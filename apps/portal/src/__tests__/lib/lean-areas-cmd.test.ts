import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LEAN_HIDDEN_AREAS, isAreaHidden } from "@/lib/lean-areas";

/**
 * The CheckMyDriver (Modives) driver-licence verification gate.
 *
 * CMD was DELETED from main — 19 files, 2,692 lines, taking six edge
 * functions, the Modives client, two migrations and the entire customer-side
 * verification panel with it (92f3a57b). That is the same inversion Fleet
 * Quotes, Tesla Fleet and Accounting already cost this project: it hides the
 * feature from ONE canary by withdrawing it from the other 56 tenants. The
 * code is back (revert of 92f3a57b) and only what `northwind` SEES changes.
 *
 * MEASURED AGAINST PRODUCTION at restore time:
 *   - `identity_verifications` carries 3 rows with `provider = 'cmd'`, all 3
 *     on the internal `test` tenant. northwind has none.
 *   - the eight `cmd_*` columns are still live on `identity_verifications`.
 *   - there is NO CMD cron job: all 23 rows of `cron.job` were enumerated and
 *     none polls CMD, so `cmd-poll-pending` is deployed source with nothing
 *     scheduled against it. Restoring the migration file did not and must not
 *     re-schedule it.
 *
 * So this gate is cosmetic for the canary and costs nobody else anything —
 * which is exactly the point. The assertion that carries the weight below is
 * not "northwind is hidden"; it is that nobody else is.
 */
