/**
 * v2 Settings structure (team lead reviews, Sep 2026):
 *   - General is THREE STACKED sections, Regional, Driver requirements and
 *     Monthly rate — headings one under another, no tab strip (the lead settled
 *     that at transcript 00:54); Booking rules, Lockbox (was Key handover),
 *     Tax and deposit (Tax and fees plus Security deposit), Booking site and
 *     Optional modules are pages of their own again, and every old `?tab=`
 *     value still opens the right place under the right permission;
 *   - the monthly rate moved from the pricing page into General (keeping the
 *     `pricing` permission), and Custom pricing became Weekend and holiday
 *     pricing; Tax and deposit's INDEX entry sits under Pricing;
 *   - Lockbox sends the code by email only, and its message moved to
 *     Customer messages;
 *   - Promo codes, Extras, Installments, Pay as you go and Auto-extension
 *     hidden from Settings (front end only), then brought back (Sep 19 2026):
 *     listed, reachable by `?tab=`, the three forms saving through the page's
 *     save bar;
 *   - the global blacklist out of Settings, `/settings/blacklist` sends v2 to
 *     /settings;
 *   - Team on the index for head admins, and no Manage Users in the org menu.
 *
 * The settings page is too large to mount, so its wiring is read as source;
 * the decisions themselves are unit-tested in settings-shell-state.test.ts,
 * the index in settings-index-states.test.tsx and the sections in
 * settings-business-rules-pages / settings-lockbox-messages-v2 /
 * settings-kit-v2. The org menu and the blacklist route are rendered.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

const h = vi.hoisted(() => ({
  v2: true,
  replace: vi.fn(),
  from: vi.fn(),
  isManager: false,
  canView: ((_tab: string) => true) as (tab: string) => boolean,
}));

vi.mock("@/lib/v2-context", () => ({
  useV2: () => h.v2,
  // The provider now carries the tenant-level half of the same answer
  // (`onV2` = tenants.portal_experience, `lean` = that OR the slug list).
  // All-false here leaves the `LEAN_TENANTS` slug list to decide, which is
  // what these cases meant before the column existed.
  usePortalExperience: () => ({ onV2: false, lean: false }),
  usePortalOnV2: () => false,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, push: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: h.from } }));
vi.mock("@/components/blacklist-v2/global-blacklist-table-v2", () => ({ GlobalBlacklistTableV2: () => null }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/hooks/use-tenant-branding", () => ({
  useTenantBranding: () => ({ branding: { app_name: "Northwind Rentals", logo_url: null }, brandName: "Northwind Rentals" }),
}));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ isManager: h.isManager, canView: h.canView }),
}));
// A head admin: the role the old Manage Users item was shown to.
vi.mock("@/stores/auth-store", () => ({ useAuth: () => ({ appUser: { role: "head_admin" } }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import GlobalBlacklistPage from "@/app/(dashboard)/settings/blacklist/page";
import {
  V2_GENERAL_SECTIONS,
  V2_HIDDEN_SETTINGS_PAGES,
  V2_TAX_AND_DEPOSIT_SECTIONS,
  isTabbedV2Page,
  resolveV2SettingsRoute,
  settingsSectionId,
} from "@/components/settings-v2/settings-shell-state";
import { OrgSwitcher } from "@/components/shared/layout/org-switcher";

beforeEach(() => {
  h.v2 = true;
  h.replace.mockReset();
  h.from.mockReset();
  h.isManager = false;
  h.canView = () => true;
});

/* -------------------------------------------------------------------------- */
/* Settings page wiring (source)                                               */
/* -------------------------------------------------------------------------- */

/** The members of a `const NAME = new Set([...]);` in the page source, in order. */
const setMembers = (source: string, name: string): string[] => {
  const body = source.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\);`))?.[1];
  expect(body, name).toBeDefined();
  return [...body!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

/** A `V2_SETTINGS_PAGES` entry's fields (single-quoted values only), read from the page source. */
const pageEntry = (pagesDecl: string, tab: string) => {
  const line = pagesDecl.split("\n").find((l) => new RegExp(`^\\s*'?${tab}'?: \\{ section:`).test(l));
  expect(line, tab).toBeDefined();
  const field = (key: string) => line!.match(new RegExp(`${key}: '([^']*)'`))?.[1];
  return { section: field("section"), title: field("title"), description: field("description"), permTab: field("permTab") };
};

