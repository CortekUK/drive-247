import { describe, expect, it } from "vitest";

import { isTestModeUiHidden } from "@/lib/lean-areas";
import { codeOnly, readPortalSource } from "../helpers/edge-source";

/**
 * The lean product has no test modes, so lean tenants are shown no test/live
 * switches, no TEST badges and no sandbox-override UI.
 *
 * PRESENTATION ONLY. Nothing here changes what a tenant's mode actually IS:
 * `tenants.stripe_mode` and `tenants.bonzah_mode` are untouched, and the 66 edge
 * functions that branch on `stripe_mode` see exactly what they saw before.
 * Flipping a lean tenant's Stripe to live for real is a money decision, not a
 * UI cleanup, and is deliberately not part of this.
 */
describe("isTestModeUiHidden", () => {
  it("hides test-mode affordances from the lean canary", () => {
    expect(isTestModeUiHidden("northwind")).toBe(true);
  });

  it("leaves every other tenant's mode UI alone", () => {
    // Non-lean tenants genuinely have test and live modes and need the switch.
    for (const slug of ["goniko", "revtekrentals", "globalmotiontransport"]) {
      expect(isTestModeUiHidden(slug)).toBe(false);
    }
  });

  it("fails open while the tenant slug is unresolved", () => {
    expect(isTestModeUiHidden(null)).toBe(false);
    expect(isTestModeUiHidden(undefined)).toBe(false);
    expect(isTestModeUiHidden("")).toBe(false);
  });

  it("keys on the slug, never on a tenant id", () => {
    expect(isTestModeUiHidden("6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
    expect(isTestModeUiHidden("8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
  });
});

describe("test-mode affordances are gated in portal settings", () => {
  const surfaces = [
    "components/settings/stripe-connect-settings.tsx",
    "components/settings/own-stripe-settings.tsx",
    "components/settings/bonzah-settings.tsx",
  ];

  it.each(surfaces)("%s consults the gate", (path) => {
    const src = readPortalSource(path);
    expect(src).toMatch(/isTestModeUiHidden\(tenantSlug\)/);
    expect(src).toMatch(/!hideTestModeUi/);
  });

  it("the Stripe TEST/LIVE mode banner is behind the gate", () => {
    const src = readPortalSource("components/settings/stripe-connect-settings.tsx");
    expect(src).toMatch(/Stripe Mode Display — hidden for lean tenants[\s\S]{0,80}\{!hideTestModeUi && \(/);
  });

  it("the own-Stripe Test/Live chip is behind the gate", () => {
    const src = readPortalSource("components/settings/own-stripe-settings.tsx");
    expect(src).toMatch(/\{!hideTestModeUi && \([\s\S]{0,400}'Live' : 'Test'\} mode/);
  });

  it("the Bonzah API Mode card and shared-test-account notice are behind the gate", () => {
    const src = readPortalSource("components/settings/bonzah-settings.tsx");
    expect(src).toMatch(/\{!hideTestModeUi && \(\s*<Card>\s*<CardHeader>\s*<CardTitle>API Mode<\/CardTitle>/);
    expect(src).toMatch(/\{isTestMode && !hideTestModeUi && \(/);
  });

  it("the BoldSign test/live toggle is hidden too (shipped with the e-sign gate)", () => {
    const src = readPortalSource("app/(dashboard)/settings/page.tsx");
    expect(src).toMatch(/isLeanTenant\(tenantSlug\)/);
    expect(src).toMatch(/!hideESignModeToggle && <ESignSettings \/>/);
  });
});

/**
 * The line this change must not cross.
 */
describe("no payment behaviour is changed", () => {
  it("no settings surface writes stripe_mode or bonzah_mode as part of the gate", () => {
    for (const path of [
      "components/settings/stripe-connect-settings.tsx",
      "components/settings/own-stripe-settings.tsx",
    ]) {
      const src = readPortalSource(path);
      expect(src).not.toMatch(/\.update\(\{\s*stripe_mode/);
      expect(src).not.toMatch(/\.update\(\{\s*bonzah_mode/);
    }
  });

  it("the gate is a pure predicate over the slug, not over a mode column", () => {
    const src = readPortalSource("lib/lean-areas.ts");
    expect(src).toMatch(/export function isTestModeUiHidden/);
    // It must not start READING modes — that would make it behaviour, not UI.
    // Comments are stripped: the module documents at length that it does not
    // touch stripe_mode/bonzah_mode, and that prose must not fail its own test.
    const code = codeOnly(src);
    expect(code).not.toMatch(/stripe_mode/);
    expect(code).not.toMatch(/bonzah_mode/);
  });
});
