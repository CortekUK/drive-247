import { describe, expect, it } from "vitest";

import {
  isRentalCreationBlocked,
  isStripeConnectUsable,
  STRIPE_CONNECT_SETTINGS_PATH,
} from "@/lib/stripe-connect-status";
import { readPortalSource } from "../helpers/edge-source";

/**
 * "Stripe Connect not usable" — and why New Rental may be blocked on it.
 *
 * The rule is deliberately the one the portal's own Connect status UI already
 * applies, not a new one. The blocking is deliberately lean-only: of the 18
 * production tenants that actually trade, 6 do not satisfy this rule, and
 * blocking them would stop real bookings.
 */
describe("isStripeConnectUsable", () => {
  const connectedExpress = {
    stripe_onboarding_complete: true,
    stripe_account_status: "active",
    own_stripe_account_id: null,
    own_stripe_test_account_id: null,
  };

  it("accepts a fully onboarded, active Express account", () => {
    expect(isStripeConnectUsable(connectedExpress)).toBe(true);
  });

  it("rejects an onboarded account that is not active", () => {
    // northwind today: stripe_account_status = 'pending'.
    expect(
      isStripeConnectUsable({ ...connectedExpress, stripe_account_status: "pending" }),
    ).toBe(false);
    expect(
      isStripeConnectUsable({ ...connectedExpress, stripe_account_status: "restricted" }),
    ).toBe(false);
    expect(
      isStripeConnectUsable({ ...connectedExpress, stripe_account_status: null }),
    ).toBe(false);
  });

  it("rejects an active account whose onboarding never completed", () => {
    expect(
      isStripeConnectUsable({ ...connectedExpress, stripe_onboarding_complete: false }),
    ).toBe(false);
    expect(
      isStripeConnectUsable({ ...connectedExpress, stripe_onboarding_complete: null }),
    ).toBe(false);
  });

  it("accepts an own-account (OAuth) tenant, whose Express fields stay empty forever", () => {
    // Deriving readiness from the Express columns alone would tell an operator
    // who has already connected their own Stripe that Connect is incomplete.
    expect(
      isStripeConnectUsable({
        stripe_onboarding_complete: false,
        stripe_account_status: null,
        own_stripe_account_id: "acct_live_123",
        own_stripe_test_account_id: null,
      }),
    ).toBe(true);
    expect(
      isStripeConnectUsable({
        stripe_onboarding_complete: false,
        stripe_account_status: null,
        own_stripe_account_id: null,
        own_stripe_test_account_id: "acct_test_123",
      }),
    ).toBe(true);
  });

  it("rejects northwind's actual production state", () => {
    // Verified against prod: no account, onboarding incomplete, status pending.
    expect(
      isStripeConnectUsable({
        stripe_onboarding_complete: false,
        stripe_account_status: "pending",
        own_stripe_account_id: null,
        own_stripe_test_account_id: null,
      }),
    ).toBe(false);
  });

  it("treats a missing tenant row as not usable", () => {
    expect(isStripeConnectUsable(null)).toBe(false);
    expect(isStripeConnectUsable(undefined)).toBe(false);
  });
});