describe("settings page (v2): General is three stacked sections; five sections left it for pages of their own", () => {
  const page = read("app/(dashboard)/settings/page.tsx");
  const v2Start = page.indexOf("  if (v2Chrome) {\n    const pageMeta =");
  const v2End = page.indexOf("\n  return (", page.indexOf("<LeaveDialogV2", v2Start));
  const v2 = page.slice(v2Start, v2End);
  const pagesDecl = page.slice(page.indexOf("const V2_SETTINGS_PAGES:"), page.indexOf("};", page.indexOf("const V2_SETTINGS_PAGES:")));
  const general = v2.slice(v2.indexOf("        case 'general': {"), v2.indexOf("        case 'duration':"));
  const tax = v2.slice(v2.indexOf("        case 'tax-and-deposit':"), v2.indexOf("        case 'booking-site': {"));
  const sections = v2.slice(v2.indexOf("const renderV2Sections ="), v2.indexOf("const renderBody ="));
  /** The body of `case '<anchor>':` inside a slice, up to the next case (or the slice's end). */
  const caseBody = (slice: string, anchor: string) => {
    const at = slice.indexOf(`case '${anchor}':`);
    expect(at, anchor).toBeGreaterThan(-1);
    const next = slice.indexOf("case '", at + 6);
    return slice.slice(at, next === -1 ? undefined : next);
  };
  /** A top-level `case '<tab>':` of renderBody, up to the next one. */
  const pageCase = (tab: string) => {
    const at = v2.indexOf(`\n        case '${tab}':`);
    expect(at, tab).toBeGreaterThan(-1);
    const next = v2.indexOf("\n        case '", at + 10);
    return v2.slice(at, next === -1 ? undefined : next);
  };

  it("Booking rules, Lockbox, Tax and deposit, Booking site and Optional modules have a page entry and render case each", () => {
    expect(v2Start).toBeGreaterThan(-1);
    for (const [tab, section, title, perm] of [
      ["duration", "Business", "Booking rules", "duration"],
      ["lockbox", "Business", "Lockbox", "lockbox"],
      // Tax and deposit's ENTRY is under Pricing (ticket item 1), while the
      // page, its key and all three aliases are unchanged.
      ["tax-and-deposit", "Pricing", "Tax and deposit", "fees"],
      ["booking-site", "Business", "Booking site", "general"],
      ["modules", "Business", "Optional modules", "general"],
    ]) {
      const entry = pageEntry(pagesDecl, tab);
      expect({ section: entry.section, title: entry.title, permTab: entry.permTab }, tab).toEqual({ section, title, permTab: perm });
      expect(entry.description, tab).toBeTruthy();
      expect(v2, tab).toMatch(new RegExp(`\\n        case '${tab}':`));
    }
    // Driver requirements and the monthly rate are sections of General, and the
    // two money halves sections of one page: none has an entry or a case of its own.
    for (const tab of ["requirements", "fees", "preauth", "monthly-rate"]) {
      expect(pagesDecl, tab).not.toMatch(new RegExp(`^\\s*'?${tab}'?: \\{`, "m"));
      expect(v2, tab).not.toContain(`\n        case '${tab}':`);
    }
    // The section keys General shed when those pages left are gone with them.
    expect(v2).not.toContain("case 'key-handover':");
    expect(v2).not.toContain("case 'optional-modules':");
    expect(v2).not.toContain("case 'booking-rules':");
    // And the parallel 'fees' page key this ticket briefly had is gone: one page.
    expect(pagesDecl).not.toMatch(/^\s*fees: \{/m);
  });

  it("Weekend and holiday pricing is the pricing page's new title; the tab and its permission are unchanged", () => {
    expect(pageEntry(pagesDecl, "pricing")).toEqual({
      section: "Pricing",
      title: "Weekend and holiday pricing",
      description: "Charge more for the weekend days and holidays a rental includes.",
      permTab: "pricing",
    });
  });

  it("ONE helper renders every sectioned page, and it is the only place the two layouts are told apart", () => {
    expect(v2).toContain("const v2Sections = v2PageSections(v2Page).filter((section) => canViewSettings(section.permTab));");
    expect(sections).toContain("isTabbedV2Page(v2Page) ? (");
    // The tab strip and the stacked list are both reachable from here, and nowhere else.
    expect(sections).toContain("<SettingsTabs");
    expect(sections).toContain("<SettingsSection");
    expect(sections).toContain("anchor={section.anchor}");
    // A partly editable page says "View only" on the sections it can't change,
    // in either layout.
    expect(sections).toContain("{canEditPage && !canEditSettings(section.permTab) && <SettingsReadOnlyNotice />}");
    expect(sections).toContain("action={canEditPage && !canEditSettings(section.permTab) ? <SettingsReadOnlyNotice /> : undefined}");
    expect(v2.replace(sections, "")).not.toContain("<SettingsTabs");
  });

  it("GENERAL IS STACKED, not tabs: it renders through the helper and draws no tab strip of its own", () => {
    // The team lead settled this today (transcript 00:54, "tab na bana do"):
    // Regional, Driver requirements and Monthly rate are headings one under
    // another. `V2_SECTIONED_PAGES.general.layout` is what decides, so General
    // draws no <SettingsTabs> and no <SettingsTabPanel> itself.
    expect(general).toMatch(/return renderV2Sections\(v2Sections, sectionBody\);/);
    expect(general).not.toContain("<SettingsTabs");
    expect(general).not.toContain("<SettingsTabPanel");
    // Three sections, in the lead's order.
    expect(V2_GENERAL_SECTIONS.map((s) => s.anchor)).toEqual(["regional", "driver-requirements", "monthly-rate"]);
    // Each is drawn by General, under its OWN permission.
    for (const [anchor, perm] of [
      ["driver-requirements", "requirements"],
      ["monthly-rate", "pricing"],
    ]) {
      expect(V2_GENERAL_SECTIONS.find((s) => s.anchor === anchor)?.permTab, anchor).toBe(perm);
      expect(caseBody(general, anchor), anchor).toContain(`canEdit={canEditSettings('${perm}')}`);
    }
    // …and every money section by the Tax and deposit page, never by General.
    for (const [anchor, perm] of [
      ["tax-and-fees", "fees"],
      ["security-deposit", "preauth"],
    ]) {
      expect(V2_TAX_AND_DEPOSIT_SECTIONS.find((s) => s.anchor === anchor)?.permTab, anchor).toBe(perm);
      expect(general, anchor).not.toContain(`case '${anchor}':`);
    }
    expect(tax).toContain("canEdit={canEditSettings('fees')}");
    expect(tax).toContain("canEdit={canEditSettings('preauth')}");
    // Regional follows General's own permission.
    expect(general).toContain("const canEditGeneral = canEditSettings('general');");
    expect(general).toContain("canEdit={canEditGeneral}");
    expect(general).not.toContain("canEdit={canEditPage}");
    expect(general).not.toContain("!canEditPage}");
    expect(tax).not.toContain("canEdit={canEditPage}");
  });

  it("the monthly rate on General saves as it did on the pricing page; the pricing page no longer draws it", () => {
    const monthly = caseBody(general, "monthly-rate");
    expect(monthly).toContain("<MonthlyRateSectionV2");
    expect(monthly).toContain("registerSave={registerV2SectionSave}");
    expect(monthly).toContain("monthlyTier={v2MonthlyTier}");
    const tier = v2.slice(v2.indexOf("const v2MonthlyTier = {"), v2.indexOf("const renderBody ="));
    expect(tier).toContain("await updateRentalSettings({ monthly_tier_days: rentalForm.monthly_tier_days } as any);");
    expect(tier).toContain("await refetchTenant();");
    expect(tier).toContain("read: v2RentalRead,");
    const pricing = pageCase("pricing");
    expect(pricing).toContain("<PricingRulesV2 canEdit={canEditPage} registerSave={registerV2SectionSave} onDirtyChange={setPricingDirty} />");
    expect(pricing).not.toContain("monthlyTier");
    // business-rules-logic reads this key: the save bar covers the monthly rate
    // on General exactly as it covered it on the pricing page.
    expect(v2).toContain('"pricing-monthly-tier"');
  });

  it("the deposit keeps its charge confirmation on the Tax and deposit page", () => {
    expect(tax).toContain("onRequestCharge={() => setShowChargeConfirm(true)}");
    expect(v2).toContain("{depositChargeConfirmDialog}");
  });

  it("the open section lives in ?tab= (replace while clean, push while there are unsaved edits), shown at once while the URL catches up", () => {
    expect(v2).toContain(
      "v2Sections.find((section) => section.anchor === (v2PickedPageTab ?? v2Route?.anchor)) ?? v2Sections[0] ?? null;",
    );
    expect(v2).toContain("const href = `/settings?tab=${section.tab ?? v2Page}`;");
    expect(v2).toContain("if (v2PageHasEdits) router.push(href, { scroll: false });");
    expect(v2).toContain("else router.replace(href, { scroll: false });");
    // The picked section is state declared before the v1 early returns, and cleared when ?tab= changes.
    const state = page.indexOf("const [v2PickedPageTab, setV2PickedPageTab] = useState<string | null>(null);");
    expect(state).toBeGreaterThan(-1);
    expect(page.indexOf("if (!v2Chrome && error && !settings) {")).toBeGreaterThan(state);
    expect(page).toContain("useEffect(() => {\n    setV2PickedPageTab(null);\n  }, [v2TabParam]);");
  });

  it("each moved page keeps its section's permission and gate", () => {
    expect(pageCase("duration")).toContain("canEdit={canEditSettings('duration')}");
    expect(pageCase("duration")).toContain('<BusinessRentalGate thing="your booking rules" rows={4}>');
    expect(pageCase("lockbox")).toContain("canEdit={canEditSettings('lockbox')}");
    expect(pageCase("lockbox")).toContain('<BusinessRentalGate thing="your lockbox settings" rows={4}>');
    expect(tax).toContain("<SettingsSection");
    expect(tax).toContain("action={canEditPage && !canEditSettings(section.permTab) ? <SettingsReadOnlyNotice /> : undefined}");
    const site = pageCase("booking-site");
    expect(site).toContain("const canEditGeneral = canEditSettings('general');");
    expect(site).toContain('sectionKey="booking-site-colours"');
    const modules = pageCase("modules");
    expect(modules).toContain("disabled={savingFleetHealth || !canEditSettings('general') || !v2FleetHealthReady}");
    // The moved pages draw their switches and buttons with the v2 parts.
    for (const body of [site, modules]) {
      expect(body).not.toMatch(/<Switch[\s>]/);
      expect(body).not.toMatch(/<Button[\s>]/);
    }
    expect(site).toContain("<SwitchV2");
    expect(modules).toContain("<SwitchV2");
  });

  it("a sectioned page opens when any of its sections may be viewed; editing it needs any section's editor grant", () => {
    expect(page).toContain("const v2Route = v2Chrome ? resolveV2SettingsRoute(v2TabParam, V2_SETTINGS_PAGES) : null;");
    expect(v2).toContain("v2Page && v2Route?.permTab && canViewAny(v2Route.permTab, canViewSettings) ? V2_SETTINGS_PAGES[v2Page] : null;");
    expect(v2).toContain("? v2Sections.some((section) => canEditSettings(section.permTab))");
    expect(v2).toContain("pages: v2NoticePages(V2_SETTINGS_PAGES),");
  });

  it("an old #settings-… link to a section that moved goes on to its new page, before the v1 early returns", () => {
    const effect = page.indexOf("const home = v2SectionHomePage(v2Hash);");
    expect(effect).toBeGreaterThan(-1);
    expect(page.indexOf("if (!v2Chrome && error && !settings) {")).toBeGreaterThan(effect);
    const body = page.slice(effect, page.indexOf("}, [v2Chrome, v2Page, v2Hash, searchParams, router]);", effect));
    expect(body).toContain("if (!home || home === v2Page) return;");
    expect(body).toContain("router.replace(`/settings?${params.toString()}#${v2Hash}`, { scroll: false });");
  });

  it("Optional modules is left off the index, and says so on its page, when no module applies", () => {
    expect(v2).toContain("const v2ShowOptionalModules = turoV2 || !hideVehicleOwnersToggle || !hideFleetHealthRow;");
    expect(v2).toContain("hiddenHrefs={v2ShowOptionalModules ? undefined : ['/settings?tab=modules']}");
    expect(pageCase("modules")).toContain("None of the optional modules are available for your workspace.");
  });

  it("no page-level General skeleton: each section loads and fails on its own", () => {
    expect(v2).not.toContain("v2Page === 'general' ? (");
    expect(v2).not.toContain('label="Loading regional settings"');
  });

  it("a deep link SCROLLS to its section, General included, wired before the v1 early returns", () => {
    const hook = page.indexOf("useScrollToSection(v2ScrollTarget, v2Chrome && v2SectionsReady);");
    const firstEarlyReturn = page.indexOf("if (!v2Chrome && error && !settings) {");
    expect(hook).toBeGreaterThan(-1);
    expect(firstEarlyReturn).toBeGreaterThan(hook);
    expect(page).toContain(
      "v2Route?.anchor && !isTabbedV2Page(v2Page) ? settingsSectionId(v2Route.anchor) : v2Page ? v2Hash : null;",
    );
    expect(page).toContain("setV2Hash(hash.startsWith('settings-') ? hash : null);");
    // General is stacked, so `?tab=requirements` yields an anchor AND
    // `isTabbedV2Page` is false: the scroll target is that section's id.
    expect(isTabbedV2Page("general")).toBe(false);
    expect(settingsSectionId(resolveV2SettingsRoute("requirements", { general: { permTab: "general" } }).anchor!)).toBe(
      "settings-driver-requirements",
    );
  });

  it("one save bar on General, the pages that came out of it (not Optional modules), Customer messages, Weekend and holiday pricing, Locations, the three payment-plan forms and Notifications", () => {
    expect(new Set(setMembers(page, "V2_PAGES_WITH_SAVE_BAR"))).toEqual(
      new Set([
        "general",
        "duration",
        "lockbox",
        "tax-and-deposit",
        "booking-site",
        "templates",
        "pricing",
        "locations",
        "installments",
        "payg",
        "auto-extend",
        "notifications",
      ]),
    );
    // Optional modules' switches save as they flip, so it has no bar.
    expect(setMembers(page, "V2_PAGES_WITH_SAVE_BAR")).not.toContain("modules");
  });

  it("General, the pages that came out of it and Customer messages put each control at the end of its row", () => {
    expect(new Set(setMembers(page, "V2_PAGES_CONTROLS_AT_END"))).toEqual(
      new Set(["general", "duration", "lockbox", "tax-and-deposit", "booking-site", "modules", "templates"]),
    );
    expect(v2).toContain("<SettingsRowAlignProvider align={V2_PAGES_CONTROLS_AT_END.has(v2Page as string) ? 'end' : 'start'}>");
  });

  it("General, Tax and deposit and the moved pages gate their own controls, so a viewer's Try again still works", () => {
    expect(setMembers(page, "V2_PAGES_GATING_OWN_CONTROLS")).toEqual(
      expect.arrayContaining(["general", "duration", "lockbox", "tax-and-deposit", "booking-site", "modules", "pricing", "notifications"]),
    );
  });

  it("Optional modules is left off the index, and says so on its page, when no module applies", () => {
    expect(v2).toContain("const v2ShowOptionalModules = turoV2 || !hideVehicleOwnersToggle || !hideFleetHealthRow;");
    expect(v2).toContain("hiddenHrefs={v2ShowOptionalModules ? undefined : ['/settings?tab=modules']}");
    expect(pageCase("modules")).toContain("None of the optional modules are available for your workspace.");
  });
});

describe("settings page (v2): Lockbox and the lockbox message", () => {
  const page = read("app/(dashboard)/settings/page.tsx");
  const v2Start = page.indexOf("  if (v2Chrome) {\n    const pageMeta =");
  const v2 = page.slice(v2Start);
  const lockbox = v2.slice(v2.indexOf("        case 'lockbox':"), v2.indexOf("        case 'tax-and-deposit':"));
  const templates = v2.slice(v2.indexOf("        case 'templates': {"), v2.indexOf("        case 'insurance':"));

  it("Lockbox gets no Twilio props, and its Templates link targets the lockbox message", () => {
    expect(lockbox).toContain("<LockboxPageV2");
    expect(lockbox).not.toContain("smsReady");
    expect(lockbox).not.toContain("integrationsHref");
    expect(lockbox).toContain("templatesHref={V2_LOCKBOX_MESSAGES_HREF}");
    expect(page).toContain("const V2_LOCKBOX_MESSAGES_HREF = `/settings?tab=templates#${settingsSectionId('lockbox-messages')}`;");
    expect(page).toContain("  lockbox: { section: 'Business', title: 'Lockbox', description:");
  });

  it("Customer messages carries the lockbox message, email only, under Lockbox's permission", () => {
    expect(templates).toContain("{v2ShowLockboxMessages && (");
    expect(templates).toContain("<div id={settingsSectionId('lockbox-messages')} className=\"scroll-mt-24\">");
    expect(templates).toContain("channels={['email']}");
    expect(templates).toContain('keyHandoverHref="/settings?tab=lockbox"');
    expect(templates).toContain("registerSave={registerV2SectionSave}");
    expect(v2).toContain("const v2ShowLockboxMessages = canViewSettings('lockbox');");
    // Its save bar shows for someone who may edit only the lockbox message.
    expect(v2).toContain("? canEditSettings('templates') || (v2ShowLockboxMessages && canEditSettings('lockbox'))");
  });

  it("the Lockbox page no longer mounts the messages editor", () => {
    const pages = read("components/settings-v2/business-rules-pages.tsx");
    expect(pages).not.toContain('from "@/components/settings-v2/lockbox-templates-v2"');
    expect(pages).not.toContain("<LockboxTemplatesSectionV2");
    expect(pages).not.toContain("<RadioGroup");
    expect(pages).not.toContain('from "@/components/ui/select"');
    expect(pages).not.toContain('from "@/components/ui/input"');
    expect(pages).not.toContain('from "@/components/ui/switch"');
  });
});

describe("settings page (v2): the pages that are back, blacklist and Weekend and holiday pricing", () => {
  const page = read("app/(dashboard)/settings/page.tsx");
  const redirects = page.slice(page.indexOf("const V2_SETTINGS_REDIRECTS"), page.indexOf("};", page.indexOf("const V2_SETTINGS_REDIRECTS")));

  it("nothing is hidden: the five pages have their entries and render cases, and ?tab= opens them", () => {
    expect(V2_HIDDEN_SETTINGS_PAGES.size).toBe(0);
    for (const tab of ["installments", "payg", "'auto-extend'", "promos", "extras"]) {
      expect(page).toMatch(new RegExp(`^\\s*${tab}: \\{ section:`, "m"));
    }
    expect(page).toContain("        case 'promos': {");
    expect(page).toContain("        case 'extras':");
    // The same pages map the page routes with: each tab opens its own page.
    const pagesDecl = page.slice(page.indexOf("const V2_SETTINGS_PAGES:"), page.indexOf("};", page.indexOf("const V2_SETTINGS_PAGES:")));
    for (const tab of ["installments", "payg", "auto-extend", "promos", "extras"]) {
      const pages = { [tab]: { permTab: tab } };
      expect(resolveV2SettingsRoute(tab, pages), tab).toEqual({ page: tab, anchor: null, permTab: tab });
      expect(pagesDecl, tab).toContain(`permTab: '${tab}' }`);
    }
  });

  it("Promo codes and Extras are lists that save per item: they register nothing, so leaving them never asks", () => {
    const v2Start = page.indexOf("  if (v2Chrome) {\n    const pageMeta =");
    const promos = page.slice(page.indexOf("        case 'promos': {", v2Start), page.indexOf("        case 'extras':", v2Start));
    const extras = page.slice(page.indexOf("        case 'extras':", v2Start), page.indexOf("        case 'reminders':", v2Start));
    expect(promos).not.toContain("registerSave");
    expect(extras).not.toContain("registerSave");
    expect(extras).toContain("<ExtrasSettings />");
    expect(read("components/settings/extras-settings.tsx")).not.toContain("registerSave");
  });

  it("the three payment-plan forms hand the page their save and discard", () => {
    expect(page).toContain("          return <InstallmentSettings registerSave={registerV2SectionSave} />;");
    expect(page).toContain("          return <PayAsYouGoSettingsV2 canEdit={canEditPage} registerSave={registerV2SectionSave} />;");
    expect(page).toContain("          return <AutoExtendSettingsV2 canEdit={canEditPage} registerSave={registerV2SectionSave} />;");
  });

  it("the v2 promo form and its dialogs use the v2 dropdown, fields and buttons; v1 keeps its own", () => {
    const v2Start = page.indexOf("  if (v2Chrome) {\n    const pageMeta =");
    const promos = page.slice(page.indexOf("        case 'promos': {", v2Start), page.indexOf("        case 'extras':", v2Start));
    expect(promos).toContain("<SelectV2 value={promoForm.type}");
    expect(promos).toContain("<SelectTriggerV2");
    expect(promos).not.toMatch(/<Select[ >]/);
    expect(promos).not.toMatch(/<Input[ >\n]/);
    expect(promos).not.toMatch(/<Button[ >\n]/);
    expect(promos).not.toMatch(/<Popover[ >]/);
    // The shared Edit / Delete dialogs pick their parts by design.
    expect(page).toContain("const PromoUi = v2Chrome ? PROMO_DIALOG_UI_V2 : PROMO_DIALOG_UI_V1;");
    expect(page).toContain("<PromoUi.Select");
    expect(page).toContain("  Dialog: DialogV2, DialogContent: DialogContentV2,");
    expect(page).toContain("Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Popover, PopoverContent, PopoverTrigger, Calendar,");
  });

  it("?tab=blacklist is no longer forwarded to /settings/blacklist", () => {
    expect(redirects).not.toContain("blacklist");
    expect(redirects).toContain("branding: '/settings/appearance',");
    expect(redirects).toContain("subscription: '/subscription',");
  });

  it("Custom pricing is Weekend and holiday pricing, in the Pricing section, on the same tab and permission", () => {
    const pagesDecl = page.slice(page.indexOf("const V2_SETTINGS_PAGES:"), page.indexOf("};", page.indexOf("const V2_SETTINGS_PAGES:")));
    const entry = pageEntry(pagesDecl, "pricing");
    expect(entry).toEqual({
      section: "Pricing",
      title: "Weekend and holiday pricing",
      description: "Charge more for the weekend days and holidays a rental includes.",
      permTab: "pricing",
    });
    // Its description no longer promises the monthly rate, which moved to General.
    expect(entry.description).not.toMatch(/month/i);
    expect(pageEntry(pagesDecl, "general").description).toContain("monthly rate");
    expect(pageEntry(pagesDecl, "general").description).not.toMatch(/fee|deposit/i);
  });

  it("the index is told who is a head admin (Team)", () => {
    expect(page).toContain("isHeadAdmin={isHeadAdmin}");
  });

  it("agreements link to the Pay As You Go page again, for someone who may open it", () => {
    const agreements = read("components/settings-v2/agreement-templates-v2.tsx");
    expect(agreements).toContain('const canOpenPayg = canViewSettings("payg");');
    expect(agreements).toContain(
      'action={canOpenPayg ? { label: "Open Pay As You Go", href: "/settings?tab=payg" } : undefined}',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* /settings/blacklist                                                         */
/* -------------------------------------------------------------------------- */

describe("settings page (v2): one Notifications page (D7, D8)", () => {
  const page = read("app/(dashboard)/settings/page.tsx");
  const v2Start = page.indexOf("  if (v2Chrome) {\n    const pageMeta =");
  const pagesDecl = page.slice(page.indexOf("const V2_SETTINGS_PAGES:"), page.indexOf("};", page.indexOf("const V2_SETTINGS_PAGES:")));
  const notifications = page.slice(
    page.indexOf("        case 'notifications':", v2Start),
    page.indexOf("        default:", page.indexOf("        case 'notifications':", v2Start)),
  );

  it("is a page of the Notifications section, under the Notifications permission (settings.reminders)", () => {
    expect(pageEntry(pagesDecl, "notifications")).toEqual({
      section: "Notifications",
      title: "Notifications",
      description: "Every email, push and in-app message: when it is sent, what it says and who gets it.",
      permTab: "notifications",
    });
    // Customer messages moved to the Templates section.
    expect(pageEntry(pagesDecl, "templates").section).toBe("Templates");
    // Team emails and Push keep their entries (the notices name them) and their cases (v1-era).
    expect(pagesDecl).toMatch(/^\s*reminders: \{ section:/m);
    expect(pagesDecl).toMatch(/^\s*push: \{ section:/m);
    expect(page).toContain("        case 'reminders':");
    expect(page).toContain("        case 'push':");
  });

  it("is loaded on demand, and gets the page's permission, save bar, today's reminder settings and scroll target", () => {
    expect(page).toContain("import('@/components/settings-v2/notifications-v2/notifications-page-v2').then((m) => m.NotificationsPageV2)");
    expect(page).not.toMatch(/^import \{[^}]*NotificationsPageV2[^}]*\} from/m);
    expect(notifications).toContain("canEdit={canEditPage}");
    expect(notifications).toContain("registerSave={registerV2SectionSave}");
    expect(notifications).toContain("todaySettings={renderV2NotificationsToday()}");
    expect(notifications).toContain("scrollTarget={v2ScrollTarget}");
    expect(setMembers(page, "V2_PAGES_WITH_SAVE_BAR")).toContain("notifications");
    expect(setMembers(page, "V2_PAGES_GATING_OWN_CONTROLS")).toContain("notifications");
  });

  it("today's reminder settings wait for the real org settings, never painting placeholders", () => {
    const today = page.slice(page.indexOf("const renderV2NotificationsToday = () =>"), page.indexOf("const renderV2Sections ="));
    expect(today).toContain("BusinessV2.hasRealOrgSettings(settings as any)");
    expect(today).toContain("renderV2ReminderExtras()");
    expect(today).toContain("<SettingsLoadError");
    expect(today).toContain("<SettingsSectionSkeleton");
    expect(today).toContain("hideRemindersRows ? null");
  });
});

describe("/settings/blacklist on v2", () => {
  const mount = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <GlobalBlacklistPage />
      </QueryClientProvider>,
    );

  it("sends v2 to the Settings index, renders nothing, and never reads the blacklist", () => {
    const { container } = mount();
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(h.replace).toHaveBeenCalledWith("/settings");
    expect(container.innerHTML).toBe("");
    expect(h.from).not.toHaveBeenCalled();
  });

  it("v1 keeps its page and its read", () => {
    h.v2 = false;
    h.from.mockReturnValue({
      select: () => ({ order: () => new Promise(() => undefined) }),
    });
    mount();
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.from).toHaveBeenCalledWith("v_global_blacklist_details");
  });
});

/* -------------------------------------------------------------------------- */
/* Org menu                                                                    */
/* -------------------------------------------------------------------------- */

describe("OrgSwitcher (v2 sidebar): one row, one destination", () => {
  /*
   * This row used to open a dropdown holding Organization settings, Billing &
   * subscription and Audit Logs. All three were taken out on request — the
   * first two have their own tab already, and Audit Logs moved onto the
   * Settings index — which left the menu with nothing in it, so the row is now
   * a plain link to /settings. These cases pin that: no menu anywhere, in
   * either the expanded pill or the collapsed rail, and the manager gate that
   * used to decide whether the menu listed Settings now decides whether the
   * row links at all.
   */
  it("is a link straight to Settings, with no menu behind it", () => {
    render(<OrgSwitcher />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/settings");
    expect(link).toHaveTextContent("Northwind Rentals");
    // Nothing opens. A menu would need a trigger, and there is none.
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    // The two that moved out, by destination rather than by label.
    expect(document.querySelector('a[href="/subscription"]')).toBeNull();
    expect(document.querySelector('a[href="/audit-logs"]')).toBeNull();
    expect(document.querySelector('a[href="/users"]')).toBeNull();
  });

  it("the collapsed rail is the same link, not a trigger", () => {
    render(<OrgSwitcher collapsed />);
    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a manager with no Settings grant gets the identity row and no link", () => {
    h.isManager = true;
    h.canView = () => false;
    const { unmount } = render(<OrgSwitcher />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Northwind Rentals")).toBeTruthy();
    unmount();
    render(<OrgSwitcher collapsed />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

/**
 * The warning ink. `text-amber-600` measures under 4.5:1 on a light card at the
 * size these notes are set in, so every v2 panel uses `panel-ink-warn`
 * (styles/v2-theme.css), which is the contrast-corrected pair. The v2 branch of
 * the settings page had two left: the Booking site "Photos are not changed…"
 * note and the promo-code-changed warning inside `{v2Chrome && …}`.
 *
 * Source, not a render: this page is too large to mount (see the file header).
 * The assertion is a property of the v2 half — no hardcoded amber ink anywhere
 * in it — not a pin on any one line, so renaming or moving a note does not
 * break it.
 */
describe("settings page (v2): the warning ink", () => {
  // Everything from here down is the v1 layout, which is not being changed.
  const V1_LAYOUT = "container mx-auto p-4 sm:p-6 space-y-6";

  it("the v2 half uses panel-ink-warn, never a hardcoded amber", () => {
    const source = read("app/(dashboard)/settings/page.tsx");
    const split = source.indexOf(V1_LAYOUT);
    expect(split, `the v1 layout marker "${V1_LAYOUT}" is gone; re-point this test`).toBeGreaterThan(0);

    const v2Half = source.slice(0, split).split("\n");
    const offenders = v2Half
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => line.includes("className") && /\b(?:text|border|bg)-amber-/.test(line));
    expect(offenders.map(([n, line]) => `${n}: ${line.trim()}`)).toEqual([]);

    // Not vacuous: the v2 half really does carry warning notes, and they are
    // the corrected ink.
    expect(v2Half.filter((line) => line.includes("panel-ink-warn")).length).toBeGreaterThan(0);
  });
});
