/**
 * v2 Settings structure (team lead reviews, Sep 2026):
 *   - General is two tabs, Regional and Driver requirements (Sep 19 2026);
 *     Booking rules, Lockbox (was Key handover), Tax and deposit (Tax and fees
 *     plus Security deposit), Booking site and Optional modules are pages of
 *     their own again, and every old `?tab=` value still opens the right place
 *     under the right permission;
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
import { V2_HIDDEN_SETTINGS_PAGES, resolveV2SettingsRoute } from "@/components/settings-v2/settings-shell-state";
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

describe("settings page (v2): General is two tabs; five sections left it for pages of their own", () => {
  const page = read("app/(dashboard)/settings/page.tsx");
  const v2Start = page.indexOf("  if (v2Chrome) {\n    const pageMeta =");
  const v2End = page.indexOf("\n  return (", page.indexOf("<LeaveDialogV2", v2Start));
  const v2 = page.slice(v2Start, v2End);
  const pagesDecl = page.slice(page.indexOf("const V2_SETTINGS_PAGES:"), page.indexOf("};", page.indexOf("const V2_SETTINGS_PAGES:")));
  const general = v2.slice(v2.indexOf("        case 'general': {"), v2.indexOf("        case 'duration':"));
  const caseBody = (name: string) => {
    const at = v2.indexOf(`\n        case '${name}':`);
    return v2.slice(at, v2.indexOf("\n        case '", at + 10));
  };

  it("Booking rules, Lockbox, Tax and deposit, Booking site and Optional modules have a page entry and render case each", () => {
    expect(v2Start).toBeGreaterThan(-1);
    for (const [tab, title, perm] of [
      ["duration", "Booking rules", "duration"],
      ["lockbox", "Lockbox", "lockbox"],
      ["'tax-and-deposit'", "Tax and deposit", "fees"],
      ["'booking-site'", "Booking site", "general"],
      ["modules", "Optional modules", "general"],
    ]) {
      expect(pagesDecl, tab).toMatch(new RegExp(`^\\s*${tab}: \\{ section: 'Business', title: '${title}', description: '[^']+', permTab: '${perm}' \\},`, "m"));
    }
    for (const tab of ["duration", "lockbox", "tax-and-deposit", "booking-site", "modules"]) {
      expect(v2, tab).toMatch(new RegExp(`\\n        case '${tab}':`));
    }
    // Driver requirements is a tab of General and the two money halves one
    // page: none of them has an entry or a case of its own.
    for (const tab of ["requirements", "fees", "preauth"]) {
      expect(pagesDecl).not.toMatch(new RegExp(`^\\s*${tab}: \\{`, "m"));
      expect(v2).not.toContain(`\n        case '${tab}':`);
    }
    // General no longer renders a section list: no Key handover, no stacked sections.
    expect(v2).not.toContain("case 'key-handover':");
    expect(v2).not.toContain("case 'optional-modules':");
    expect(general).not.toContain("<SettingsSection");
  });

  it("General is a tab strip of the tabs this user may see, each under its own permission", () => {
    expect(v2).toContain("const v2Sections = v2PageSections(v2Page).filter((section) => canViewSettings(section.permTab));");
    expect(general).toContain("<SettingsTabs");
    expect(general).toContain("tabs={v2Sections.map((section) => ({ value: section.anchor, label: section.title }))}");
    expect(general).toContain("value={v2OpenSection?.anchor ?? ''}");
    expect(general).toContain("onValueChange={openV2PageTab}");
    expect(general).toContain("<SettingsTabPanel key={section.anchor} value={section.anchor}");
    // A partly editable page says "View only" on the tab it can't change.
    expect(general).toContain("{canEditPage && !canEditSettings(section.permTab) && <SettingsReadOnlyNotice />}");
    const requirements = general.slice(general.indexOf("case 'driver-requirements':"));
    expect(requirements).toContain("canEdit={canEditSettings('requirements')}");
    // Regional follows General's own permission.
    expect(general).toContain("const canEditGeneral = canEditSettings('general');");
    expect(general).toContain("canEdit={canEditGeneral}");
    expect(general).not.toContain("canEdit={canEditPage}");
    expect(general).not.toContain("!canEditPage}");
  });

  it("the open tab lives in ?tab= (replace while clean, push while there are unsaved edits), shown at once while the URL catches up", () => {
    expect(v2).toContain(
      "v2Sections.find((section) => section.anchor === (v2PickedPageTab ?? v2Route?.anchor)) ?? v2Sections[0] ?? null;",
    );
    expect(v2).toContain("const href = `/settings?tab=${section.tab ?? v2Page}`;");
    expect(v2).toContain("if (v2PageHasEdits) router.push(href, { scroll: false });");
    expect(v2).toContain("else router.replace(href, { scroll: false });");
    // The picked tab is state declared before the v1 early returns, and cleared when ?tab= changes.
    const state = page.indexOf("const [v2PickedPageTab, setV2PickedPageTab] = useState<string | null>(null);");
    expect(state).toBeGreaterThan(-1);
    expect(page.indexOf("if (!v2Chrome && error && !settings) {")).toBeGreaterThan(state);
    expect(page).toContain("useEffect(() => {\n    setV2PickedPageTab(null);\n  }, [v2TabParam]);");
  });

  it("each moved page keeps its section's permission and gate", () => {
    expect(caseBody("duration")).toContain("canEdit={canEditSettings('duration')}");
    expect(caseBody("duration")).toContain('<BusinessRentalGate thing="your booking rules" rows={4}>');
    expect(caseBody("lockbox")).toContain("canEdit={canEditSettings('lockbox')}");
    expect(caseBody("lockbox")).toContain('<BusinessRentalGate thing="your lockbox settings" rows={4}>');
    const tax = caseBody("tax-and-deposit");
    expect(tax).toContain("<SettingsSection");
    expect(tax).toContain("canEdit={canEditSettings('fees')}");
    expect(tax).toContain("canEdit={canEditSettings('preauth')}");
    expect(tax).toContain("action={canEditPage && !canEditSettings(section.permTab) ? <SettingsReadOnlyNotice /> : undefined}");
    const site = caseBody("booking-site");
    expect(site).toContain("const canEditGeneral = canEditSettings('general');");
    expect(site).toContain('sectionKey="booking-site-colours"');
    const modules = caseBody("modules");
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

  it("no page-level General skeleton: each tab loads and fails on its own", () => {
    expect(v2).not.toContain("v2Page === 'general' ? (");
    expect(v2).not.toContain('label="Loading regional settings"');
  });

  it("a deep link scrolls to its section (never on General, whose sections are tabs), wired before the v1 early returns", () => {
    const hook = page.indexOf("useScrollToSection(v2ScrollTarget, v2Chrome && v2SectionsReady);");
    const firstEarlyReturn = page.indexOf("if (!v2Chrome && error && !settings) {");
    expect(hook).toBeGreaterThan(-1);
    expect(firstEarlyReturn).toBeGreaterThan(hook);
    expect(page).toContain(
      "v2Route?.anchor && !isTabbedV2Page(v2Page) ? settingsSectionId(v2Route.anchor) : v2Page ? v2Hash : null;",
    );
    expect(page).toContain("setV2Hash(hash.startsWith('settings-') ? hash : null);");
  });

  it("one save bar on General, the pages that came out of it (not Optional modules), Customer messages, Custom pricing, Locations and the three payment-plan forms", () => {
    expect(page).toContain(
      "const V2_PAGES_WITH_SAVE_BAR = new Set(['general', 'duration', 'lockbox', 'tax-and-deposit', 'booking-site', 'templates', 'pricing', 'locations', 'installments', 'payg', 'auto-extend']);",
    );
  });

  it("General and the pages that came out of it put each control at the end of its row; every other page keeps it after the label", () => {
    expect(page).toContain(
      "const V2_PAGES_CONTROLS_AT_END = new Set(['general', 'duration', 'lockbox', 'tax-and-deposit', 'booking-site', 'modules']);",
    );
    expect(v2).toContain("<SettingsRowAlignProvider align={V2_PAGES_CONTROLS_AT_END.has(v2Page as string) ? 'end' : 'start'}>");
  });

  it("the moved pages gate their own controls, so a viewer's Try again still works", () => {
    const set = page.match(/const V2_PAGES_GATING_OWN_CONTROLS = new Set\(\[([^\]]*)\]\);/);
    expect(set).not.toBeNull();
    for (const tab of ["general", "duration", "lockbox", "tax-and-deposit", "booking-site", "modules"]) {
      expect(set![1], tab).toContain(`'${tab}'`);
    }
  });

  it("Optional modules is left off the index, and says so on its page, when no module applies", () => {
    expect(v2).toContain("const v2ShowOptionalModules = turoV2 || !hideVehicleOwnersToggle || !hideFleetHealthRow;");
    expect(v2).toContain("hiddenHrefs={v2ShowOptionalModules ? undefined : ['/settings?tab=modules']}");
    expect(caseBody("modules")).toContain("None of the optional modules are available for your workspace.");
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

describe("settings page (v2): the pages that are back, blacklist and Custom pricing", () => {
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

  it("Pricing rules is Custom pricing, in the Pricing section, on the same tab and permission", () => {
    expect(page).toContain(
      "pricing: { section: 'Pricing', title: 'Custom pricing', description: 'Weekend and holiday surcharges, and when monthly pricing starts.', permTab: 'pricing' },",
    );
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

describe("OrgSwitcher (v2 sidebar): Team lives in Settings, not here", () => {
  // Radix's popper constructs a ResizeObserver; the shared setup's stub is a
  // plain function, so give it a class for these renders only.
  const SetupResizeObserver = globalThis.ResizeObserver;
  beforeEach(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = SetupResizeObserver;
  });

  const openMenu = () => {
    render(<OrgSwitcher />);
    fireEvent.click(screen.getByText("Northwind Rentals"));
  };

  it("a head admin sees Settings, Billing and Audit Logs, and no Manage Users", () => {
    openMenu();
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent?.trim());
    expect(items).toEqual(["Organization settings", "Billing & subscription", "Audit Logs"]);
    expect(screen.queryByText("Manage Users")).toBeNull();
    expect(document.querySelector('a[href="/users"]')).toBeNull();
  });

  it("with no Audit Logs grant, no separator is left dangling after Billing", () => {
    h.isManager = true;
    h.canView = (tab) => tab === "settings";
    openMenu();
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent?.trim());
    expect(items).toEqual(["Organization settings", "Billing & subscription"]);
    // One separator only: the one under the organization's name.
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });
});
