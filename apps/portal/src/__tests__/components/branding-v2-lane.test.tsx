/**
 * Settings › Branding (v2), the Sep 2026 review pass:
 *
 *  - a live preview under Portal name: the real sidebar row (OrgMark and the
 *    OrgSwitcher row classes, at the sidebar's real width) and a browser tab,
 *    with a note when the name is cut off in the sidebar
 *  - the sign-in page preview for the full logo, tinted as login-v2 tints it
 *  - a new or removed logo shows in the sidebar and the browser tab at once
 *    (the same try-on the brand colour uses), and goes back on Reset
 *  - no standalone "Restore default colour" button, and no "Indigo" in the copy
 *
 * HARNESS: Testing Library. Branding, tenant, permissions, theme preview and
 * router are mocked; the swatch row is a plain hex box and the logo cards are
 * a stub with buttons (both are covered for real in their own suites). jsdom
 * has no layout, so the name's width is given by hand (see `measureNames`).
 */

import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  v2: true,
  branding: {} as Record<string, any>,
  tenant: { id: "t1", company_name: "Northwind Rentals" } as Record<string, any>,
  preview: (() => undefined) as (patch: unknown) => void,
  restore: (() => undefined) as () => void,
  commit: (() => undefined) as () => void,
  updateBranding: (() => Promise.resolve()) as (values: unknown) => Promise<unknown>,
  theme: "light",
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: s.theme }) }));
vi.mock("@/lib/v2-context", () => ({
  useV2: () => s.v2,
  usePortalExperience: () => ({ onV2: false, lean: false }),
  usePortalOnV2: () => false,
}));
// No slug unless a test gives one, as before the tenant row resolves: the
// sidebar's org row is then plain identity. The parity test below gives it one,
// because the row a tenant actually sees is the booking-site link.
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: s.tenant, tenantSlug: s.tenant.slug ?? null }),
}));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({
    canEditSettings: () => true,
    canViewSettings: () => true,
    isLoading: false,
    isManager: false,
    canView: () => true,
  }),
}));
vi.mock("@/hooks/use-tenant-branding", () => ({
  useTenantBranding: () => ({
    branding: s.branding,
    brandName: s.branding.app_name || "Northwind Rentals",
    updateBranding: s.updateBranding,
    isUpdating: false,
    hasBrandingData: true,
    error: null,
    refetch: vi.fn(),
    isFetchingBranding: false,
  }),
}));
vi.mock("@/hooks/use-theme-preview", () => ({
  useThemePreview: () => ({ preview: s.preview, restore: s.restore, commit: s.commit }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/settings/favicon-upload", () => ({ FaviconUpload: () => <div data-testid="favicon" /> }));
vi.mock("@/components/settings/appearance/logo-studio", () => ({ LogoStudio: () => <div data-testid="logo-studio" /> }));
vi.mock("@/components/settings/appearance/brand-color-field", () => ({ BrandColorField: () => null }));
vi.mock("@/components/settings/appearance/brand-swatches", () => ({
  BrandSwatches: ({ value, onChange }: any) => (
    <input data-testid="hex" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/components/settings/appearance/logos-v2", () => ({
  // Stands in for the two cards: what the page hands them, and a way to change each logo.
  LogosV2: ({ faviconUrl, logoUrl, tabTitle, brandColor, markColor, portalName, onFaviconChange, onLogoChange }: any) => (
    <div
      data-testid="logos-v2"
      data-favicon={faviconUrl ?? ""}
      data-logo={logoUrl ?? ""}
      data-tab-title={tabTitle}
      data-brand-color={brandColor ?? ""}
      data-mark-color={markColor ?? ""}
      data-portal-name={portalName}
    >
      <button type="button" onClick={() => onFaviconChange("https://cdn.test/new-icon.png")}>
        Use new icon
      </button>
      <button type="button" onClick={() => onFaviconChange(null)}>
        Remove icon
      </button>
      <button type="button" onClick={() => onLogoChange("https://cdn.test/new-logo.png")}>
        Use new logo
      </button>
    </div>
  ),
}));

import { AppearanceSettings } from "@/components/settings/appearance/appearance-settings";
import {
  PORTAL_NAME_CUT_OFF_NOTE,
  PortalNamePreview,
  SIDEBAR_ROW,
  SignInPreview,
  useBrandIcon,
} from "@/components/settings/appearance/branding-previews";
import { BRAND_MARK_FONT_STACK, clearBrandMarkCache } from "@/lib/appearance/logo";
import { expectedMarkUrl, installCanvas, type CanvasStub } from "../helpers/canvas-stub";
import { OrgSwitcher } from "@/components/shared/layout/org-switcher";
import { bookingOriginFor } from "@/lib/booking-origin";
import { brandSurface } from "@/components/auth-v2/brand-surface";

/**
 * jsdom lays nothing out, so give the sidebar name a width: 8px a character in
 * a 106px box. 106 is the real room, from the classes of the expanded org row
 * once the tenant slug has resolved and the row is the booking-site entry
 * (org-switcher.tsx; `SIDEBAR_ROW` copies them):
 *
 *   256  the sidebar, 16rem (ui-v2/sidebar.tsx `SIDEBAR_WIDTH`; no border)
 *   244  less the header's `p-1.5`, 6px a side (app-sidebar-v2.tsx)
 *   216  less the Branding pencil, `h-7 w-7` (28px), which sits straight after
 *        the name. It is `opacity-0` until hover but keeps its room.
 *   188  less the sidebar customiser, `h-7 w-7` (28px)
 *   160  less the booking-site arrow on the row's right edge, `h-7 w-7` (28px)
 *   148  less the site link's own `p-1.5`, 6px a side
 *   106  less the mark, `h-8 w-8` (32px), and the `gap-2.5` after it (10px)
 *
 * The `flex-1` spacer between the pencil and the last two controls is worth
 * nothing here: its basis is 0, and every spare pixel it holds goes back to the
 * name before the name is cut off.
 *
 * So 13 characters fit (104px) and 14 do not (112px).
 *
 * The figure has moved each time the controls beside the name changed:
 *   - 130 until Sep 20 2026: a Settings gear (28px) and a "Switch
 *     organization" chevron (28px, and the 4px end margin) after the name box.
 *   - 158 until the morning of Sep 21 2026: the chevron gone, and the row one
 *     link to Settings with the gear inside it after the name box (28px, the
 *     end margin passed to it).
 *   - 190, briefly, on Sep 21 2026: the gear moved down to the profile row and
 *     the org row was identity only, the mark and the name with nothing after.
 *   - 134 until Sep 23 2026: the row became the booking-site entry, with the
 *     arrow after the name (24px with its gap) and the pencil's room after the
 *     link (28px plus the 4px `mr-1` that held it short of the row's edge).
 *   - 138 that same day: the team lead asked for the pencil to sit ON the row's
 *     right edge, like every other trailing control in this sidebar, so its
 *     `mr-1` went and those 4px came back to the name.
 *   - 106 since, from the re-order later that day: the pencil moved up against
 *     the name, the sidebar customiser came up from the profile row in the
 *     footer, and the arrow left the name link to become a control of its own
 *     at the row's end. Three 28px controls where there were one and a bare
 *     14px icon with a 10px gap: 84px of trailing controls instead of 52.
 * At 190, "Northwind Car Hire" (18 characters, 144px) fit; at 106 even
 * "Northwind Rentals" (17, 136px) is cut off, and it fit until the re-order.
 */
const descriptors = {
  scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth"),
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
};
function measureNames() {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-preview-name") ? (this.textContent?.length ?? 0) * 8 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-preview-name") ? 106 : 0;
    },
  });
}

const nameInput = () => document.querySelector<HTMLInputElement>("#app_name")!;
const hexInput = () => screen.getByTestId("hex") as HTMLInputElement;
const logos = () => screen.getByTestId("logos-v2");
const namePreview = () => document.querySelector<HTMLElement>("[data-portal-name-preview]")!;
const lastPreview = () => vi.mocked(s.preview).mock.calls.at(-1)![0] as Record<string, unknown>;

beforeEach(() => {
  s.v2 = true;
  s.theme = "light";
  s.preview = vi.fn();
  s.restore = vi.fn();
  s.commit = vi.fn();
  s.updateBranding = vi.fn().mockResolvedValue(undefined);
  s.tenant = { id: "t1", company_name: "Northwind Rentals" };
  s.branding = {
    primary_color: "#1D4ED8",
    light_primary_color: "#1D4ED8",
    light_accent_color: "#3B6BE0",
    app_name: "Northwind",
    meta_title: null,
    logo_url: "https://cdn.test/logo.png",
    dark_logo_url: null,
    favicon_url: null,
  };
  measureNames();
});

afterEach(() => {
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as any)[name];
  }
});

