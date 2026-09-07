import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LEAN_HIDDEN_AREAS,
  SETTINGS_TAB_BOARD_ROUTE,
  isAreaHidden,
  isSettingsTabHidden,
  settingsTabBoardCard,
} from "@/lib/lean-areas";

/**
 * De-duplicating Settings against the Integrations board.
 *
 * The canary now has `/integrations` — twelve cards, each opening a panel that
 * fully manages its integration. Until this gate, a lean tenant ALSO had a
 * Settings tab for Stripe/Square, Twilio, Bonzah and BoldSign, so there were
 * two places to configure the same money and messaging paths.
 *
 * These four keys are therefore a different kind of entry from every other one
 * in LEAN_HIDDEN_AREAS: the rest hide a feature the lean product does not
 * carry, these hide a SECOND COPY of one it does. Nothing is withdrawn.
 *
 * WHY IT IS STILL A GATE AND NOT A DELETE, measured against production
 * (63 tenant rows) at the time of writing:
 *   - 53 tenants run `payment_model = 'own'`, 2 run `payment_provider='square'`
 *   - 7 hold Twilio SMS credentials, 3 have `twilio_voice_enabled`
 *   - 35 have `integration_bonzah = true`
 *   - 49 are on `boldsign_mode = 'live'`
 * `/integrations` is `notFound()` for every one of them — the route gate is
 * `isV2('appearance', slug)`, canary-only — so these Settings tabs are the ONLY
 * way any of those 56 operators reaches Stripe onboarding, Twilio setup, Bonzah
 * credentials or the BoldSign mode switch. Deleting a tab to tidy one canary
 * would take all of that off all of them at once, which is the inversion Fleet
 * Quotes, Tesla Fleet and Accounting have already cost this project three
 * times. The assertion that carries the weight below is not "northwind is
 * hidden"; it is that nobody else is.
 */

const SRC = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const NON_CANARY = [
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
];

const NEW_AREAS = [
  "settings-payments",
  "settings-messaging",
  "settings-insurance",
  "settings-esign",
] as const;

describe("the four settings-* areas", () => {
  it("are real members of LEAN_HIDDEN_AREAS", () => {
    // A typo'd or missing area is not a runtime error — isAreaHidden fails open
    // on anything it does not recognise, so the gate would silently never fire
    // and every test below would still pass by agreeing that nothing is hidden.
    // That exact bug shipped once already with `fleet-health`.
    for (const area of NEW_AREAS) expect(LEAN_HIDDEN_AREAS).toContain(area);
  });

  it("hide their tab from the northwind canary", () => {
    for (const area of NEW_AREAS) expect(isAreaHidden(area, "northwind")).toBe(true);
  });

  it("leave every non-canary tenant untouched", () => {
    // THE OUTAGE CASE. Each of these is a live operator whose only route to
    // Stripe, Twilio, Bonzah and BoldSign is the tab being hidden here.
    for (const area of NEW_AREAS) {
      for (const slug of NON_CANARY) expect(isAreaHidden(area, slug)).toBe(false);
    }
  });

  it("fail OPEN on an unresolved slug", () => {
    // TenantContext resolves the slug client-side and it is null for a tick on
    // first paint, and stays null on an unrecognised host. A gate that failed
    // closed there would blank Payments for every tenant during that tick.
    for (const area of NEW_AREAS) {
      expect(isAreaHidden(area, null)).toBe(false);
      expect(isAreaHidden(area, undefined)).toBe(false);
      expect(isAreaHidden(area, "")).toBe(false);
      expect(isAreaHidden(area, "not-a-real-tenant")).toBe(false);
    }
  });

  it("are never satisfied by a tenant ID", () => {
    // northwind is 6e5c544f-… in production but 8e6bc88f-… on staging, because
    // staging was seeded rather than cloned. An id-keyed gate resolves to the
    // ungated path on localhost with no error and no failed build.
    for (const area of NEW_AREAS) {
      expect(isAreaHidden(area, "6e5c544f-b374-451f-a662-360a634bff15")).toBe(false);
      expect(isAreaHidden(area, "8e6bc88f-86d6-4468-8610-73f7c8a88f6e")).toBe(false);
    }
  });

  it("do not disturb the areas gated before them", () => {
    for (const area of LEAN_HIDDEN_AREAS) {
      expect(isAreaHidden(area, "northwind")).toBe(true);
      expect(isAreaHidden(area, "goniko")).toBe(false);
    }
  });
});

