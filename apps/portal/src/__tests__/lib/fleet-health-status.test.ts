/**
 * Fleet Health — how a vehicle's status reaches the operator.
 *
 * Three pieces of pure logic sit between the database and the screen, and all
 * three live inside hook bodies rather than in `lib/`:
 *
 *   * the urgency comparator in `useFleetHealth` — what the operator reads first
 *   * `useFleetHealthStats` — the counts, and the coverage gate that decides
 *     whether the page shows a table or a setup screen
 *   * `friendlyError` in `use-maintenance-jobs` — which Postgres conflict codes
 *     become which sentence, and specifically which one offers an override
 *
 * None of them can be reached by importing the module: the hooks pull in
 * `@tanstack/react-query`, the Supabase client and `TenantContext`, and this
 * workspace cannot load React at all (portal pins 18.3.1, the monorepo root
 * hoists 19 — see the header of `helpers/source.ts`).
 *
 * So they are LIFTED: the real source text is parsed out of the shipped file,
 * compiled, and executed with its React-shaped dependencies passed in as plain
 * arguments. `useFleetHealthStats` is an ordinary function that happens to call
 * one hook, so injecting a stub `useFleetHealth` runs the genuine shipped body
 * with no renderer involved. If any of this is renamed, the lift throws and this
 * suite goes red rather than quietly passing against a stale copy.
 */

import { describe, it, expect } from "vitest";
import ts from "typescript";
import {
  HEALTH_STATUS_RANK,
  isVehicleSeeded,
  type VehicleHealthStatus,
} from "@/types/fleet-health";
import {
  readPortalSource,
  liftDeclaration,
  compile,
  compileExpression,
  codeOnly,
} from "../helpers/edge-source";

const fleetHealthHook = readPortalSource("hooks/use-fleet-health.ts");
const jobsHook = readPortalSource("hooks/use-maintenance-jobs.ts");
const odometerHook = readPortalSource("hooks/use-vehicle-odometer.ts");

/**
 * The callback of the file's single `.sort(...)` call.
 *
 * These comparators are anonymous arguments, not named declarations, so
 * `liftDeclaration` cannot reach them. Requiring EXACTLY one match is the guard:
 * if a second sort is added the lift fails loudly instead of silently testing
 * whichever one happened to come first.
 */