describe("Portal name: a live preview of where the name shows", () => {
  it("shows the name in the sidebar row and the browser tab, and follows the typing", () => {
    render(<AppearanceSettings />);
    const preview = namePreview();
    expect(within(preview).getByText("Northwind")).toHaveAttribute("data-preview-name");
    expect(within(preview).getByText("Northwind - Portal")).toBeInTheDocument();
    // No square icon, and the full logo is NOT a stand-in for one: both places
    // show the name's initials instead. jsdom cannot draw the mark, so the
    // sidebar shows its own chip and the tab the platform icon it really would.
    expect(preview.innerHTML).not.toContain("cdn.test/logo.png");
    expect(within(preview).getByText("NO")).toBeInTheDocument();
    expect(within(preview).getByAltText("Default icon in a browser tab")).toHaveAttribute("src", "/icons/favicon-light.png");

    fireEvent.change(nameInput(), { target: { value: "Southwind" } });
    expect(within(namePreview()).getByText("Southwind")).toBeInTheDocument();
    expect(within(namePreview()).getByText("Southwind - Portal")).toBeInTheDocument();
    // An empty field falls back to the company name, as the sidebar does.
    fireEvent.change(nameInput(), { target: { value: "  " } });
    expect(within(namePreview()).getByText("Northwind Rentals")).toBeInTheDocument();
  });

  /**
   * Team lead, Sep 2026, with a screenshot of the section: the field sat on the
   * left and the two pictures hung UNDER it, leaving the whole right half of the
   * section empty. Field and pictures are now one row — the settings kit's own
   * grid (420px label column, 40px gutter, `md`), so the section lines up with
   * every other row on the page instead of looking bolted on.
   */
  it("lays the field and its pictures side by side in one row, on the settings grid", () => {
    render(<AppearanceSettings />);
    const row = namePreview();
    for (const cls of ["md:grid", "md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]", "md:gap-x-10", "md:items-start"]) {
      expect(row.className, cls).toContain(cls);
    }
    // Stacks below the breakpoint, exactly as it did.
    expect(row.className).toContain("flex flex-col gap-3");

    const field = row.querySelector<HTMLElement>("[data-portal-name-field]")!;
    const pictures = row.querySelector<HTMLElement>("[data-portal-name-pictures]")!;
    // Siblings in the row, not one nested under the other.
    expect(field.parentElement).toBe(row);
    expect(pictures.parentElement).toBe(row);
    expect(field.contains(pictures)).toBe(false);
    // The field is the left column; both pictures are the right one.
    expect(field.contains(nameInput())).toBe(true);
    expect(pictures.contains(nameInput())).toBe(false);
    expect(within(pictures).getByRole("figure", { name: "Your name at the top of the sidebar" })).toBeInTheDocument();
    expect(within(pictures).getByRole("figure", { name: "Your name in a browser tab" })).toBeInTheDocument();

    // Both pictures still take ONE resolve, so they cannot show different things.
    expect(within(pictures).getAllByText("NO")).toHaveLength(1);
    expect(within(pictures).getByAltText("Default icon in a browser tab")).toBeInTheDocument();

    // The cut-off note belongs to the field and travels with it. 14 characters
    // (112px): the shortest name the 106px box cuts off (see `measureNames`).
    fireEvent.change(nameInput(), { target: { value: "Northwind Cars" } });
    expect(field.contains(screen.getByText(PORTAL_NAME_CUT_OFF_NOTE))).toBe(true);
  });

  it("says when the name is too long for the sidebar, and stops saying it once it fits", () => {
    render(<AppearanceSettings />);
    // "Northwind", 9 characters: 72px in the 106px box (see `measureNames`). Fits.
    expect(screen.queryByText(PORTAL_NAME_CUT_OFF_NOTE)).toBeNull();
    // 13 characters: 104px. Fits — the longest that does, now that three 28px
    // controls follow the name (Sep 23 2026). "Northwind Rentals", 17, no
    // longer does.
    fireEvent.change(nameInput(), { target: { value: "Northwind Car" } });
    expect(screen.queryByText(PORTAL_NAME_CUT_OFF_NOTE)).toBeNull();
    fireEvent.change(nameInput(), { target: { value: "Northwind Rentals" } });
    expect(screen.getByText(PORTAL_NAME_CUT_OFF_NOTE)).toBeInTheDocument();
    // 14 characters: 112px. Cut off — the shortest that is. It fit the
    // identity-only row's 190px, and the 138px this row had before the
    // customiser and the arrow took their own 28px boxes beside the name.
    fireEvent.change(nameInput(), { target: { value: "Northwind Cars" } });
    const note = screen.getByText(PORTAL_NAME_CUT_OFF_NOTE);
    expect(note).toHaveAttribute("role", "status");
    expect(note.className).toContain("text-muted-foreground");
    // "Northwind" again, 9 characters: 72px. Fits, and the note goes.
    fireEvent.change(nameInput(), { target: { value: "Northwind" } });
    expect(screen.queryByText(PORTAL_NAME_CUT_OFF_NOTE)).toBeNull();
  });

  it("shows the site title in the tab when Website settings set one, because that is what the tab says", () => {
    s.branding = { ...s.branding, meta_title: "Northwind | Car hire in Leeds" };
    render(<AppearanceSettings />);
    expect(within(namePreview()).getByText("Northwind | Car hire in Leeds")).toBeInTheDocument();
    expect(logos()).toHaveAttribute("data-tab-title", "Northwind | Car hire in Leeds");
  });

  it("the preview row is the real sidebar row: same slots, same room around the name", () => {
    // Sep 21 2026: the org row is the tenant's booking-site entry. Sep 23: it
    // was re-ordered, and once the tenant slug resolves the expanded row holds
    // exactly five slots, side by side and never nested:
    //   1. the link to the booking site: the mark and the name, hugging them;
    //   2. the Branding pencil, a link of its own, straight after the name. It
    //      is `opacity-0` until hover, but it keeps its room at rest, so it
    //      takes its width from the name even while unseen;
    //   3. the `flex-1` gap, which gives its width back to the name first;
    //   4. the sidebar customiser, a button, always shown;
    //   5. the "opens in a new tab" arrow on the row's right edge, always
    //      shown — a link of its own now, not an icon inside slot 1.
    // With no slug the row is plain identity, which is not the row a tenant
    // sees once the page has loaded (org-switcher.tsx), so give it one.
    s.tenant = { ...s.tenant, slug: "northwind" };
    // Every class of a `SIDEBAR_ROW` entry is on the real element, whatever
    // else it carries (cursor, hover states). An <svg>'s `className` is not a
    // string, so the attribute is read instead.
    const classesOf = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    const expectSlot = (el: Element, slot: string) => {
      for (const cls of slot.split(" ")) expect(classesOf(el), cls).toContain(cls);
    };

    const { container: sidebar } = render(<OrgSwitcher />);
    const orgRow = sidebar.querySelector<HTMLElement>('[data-slot="org-row"]')!;
    expect(orgRow).not.toBeNull();
    expect(orgRow.closest("a, button")).toBeNull();
    expectSlot(orgRow, SIDEBAR_ROW.row);
    expect(orgRow.children).toHaveLength(5);
    const [site, pencil, gap, customiser, arrowLink] = Array.from(orgRow.children) as HTMLElement[];

    // 1. The site link: the mark and the name, and nothing else.
    expect(site.tagName).toBe("A");
    expect(site).toHaveAttribute("href", bookingOriginFor("northwind"));
    expectSlot(site, SIDEBAR_ROW.trigger);
    expect(site.children).toHaveLength(2);
    const [mark, name] = Array.from(site.children);
    expect(mark.textContent).toBe("NO"); // OrgMark's initials chip: there is no square icon
    expect(name.tagName).toBe("SPAN");
    expect(name.className).toBe(SIDEBAR_ROW.name);
    expect(name.textContent).toBe("Northwind");
    // Neither stretches, which is what lets the pencil sit against the name.
    for (const el of [site, name]) expect(classesOf(el)).not.toContain("flex-1");

    // 2. The pencil: beside the site link, not inside it, going to Branding.
    expectSlot(pencil, SIDEBAR_ROW.control);
    expect(pencil).toHaveAttribute("href", "/settings/appearance");
    expect(site.contains(pencil)).toBe(false);
    expect(site.querySelector("a, button")).toBeNull();
    // Hidden from the eye only: `opacity-0`, never `hidden` or `absolute`,
    // either of which would hand its 28px back to the name at rest.
    expect(classesOf(pencil)).toContain("opacity-0");
    for (const cls of ["hidden", "absolute", "fixed"]) expect(classesOf(pencil), cls).not.toContain(cls);

    // 3. The gap, and 4/5 the two controls at the end, both always shown.
    expectSlot(gap, SIDEBAR_ROW.spacer);
    expect(gap).toBeEmptyDOMElement();
    expect(customiser.tagName).toBe("BUTTON");
    expect(customiser).toHaveAttribute("aria-label", "Customise sidebar");
    expectSlot(customiser, SIDEBAR_ROW.control);
    expect(arrowLink.tagName).toBe("A");
    expect(arrowLink).toHaveAttribute("href", bookingOriginFor("northwind"));
    expectSlot(arrowLink, SIDEBAR_ROW.control);
    for (const el of [customiser, arrowLink]) expect(classesOf(el)).not.toContain("opacity-0");
    const arrow = arrowLink.firstElementChild!;
    expect(arrow.tagName).toBe("svg");
    expectSlot(arrow, SIDEBAR_ROW.icon);

    // Those are the row's only controls: two links to the site, the pencil and
    // the customiser.
    const links = within(sidebar).getAllByRole("link");
    expect(links).toEqual([site, pencil, arrowLink]);
    expect(within(sidebar).getAllByRole("button")).toEqual([customiser]);

    // The picture has exactly the real row's slots, and no more: a slot it
    // draws that the sidebar does not (the old chevron, then the gear) takes
    // width from the name, and one it leaves out (the arrow, the pencil's room)
    // gives the name width the sidebar does not. Either way the note under the
    // field fires for the wrong names.
    const { container: picture } = render(
      <PortalNamePreview name="Northwind" iconUrl={null} brandColor="#1D4ED8" tabTitle="Northwind - Portal" />,
    );
    const row = picture.querySelector<HTMLElement>("[data-preview-sidebar-row]")!;
    expect(row.className).toBe(SIDEBAR_ROW.row);
    expect(Array.from(row.children).map((child) => child.className)).toEqual([
      SIDEBAR_ROW.trigger,
      SIDEBAR_ROW.control,
      SIDEBAR_ROW.spacer,
      SIDEBAR_ROW.control,
      SIDEBAR_ROW.control,
    ]);
    const [pictureSite, picturePencil, pictureGap, pictureCustomiser, pictureArrowBox] = Array.from(
      row.children,
    ) as HTMLElement[];
    // Inside the site link's slot: the same two as the real one, in the same order.
    expect(Array.from(pictureSite.children).map((child) => child.tagName)).toEqual(
      Array.from(site.children).map((child) => child.tagName),
    );
    const [pictureMark, pictureName] = Array.from(pictureSite.children);
    expect(pictureMark.className).toBe(mark.className); // the same OrgMark
    expect(pictureName).toHaveAttribute("data-preview-name");
    expect(pictureName.className).toBe(SIDEBAR_ROW.name);
    // The pencil's room and the gap, kept and left empty: the space, not the
    // control. The two that are always on screen are drawn, icon and all.
    expect(picturePencil).toBeEmptyDOMElement();
    expect(pictureGap).toBeEmptyDOMElement();
    for (const [box, real] of [
      [pictureCustomiser, customiser],
      [pictureArrowBox, arrowLink],
    ] as const) {
      const icon = box.firstElementChild!;
      expect(icon.tagName).toBe("svg");
      expectSlot(icon, SIDEBAR_ROW.icon);
      // The same glyph at the same size as the real control, which is what the
      // picture is for (lucide stamps its own `lucide-<name>` class on each).
      expect(classesOf(icon)).toEqual(classesOf(real.firstElementChild!));
    }
    // A picture, not a control: no link and no button anywhere in it.
    expect(picture.querySelector("a, button")).toBeNull();
  });

  it("the preview on its own: one square icon, in the tab and in the sidebar badge", () => {
    render(
      <PortalNamePreview
        name="Northwind"
        iconUrl="https://cdn.test/icon.png"
        brandColor="#1D4ED8"
        tabTitle="Northwind - Portal"
      />,
    );
    expect(screen.getByAltText("Your square icon in a browser tab")).toHaveAttribute("src", "https://cdn.test/icon.png");
    const badge = screen.getByAltText("Your square icon in the sidebar");
    expect(badge).toHaveAttribute("src", "https://cdn.test/icon.png");
    expect(badge.className).toContain("h-8 w-8");
  });

  it("gives the name the sidebar's own room: the border sits outside the 256px, not inside it", () => {
    // The real row: the 256px sidebar less its header's 6px a side = 244px. The
    // preview box has a 1px border a side and 6px padding a side, and Tailwind
    // sizes it border-box, so it must be 244 + 12 + 2 = 258px wide. At w-64
    // (256px) the row was 242px and a name 2px from the edge read as cut off
    // here while it fit in the real sidebar.
    render(<PortalNamePreview name="Northwind" iconUrl={null} brandColor="#1D4ED8" tabTitle="Northwind - Portal" />);
    const frame = screen.getByRole("figure", { name: "Your name at the top of the sidebar" }).className.split(/\s+/);
    expect(frame).toEqual(expect.arrayContaining(["w-[258px]", "border", "p-1.5"]));
    expect(frame).not.toContain("w-64");
    // The square icon card draws the sidebar with no border of its own round the row: 256px there.
    expect(SIDEBAR_ROW.frame.split(" ")).toEqual(expect.arrayContaining(["w-64", "p-1.5"]));
    expect(SIDEBAR_ROW.frame.split(" ")).not.toContain("border");
  });
});

