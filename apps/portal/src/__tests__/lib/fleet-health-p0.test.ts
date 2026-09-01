import { describe, it, expect } from "vitest";
import { readRepoSource, readPortalSource } from "../helpers/edge-source";

/**
 * Guards for the Fleet Health correctness work.
 *
 * These are source assertions rather than executions, and deliberately so: the
 * logic being pinned is plpgsql, there is no database in CI, and the honest
 * options were to assert on the real file or to assert on a paste of it. The
 * helper reads the shipped file, so deleting or rewording any of these turns the
 * suite red instead of quietly reopening the hole.
 *
 * WHAT IS *NOT* ASSERTED HERE, AND WHY
 *
 * §5.1 (check_rental_overlap reading blocked_dates) and §5.2/§5.3 (the
 * timezone-aware, per-row reconciler) were verified as ALREADY LIVE by querying
 * production directly. Neither appears in any migration file — they were applied
 * through the Supabase MCP, which is the convention spec §10.5 prescribes. There
 * is therefore no repo artefact to assert against, and writing one would mean
 * re-shipping a definition that differs from the live one:
 *
 *   - live check_rental_overlap raises 23P02 (not 23P05), scopes to
 *     source_type IN ('maintenance','swap'), and reports the reason_code
 *   - live sync_vehicle_maintenance_status RETURNS integer (not void) and
 *     LEFT JOINs tenants, so a vehicle with no tenant row is still reconciled
 *
 * Anything asserting otherwise would be asserting a regression.
 */

const defects = () =>
  readRepoSource("supabase/migrations/20260823130000_fleet_health_defect_fixes.sql");

/**
 * Pull one CREATE FUNCTION body out of a migration.
 *
 * Taking the EARLIEST terminator present is what stops an assertion about one
 * function silently passing because the text it wanted was in the next one down.
 */
