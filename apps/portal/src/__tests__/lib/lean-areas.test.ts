import { describe, expect, it } from "vitest";

import { LEAN_HIDDEN_AREAS, isAreaHidden } from "@/lib/lean-areas";

/**
 * The gate that hides Enquiries, Leads and Automations from the lean canary.
 *
 * Three cases, deliberately — two cannot tell "the gate refused" apart from
 * "the tenant lookup came back empty":
 *   1. the canary               → hidden
 *   2. a real non-canary tenant → visible (51 production tenants have
 *                                 enquiries on; this is the outage case)
 *   3. a slug that is not a tenant at all → visible
 */
describe("isAreaHidden", () => {
  it("hides every gated area from the northwind canary", () => {
    for (const area of LEAN_HIDDEN_AREAS) {
      expect(isAreaHidden(area, "northwind")).toBe(true);
    }
  });

  it("hides nothing from real non-canary tenants", () => {
    for (const slug of ["goniko", "revtekrentals", "globalmotiontransport"]) {
      for (const area of LEAN_HIDDEN_AREAS) {
        expect(isAreaHidden(area, slug)).toBe(false);
      }
    }
  });

  it("hides nothing for a slug that is not a tenant", () => {
    for (const area of LEAN_HIDDEN_AREAS) {
      expect(isAreaHidden(area, "not-a-real-tenant")).toBe(false);
    }
  });

  it("fails open while the tenant slug is still unresolved", () => {
    // TenantContext leaves the slug null for a tick on first paint, and keeps
    // it null on an unrecognised host. Neither may hide anything.
    for (const area of LEAN_HIDDEN_AREAS) {
      expect(isAreaHidden(area, null)).toBe(false);
      expect(isAreaHidden(area, undefined)).toBe(false);
      expect(isAreaHidden(area, "")).toBe(false);
    }
  });

  it("keys on the slug, never on a tenant id", () => {
    // Same tenant, different primary key per environment — prod vs the seeded
    // staging branch. Neither id may ever satisfy the gate.
    expect(isAreaHidden("leads", "6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(isAreaHidden("leads", "8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
  });

  it("is case- and whitespace-exact", () => {
    expect(isAreaHidden("leads", "Northwind")).toBe(false);
    expect(isAreaHidden("leads", " northwind")).toBe(false);
    expect(isAreaHidden("leads", "northwind-2")).toBe(false);
  });
});

/**
 * Tesla Fleet, called out on its own because the cost of getting it wrong is
 * already known. The integration was DELETED from main rather than gated, and
 * Jangram Rentals — a live Denver operator with 6 Teslas, 5 wired to the Fleet
 * API — lost automatic Supercharger billing until it was restored (c37e0f55).
 *
 * So the assertion that matters here is not "northwind is hidden". It is that
 * NO other tenant is: jangramrentals and openbayrental both have
 * `integration_tesla_fleet = true` in production today, and the `test` tenant
 * carries 9 wired vehicles. Any of them turning true is an outage, not a
 * cosmetic regression.
 */
describe("isAreaHidden('tesla')", () => {
  it("is a real member of LEAN_HIDDEN_AREAS", () => {
    // A typo'd or missing area is not a compile error at runtime — isAreaHidden
    // returns false for anything it does not recognise (fail-open). So the
    // membership itself has to be asserted, or the gate silently never fires.
    expect(LEAN_HIDDEN_AREAS).toContain("tesla");
  });

  it("hides Tesla Fleet from the northwind canary", () => {
    expect(isAreaHidden("tesla", "northwind")).toBe(true);
  });

  it("hides Tesla Fleet from NO ONE else", () => {
    // jangramrentals is the operator the removal actually broke; openbayrental
    // has the integration connected; `test` is the internal tenant with 9 wired
    // Teslas. The rest are ordinary paying tenants.
    for (const slug of [
      "jangramrentals",
      "openbayrental",
      "test",
      "goniko",
      "revtekrentals",
      "globalmotiontransport",
      "eastpeakrentalsllc",
    ]) {
      expect(isAreaHidden("tesla", slug)).toBe(false);
    }
  });

  it("fails open on an unresolved slug", () => {
    // TenantContext leaves the slug null for a tick on first paint. Hiding the
    // tab during that tick would flicker it away from Jangram on every load.
    expect(isAreaHidden("tesla", null)).toBe(false);
    expect(isAreaHidden("tesla", undefined)).toBe(false);
    expect(isAreaHidden("tesla", "")).toBe(false);
  });

  it("keys on the slug, never on a tenant id", () => {
    // northwind is 6e5c544f-… in production and 8e6bc88f-… on the seeded
    // staging branch. An id-keyed gate resolves to the ungated path on
    // localhost with no error and no failed build.
    expect(isAreaHidden("tesla", "6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(isAreaHidden("tesla", "8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
  });

  it("is case- and whitespace-exact", () => {
    expect(isAreaHidden("tesla", "Northwind")).toBe(false);
    expect(isAreaHidden("tesla", " northwind")).toBe(false);
    expect(isAreaHidden("tesla", "northwind-2")).toBe(false);
  });
});

/**
 * Welcome Pack, called out on its own for the same reason Tesla Fleet is: the
 * cost of getting it wrong is measurable rather than hypothetical.
 *
 * The pack is the in-portal operator guide at `/welcome`. It is not dormant
 * code — `welcome_pack_reads` holds 184 rows written by 16 operators across 14
 * tenants, the newest 2026-09-02, against 12 chapters / 59 sections / 62 FAQs.
 * So the assertion that carries weight below is NOT "northwind is hidden"; it
 * is that nobody else is. A tenant flipping to true here is 35+ operators
 * losing the documentation for a product they are actively learning, to hide
 * one row from one canary.
 */
describe("isAreaHidden('welcome')", () => {
  it("is a real member of LEAN_HIDDEN_AREAS", () => {
    // A typo'd or missing area is not a compile error at runtime — isAreaHidden
    // fails open on anything it does not recognise. Without this assertion the
    // gate could silently never fire and every test below would still pass by
    // agreeing that nothing is hidden.
    expect(LEAN_HIDDEN_AREAS).toContain("welcome");
  });

  it("hides the Welcome Pack from the northwind canary", () => {
    expect(isAreaHidden("welcome", "northwind")).toBe(true);
  });

  it("hides the Welcome Pack from NO ONE else", () => {
    // Ordinary paying tenants, plus the internal `test` tenant. Any of these
    // turning true is an outage of the docs, not a cosmetic regression.
    for (const slug of [
      "goniko",
      "revtekrentals",
      "globalmotiontransport",
      "jangramrentals",
      "eastpeakrentalsllc",
      "openbayrental",
      "flowrentalsllc",
      "drive-hustle",
      "test",
    ]) {
      expect(isAreaHidden("welcome", slug)).toBe(false);
    }
  });

  it("fails open on an unresolved slug", () => {
    // TenantContext leaves the slug null for a tick on first paint and keeps it
    // null on an unrecognised host. Hiding during that tick would make the nav
    // row flicker out on every load for the 14 tenants already reading it, and
    // would 404 the route out from under a mid-read operator.
    expect(isAreaHidden("welcome", null)).toBe(false);
    expect(isAreaHidden("welcome", undefined)).toBe(false);
    expect(isAreaHidden("welcome", "")).toBe(false);
  });

  it("keys on the slug, never on a tenant id", () => {
    // northwind is 6e5c544f-… in production and 8e6bc88f-… on the seeded
    // staging branch. An id-keyed gate resolves to the ungated path on
    // localhost — where the owner tests at northwind.portal.localhost:3011 —
    // with no error and no failed build, so the screen simply never changes.
    expect(isAreaHidden("welcome", "6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(isAreaHidden("welcome", "8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
  });

  it("is case- and whitespace-exact", () => {
    expect(isAreaHidden("welcome", "Northwind")).toBe(false);
    expect(isAreaHidden("welcome", " northwind")).toBe(false);
    expect(isAreaHidden("welcome", "northwind-2")).toBe(false);
  });

  it("does not disturb the areas gated before it", () => {
    // Adding an area to the tuple must not shift behaviour for the existing
    // five. Enquiries alone is on for 51 production tenants.
    for (const area of ["enquiries", "leads", "automations", "quotes", "tesla"] as const) {
      expect(isAreaHidden(area, "northwind")).toBe(true);
      expect(isAreaHidden(area, "goniko")).toBe(false);
    }
  });
});

/**
 * Vehicle Owners + Owner Payouts, called out on its own because this one is
 * settling real money and the blast radius is a payout ledger rather than a
 * screen.
 *
 * Measured against production: `vehicle_owners_enabled` is ON for 7 tenants,
 * `vehicle_owners` holds 9 rows across 4 tenants, and `owner_payouts` holds 19
 * rows — 15 of them Global Motion Transport's, totalling 4,978.55 in
 * `net_owed`, with `owner_payout_lines` beneath them. GMT is a live Chicago
 * operator paying three vehicle owners out of this screen every period.
 *
 * So the assertion that carries the weight below is NOT "northwind is hidden".
 * It is that globalmotiontransport is not — and neither are the other six
 * flag-on tenants, nor jangramrentals, whose 12 vehicles carry an `owner_id`.
 * Any of them turning true is an operator losing their payout history, not a
 * cosmetic regression.
 */
describe("isAreaHidden('owners')", () => {
  it("is a real member of LEAN_HIDDEN_AREAS", () => {
    // A typo'd or missing area is not a compile error at runtime — isAreaHidden
    // fails open on anything it does not recognise. Without this assertion the
    // gate could silently never fire and every test below would still pass by
    // agreeing that nothing is hidden.
    expect(LEAN_HIDDEN_AREAS).toContain("owners");
  });

  it("hides Vehicle Owners and Owner Payouts from the northwind canary", () => {
    expect(isAreaHidden("owners", "northwind")).toBe(true);
  });

  it("hides the area from NO tenant that has the feature switched on", () => {
    // Every slug with `vehicle_owners_enabled = true` in production, plus the
    // internal `test` tenant. globalmotiontransport is the one that matters:
    // 3 owners, 15 payouts, 4,978.55 owed.
    for (const slug of [
      "globalmotiontransport",
      "jangramrentals",
      "hezkee",
      "dbcarrentals",
      "flowrentalsllc",
      "lingam-rentals",
      "test",
    ]) {
      expect(isAreaHidden("owners", slug)).toBe(false);
    }
  });

  it("hides the area from NO ordinary tenant either", () => {
    // The Reports export card, the vehicle-detail Ownership panel and the
    // vehicles-list Owner column sit behind NO feature flag, so these tenants
    // see them today even with `vehicle_owners_enabled` off. The gate must not
    // take those away from them.
    for (const slug of [
      "goniko",
      "revtekrentals",
      "eastpeakrentalsllc",
      "openbayrental",
      "drive-hustle",
    ]) {
      expect(isAreaHidden("owners", slug)).toBe(false);
    }
  });

  it("fails open on an unresolved slug", () => {
    // TenantContext leaves the slug null for a tick on first paint and keeps it
    // null on an unrecognised host. Hiding during that tick would 404 the
    // payouts page out from under a GMT operator mid-run, and flicker the Owner
    // column out of the vehicles table on every load.
    expect(isAreaHidden("owners", null)).toBe(false);
    expect(isAreaHidden("owners", undefined)).toBe(false);
    expect(isAreaHidden("owners", "")).toBe(false);
  });

  it("keys on the slug, never on a tenant id", () => {
    // northwind is 6e5c544f-… in production and 8e6bc88f-… on the seeded
    // staging branch. An id-keyed gate resolves to the ungated path on
    // localhost — where the owner tests at northwind.portal.localhost:3011 —
    // with no error and no failed build, so the screen simply never changes.
    expect(isAreaHidden("owners", "6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(isAreaHidden("owners", "8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
    // GMT's own id, for the same reason, from the opposite direction.
    expect(isAreaHidden("owners", "ada84c6f-eb17-43b6-a14d-d16518165349")).toBe(false);
  });

  it("is case- and whitespace-exact", () => {
    expect(isAreaHidden("owners", "Northwind")).toBe(false);
    expect(isAreaHidden("owners", " northwind")).toBe(false);
    expect(isAreaHidden("owners", "northwind-2")).toBe(false);
  });

  it("is not confused by the `owner` user role or the super-admin login", () => {
    // The app has no `owner` app_users role (the roles are head_admin, admin,
    // manager, ops, viewer) but it does have owner@cortek.io as the primary
    // super-admin. Neither is a tenant slug, and neither may satisfy the gate.
    expect(isAreaHidden("owners", "owner")).toBe(false);
    expect(isAreaHidden("owners", "owner@cortek.io")).toBe(false);
    expect(isAreaHidden("owners", "head_admin")).toBe(false);
  });

  it("does not disturb the areas gated before it", () => {
    // Adding an area to the tuple must not shift behaviour for the existing
    // six. Enquiries alone is on for 51 production tenants.
    for (const area of ["enquiries", "leads", "automations", "quotes", "tesla", "welcome"] as const) {
      expect(isAreaHidden(area, "northwind")).toBe(true);
      expect(isAreaHidden(area, "goniko")).toBe(false);
    }
  });
});
/**
 * Expenses, called out on its own for the reason the two before it are: the
 * cost of getting it wrong is measurable, not hypothetical.
 *
 * `vehicle_expenses` holds 57 rows across three tenants. Eleven belong to Flow
 * Auto Rentals — 2,364.64 of real spend, newest 2026-08-10 — with 41 on the
 * internal `test` tenant and 5 on `drive-247`. So the assertion that carries
 * the weight below is NOT "northwind is hidden". It is that nobody else is: a
 * tenant flipping to true here is a live operator losing the screen that holds
 * its cost ledger, to hide one nav row from one canary.
 *
 * The gate is presentation-only and CANNOT reach P&L. Expenses feeds
 * `pnl_entries` through the database trigger `vehicle_expense_pnl_trigger`
 * (`handle_vehicle_expense_pnl()`), which is server-side and fires for any
 * writer. `pnl_entries` carries 12,559 rows across 31 tenants and is untouched
 * by anything in this module.
 */
describe("isAreaHidden('expenses')", () => {
  it("is a real member of LEAN_HIDDEN_AREAS", () => {
    // A typo'd or missing area is not a compile error at runtime — isAreaHidden
    // fails open on anything it does not recognise. Without this assertion the
    // gate could silently never fire and every test below would still pass by
    // agreeing that nothing is hidden.
    expect(LEAN_HIDDEN_AREAS).toContain("expenses");
  });

  it("hides Expenses from the northwind canary", () => {
    expect(isAreaHidden("expenses", "northwind")).toBe(true);
  });

  it("hides Expenses from NO ONE else", () => {
    // The first three are the only tenants with rows in `vehicle_expenses`:
    // flowautorentals (11, live), the internal `test` tenant (41) and
    // drive-247 (5). flowautorentals is the case that matters — it is a live
    // operator whose ledger this screen holds. The rest are ordinary paying
    // tenants that can reach the page from the Finance nav group today.
    for (const slug of [
      "flowautorentals",
      "test",
      "drive-247",
      "goniko",
      "revtekrentals",
      "globalmotiontransport",
      "jangramrentals",
      "eastpeakrentalsllc",
      "openbayrental",
      "flowrentalsllc",
      "drive-hustle",
    ]) {
      expect(isAreaHidden("expenses", slug)).toBe(false);
    }
  });

  it("fails open on an unresolved slug", () => {
    // TenantContext resolves the slug client-side from window.location.hostname
    // and leaves it null for a tick on first paint, and on an unrecognised
    // host. Hiding during that tick would flicker the nav row out on every load
    // for the tenants using it, and would 404 the route out from under an
    // operator mid-entry.
    expect(isAreaHidden("expenses", null)).toBe(false);
    expect(isAreaHidden("expenses", undefined)).toBe(false);
    expect(isAreaHidden("expenses", "")).toBe(false);
  });

  it("keys on the slug, never on a tenant id", () => {
    // northwind is 6e5c544f-… in production and 8e6bc88f-… on the seeded
    // staging branch. An id-keyed gate resolves to the ungated path on
    // localhost — where the owner tests at northwind.portal.localhost — with no
    // error and no failed build, so the screen simply never changes.
    expect(isAreaHidden("expenses", "6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(isAreaHidden("expenses", "8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
  });

  it("is case- and whitespace-exact", () => {
    expect(isAreaHidden("expenses", "Northwind")).toBe(false);
    expect(isAreaHidden("expenses", " northwind")).toBe(false);
    expect(isAreaHidden("expenses", "northwind-2")).toBe(false);
  });

  it("does not disturb the areas gated before it", () => {
    // Adding an area to the tuple must not shift behaviour for the existing
    // seven. Enquiries alone is on for 51 production tenants.
    for (const area of [
      "enquiries",
      "leads",
      "automations",
      "quotes",
      "tesla",
      "welcome",
      "owners",
    ] as const) {
      expect(isAreaHidden(area, "northwind")).toBe(true);
      expect(isAreaHidden(area, "goniko")).toBe(false);
    }
  });
});