describe("isRentalCreationBlocked", () => {
  const unusable = {
    stripe_onboarding_complete: false,
    stripe_account_status: "pending",
    own_stripe_account_id: null,
    own_stripe_test_account_id: null,
  };
  const usable = {
    stripe_onboarding_complete: true,
    stripe_account_status: "active",
    own_stripe_account_id: null,
    own_stripe_test_account_id: null,
  };

  it("blocks the lean canary when Connect cannot take money", () => {
    expect(isRentalCreationBlocked(unusable, "northwind")).toBe(true);
  });

  it("does not block the lean canary once Connect is usable", () => {
    expect(isRentalCreationBlocked(usable, "northwind")).toBe(false);
  });

  it("NEVER blocks a non-lean tenant, however broken its Connect is", () => {
    // This is the outage case. 6 of the 18 trading tenants fail the Connect
    // rule; blocking them would stop real bookings on a live platform.
    for (const slug of ["goniko", "revtekrentals", "globalmotiontransport", "eastpeakrentalsllc"]) {
      expect(isRentalCreationBlocked(unusable, slug)).toBe(false);
    }
  });

  it("fails open while the tenant row has not loaded", () => {
    // null is both "first paint" and "the query errored". Treating unknown as
    // "not connected" would flash the block at a fully set-up operator, or
    // strand them completely if the lookup keeps failing.
    expect(isRentalCreationBlocked(null, "northwind")).toBe(false);
    expect(isRentalCreationBlocked(undefined, "northwind")).toBe(false);
  });

  it("fails open while the tenant slug is unresolved", () => {
    expect(isRentalCreationBlocked(unusable, null)).toBe(false);
    expect(isRentalCreationBlocked(unusable, undefined)).toBe(false);
    expect(isRentalCreationBlocked(unusable, "")).toBe(false);
  });

  it("keys on the slug, never on a tenant id", () => {
    expect(isRentalCreationBlocked(unusable, "6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(isRentalCreationBlocked(unusable, "8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
  });
});

/**
 * The rule must not drift from the Connect panel the operator can open two
 * clicks away. These assert the source of the existing status surfaces still
 * decides on the same columns — if someone changes how Connect readiness is
 * judged, this fails and the predicate gets updated with it.
 */
describe("matches the existing Connect status UI", () => {
  it("stripe-connect-settings still judges on onboarding_complete + status active", () => {
    const src = readPortalSource("components/settings/stripe-connect-settings.tsx");
    expect(src).toMatch(
      /stripe_onboarding_complete\s*&&\s*\w+\??\.\s*stripe_account_status\s*===\s*'active'/,
    );
  });

  it("use-setup-status still judges on the same columns plus the own-account escape", () => {
    const src = readPortalSource("hooks/use-setup-status.ts");
    expect(src).toMatch(/own_stripe_account_id\s*\|\|\s*!!\w+\??\.\s*own_stripe_test_account_id/);
    expect(src).toMatch(/stripe_onboarding_complete\s*&&\s*\w+\??\.\s*stripe_account_status\s*===\s*"active"/);
  });

  it("stripe_charges_enabled is still unused in the portal", () => {
    // The moment this column starts driving what an operator is shown, this
    // predicate should adopt it too. Until then the two disagree for 11 of 57
    // production tenants, and the gate must tell the same story as the panel.
    const usable = readPortalSource("lib/stripe-connect-status.ts");
    expect(usable).not.toMatch(/tenant\.stripe_charges_enabled/);
  });
});

describe("every rental-creation entry point is gated", () => {
  const entryPoints = [
    "app/(dashboard)/rentals/page.tsx",
    "app/(dashboard)/rentals/[id]/page.tsx",
    "app/(dashboard)/customers/[id]/page.tsx",
  ];

  it.each(entryPoints)("%s raises the dialog instead of navigating", (path) => {
    const src = readPortalSource(path);
    expect(src).toMatch(/useRentalCreationGate\(\)/);
    expect(src).toMatch(/ConnectStripeRequiredDialog/);
  });

  it("the /rentals/new ROUTE itself is gated, so the URL cannot bypass it", () => {
    // Without this, the dialog is defeated by typing the address.
    const src = readPortalSource("app/(dashboard)/rentals/new/page.tsx");
    expect(src).toMatch(/useRentalCreationGate\(\)/);
    expect(src).toMatch(
      /if \(rentalCreationBlocked\) \{\s*return <ConnectStripeRequiredDialog open[^>]*\/>;/,
    );
  });

  it("the route wires up the canary's dismissal, or its close control does nothing", () => {
    // This branch returns the dialog INSTEAD of the form, so closing the dialog
    // without recording the dismissal would blank the screen rather than reveal
    // the form. `onDismiss` flips `blocked` itself, which is the boolean the
    // branch above tests. See lib/rental-gate-dismissal.ts.
    const src = readPortalSource("app/(dashboard)/rentals/new/page.tsx");
    expect(src).toMatch(/dismiss:\s*dismissRentalCreationGate/);
    expect(src).toMatch(/<ConnectStripeRequiredDialog open onDismiss=\{dismissRentalCreationGate\}/);
  });

  it("no gated entry point still navigates unconditionally", () => {
    for (const path of entryPoints) {
      const src = readPortalSource(path);
      expect(src).not.toMatch(/onClick=\{\(\) => router\.push\(["'`]\/rentals\/new/);
      expect(src).not.toMatch(/onAction=\{\(\) => router\.push\(["'`]\/rentals\/new/);
    }
  });

  it("points the operator at the Connect settings tab", () => {
    expect(STRIPE_CONNECT_SETTINGS_PATH).toBe("/settings?tab=payments");
    const dialog = readPortalSource("components/rentals/connect-stripe-required-dialog.tsx");
    expect(dialog).toMatch(/STRIPE_CONNECT_SETTINGS_PATH/);
    expect(dialog).toMatch(/Connect Stripe to create rentals/);
  });
});
