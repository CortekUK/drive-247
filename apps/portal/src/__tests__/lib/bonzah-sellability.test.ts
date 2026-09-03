import { describe, expect, it } from "vitest";

import { bonzahBlockedReason, isBonzahSellable } from "@/lib/bonzah";
import { readEdgeSource, readPortalSource, readRepoSource } from "../helpers/edge-source";

/**
 * REGRESSION LOCK — no behaviour change.
 *
 * The requirement "a tenant whose Bonzah is not active must not offer Bonzah
 * insurance, to its operators or to its customers" is ALREADY satisfied, by
 * commit 09b9678d ("block insurance sales while a tenant is in Bonzah test
 * mode"). This file exists so it stays satisfied: the gate was previously
 * enforced only by three hand-written mirrors with no test behind any of them.
 *
 * "Not active" is taken to be `integration_bonzah !== true`, plus test mode
 * without the super-admin sandbox override. That is what the code and the data
 * actually support, and it is the strictly safer reading — a sandbox policy is
 * not real cover, yet Stripe still takes real money for it. Missing
 * `bonzah_username` is NOT used as the signal: credentials are only consulted
 * in live mode (test mode runs on shared platform credentials), so a username
 * check would wrongly block sandbox-override demo tenants while adding nothing
 * for live ones, whose integration_bonzah is set by the same flow that stores
 * the credentials.
 *
 * 31 live tenants have integration_bonzah = true and must be undisturbed.
 */
describe("isBonzahSellable", () => {
  it("refuses when the integration is off — northwind's actual state", () => {
    // Verified against prod: integration_bonzah = false, bonzah_mode = 'test',
    // no bonzah_username, sandbox override off.
    expect(
      isBonzahSellable({
        integration_bonzah: false,
        bonzah_mode: "test",
        bonzah_sandbox_override: false,
      }),
    ).toBe(false);
  });

  it("refuses when the integration is off even in live mode", () => {
    expect(
      isBonzahSellable({ integration_bonzah: false, bonzah_mode: "live" }),
    ).toBe(false);
    expect(
      isBonzahSellable({ integration_bonzah: null, bonzah_mode: "live" }),
    ).toBe(false);
  });

  it("refuses a test-mode tenant even with the integration on", () => {
    // A sandbox policy is not real cover, but Stripe still charges for it.
    expect(
      isBonzahSellable({ integration_bonzah: true, bonzah_mode: "test" }),
    ).toBe(false);
  });

  it("allows the 31 live, integrated tenants", () => {
    expect(
      isBonzahSellable({ integration_bonzah: true, bonzah_mode: "live" }),
    ).toBe(true);
  });

  it("honours the super-admin sandbox override for demo tenants", () => {
    expect(
      isBonzahSellable({
        integration_bonzah: true,
        bonzah_mode: "test",
        bonzah_sandbox_override: true,
      }),
    ).toBe(true);
  });

  it("refuses on a missing tenant rather than failing open", () => {
    expect(isBonzahSellable(null)).toBe(false);
    expect(isBonzahSellable(undefined)).toBe(false);
  });
});

describe("bonzahBlockedReason", () => {
  it("tells the operator plainly that the integration is off", () => {
    const reason = bonzahBlockedReason({ integration_bonzah: false });
    expect(reason).toMatch(/not enabled for this account/i);
    expect(reason).toMatch(/Settings/);
  });

  it("distinguishes test mode from a disabled integration", () => {
    const reason = bonzahBlockedReason({
      integration_bonzah: true,
      bonzah_mode: "test",
    });
    expect(reason).toMatch(/test mode/i);
    expect(reason).toMatch(/not real cover/i);
  });

  it("says nothing when selling is allowed", () => {
    expect(
      bonzahBlockedReason({ integration_bonzah: true, bonzah_mode: "live" }),
    ).toBeNull();
  });
});

/**
 * The gate has to hold on all three layers independently — operator UI,
 * customer UI, and the server. The two client mirrors decide what is SHOWN; the
 * server is what actually refuses, and it must fail closed.
 */
describe("the sell-side gate is wired on every layer", () => {
  it("portal: the operator's Bonzah selector is hidden on /rentals/new", () => {
    const src = readPortalSource("app/(dashboard)/rentals/new/page.tsx");
    expect(src).toMatch(/skipInsurance\s*=\s*!isBonzahConnected\s*\|\|\s*!isBonzahSellable\(tenant\)/);
    // …and the whole coverage block hangs off it.
    expect(src).toMatch(/\{!skipInsurance && \(/);
  });

  it("portal: the rental detail page and both extension dialogs gate too", () => {
    for (const path of [
      "app/(dashboard)/rentals/[id]/page.tsx",
      "components/rentals/AdminExtendRentalDialog.tsx",
      "components/rentals/ExtensionRequestDialog.tsx",
    ]) {
      expect(readPortalSource(path)).toMatch(/isBonzahSellable\(tenant\)/);
    }
  });

  it("booking: the customer is offered no purchase when it is not sellable", () => {
    const src = readRepoSource("apps/booking/src/components/MultiStepBookingWidget.tsx");
    expect(src).toMatch(/const bonzahSellable = isBonzahSellable\(tenant\)/);
    // The purchase flow is behind bonzahSellable; the not-sellable branch just
    // lets the customer continue.
    expect(src).toMatch(/hasInsurance === false && !bonzahSellable/);
    expect(src).toMatch(/hasInsurance === false && bonzahSellable/);
  });

  it("server: quoting fails CLOSED, so a client mirror cannot be bypassed", () => {
    const client = readEdgeSource("_shared/bonzah-client.ts");
    expect(client).toMatch(/integration_bonzah !== true/);
    // A gate that cannot read its own configuration must refuse, not wave through.
    expect(client).toMatch(/Fail CLOSED/i);

    const quote = readEdgeSource("bonzah-create-quote/index.ts");
    expect(quote).toMatch(/getBonzahSellability\(/);
  });

  it("all three mirrors agree on the same three columns", () => {
    const portal = readPortalSource("lib/bonzah.ts");
    const booking = readRepoSource("apps/booking/src/config/tenant-config.ts");
    const edge = readEdgeSource("_shared/bonzah-client.ts");
    for (const src of [portal, booking, edge]) {
      expect(src).toMatch(/integration_bonzah/);
      expect(src).toMatch(/bonzah_mode/);
      expect(src).toMatch(/bonzah_sandbox_override/);
    }
  });
});
