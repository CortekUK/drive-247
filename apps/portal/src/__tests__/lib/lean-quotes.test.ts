import { describe, expect, it } from "vitest";

import { LEAN_HIDDEN_AREAS, isAreaHidden } from "@/lib/lean-areas";
import { readPortalSource } from "../helpers/edge-source";

/**
 * Fleet Quotes is HIDDEN from the lean canary, not removed from the product.
 *
 * The history matters, because this suite exists to stop it repeating. /quotes
 * was deleted from main outright (43b97af1) on the reading that it was a lean-v2
 * casualty like Enquiries or Leads. It was not one: its nav entry sat
 * unconditionally in app-sidebar.tsx next to Rentals, behind no flag and no
 * tenant column, so every one of the 35+ paying tenants rendered it and could
 * use it. The delete was reverted (5acae08a) and replaced by this gate.
 *
 * So the assertion that actually protects revenue here is the NEGATIVE one:
 * a non-canary tenant must still see Fleet Quotes. A gate that hides it from
 * everybody is the same outage as the delete, just harder to spot in a diff.
 */
describe("isAreaHidden('quotes')", () => {
  it("hides Fleet Quotes from the northwind canary", () => {
    expect(isAreaHidden("quotes", "northwind")).toBe(true);
  });

  it("leaves Fleet Quotes visible to real non-canary tenants", () => {
    // This is the case the deleted commit broke. 35+ paying tenants had this
    // feature with no flag in front of it; every one of them keeps it.
    for (const slug of ["goniko", "revtekrentals", "globalmotiontransport", "jangram"]) {
      expect(isAreaHidden("quotes", slug)).toBe(false);
    }
  });

  it("leaves Fleet Quotes visible for a slug that is not a tenant", () => {
    expect(isAreaHidden("quotes", "not-a-real-tenant")).toBe(false);
  });

  it("fails open while the tenant slug is still unresolved", () => {
    // TenantContext leaves the slug null for a tick on first paint, and keeps
    // it null on an unrecognised host. Neither may hide the feature.
    expect(isAreaHidden("quotes", null)).toBe(false);
    expect(isAreaHidden("quotes", undefined)).toBe(false);
    expect(isAreaHidden("quotes", "")).toBe(false);
  });

  it("keys on the slug, never on a tenant id", () => {
    // northwind has a different primary key in production and on the seeded
    // staging branch, so an id-keyed gate resolves to the ungated path on
    // localhost with no error and no failed build.
    expect(isAreaHidden("quotes", "6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(isAreaHidden("quotes", "8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
  });

  it("is case- and whitespace-exact", () => {
    expect(isAreaHidden("quotes", "Northwind")).toBe(false);
    expect(isAreaHidden("quotes", " northwind")).toBe(false);
    expect(isAreaHidden("quotes", "northwind-2")).toBe(false);
  });

  it("is a declared area, so the shared area suite covers it too", () => {
    expect(LEAN_HIDDEN_AREAS).toContain("quotes");
  });
});

/**
 * All three surfaces, pinned in source.
 *
 * Hiding a nav entry hides the LINK, not the page — and there are two nav
 * entries, not one. Northwind renders app-sidebar-v2; the other 35 tenants
 * render app-sidebar. Gating only one sidebar is the exact failure this
 * project already hit once: the v1 path was correct and proved nothing about
 * the canary, which renders v2.
 */
describe("Fleet Quotes is gated on every surface", () => {
  it("the /quotes route itself calls notFound() for lean tenants", () => {
    // Load-bearing and not redundant with the sidebars: without it, typing the
    // URL or following a bookmark renders the full generator for the canary.
    const src = readPortalSource("app/(dashboard)/quotes/page.tsx");
    expect(src).toMatch(/import \{ notFound \} from "next\/navigation"/);
    expect(src).toMatch(/isAreaHidden\("quotes", tenantSlug\)/);
    expect(src).toMatch(/if \(isAreaHidden\("quotes", tenantSlug\)\) notFound\(\);/);
  });

  it("the v1 sidebar — what the 35 other tenants render — gates the entry", () => {
    const src = readPortalSource("components/shared/layout/app-sidebar.tsx");
    expect(src).toMatch(/from "@\/lib\/lean-areas"/);
    expect(src).toMatch(/tenantSlug/);
    expect(src).toMatch(/isAreaHidden\("quotes", tenantSlug\)/);
  });

  it("the v2 sidebar — what northwind renders — gates the entry", () => {
    const src = readPortalSource("components/shared/layout/app-sidebar-v2.tsx");
    expect(src).toMatch(/from "@\/lib\/lean-areas"/);
    expect(src).toMatch(/isAreaHidden\("quotes", tenantSlug\)/);
  });

  it("neither sidebar still carries an ungated Fleet Quotes entry", () => {
    // The regression shape: someone re-adds the plain entry above the gated
    // one, or reverts the gate on one file only. A bare entry that is not the
    // gated spread's payload means the canary gets a link back.
    for (const path of [
      "components/shared/layout/app-sidebar.tsx",
      "components/shared/layout/app-sidebar-v2.tsx",
    ]) {
      const src = readPortalSource(path);
      // Every occurrence of the nav entry must sit inside the isAreaHidden
      // spread — i.e. be preceded by the gate within the same expression.
      const entries = src.match(/\{ name: "Fleet Quotes", href: "\/quotes"/g) ?? [];
      expect(entries).toHaveLength(1);
      const gated = src.match(
        /isAreaHidden\("quotes", tenantSlug\)\s*\?\s*\[\]\s*:\s*\[\{ name: "Fleet Quotes", href: "\/quotes"/,
      );
      expect(gated).not.toBeNull();
    }
  });

  it("the route mapping stays in permissions.ts alongside the live route", () => {
    // ROUTE_TO_TAB returning undefined makes canView() treat a route as
    // ALLOWED, so a live /quotes with no mapping is open to every manager
    // regardless of granted tabs. Route and mapping move together.
    const src = readPortalSource("lib/permissions.ts");
    expect(src).toMatch(/'\/quotes': 'rentals',/);
  });

  it("nothing about the feature was deleted to achieve the gate", () => {
    // The gate is presentation-only. The builder, the hook and its own suite
    // stay on main and keep serving every non-canary tenant.
    expect(readPortalSource("lib/fleet-quote.ts")).toMatch(/buildFleetQuote/);
    expect(readPortalSource("hooks/use-fleet-quote.ts")).toMatch(/useFleetQuote/);
  });
});
