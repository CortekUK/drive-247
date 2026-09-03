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
