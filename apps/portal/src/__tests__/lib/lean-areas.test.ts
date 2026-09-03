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