const fn = (sql: string, name: string): string => {
  const start = sql.indexOf(`FUNCTION ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const rest = sql.slice(start);

  // pg_get_functiondef wraps the body in a dollar-quoted tag, so the tag occurs
  // TWICE — opening and closing. Searching from index 0 finds the opening one
  // and truncates the body to nothing, which is a test that passes for the wrong
  // reason on negative assertions. Anchor past the opener, then find its match.
  const openTag = /AS (\$[A-Za-z_]*\$)/.exec(rest);
  if (openTag) {
    const bodyStart = openTag.index + openTag[0].length;
    const close = rest.indexOf(openTag[1], bodyStart);
    expect(close, `unterminated body for ${name}`).toBeGreaterThan(-1);
    return rest.slice(0, close);
  }

  const end = rest.indexOf("$$ LANGUAGE plpgsql;");
  expect(end, `no terminator found for ${name}`).toBeGreaterThan(-1);
  return rest.slice(0, end);
};

describe("the defect migration is rebased on the live definitions", () => {
  it("says so, so nobody regenerates it from the repo files", () => {
    expect(defects()).toContain("REBASED ONTO THE LIVE DEFINITIONS");
  });

  it("does not try to redefine check_rental_overlap — production's is ahead", () => {
    expect(defects()).not.toContain("FUNCTION check_rental_overlap");
  });

  it("does not try to redefine the reconciler — its return type alone would fail", () => {
    expect(defects()).not.toContain("FUNCTION public.sync_vehicle_maintenance_status");
  });
});

describe("D1 — the PAYG pause is scoped to its own window", () => {
  const body = () => fn(defects(), "public.schedule_vehicle_maintenance");

  it("only pauses rentals that overlap the maintenance window", () => {
    const b = body();
    const pause = b.slice(b.indexOf("payg_paused = true"));
    expect(pause).toContain("start_date <= p_end");
    expect(pause).toContain("end_date, '9999-12-31'::date) >= p_start");
  });

  it("only pauses once the window has actually started", () => {
    const b = body();
    const pause = b.slice(b.indexOf("-- The agreement's one maintenance promise"));
    expect(pause).toContain("IF p_start <= v_today AND p_end >= v_today THEN");
  });

  it("still refuses to take an actively-rented vehicle off the road (D8)", () => {
    expect(body()).toContain("23P03");
  });

  it("still gates a conflicting window behind force (F6)", () => {
    expect(body()).toContain("23P04");
  });

  it("still records the hold as a structured reason_code, keeping narrative off blocked_dates", () => {
    const b = body();
    expect(b).toContain("source_type, reason_code");
  });
});

describe("D2 — rule selection is deterministic", () => {
  const body = () => fn(defects(), "public.evaluate_vehicle_health");

  it("breaks the tie beyond the vehicle-specific preference", () => {
    const b = body();
    const order = b.slice(b.indexOf("ORDER BY COALESCE(r.service_type"));
    expect(order).toContain("r.created_at DESC");
    expect(order).toContain("r.id");
  });

  it("still prefers a vehicle-specific rule over the tenant default", () => {
    expect(body()).toContain("(r.vehicle_id IS NULL)");
  });

  it("still resolves each rule's baseline by service_type, never last_service_date", () => {
    const b = body();
    expect(b).toContain("sr.service_type = rule.service_type");
    expect(b).not.toContain("v.last_service_date");
  });

  it("keeps the F9 set-based tenant burn — the per-sibling loop was O(N^2)", () => {
    expect(body()).toContain("per_vehicle AS");
  });
});

describe("cross-tenant scoping in the client", () => {
  it("a calendar block cannot be deleted across tenants", () => {
    const s = readPortalSource("hooks/use-calendar-blocks.ts");
    const remove = s.slice(s.indexOf("const removeBlock"));
    expect(remove).toContain('.eq("tenant_id", tenant.id)');
  });
});

describe("conflict detection uses statuses that exist", () => {
  it("the blocked-dates screen checks Pending, not the non-existent Confirmed", () => {
    const s = readPortalSource("components/blocked-dates/blocked-dates-manager.tsx");
    expect(s).toContain("['Active', 'Pending']");
    expect(s).not.toContain("['Active', 'Confirmed']");
  });

  it("the RPC and the screen agree", () => {
    const rpc = readRepoSource(
      "supabase/migrations/20260822120000_fleet_health_security_and_defect_fixes.sql",
    );
    expect(rpc).toContain("r.status IN ('Active','Pending')");
  });
});

describe("§5.1 — the portal booking form no longer waives a maintenance hold", () => {
  const page = () => readPortalSource("app/(dashboard)/rentals/new/page.tsx");

  it("enforces a vehicle-specific maintenance hold, not only a global block", () => {
    expect(page()).toContain("block.vehicle_id === vehicleId && isHold");
  });

  it("has dropped the comment that documented the bypass", () => {
    expect(page()).not.toContain("vehicle-specific blocks are informational only");
  });

  it("honours manual blocks too — deliberately stricter than the trigger", () => {
    const s = page();
    // REVERSED 2026-08-28, with evidence the original decision lacked.
    //
    // This previously scoped to maintenance/swap so the client could not be
    // stricter than check_rental_overlap. In practice that left this screen —
    // the one operators use most — as the only place a block they deliberately
    // created had no effect. Five rentals were created straight over an
    // in-force block, every one of them source='portal'; one cost a tenant a
    // $410.15 refund and a written apology to the customer.
    //
    // Every in-force block's reason is unambiguous: "Car totaled", "Wreak",
    // "repair", "Turo", "rented", "Rented long term". An operator blocking
    // dates means "do not book this car".
    //
    // The trigger cannot safely take this on: its maintenance branch raises
    // 23P02 interpolating the operator's private note, and nothing in the
    // booking app catches that errcode, so it would surface to a customer.
    // Client-side is the correct home for it — staff who genuinely need to
    // book can delete the block first.
    expect(s).toContain('block.source_type === "manual"');
    expect(s).toContain('block.vehicle_id === vehicleId && isHold');
  });
});