/**
 * `isSettingsTabHidden` is the single predicate both navigation surfaces read.
 *
 * It exists because three call sites disagreeing is not hypothetical here.
 * E-Signatures was filtered out of the mobile trigger row and blanked in its
 * body, but nobody filtered the DESKTOP sidebar — so a lean tenant saw the
 * entry, clicked it, and got an empty page. Tesla had the mirror-image defect:
 * both nav surfaces hid it, but `?tab=tesla` typed by hand still selected a tab
 * whose body drew nothing.
 */
describe("isSettingsTabHidden", () => {
  const HIDDEN_FOR_LEAN = [
    "payments",
    "messaging",
    "insurance",
    "esign",
    "accounting",
    "inshur",
    "tesla",
  ];

  it("hides every tab the board now owns, from the canary only", () => {
    for (const tab of HIDDEN_FOR_LEAN) {
      expect(isSettingsTabHidden(tab, "northwind")).toBe(true);
      for (const slug of NON_CANARY) expect(isSettingsTabHidden(tab, slug)).toBe(false);
    }
  });

  it("LEAVES BLACKLIST ALONE", () => {
    // The Global Blacklist is a booking/risk rule, not an integration: it
    // connects to no third party and has no card on the board. It is RELOCATED
    // into Booking Rules for lean tenants, never hidden. If this ever starts
    // returning true the canary loses the screen outright.
    expect(isSettingsTabHidden("blacklist", "northwind")).toBe(false);
  });

  it("leaves the rest of Settings exactly as it was", () => {
    for (const tab of [
      "general",
      "locations",
      "branding",
      "requirements",
      "duration",
      "lockbox",
      "pricing",
      "fees",
      "preauth",
      "installments",
      "payg",
      "auto-extend",
      "promos",
      "extras",
      "reminders",
      "push",
      "templates",
      "subscription",
    ]) {
      expect(isSettingsTabHidden(tab, "northwind")).toBe(false);
    }
  });

  it("fails open on an unresolved slug and on an unknown tab", () => {
    for (const tab of HIDDEN_FOR_LEAN) {
      expect(isSettingsTabHidden(tab, null)).toBe(false);
      expect(isSettingsTabHidden(tab, undefined)).toBe(false);
    }
    expect(isSettingsTabHidden("not-a-tab", "northwind")).toBe(false);
    expect(isSettingsTabHidden("", "northwind")).toBe(false);
  });
});

/**
 * The hand-off.
 *
 * Hiding these tabs is only safe because roughly twenty existing deep links —
 * and, critically, TWO Supabase edge functions — still point at them. Both
 * `stripe-oauth-callback` and `square-oauth-callback` hardcode
 * `/settings?tab=payments` as their landing and append the outcome as a query
 * param. Edge functions are not this change's to edit (V2_PLAN §7), so the
 * Settings page forwards those hits to the board with the query string intact.
 */
describe("settingsTabBoardCard", () => {
  it("sends the bare grid for Payments", () => {
    // Stripe Connect and Square are two cards and `?tab=payments` cannot say
    // which was meant. The grid is the honest landing.
    expect(settingsTabBoardCard("payments")).toBe("");
  });

  it("names a card for the tabs that have exactly one", () => {
    expect(settingsTabBoardCard("messaging")).toBe("Twilio Messages");
    expect(settingsTabBoardCard("esign")).toBe("BoldSign");
    expect(settingsTabBoardCard("tesla")).toBe("Tesla");
  });

  it("returns null for the tabs that must KEEP RENDERING", () => {
    // null is not "no destination". It means: do not redirect.
    //
    // `insurance` is the load-bearing one. Bonzah's 10-step application wizard
    // lives only in components/settings/bonzah-onboarding/, and the board's own
    // Bonzah panel deep-links BACK to `/settings?tab=insurance` for it. A
    // redirect here would send that link to the board it came from — a loop
    // with the wizard unreachable at the end of it.
    expect(settingsTabBoardCard("insurance")).toBe(null);
    // These two already render no body at all, so there is nothing to hand off.
    expect(settingsTabBoardCard("accounting")).toBe(null);
    expect(settingsTabBoardCard("inshur")).toBe(null);
    expect(settingsTabBoardCard("blacklist")).toBe(null);
    expect(settingsTabBoardCard("general")).toBe(null);
  });

  it("names cards that actually exist on the board", () => {
    // The board looks the name up in its `integrations` list and silently opens
    // NOTHING on a miss — a typo here is invisible until an operator follows a
    // link and lands on a bare grid.
    const registry = read("app/(dashboard)/integrations/_panels/registry.ts");
    const board = read("app/(dashboard)/integrations/integrations-board.tsx");
    for (const tab of ["messaging", "esign", "tesla"]) {
      const card = settingsTabBoardCard(tab)!;
      expect(registry).toContain(card);
      expect(board).toContain(`name: "${card}"`);
    }
  });

  it("points at the route the board is actually mounted on", () => {
    expect(SETTINGS_TAB_BOARD_ROUTE).toBe("/integrations");
    expect(() => read("app/(dashboard)/integrations/page.tsx")).not.toThrow();
  });
});