describe("Full logo: the sign-in page preview", () => {
  it("tints the page as login-v2 does and puts the logo top left, at half size", () => {
    render(<SignInPreview logoUrl="https://cdn.test/logo.png" appName="Northwind" brandColor="#0F766E" />);
    const wash = document.querySelector<HTMLElement>("[data-preview-wash]")!;
    // brandSurface('#0F766E', light): hue 175, saturation min(80, 77) = 77 then
    // capped at 58 for the tint, lightness 88 -> hsl(175 58% 88%).
    expect(brandSurface("#0F766E", false).color).toBe("hsl(175 58% 88%)");
    // jsdom hands the colour back as rgb(): hsl(175 58% 88%) = rgb(207, 242, 239).
    expect(wash.style.backgroundColor).toBe("rgb(207, 242, 239)");
    const logo = screen.getByAltText("Full logo on the sign-in page");
    expect(logo).toHaveAttribute("src", "https://cdn.test/logo.png");
    // login-v2: h-14 (56px) and max-w-[220px]; halved.
    expect(logo.className).toContain("h-7");
    expect(logo.className).toContain("max-w-[110px]");
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  it("shows the name where the logo would be when there is none, as login-v2 does", () => {
    render(<SignInPreview logoUrl={null} appName="Northwind" brandColor="#0F766E" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getAllByText(/Northwind/)[0]).toHaveTextContent("Northwind");
  });

  it("the page hands the logos the brand colour the sign-in page tints with, and the name", () => {
    render(<AppearanceSettings />);
    // login-v2 in light mode: light_accent_color first.
    expect(logos()).toHaveAttribute("data-brand-color", "#3B6BE0");
    // The initials mark is a badge, not a wash: it takes the primary, which is
    // what OrgMark's chip paints with, NOT the sign-in accent.
    expect(logos()).toHaveAttribute("data-mark-color", "#1D4ED8");
    expect(logos()).toHaveAttribute("data-portal-name", "Northwind");
  });
});

describe("A new logo shows in the sidebar and the browser tab at once", () => {
  it("tries a new square icon on the running portal before it is saved", () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Use new icon" }));
    expect(lastPreview()).toMatchObject({ favicon_url: "https://cdn.test/new-icon.png", logo_url: "https://cdn.test/logo.png" });
    // Nothing about the colour: none was tried on.
    expect(lastPreview()).not.toHaveProperty("primary_color");
    expect(logos()).toHaveAttribute("data-favicon", "https://cdn.test/new-icon.png");
    // The name preview follows too.
    expect(within(namePreview()).getByAltText("Your square icon in a browser tab")).toHaveAttribute("src", "https://cdn.test/new-icon.png");
  });

  it("keeps a colour already tried on, and never a half-typed one", () => {
    render(<AppearanceSettings />);
    fireEvent.change(hexInput(), { target: { value: "#0F766E" } });
    fireEvent.change(hexInput(), { target: { value: "#0F7" } }); // half typed: not previewed
    fireEvent.click(screen.getByRole("button", { name: "Use new logo" }));
    expect(lastPreview()).toMatchObject({
      primary_color: "#0F766E",
      light_primary_color: "#0F766E",
      logo_url: "https://cdn.test/new-logo.png",
    });
  });

  it("a dark-mode logo that only followed the old logo follows the new one, as the save will", () => {
    s.branding = { ...s.branding, dark_logo_url: "https://cdn.test/logo.png" };
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Use new logo" }));
    expect(lastPreview()).toMatchObject({ dark_logo_url: null });
  });

  it("a deliberately different dark-mode logo is left alone", () => {
    s.branding = { ...s.branding, dark_logo_url: "https://cdn.test/logo-dark.png" };
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Use new logo" }));
    expect(lastPreview()).not.toHaveProperty("dark_logo_url");
  });

  it("Reset takes the tried-on logo back off the portal; Save keeps it", async () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Use new icon" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(s.restore).toHaveBeenCalledTimes(1);
    expect(logos()).toHaveAttribute("data-favicon", "");

    fireEvent.click(screen.getByRole("button", { name: "Use new icon" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(vi.mocked(s.updateBranding).mock.calls[0][0]).toMatchObject({ favicon_url: "https://cdn.test/new-icon.png" });
    expect(s.commit).toHaveBeenCalledTimes(1);
    expect(s.restore).toHaveBeenCalledTimes(1);
  });

  it("removing the square icon is tried on too", () => {
    s.branding = { ...s.branding, favicon_url: "https://cdn.test/icon.png" };
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Remove icon" }));
    expect(lastPreview()).toMatchObject({ favicon_url: null });
  });
});

describe("Brand colour copy and layout", () => {
  it("no standalone Restore default colour button, and nothing on the page calls the default Indigo", () => {
    render(<AppearanceSettings />);
    expect(screen.queryByRole("button", { name: "Restore default colour" })).toBeNull();
    fireEvent.change(hexInput(), { target: { value: "#808080" } }); // grey: the unusable-colour note
    const note = screen.getByText(/too close to black, white or grey/);
    expect(note).toHaveTextContent("so the portal keeps the default colour.");
    expect(document.body.textContent).not.toMatch(/indigo/i);
  });

  it("the three sections sit 32px apart (space-y-8), not 40", () => {
    render(<AppearanceSettings />);
    const sections = document.querySelector('[data-settings-section="portal-name"]')!.parentElement!;
    expect(sections.className).toBe("space-y-8");
  });

  it("v1 (flag off) shows none of it: no name preview, and its own Reset colours dialog", () => {
    s.v2 = false;
    const { rerender } = render(<AppearanceSettings />);
    s.branding = { ...s.branding };
    rerender(<AppearanceSettings />);
    expect(document.querySelector("[data-portal-name-preview]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Appearance");
    expect(document.body.textContent).toContain("Appears in the browser tab and beside your logo.");
  });
});

/**
 * The mark is drawn in the page's OWN `--primary`, which is what `OrgMark`'s
 * chip paints with — so the picture and the real badge are the same colour.
 *
 * But the try-on does not write that variable here: it writes the candidate
 * palette into the branding query cache, and `useDynamicTheme` — an ancestor —
 * turns it into `--brand-*` on `<body>` in an effect that runs AFTER this
 * subtree has rendered. Memoising on the props alone therefore left the drawn
 * mark one colour behind every pick.
 */
describe("the drawn mark follows the portal as it repaints", () => {
  let canvas: CanvasStub | null = null;
  let primary = "175 77% 26%";

  const markIn = (background: string) =>
    expectedMarkUrl({ initials: "NO", background, foreground: "#FAFAFA", fontFamily: BRAND_MARK_FONT_STACK });

  beforeEach(() => {
    clearBrandMarkCache();
    canvas = installCanvas();
    primary = "175 77% 26%";
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          getPropertyValue: (name: string) =>
            name === "--primary" ? primary : name === "--primary-foreground" ? "0 0% 98%" : "",
          fontFamily: "",
        }) as unknown as CSSStyleDeclaration,
    );
  });

  afterEach(() => {
    canvas?.restore();
    canvas = null;
    vi.restoreAllMocks();
    document.body.removeAttribute("style");
  });

  it("redraws once the repaint has landed, with no prop of its own having changed", async () => {
    // hsl(175 77% 26%) -> #0F756D, hsl(246 61% 42%) -> #372AAC, hsl(0 0% 98%) -> #FAFAFA.
    const { result } = renderHook(() => useBrandIcon(null, "Northwind", "#FDE68A"));
    expect(result.current.kind).toBe("initials");
    expect(result.current.src).toBe(markIn("#0F756D"));

    // What the ancestor's effect does, a tick later: the same props, a new page.
    await act(async () => {
      primary = "246 61% 42%";
      document.body.style.setProperty("--brand-h", "246");
    });
    await waitFor(() => expect(result.current.src).toBe(markIn("#372AAC")));
  });
});
