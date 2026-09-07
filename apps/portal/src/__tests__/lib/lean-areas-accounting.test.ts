import { describe, expect, it } from "vitest";

import { LEAN_HIDDEN_AREAS, isAreaHidden } from "@/lib/lean-areas";

/**
 * The Accounting (Xero + Zoho Books) gate.
 *
 * This one gets its own file because its history is the whole argument for
 * gating rather than deleting. Accounting was DELETED from main — 41 files,
 * 6,578 lines, including both OAuth pairs, the sync worker, the token
 * refresher and the void-on-refund hook — on the reading that "park" meant
 * "remove". It did not. It means: hide the feature from the `northwind`
 * canary, and leave it working for every other tenant. The code is now back
 * (revert of 3e3d24af) and only what northwind SEES changes.
 *
 * MEASURED AGAINST PRODUCTION, and the numbers cut in an unusual direction
 * here — they are the reason the gate is SAFE, not the reason it is urgent:
 *   - 57 tenants; `integration_xero` is on for 0 of them, and
 *     `integration_zoho_books` for exactly 1 — `test`, the internal tenant.
 *   - `accounting_connections` holds 3 rows, all 3 on `test`.
 *     `accounting_account_mappings` 18, `accounting_contact_links` 5.
 *   - northwind itself has both flags false, 0 connections, 0
 *     `financial_events` and 0 `pnl_entries`. The canary has no accounting
 *     footprint at all, so this gate is purely cosmetic for it.
 *
 * So unlike Tesla Fleet or Owner Payouts, hiding this from northwind takes
 * nothing away from anyone today. What the DELETION took away was the ability
 * for any of the other 56 tenants to ever switch it on — which is precisely
 * the asymmetry these tests exist to lock down. The assertion that carries the
 * weight below is not "northwind is hidden"; it is that nobody else is.
 *
 * WHAT THIS GATE CANNOT REACH, deliberately:
 *   - `financial_events` (7,635 rows) and `financial_event_sync_state` (6,616)
 *     keep filling from the `ledger_entries` trigger and the nine
 *     `enqueue_financial_event` callers. Those are server-side and fire for
 *     every writer; no presentation gate touches them.
 *   - `pnl_entries` — 12,559 rows across 31 live tenants — is not part of
 *     accounting at all. `/reports`, the vehicle-profitability route and every
 *     P&L surface read it directly and are untouched by anything in this
 *     module. The one shared helper they had in common, `resolve-tenant.ts`,
 *     now lives at `_shared/resolve-tenant.ts` rather than under
 *     `_shared/accounting/`, so the false coupling is gone in the source too.
 */
describe("isAreaHidden('accounting')", () => {
  it("is a real member of LEAN_HIDDEN_AREAS", () => {
    // A typo'd or missing area is not a compile error at runtime — isAreaHidden
    // fails open on anything it does not recognise. Without this assertion the
    // gate could silently never fire and every test below would still pass by
    // agreeing that nothing is hidden.
    expect(LEAN_HIDDEN_AREAS).toContain("accounting");
  });

  it("hides Accounting from the northwind canary", () => {
    expect(isAreaHidden("accounting", "northwind")).toBe(true);
  });

  it("hides Accounting from the one tenant that actually has it connected", () => {
    // `test` is the only tenant in production with `integration_zoho_books`
    // true, and it owns all 3 rows in `accounting_connections`. It is the
    // single tenant for whom this feature is live today — if any gate is going
    // to catch the wrong tenant, it is this one.
    expect(isAreaHidden("accounting", "test")).toBe(false);
  });

  it("hides Accounting from NO ONE else", () => {
    // Ordinary paying tenants. None has the integration on today, but the
    // Settings > Accounting tab is how any of them would ever turn it on, so
    // hiding it from them removes the feature in the only sense that matters.
    for (const slug of [
      "goniko",
      "revtekrentals",
      "globalmotiontransport",
      "jangramrentals",
      "eastpeakrentalsllc",
      "openbayrental",
      "flowrentalsllc",
      "flowautorentals",
      "drive-hustle",
      "drive-247",
      "paramount-solutions-llc",
      "kedic-services",
      "averysrental",
    ]) {
      expect(isAreaHidden("accounting", slug)).toBe(false);
    }
  });

  it("fails open on an unresolved slug", () => {
    // TenantContext resolves the slug client-side from window.location.hostname
    // and leaves it null for a tick on first paint, and on an unrecognised
    // host. Hiding during that tick would flicker the Settings tab out of the
    // sidebar on every load, and would blank the panel out from under an
    // operator who was mid-way through an OAuth connect.
    expect(isAreaHidden("accounting", null)).toBe(false);
    expect(isAreaHidden("accounting", undefined)).toBe(false);
    expect(isAreaHidden("accounting", "")).toBe(false);
  });

  it("keys on the slug, never on a tenant id", () => {
    // northwind is 6e5c544f-… in production and 8e6bc88f-… on the seeded
    // staging branch. An id-keyed gate resolves to the ungated path on
    // localhost — where the owner tests at northwind.portal.localhost:3011 —
    // with no error and no failed build, so the screen simply never changes.
    expect(isAreaHidden("accounting", "6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(isAreaHidden("accounting", "8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
  });

  it("is case- and whitespace-exact", () => {
    expect(isAreaHidden("accounting", "Northwind")).toBe(false);
    expect(isAreaHidden("accounting", " northwind")).toBe(false);
    expect(isAreaHidden("accounting", "northwind-2")).toBe(false);
  });

  it("is not satisfied by the provider names or the settings tab key", () => {
    // The gate takes a tenant SLUG. `xero`, `zoho`, `accounting` and
    // `settings.accounting` are a provider, a provider, an area key and a
    // permission key respectively — none is a tenant, and none may ever
    // satisfy the membership test by resembling one.
    for (const notATenant of ["xero", "zoho", "accounting", "settings.accounting", "finance"]) {
      expect(isAreaHidden("accounting", notATenant)).toBe(false);
    }
  });

  it("does not disturb the areas gated before it", () => {
    // Adding an area to the tuple must not shift behaviour for the existing
    // ones. Enquiries alone is on for 51 production tenants.
    for (const area of LEAN_HIDDEN_AREAS.filter((a) => a !== "accounting")) {
      expect(isAreaHidden(area, "northwind")).toBe(true);
      expect(isAreaHidden(area, "goniko")).toBe(false);
    }
  });
});