/**
 * Call-site assertions.
 *
 * `isSettingsTabHidden` being correct proves nothing about whether anything
 * CALLS it. A gate that is never invoked is silently inert — the screen simply
 * never changes and nothing errors. These read the real source so a future edit
 * that drops a gate fails here rather than in production.
 */
describe("gate call sites", () => {
  const settings = () => read("app/(dashboard)/settings/page.tsx");
  const sidebar = () => read("components/shared/layout/app-sidebar-v2.tsx");

  it("gates the desktop settings sidebar", () => {
    const src = sidebar();
    expect(src).toMatch(/isSettingsTabHidden/);
    expect(src).toMatch(/!isSettingsTabHidden\(item\.value, tenantSlug\)/);
  });

  it("gates the mobile trigger row with the SAME predicate", () => {
    // Both surfaces must read one function. Two hand-maintained lists is what
    // left E-Signatures clickable in the sidebar while its body was blanked.
    const src = settings();
    expect(src).toMatch(/!isSettingsTabHidden\(item\.value, tenantSlug\)/);
  });

  it("declares a body gate for each newly hidden tab", () => {
    const src = settings();
    expect(src).toMatch(/const hidePaymentsTab = isAreaHidden\('settings-payments', tenantSlug\);/);
    expect(src).toMatch(/const hideMessagingTab = isAreaHidden\('settings-messaging', tenantSlug\);/);
    expect(src).toMatch(/const hideESignTab = isAreaHidden\('settings-esign', tenantSlug\);/);
    expect(src).toMatch(/const hideInsuranceNav = isAreaHidden\('settings-insurance', tenantSlug\);/);
  });

  it("guards the TabsContent bodies, not just the triggers", () => {
    // `?tab=…` is read straight out of the URL and drives activeTab, so a typed
    // or bookmarked link would still open the v1 panel if only the trigger were
    // hidden — and for Payments that link is also an OAuth callback's landing.
    const src = settings();
    expect(src).toMatch(/\{!hidePaymentsTab && \(\s*<TabsContent value="payments"/);
    expect(src).toMatch(/\{!hideMessagingTab && \(\s*<TabsContent value="messaging"/);
    expect(src).toMatch(/\{!hideESignTab && \(\s*<TabsContent value="esign"/);
    expect(src).toMatch(/\{!hideTeslaTab && \(\s*<TabsContent value="tesla"/);
  });

  it("bounces effectiveTab off every tab whose body is gone", () => {
    // A hidden tab left selected shows an EMPTY settings body rather than a
    // tab. `insurance` is deliberately absent from this set because its body
    // still renders.
    const src = settings();
    const set = src.match(/const hiddenSettingsTabs = new Set<string>\(\[[\s\S]*?\]\);/)?.[0] ?? "";
    expect(set).toBeTruthy();
    for (const tab of ["accounting", "inshur", "payments", "messaging", "esign", "tesla"]) {
      expect(set).toContain(`['${tab}']`);
    }
    expect(set).not.toContain("['insurance']");
    expect(src).toMatch(/const effectiveTab = hiddenSettingsTabs\.has\(activeTab\)/);
    // …and the mount-time URL guard reads the same set rather than a second
    // hand-maintained list of its own.
    expect(src).toMatch(/!hiddenSettingsTabs\.has\(tabParam\)/);
  });

  it("forwards a hidden tab's deep link to the board WITH its query string", () => {
    // Two edge functions hardcode `/settings?tab=payments` and append their
    // result (`&oauth=…`, `&square=…&reason=…`). Dropping those params loses
    // the outcome of an OAuth round-trip the operator just completed.
    const src = settings();
    expect(src).toMatch(/settingsTabBoardCard\(tabParam\)/);
    expect(src).toMatch(/new URLSearchParams\(searchParams\.toString\(\)\)/);
    expect(src).toMatch(/params\.delete\('tab'\)/);
    expect(src).toMatch(/params\.set\('open', card\)/);
    // replace, not push: Back must not bounce between the two screens.
    expect(src).toMatch(/router\.replace\(`\$\{SETTINGS_TAB_BOARD_ROUTE\}/);
    // …and it must not fire for a tab with no board home.
    expect(src).toMatch(/if \(card === null\) return;/);
  });

  it("keeps the Bonzah application wizard reachable", () => {
    // The board's Bonzah panel is the ONLY caller left, and it deep-links here.
    const src = settings();
    expect(src).toMatch(/hideInsuranceNav \? <BonzahOnboardingForm \/> : <BonzahSettings \/>/);
    const panel = read("app/(dashboard)/integrations/_panels/bonzah.tsx");
    expect(panel).toMatch(/ONBOARDING_HREF = "\/settings\?tab=insurance"/);
    // The wizard itself must still exist for it to land on.
    expect(() => read("components/settings/bonzah-onboarding/index.tsx")).not.toThrow();
  });

  it("moves Blacklist into Booking Rules for lean tenants, and only for them", () => {
    const src = sidebar();
    expect(src).toMatch(/function settingsGroupsFor\(tenantSlug: string \| null \| undefined\)/);
    // Non-lean tenants get the module constant BY REFERENCE — no reshaping, no
    // reordering, no re-render cost.
    expect(src).toMatch(/if \(!isLeanTenant\(tenantSlug\)\) return settingsTabGroups;/);
    expect(src).toMatch(/settingsGroupsFor\(tenantSlug\)\s*\n?\s*\.map\(group =>/);
    // The entry is declared exactly once, still under Integrations.
    const entries = src.match(/\{ value: 'blacklist', icon: ShieldX, label: 'Blacklist' \}/g) ?? [];
    expect(entries).toHaveLength(1);
    // The now-empty group disappears on its own.
    expect(src).toMatch(/\.filter\(group => group\.items\.length > 0\)/);
  });
});

/**
 * Nothing left main.
 *
 * The whole point of gating rather than deleting is that all of it is still
 * there for the other 56 tenants. If a future "cleanup" removes it, these fail.
 */
describe("every gated settings surface is still on main", () => {
  it("keeps the four tab components and everything they dispatch to", () => {
    for (const p of [
      "components/settings/stripe-connect-settings.tsx",
      "components/settings/payment-provider-choice.tsx",
      "components/settings/square-settings.tsx",
      "components/settings/own-stripe-settings.tsx",
      "components/settings/communication-settings.tsx",
      "components/settings/twilio-sms-settings.tsx",
      "components/settings/call-forwarding-settings.tsx",
      "components/settings/bonzah-settings.tsx",
      "components/settings/esign-settings.tsx",
    ]) {
      expect(() => read(p)).not.toThrow();
    }
  });

  it("keeps every tab value in allSettingsTabs and every trigger in the mobile row", () => {
    // The gate is a filter over these lists. Removing an entry instead would
    // take the tab from all 57 tenants, not one.
    const src = read("app/(dashboard)/settings/page.tsx");
    const all = src.match(/const allSettingsTabs = \[[\s\S]*?\];/)?.[0] ?? "";
    for (const tab of ["payments", "messaging", "insurance", "esign", "accounting", "inshur", "tesla", "blacklist"]) {
      expect(all).toContain(`'${tab}'`);
      expect(src).toContain(`{ value: '${tab}', icon:`);
    }
  });

  it("leaves the permissions.ts mappings alone", () => {
    // canViewSettings() opens with `if (!settingsKey) return true;`, so dropping
    // a mapping while the tab still exists WIDENS manager access rather than
    // narrowing it. Removing the key is the opposite of a lockdown.
    const src = read("lib/permissions.ts");
    expect(src).toMatch(/payments: 'settings\.payments',/);
    expect(src).toMatch(/accounting: 'settings\.accounting',/);
    for (const tab of ["messaging", "insurance", "inshur", "esign", "tesla", "blacklist"]) {
      expect(src).toMatch(new RegExp(`${tab}: 'settings\\.integrations',`));
    }
  });

  it("keeps the Settings tab rendering for every non-lean tenant", () => {
    // The gates are all `!hideXTab &&`, i.e. a filter that is inert unless
    // isAreaHidden says otherwise — never a deletion of the branch.
    const src = read("app/(dashboard)/settings/page.tsx");
    expect(src).toContain("<StripeConnectSettings />");
    expect(src).toContain("<CommunicationSettings />");
    expect(src).toContain("<BonzahSettings />");
    expect(src).toContain("<ESignSettings />");
    expect(src).toContain("<TeslaFleetSettings />");
  });
});