function liftSortComparator(source: string, file: string): string {
  const sf = ts.createSourceFile("lifted.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "sort" &&
      node.arguments.length === 1
    ) {
      found.push(node.arguments[0].getText(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (found.length !== 1) {
    throw new Error(
      `Expected exactly one .sort() in ${file}, found ${found.length}. ` +
        "Update this test to name the comparator it is guarding.",
    );
  }
  return found[0];
}

// ---------------------------------------------------------------------------
// 1. The urgency comparator — "what needs my attention?", answered in 5 seconds.
// ---------------------------------------------------------------------------

interface SortableRow {
  status: VehicleHealthStatus;
  reg: string;
}

/** The real comparator from useFleetHealth, fed the real rank table. */
const compareByUrgency = compileExpression<
  (rank: Record<VehicleHealthStatus, number>) => (a: SortableRow, b: SortableRow) => number
>(
  ["HEALTH_STATUS_RANK"],
  [`const compareVehicleHealth = ${liftSortComparator(fleetHealthHook, "use-fleet-health.ts")};`],
  "compareVehicleHealth",
)(HEALTH_STATUS_RANK);

const row = (status: VehicleHealthStatus, reg: string): SortableRow => ({ status, reg });
const order = (rows: SortableRow[]): string[] =>
  [...rows].sort(compareByUrgency).map((r) => `${r.status}:${r.reg}`);

describe("fleet health list order", () => {
  it("sorts by urgency regardless of the order the rows arrive in", () => {
    // The query has no ORDER BY, so Postgres row order is whatever the cache
    // table hands back. Everything the operator sees first is decided here.
    const shuffled = [
      row("ok", "AA01 OKO"),
      row("unknown", "BB02 UNK"),
      row("off_road", "CC03 OFF"),
      row("attention", "DD04 ATT"),
      row("overdue", "EE05 OVD"),
      row("not_road_legal", "FF06 NRL"),
    ];
    expect(order(shuffled)).toEqual([
      "not_road_legal:FF06 NRL",
      "overdue:EE05 OVD",
      "attention:DD04 ATT",
      "off_road:CC03 OFF",
      "unknown:BB02 UNK",
      "ok:AA01 OKO",
    ]);
  });

  it("puts a blocked vehicle first even when its reg sorts last", () => {
    // Urgency strictly dominates the alphabet — the tie-break must never be able
    // to bury a vehicle that cannot legally go out.
    expect(order([row("ok", "AAA"), row("not_road_legal", "ZZZ")])).toEqual([
      "not_road_legal:ZZZ",
      "ok:AAA",
    ]);
  });

  it("keeps unknown vehicles above the healthy fleet", () => {
    // Product rule: `unknown` is a first-class status. On a 22-vehicle fleet with
    // three healthy cars, sorting unknown below ok would push every vehicle that
    // needs an odometer reading off the first screen — which is the same as not
    // reporting it.
    const rows = [row("ok", "AAA 111"), row("ok", "BBB 222"), row("unknown", "ZZZ 999")];
    expect(order(rows)[0]).toBe("unknown:ZZZ 999");
  });

  it("breaks ties on registration, ascending", () => {
    const rows = [row("overdue", "KL21 ABC"), row("overdue", "BD19 XYZ"), row("overdue", "AA70 ZZZ")];
    expect(order(rows)).toEqual([
      "overdue:AA70 ZZZ",
      "overdue:BD19 XYZ",
      "overdue:KL21 ABC",
    ]);
  });

  it("compares registrations case-insensitively rather than by code point", () => {
    // `localeCompare`, not `<`. A raw comparison would sort every lowercase reg
    // below every uppercase one, so a badly-entered plate would jump the queue.
    expect(compareByUrgency(row("ok", "ab01 xyz"), row("ok", "AC01 XYZ"))).toBeLessThan(0);
  });

  it("orders registrations lexicographically, not numerically", () => {
    // Documented, not endorsed: "AB10" sorts before "AB9". Registrations are
    // opaque identifiers here, so this only affects tie-break display order —
    // but a future switch to a numeric collator should be a deliberate change.
    expect(compareByUrgency(row("ok", "AB10"), row("ok", "AB9"))).toBeLessThan(0);
  });

  it("returns 0 only when both status and registration match", () => {
    expect(compareByUrgency(row("ok", "AA01"), row("ok", "AA01"))).toBe(0);
    expect(compareByUrgency(row("ok", "AA01"), row("ok", "AA02"))).not.toBe(0);
    expect(compareByUrgency(row("ok", "AA01"), row("unknown", "AA01"))).not.toBe(0);
  });

  it("consumes the shared rank table rather than an inline order", () => {
    // If the comparator ever hardcodes its own ordering, HEALTH_STATUS_RANK stops
    // being the single source of truth and the chips can disagree with the list.
    expect(liftSortComparator(fleetHealthHook, "use-fleet-health.ts")).toContain(
      "HEALTH_STATUS_RANK",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. useFleetHealthStats — the counts and the setup gate.
// ---------------------------------------------------------------------------

interface StatsRow {
  status: VehicleHealthStatus;
  current_mileage: number | null;
}

interface FleetHealthStats {
  isLoading: boolean;
  total: number;
  counts: Record<string, number>;
  needsAttention: number;
  seeded: number;
  unseeded: number;
  coverage: number;
  shouldShowSetup: boolean;
}

/**
 * The real `useFleetHealthStats`, with its one hook dependency injected. The
 * function never touches React itself — it destructures whatever `useFleetHealth`
 * returns — so a plain object stub runs the shipped body verbatim.
 */
const buildStats = compileExpression<
  (useFleetHealth: () => { data?: StatsRow[]; isLoading: boolean }) => () => FleetHealthStats
>(
  ["useFleetHealth"],
  [liftDeclaration(fleetHealthHook, "useFleetHealthStats")],
  "useFleetHealthStats",
);

const statsFor = (rows: StatsRow[], isLoading = false): FleetHealthStats =>
  buildStats(() => ({ data: rows, isLoading }))();

const seededRow = (status: VehicleHealthStatus, miles: number): StatsRow => ({
  status,
  current_mileage: miles,
});
const unseededRow = (status: VehicleHealthStatus = "unknown"): StatsRow => ({
  status,
  current_mileage: null,
});

describe("fleet health stats", () => {
  it("counts each status and totals the fleet", () => {
    const stats = statsFor([
      seededRow("ok", 10_000),
      seededRow("ok", 20_000),
      seededRow("overdue", 30_000),
      unseededRow(),
    ]);
    expect(stats.total).toBe(4);
    expect(stats.counts).toEqual({ ok: 2, overdue: 1, unknown: 1 });
  });

  it("counts only actionable statuses as needing attention", () => {
    // `unknown` needs an INPUT, not a repair, and `off_road` is already being
    // dealt with. Folding either into this number turns the headline stat into
    // noise on day one, when most of a real fleet is unknown.
    const stats = statsFor([
      seededRow("not_road_legal", 1),
      seededRow("overdue", 2),
      seededRow("attention", 3),
      seededRow("off_road", 4),
      seededRow("ok", 5),
      unseededRow(),
    ]);
    expect(stats.needsAttention).toBe(3);
  });

  it("survives an empty result and never divides by zero", () => {
    const stats = statsFor([]);
    expect(stats.total).toBe(0);
    expect(stats.coverage).toBe(0);
    expect(stats.needsAttention).toBe(0);
    // A tenant with no vehicles is not "not set up" — there is nothing to set up.
    // Showing the odometer setup screen to them would be a dead end.
    expect(stats.shouldShowSetup).toBe(false);
  });

  it("passes the loading flag straight through", () => {
    expect(statsFor([], true).isLoading).toBe(true);
    expect(statsFor([], false).isLoading).toBe(false);
  });
});

describe("the setup gate", () => {
  /** n vehicles, `seeded` of them with a reading. */
  const fleet = (total: number, seeded: number): StatsRow[] =>
    Array.from({ length: total }, (_, i) =>
      i < seeded ? seededRow("ok", 10_000 + i) : unseededRow(),
    );

  it("shows setup when almost nothing has an odometer reading", () => {
    // The real day-one shape: an all-unknown table reads as broken software
    // rather than as missing input, so the page shows the work-list instead.
    const stats = statsFor(fleet(20, 2));
    expect(stats.coverage).toBeCloseTo(0.1);
    expect(stats.unseeded).toBe(18);
    expect(stats.shouldShowSetup).toBe(true);
  });

  it("stops showing setup at exactly 25% coverage", () => {
    // Boundary of `seeded / total < 0.25`. Off-by-one here either strands a
    // tenant on the setup screen after they have done the work, or drops them
    // into a table that is still mostly unknown.
    expect(statsFor(fleet(4, 1)).shouldShowSetup).toBe(false);
    expect(statsFor(fleet(100, 25)).shouldShowSetup).toBe(false);
    expect(statsFor(fleet(100, 24)).shouldShowSetup).toBe(true);
  });

  it("never shows setup to a fully seeded fleet", () => {
    const stats = statsFor(fleet(6, 6));
    expect(stats.coverage).toBe(1);
    expect(stats.unseeded).toBe(0);
    expect(stats.shouldShowSetup).toBe(false);
  });

  it("counts a vehicle reading exactly 0 miles as seeded", () => {
    // THE bug this whole predicate exists to avoid. A brand-new car reads 0; a
    // truthiness check drops it, which here would drag a compliant 4-vehicle
    // fleet from 25% coverage down to 0% and throw the operator back onto the
    // setup screen for a reading they already entered.
    const rows = [seededRow("ok", 0), unseededRow(), unseededRow(), unseededRow()];
    const stats = statsFor(rows);
    expect(stats.seeded).toBe(1);
    expect(stats.coverage).toBe(0.25);
    expect(stats.shouldShowSetup).toBe(false);
  });

  it("agrees with isVehicleSeeded on every kind of mileage value", () => {
    // Two implementations of one idea — the exported predicate used by the
    // vehicle-level UI, and the inline `!= null` filter used for the fleet-level
    // gate. They must not be allowed to diverge.
    const cases: Array<number | null> = [0, 1, 128_400, null];
    for (const mileage of cases) {
      const stats = statsFor([{ status: "ok", current_mileage: mileage }]);
      expect(stats.seeded === 1, `current_mileage=${String(mileage)}`).toBe(
        isVehicleSeeded({ current_mileage: mileage }),
      );
    }
  });

  it("uses a null check rather than a truthiness check for coverage", () => {
    const decl = liftDeclaration(fleetHealthHook, "useFleetHealthStats");
    expect(decl).toContain("current_mileage != null");
    expect(decl).not.toMatch(/filter\(\(r\) => r\.current_mileage\)/);
  });
});

// ---------------------------------------------------------------------------
// 3. Conflict errors — which failure the operator is allowed to override.
// ---------------------------------------------------------------------------

const friendlyError = compile<(e: unknown, fallback: string) => string>(
  [liftDeclaration(jobsHook, "RPC_ERRORS"), liftDeclaration(jobsHook, "friendlyError")],
  "friendlyError",
);

const rpcErrors = compile<Record<string, string>>(
  [liftDeclaration(jobsHook, "RPC_ERRORS")],
  "RPC_ERRORS",
);

describe("maintenance RPC errors become sentences", () => {
  it("handles exactly the three conflict codes the RPC raises", () => {
    expect(Object.keys(rpcErrors).sort()).toEqual(["23P02", "23P03", "23P04"]);
    for (const [code, sentence] of Object.entries(rpcErrors)) {
      expect(sentence, code).toMatch(/[.!]$/);
      // The raw SQLSTATE tells the operator nothing and looks like a crash.
      expect(sentence, code).not.toContain(code);
    }
  });

  it("explains a double-booked maintenance window", () => {
    expect(friendlyError({ code: "23P02" }, "fallback")).toMatch(/already off the road/i);
  });

  it("distinguishes the blocking conflict from the overridable one", () => {
    // 23P03 is an ACTIVE rental — the customer is in the car, so the only route
    // forward is to move them. 23P04 is a set of bookings the operator may
    // knowingly override, and is the one path that is allowed to send force:true.
    const active = friendlyError({ code: "23P03" }, "fallback");
    const overridable = friendlyError({ code: "23P04" }, "fallback");

    expect(active).toMatch(/active rental/i);
    expect(active).not.toMatch(/override|confirm/i);
    expect(overridable).toMatch(/override|confirm/i);
    expect(active).not.toBe(overridable);
  });

  it("reads the code from a nested details object as well as the top level", () => {
    // supabase-js surfaces PostgrestError at the top level, but a wrapped RPC
    // failure arrives with the code one level down. Only handling one shape sends
    // half of these conflicts to the screen as raw Postgres text.
    expect(friendlyError({ details: { code: "23P02" } }, "fallback")).toBe(rpcErrors["23P02"]);
  });

  it("passes through an unmapped error's own message", () => {
    // Rule: the hook maps the codes it knows and surfaces everything else
    // verbatim. Swallowing unknown failures into a generic sentence hides
    // permission and network errors that need a different fix.
    expect(friendlyError({ code: "23505", message: "duplicate key value" }, "fallback")).toBe(
      "duplicate key value",
    );
    expect(friendlyError({ message: "network error" }, "fallback")).toBe("network error");
  });

  it("falls back only when there is nothing else to say", () => {
    expect(friendlyError({}, "Failed to schedule maintenance")).toBe(
      "Failed to schedule maintenance",
    );
    expect(friendlyError(null, "Failed to schedule maintenance")).toBe(
      "Failed to schedule maintenance",
    );
  });
});

describe("overriding a booking conflict stays opt-in", () => {
  // Product rule: the operator must SEE the conflicting bookings — with payment
  // status and amount — and acknowledge them before anything is forced. The
  // dialog is unreachable from this workspace, but the two facts that make the
  // acknowledgement meaningful are pinned here.
  const code = codeOnly(jobsHook);

  it("defaults p_force to false", () => {
    // A flip to `?? true` would make the acknowledgement step decorative: the
    // schedule would succeed on the first attempt and the conflicts panel would
    // never render.
    expect(code).toContain("p_force: input.force ?? false");
    expect(code).not.toContain("p_force: input.force ?? true");
    expect(code).not.toContain("p_force: true");
  });

  it("documents force as post-acknowledgement only", () => {
    expect(jobsHook).toMatch(/Only ever set after the operator has seen and accepted/i);
  });

  it("previews conflicts through the dedicated RPC before committing", () => {
    const health = codeOnly(fleetHealthHook);
    expect(health).toContain("preview_maintenance_conflicts");
    // No window means no preview — the query stays disabled rather than
    // returning an empty list that would read as "no conflicts".
    expect(health).toContain("enabled: !!tenant?.id && !!vehicleId && !!start && !!end");
  });
});

// ---------------------------------------------------------------------------
// 4. The setup work-list order.
// ---------------------------------------------------------------------------

interface WorklistVehicle {
  reg: string;
  mot_due_date?: string | null;
  tax_due_date?: string | null;
  last_service_date?: string | null;
}

const sortWorklist = compile<(a: WorklistVehicle, b: WorklistVehicle) => number>(
  [`const sortWorklist = ${liftSortComparator(odometerHook, "use-vehicle-odometer.ts")};`],
  "sortWorklist",
);

describe("odometer setup work-list order", () => {
  const worklist = (vehicles: WorklistVehicle[]): string[] =>
    [...vehicles].sort(sortWorklist).map((v) => v.reg);

  it("asks first about the vehicles where a missing reading costs the most", () => {
    // An operator seeding a 22-vehicle fleet by hand will not finish in one
    // sitting. Ordering by how much the gap costs — compliance dates first, then
    // vehicles with service history — means the first ten entries are the ten
    // that unlock the most rules.
    expect(
      worklist([
        { reg: "DDD", mot_due_date: null, tax_due_date: null, last_service_date: null },
        { reg: "CCC", mot_due_date: null, tax_due_date: null, last_service_date: "2026-01-01" },
        { reg: "BBB", mot_due_date: null, tax_due_date: "2026-09-01", last_service_date: null },
        { reg: "AAA", mot_due_date: "2026-09-01", tax_due_date: null, last_service_date: "2026-01-01" },
      ]),
    ).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  it("treats either compliance date as equally qualifying", () => {
    const byMot = { reg: "ZZZ MOT", mot_due_date: "2026-09-01", last_service_date: null };
    const byTax = { reg: "AAA TAX", tax_due_date: "2026-09-01", last_service_date: null };
    // Equal score, so the alphabet decides: an MOT date and a tax date are the
    // same signal — both mean this vehicle has a deadline the missing reading
    // cannot be projected against.
    expect(worklist([byMot, byTax])).toEqual(["AAA TAX", "ZZZ MOT"]);
    // ...and the score still beats the alphabet when it differs.
    expect(worklist([{ reg: "AAA NONE" }, byMot])).toEqual(["ZZZ MOT", "AAA NONE"]);
  });

  it("breaks ties on registration so the list is stable between refetches", () => {
    // Every row here scores identically. Without the tie-break the list would
    // reshuffle on each poll and the operator would lose their place mid-way
    // through data entry.
    expect(
      worklist([{ reg: "ZZZ 999" }, { reg: "AAA 111" }, { reg: "MMM 555" }]),
    ).toEqual(["AAA 111", "MMM 555", "ZZZ 999"]);
  });

  it("tolerates a registration that is not a string", () => {
    // The comparator coerces with String() — the column is NOT NULL in practice
    // but the query is untyped, and a null here would otherwise throw inside
    // Array.prototype.sort and blank the whole setup screen.
    expect(() =>
      [{ reg: null as unknown as string }, { reg: "AAA" }].sort(sortWorklist),
    ).not.toThrow();
  });
});