describe("isAreaHidden('cmd')", () => {
  it("is a real member of LEAN_HIDDEN_AREAS", () => {
    // A typo'd or missing area is not a compile error at runtime — isAreaHidden
    // fails open on anything it does not recognise. Without this assertion the
    // gate could silently never fire and every test below would still pass by
    // agreeing that nothing is hidden. That exact bug shipped once with
    // `fleet-health`.
    expect(LEAN_HIDDEN_AREAS).toContain("cmd");
  });

  it("hides CMD from the northwind canary", () => {
    expect(isAreaHidden("cmd", "northwind")).toBe(true);
  });

  it("leaves CMD visible for every non-canary tenant", () => {
    // THIS is the outage case. Every one of these is a live operator; the
    // deletion took CMD from all of them to hide it from one.
    for (const slug of [
      "test",
      "revtek",
      "jangram",
      "goniko",
      "drive-247",
      "eastpeakrentalsllc",
      "globalmotiontransport",
      "openbayrental",
      "flowrentalsllc",
      "drive-hustle",
    ]) {
      expect(isAreaHidden("cmd", slug)).toBe(false);
    }
  });

  it("fails OPEN on an unresolved slug", () => {
    // TenantContext resolves the slug client-side and it is null for a tick on
    // first paint, and stays null on an unrecognised host. A gate that failed
    // closed there would blank CMD for every tenant during that tick.
    expect(isAreaHidden("cmd", null)).toBe(false);
    expect(isAreaHidden("cmd", undefined)).toBe(false);
    expect(isAreaHidden("cmd", "")).toBe(false);
    expect(isAreaHidden("cmd", "not-a-real-tenant")).toBe(false);
  });

  it("is never satisfied by a tenant ID", () => {
    // northwind is 6e5c544f-… in production but 8e6bc88f-… on staging, because
    // staging was seeded rather than cloned. An id-keyed gate resolves to the
    // ungated path on localhost with no error and no failed build.
    expect(isAreaHidden("cmd", "6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(isAreaHidden("cmd", "8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
  });

  it("matches the slug exactly", () => {
    expect(isAreaHidden("cmd", "Northwind")).toBe(false);
    expect(isAreaHidden("cmd", " northwind")).toBe(false);
    expect(isAreaHidden("cmd", "northwind-2")).toBe(false);
  });

  it("is not satisfied by the vendor names or the provider value", () => {
    // The gate takes a tenant SLUG. `cmd` is an area key and a DB provider
    // value; `modives` and `checkmydriver` are the vendor. None is a tenant.
    for (const notATenant of ["cmd", "modives", "checkmydriver", "CheckMyDriver", "verification"]) {
      expect(isAreaHidden("cmd", notATenant)).toBe(false);
    }
  });

  it("does not disturb the areas gated before it", () => {
    for (const area of LEAN_HIDDEN_AREAS.filter((a) => a !== "cmd")) {
      expect(isAreaHidden(area, "northwind")).toBe(true);
      expect(isAreaHidden(area, "goniko")).toBe(false);
    }
  });
});

/**
 * Call-site assertions.
 *
 * `isAreaHidden` being correct proves nothing about whether anything CALLS it.
 * A gate that is never invoked is silently inert — the screen simply never
 * changes and nothing errors. These read the real source so a future edit that
 * drops a gate fails here rather than in production.
 */
const SRC = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

describe("CMD gate call sites", () => {
  it("gates the customer-detail CMD tab and dialog", () => {
    const src = read("app/(dashboard)/customers/[id]/page.tsx");
    expect(src).toMatch(/import \{ isAreaHidden \} from "@\/lib\/lean-areas";/);
    expect(src).toMatch(/const cmdHidden = isAreaHidden\("cmd", tenantSlug\);/);
    // hasCmd drives the entire CMD tab block; the dialog is gated separately.
    expect(src).toMatch(/const hasCmd = !!cmdVerification && !cmdHidden;/);
    expect(src).toMatch(/\{customer && !cmdHidden && \(/);
  });

  it("gates the CMD queries at the hook, not just the markup", () => {
    // Gating only the markup would still issue the reads for the canary.
    const src = read("hooks/use-cmd-verification.ts");
    expect(src).toMatch(/const cmdHidden = isAreaHidden\("cmd", tenantSlug\);/);
    expect(src).toMatch(/enabled: !!customerId && !!tenant\?\.id && !cmdHidden,/);
    expect(src).toMatch(/enabled: !!applicantVerificationId && !cmdHidden,/);
  });

  it("gates the CheckMyDriver card on the Integrations board", () => {
    // This surface was NOT part of the delete, so restoring the commit does not
    // cover it. It is a v2-only route, which means the canary is very nearly
    // the only tenant that can reach it.
    const src = read("app/(dashboard)/integrations/integrations-board.tsx");
    expect(src).toMatch(/const cmdHidden = isAreaHidden\("cmd", tenantSlug\);/);
    expect(src).toMatch(/i\.name !== "CheckMyDriver"/);
    // The grid must render the FILTERED list, not the raw array.
    expect(src).toMatch(/\{visibleIntegrations\.map\(\(it\) => \(/);
    expect(src).not.toMatch(/\{integrations\.map\(\(it\) => \(/);
    // …and the entry itself must still be on main for everyone else.
    expect(src).toMatch(/name: "CheckMyDriver"/);
  });

  it("drops the two CMD checklist rows from the canary dashboard", () => {
    const src = read("hooks/use-platform-status.ts");
    expect(src).toMatch(/const cmdHidden = isAreaHidden\("cmd", tenantSlug\);/);
    expect(src).toMatch(/\.\.\.\(cmdHidden\s*\n\s*\? \[\]/);
    // Both rows must stay in the file for every other tenant.
    expect(src).toMatch(/id: "cmd-driver-verification"/);
    expect(src).toMatch(/id: "cmd-insurance-verification"/);
  });
});

/**
 * Restore assertions — nothing left main.
 *
 * The whole point of gating rather than parking is that the feature is still
 * there for the other 56 tenants. If a future "cleanup" deletes it again,
 * these fail.
 */
describe("CMD is still on main", () => {
  it("keeps the portal hook, dialog and logos", () => {
    expect(() => read("hooks/use-cmd-verification.ts")).not.toThrow();
    expect(() => read("components/customers/start-cmd-verification-dialog.tsx")).not.toThrow();
    expect(() => read("components/customers/identity-verification-tab.tsx")).not.toThrow();
  });

  it("keeps the six edge functions and the Modives client", () => {
    const fns = join(SRC, "../../../supabase/functions");
    for (const f of [
      "_shared/modives-client.ts",
      "cmd-create-verification/index.ts",
      "cmd-get-results/index.ts",
      "cmd-get-status/index.ts",
      "cmd-poll-pending/index.ts",
      "cmd-resend-link/index.ts",
      "cmd-webhook/index.ts",
    ]) {
      expect(() => readFileSync(join(fns, f), "utf8")).not.toThrow();
    }
  });

  it("keeps the two webhook JWT exemptions in config.toml", () => {
    const cfg = readFileSync(join(SRC, "../../../supabase/config.toml"), "utf8");
    expect(cfg).toMatch(/\[functions\.cmd-webhook\]\nverify_jwt = false/);
    expect(cfg).toMatch(/\[functions\.cmd-poll-pending\]\nverify_jwt = false/);
  });
});
