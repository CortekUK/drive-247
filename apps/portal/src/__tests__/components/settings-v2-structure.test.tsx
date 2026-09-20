/**
 * v2 Settings structure (team lead review, Sep 2026):
 *   - six small pages merged into General as sections, with `?tab=` deep links
 *     that open General at the section, and a permission per section;
 *   - Key handover sends the code by email only, and its message moved to
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

describe("settings page (v2): General holds six former pages as sections", () => {
  const page = read("app/(dashboard)/settings/page.tsx");
  const v2Start = page.indexOf("  if (v2Chrome) {\n    const pageMeta =");
  const v2End = page.indexOf("\n  return (", page.indexOf("<LeaveDialogV2", v2Start));
  const v2 = page.slice(v2Start, v2End);
  const pagesDecl = page.slice(page.indexOf("const V2_SETTINGS_PAGES:"), page.indexOf("};", page.indexOf("const V2_SETTINGS_PAGES:")));
  const general = v2.slice(v2.indexOf("        case 'general': {"), v2.indexOf("        case 'locations':"));

  it("the merged pages have no page entry and no render case of their own any more", () => {
    expect(v2Start).toBeGreaterThan(-1);
    for (const tab of ["requirements", "duration", "lockbox", "'booking-site'", "fees", "preauth"]) {
      expect(pagesDecl).not.toMatch(new RegExp(`^\\s*${tab}: \\{`, "m"));
    }
    for (const tab of ["requirements", "duration", "lockbox", "booking-site", "fees", "preauth"]) {
      expect(v2).not.toContain(`\n        case '${tab}':`);
    }
  });

  it("General renders every section this user may see, each under its own permission", () => {
    expect(v2).toContain("const v2GeneralSections = V2_GENERAL_SECTIONS.filter((section) => canViewSettings(section.permTab));");
    expect(general).toContain("<SettingsSection");
    expect(general).toContain("anchor={section.anchor}");
    // A partly editable page says "View only" on the sections it can't change.
    expect(general).toContain("action={canEditPage && !canEditSettings(section.permTab) ? <SettingsReadOnlyNotice /> : undefined}");
    for (const [anchor, perm] of [
      ["driver-requirements", "requirements"],
      ["booking-rules", "duration"],
      ["key-handover", "lockbox"],
      ["tax-and-fees", "fees"],
      ["security-deposit", "preauth"],
    ]) {
      const body = general.slice(general.indexOf(`case '${anchor}':`), general.indexOf("case '", general.indexOf(`case '${anchor}':`) + 6));
      expect(body, anchor).toContain(`canEdit={canEditSettings('${perm}')}`);
    }
    // Regional and Booking site follow General's own permission.
    expect(general).toContain("const canEditGeneral = canEditSettings('general');");
    expect(general).not.toContain("canEdit={canEditPage}");
    expect(general).not.toContain("!canEditPage}");
  });

  it("General opens when any of its sections may be viewed; editing it needs any section's editor grant", () => {
    expect(page).toContain("const v2Route = v2Chrome ? resolveV2SettingsRoute(v2TabParam, V2_SETTINGS_PAGES) : null;");
    expect(v2).toContain("v2Page && v2Route?.permTab && canViewAny(v2Route.permTab, canViewSettings) ? V2_SETTINGS_PAGES[v2Page] : null;");
    expect(v2).toContain("? v2GeneralSections.some((section) => canEditSettings(section.permTab))");
    expect(v2).toContain("pages: v2NoticePages(V2_SETTINGS_PAGES),");
  });

  it("no page-level General skeleton: each section loads and fails on its own", () => {
    expect(v2).not.toContain("v2Page === 'general' ? (");
    expect(v2).not.toContain('label="Loading regional settings"');
  });

  it("a deep link scrolls to its section once the data above it is in, wired before the v1 early returns", () => {
    const hook = page.indexOf("useScrollToSection(v2ScrollTarget, v2Chrome && v2SectionsReady);");
    const firstEarlyReturn = page.indexOf("if (!v2Chrome && error && !settings) {");
    expect(hook).toBeGreaterThan(-1);
    expect(firstEarlyReturn).toBeGreaterThan(hook);
    expect(page).toContain("const v2ScrollTarget = v2Route?.anchor ? settingsSectionId(v2Route.anchor) : v2Page ? v2Hash : null;");
    expect(page).toContain("setV2Hash(hash.startsWith('settings-') ? hash : null);");
  });

  it("one save bar on General, Customer messages, Custom pricing, Locations and the three payment-plan forms", () => {
    expect(page).toContain(
      "const V2_PAGES_WITH_SAVE_BAR = new Set(['general', 'templates', 'pricing', 'locations', 'installments', 'payg', 'auto-extend']);",
    );
  });
});

describe("settings page (v2): Key handover and the lockbox message", () => {
  const page = read("app/(dashboard)/settings/page.tsx");
  const v2Start = page.indexOf("  if (v2Chrome) {\n    const pageMeta =");
  const v2 = page.slice(v2Start);
  const keyHandover = v2.slice(v2.indexOf("case 'key-handover':"), v2.indexOf("case 'tax-and-fees':"));
  const templates = v2.slice(v2.indexOf("        case 'templates': {"), v2.indexOf("        case 'insurance':"));

  it("Key handover gets no Twilio props, and its Templates button targets the lockbox message", () => {
    expect(keyHandover).not.toContain("smsReady");
    expect(keyHandover).not.toContain("integrationsHref");
    expect(keyHandover).toContain("templatesHref={V2_LOCKBOX_MESSAGES_HREF}");
    expect(page).toContain("const V2_LOCKBOX_MESSAGES_HREF = `/settings?tab=templates#${settingsSectionId('lockbox-messages')}`;");
  });

  it("Customer messages carries the lockbox message, email only, under Key handover's permission", () => {
    expect(templates).toContain("{v2ShowLockboxMessages && (");
    expect(templates).toContain("<div id={settingsSectionId('lockbox-messages')} className=\"scroll-mt-24\">");
    expect(templates).toContain("channels={['email']}");
    expect(templates).toContain('keyHandoverHref="/settings?tab=lockbox"');
    expect(templates).toContain("registerSave={registerV2SectionSave}");
    expect(v2).toContain("const v2ShowLockboxMessages = canViewSettings('lockbox');");
    // Its save bar shows for someone who may edit only the lockbox message.
    expect(v2).toContain("? canEditSettings('templates') || (v2ShowLockboxMessages && canEditSettings('lockbox'))");
  });

  it("the Key handover section no longer mounts the messages editor", () => {
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
