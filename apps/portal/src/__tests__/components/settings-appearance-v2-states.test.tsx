/**
 * Settings › Appearance (`components/settings/appearance/appearance-settings.tsx`):
 * the v2 (northwind) "Branding" page on top of a screen every tenant renders,
 * and proof that the v1 render is unchanged when the flag is off.
 *
 * HARNESS: `react-dom/client` + `act`. Branding, tenant, permissions, theme
 * preview, router and the logo/favicon uploaders are mocked, so nothing here
 * touches Supabase or storage. The swatches are a plain hex box here; the real
 * swatch row, sections and logos are covered in settings-appearance-v2-page.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const s = vi.hoisted(() => ({
  v2: true,
  permissionsLoading: false,
  canEdit: true,
  tenantId: "t1",
  hasBrandingData: true,
  brandingError: null as unknown,
  branding: {} as Record<string, any>,
  updateBranding: (() => Promise.resolve()) as (values: unknown) => Promise<unknown>,
  isUpdating: false,
  push: (() => undefined) as (url: string) => void,
  preview: (() => undefined) as (palette: unknown) => void,
  restore: (() => undefined) as () => void,
  commit: (() => undefined) as () => void,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: s.push, replace: vi.fn(), back: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/v2-context", () => ({ useV2: () => s.v2 }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: s.tenantId, company_name: "Northwind Rentals" } }) }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({
    canEditSettings: () => s.canEdit,
    canViewSettings: () => true,
    isLoading: s.permissionsLoading,
  }),
}));
vi.mock("@/hooks/use-tenant-branding", () => ({
  useTenantBranding: () => ({
    branding: s.branding,
    updateBranding: s.updateBranding,
    isUpdating: s.isUpdating,
    hasBrandingData: s.hasBrandingData,
    error: s.brandingError,
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
vi.mock("@/components/settings/appearance/logos-v2", () => ({
  // Stands in for the two logo cards: shows what the form holds and edits it.
  LogosV2: ({ faviconUrl, logoUrl, onLogoChange }: any) => (
    <div data-testid="logos-v2" data-favicon={faviconUrl ?? ""} data-logo={logoUrl ?? ""}>
      <button type="button" onClick={() => onLogoChange("https://cdn.test/new-logo.png")}>
        Use new logo
      </button>
    </div>
  ),
}));
vi.mock("@/components/settings/appearance/brand-color-field", () => ({ BrandColorField: () => null }));
vi.mock("@/components/settings/appearance/brand-swatches", () => ({
  // The real custom-hex box forwards every keystroke, like this one.
  BrandSwatches: ({ value, onChange, disabled }: any) => (
    <input data-testid="hex" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { AppearanceSettings } from "@/components/settings/appearance/appearance-settings";
import { V2_BRAND_PRESETS } from "@/lib/appearance/presets";
import { toast } from "@/hooks/use-toast";

let container: HTMLDivElement;
let root: Root;
const bodyText = () => document.body.textContent ?? "";

function mount() {
  act(() => root.render(<AppearanceSettings />));
}

function type(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const hex = () => container.querySelector<HTMLInputElement>('[data-testid="hex"]')!;
const nameInput = () => container.querySelector<HTMLInputElement>("#app_name")!;
const buttonsNamed = (name: string, scope: ParentNode = container) =>
  Array.from(scope.querySelectorAll("button")).filter((b) => b.textContent?.trim() === name);
const saveButtons = () => buttonsNamed("Save changes");
const resetButton = () => buttonsNamed("Reset")[0];

/** A sidebar-style link outside the page, clicked the way a person would. */
async function clickLinkTo(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = "Vehicles";
  document.body.appendChild(link);
  // jsdom cannot navigate; a link nobody stopped would only log that.
  const swallow = (event: Event) => event.preventDefault();
  link.addEventListener("click", swallow);
  await act(async () => {
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await Promise.resolve();
  });
  link.remove();
}

const originalPushState = window.history.pushState;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  s.v2 = true;
  s.permissionsLoading = false;
  s.canEdit = true;
  s.tenantId = "t1";
  s.hasBrandingData = true;
  s.brandingError = null;
  s.isUpdating = false;
  s.push = vi.fn();
  s.preview = vi.fn();
  s.restore = vi.fn();
  s.commit = vi.fn();
  s.updateBranding = vi.fn().mockResolvedValue(undefined);
  vi.mocked(toast).mockClear();
  s.branding = {
    primary_color: "#C6A256",
    light_primary_color: "#C6A256",
    app_name: "Northwind",
    logo_url: null,
    dark_logo_url: null,
    favicon_url: null,
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.pushState = originalPushState;
  window.history.replaceState(null, "", "/");
});

describe("Appearance, v2: opening the page (S17)", () => {
  it("opens straight onto the saved branding when it is already cached (no skeleton left on screen)", () => {
    // Branding is cached by the theme provider long before this page opens, so
    // nothing changes after mount that could re-run a hydration.
    mount();
    expect(container.textContent).not.toContain("Loading branding");
    expect(hex().value).toBe("#C6A256");
    expect(nameInput().value).toBe("Northwind");
    expect(saveButtons()).toHaveLength(1); // the page's one sticky bar
    expect(saveButtons()[0].disabled).toBe(true);
  });

  it("shows the form once the real row lands, even when the branding object is the same one", () => {
    // The placeholder and the fetched row can be the same reference (a preview
    // wrote it into the cache): only hasBrandingData changes.
    s.hasBrandingData = false;
    mount();
    expect(container.textContent).toContain("Loading branding");
    expect(hex()).toBeNull();

    s.hasBrandingData = true;
    mount();
    expect(container.textContent).not.toContain("Loading branding");
    expect(hex().value).toBe("#C6A256");
    expect(nameInput().value).toBe("Northwind");
  });

  it("waits for a manager's permissions before showing any control", () => {
    s.permissionsLoading = true;
    mount();
    expect(container.textContent).toContain("Loading branding");
    expect(hex()).toBeNull();
  });

  it("starts again from the new tenant's branding when the tenant changes", () => {
    mount();
    type(nameInput(), "Half typed");
    s.tenantId = "t2";
    s.branding = { ...s.branding, app_name: "Southwind", light_primary_color: "#0F766E", primary_color: "#0F766E" };
    mount();
    expect(nameInput().value).toBe("Southwind");
    expect(hex().value).toBe("#0F766E");
    expect(saveButtons()[0].disabled).toBe(true);
  });

  it("offers a retry, under the page title, when the branding read failed", () => {
    s.hasBrandingData = false;
    s.brandingError = new Error("Failed to fetch");
    mount();
    expect(container.querySelector("h1")?.textContent).toBe("Branding");
    expect(container.querySelector('[data-settings-state="error"]')?.textContent).toContain("Couldn't load your branding");
  });
});

describe("Appearance, v2: the page", () => {
  it("has the kit header (bold title, no breadcrumb or Back) and no separator lines", () => {
    mount();
    const h1 = container.querySelector("h1")!;
    expect(h1.textContent).toBe("Branding");
    expect(h1.className).toContain("font-bold");
    expect(buttonsNamed("Settings")).toHaveLength(0);
    expect(container.querySelector('[data-slot="separator"], [role="separator"]')).toBeNull();
    expect(container.querySelector('[class~="fixed"]')).toBeNull();
    expect(container.querySelector("[data-settings-save-bar]")).not.toBeNull();
  });

  it("points customers' site styling at Website → Site settings, not CMS", () => {
    mount();
    expect(container.querySelector('a[href="/cms/site-settings"]')?.textContent).toBe("Website → Site settings");
    expect(container.textContent).not.toContain("under CMS");
  });

  it("keeps a half-typed brand colour from being saved", async () => {
    mount();
    type(hex(), "#1D");
    expect(container.textContent).toContain("That isn't a full colour code yet.");
    expect(s.preview).not.toHaveBeenCalled();
    await act(async () => saveButtons()[0].click());
    expect(s.updateBranding).not.toHaveBeenCalled();
    expect(vi.mocked(toast).mock.calls[0][0]).toMatchObject({ title: "Finish the brand colour first" });
    type(hex(), "#1D4ED8");
    expect(container.textContent).not.toContain("That isn't a full colour code yet.");
    expect(s.preview).toHaveBeenCalledTimes(1);
  });

  describe("a colour the portal cannot be themed from", () => {
    // `isUsableV2Brand`: saturation 15+ and lightness 12–92, worked out here by
    // hand from the hex. Below those the v2 stylesheet keeps its default indigo,
    // so the colour saves and nothing on screen changes — hence the note.
    const NOTE = "This colour is too close to black, white or grey to colour the portal";

    it.each([
      // #020303 → max 3/255, min 2/255: l = 0.98% → 1%, under the floor of 12.
      ["#020303", "near-black, 180 20% 1%"],
      // #808080 → r = g = b, so delta is 0 and saturation is 0: no hue to carry.
      ["#808080", "grey, 0 0% 50%"],
    ])("says the portal keeps its default colour for %s (%s)", (hexValue) => {
      mount();
      type(hex(), hexValue);
      const note = container.querySelector('[role="status"]');
      expect(note?.textContent).toContain(NOTE);
      expect(note?.className).toContain("text-muted-foreground");
    });

    it.each([
      // #1E293B → delta 29/255: s = 33%, l = 17%. Both inside the bounds.
      ["#1E293B", "deep slate, 217 33% 17%"],
      // #0F766E → delta 103/255: s = 77%, l = 26%.
      ["#0F766E", "teal, 175 77% 26%"],
    ])("says nothing for %s (%s)", (hexValue) => {
      mount();
      type(hex(), hexValue);
      expect(container.textContent).not.toContain(NOTE);
    });

    it("waits for the full colour code, so a half-typed one shows only the code error", () => {
      mount();
      type(hex(), "#02");
      expect(container.textContent).toContain("That isn't a full colour code yet.");
      expect(container.textContent).not.toContain(NOTE);
    });

    it("none of the five presets can trigger it", () => {
      mount();
      for (const preset of V2_BRAND_PRESETS) {
        type(hex(), preset.hex);
        expect(container.textContent, preset.name).not.toContain(NOTE);
      }
    });
  });

  it("saves the colours, name and both logos, and leaves the dark and sign-in logos to the logo sync", async () => {
    mount();
    type(hex(), "#1D4ED8");
    act(() => buttonsNamed("Use new logo")[0].click());
    await act(async () => saveButtons()[0].click());
    const payload = vi.mocked(s.updateBranding).mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      light_primary_color: "#1D4ED8",
      primary_color: "#1D4ED8",
      app_name: "Northwind",
      logo_url: "https://cdn.test/new-logo.png",
      favicon_url: null,
    });
    expect("dark_logo_url" in payload).toBe(false);
    expect("auth_logo_url" in payload).toBe(false);
    expect(s.commit).toHaveBeenCalledTimes(1);
    expect(saveButtons()[0].disabled).toBe(true); // clean against the new baseline
  });

  it("shows a failed save inline once, keeps the edits, and clears the message on the next edit", async () => {
    s.updateBranding = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    mount();
    type(hex(), "#1D4ED8");
    await act(async () => saveButtons()[0].click());
    const errors = container.querySelectorAll('[data-settings-state="save-error"]');
    expect(errors).toHaveLength(1);
    expect(errors[0].textContent).toContain("Couldn't save. We couldn't reach the server. Your changes are still here.");
    expect(hex().value).toBe("#1D4ED8");
    expect(saveButtons()[0].disabled).toBe(false);

    type(hex(), "#1D4ED9");
    expect(container.querySelectorAll('[data-settings-state="save-error"]')).toHaveLength(0);
  });

  it("Reset discards unsaved edits and puts the saved theme back; it never restores defaults", () => {
    mount();
    type(hex(), "#1D4ED8");
    type(nameInput(), "Renamed");
    act(() => buttonsNamed("Use new logo")[0].click());
    act(() => resetButton().click());
    expect(hex().value).toBe("#C6A256"); // the saved colour, not Indigo
    expect(nameInput().value).toBe("Northwind");
    expect(container.querySelector('[data-testid="logos-v2"]')!.getAttribute("data-logo")).toBe("");
    expect(s.restore).toHaveBeenCalled();
    expect(saveButtons()[0].disabled).toBe(true);
  });

  it("asks Save or Don't save before a link leaves mid try-on, and Don't save drops the try-on", async () => {
    mount();
    type(hex(), "#1D4ED8");
    await clickLinkTo("/vehicles");
    const dialog = document.body.querySelector('[data-leave-dialog="v2"]')!;
    expect(dialog.textContent).toContain("Save your changes?");
    expect(buttonsNamed("Save", dialog)).toHaveLength(1);
    await act(async () => buttonsNamed("Don't save", dialog)[0].click());
    expect(s.restore).toHaveBeenCalled();
    expect(s.push).toHaveBeenCalledWith("/vehicles");
    expect(bodyText()).not.toContain("Unsaved Changes"); // never the v1 dialog
  });

  it("the leave dialog's Save saves the branding, then goes where the link pointed", async () => {
    mount();
    type(hex(), "#1D4ED8");
    type(nameInput(), "Northwind Cars");
    await clickLinkTo("/vehicles");
    const dialog = document.body.querySelector('[data-leave-dialog="v2"]')!;
    expect(s.push).not.toHaveBeenCalled();
    await act(async () => buttonsNamed("Save", dialog)[0].click());
    expect(s.updateBranding).toHaveBeenCalledTimes(1);
    expect(vi.mocked(s.updateBranding).mock.calls[0][0]).toMatchObject({
      primary_color: "#1D4ED8",
      light_primary_color: "#1D4ED8",
      app_name: "Northwind Cars",
    });
    expect(s.commit).toHaveBeenCalledTimes(1);
    expect(s.restore).not.toHaveBeenCalled(); // the saved colour stays on screen
    expect(s.push).toHaveBeenCalledWith("/vehicles");
    expect(document.body.querySelector('[data-leave-dialog="v2"]')).toBeNull();
  });

  it("stays put, with the reason in the dialog, when the leave dialog's Save fails", async () => {
    s.updateBranding = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    mount();
    type(hex(), "#1D4ED8");
    await clickLinkTo("/vehicles");
    const dialog = () => document.body.querySelector('[data-leave-dialog="v2"]');
    await act(async () => buttonsNamed("Save", dialog()!)[0].click());
    expect(s.updateBranding).toHaveBeenCalledTimes(1);
    expect(s.push).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector('[data-settings-state="save-error"]')?.textContent).toContain("Couldn't save.");
    expect(hex().value).toBe("#1D4ED8");
  });

  it("offers only Don't save while the colour is half typed", async () => {
    mount();
    type(hex(), "#1D");
    await clickLinkTo("/vehicles");
    const dialog = document.body.querySelector('[data-leave-dialog="v2"]')!;
    expect(buttonsNamed("Save", dialog)).toHaveLength(0);
    expect(buttonsNamed("Don't save", dialog)).toHaveLength(1);
  });

  it("view-only: no save bar, no leave prompt, and the colour cannot change", async () => {
    s.canEdit = false;
    mount();
    expect(hex().disabled).toBe(true);
    expect(container.querySelector('[data-settings-state="read-only"]')).not.toBeNull();
    expect(container.querySelector("[data-settings-save-bar]")).toBeNull();
    await clickLinkTo("/vehicles");
    expect(document.body.querySelector('[data-leave-dialog="v2"]')).toBeNull();
    expect(s.push).not.toHaveBeenCalled();
  });
});

describe("Appearance, v1 (flag off)", () => {
  it("renders the original copy, no inline save state and no leave dialog", async () => {
    s.v2 = false;
    s.updateBranding = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    mount();
    // v1 unchanged: its tenant-reset effect undoes the first hydration on mount,
    // so it hydrates when the branding query lands (a new object), as on a cold load.
    s.branding = { ...s.branding };
    mount();
    expect(container.textContent).toContain("Your customers' booking site is styled separately under CMS.");
    expect(container.querySelector('a[href="/cms/site-settings"]')).toBeNull();

    type(hex(), "#1D");
    // v1 never gated Save on a half-typed colour.
    expect(saveButtons().every((b) => !b.disabled)).toBe(true);

    type(hex(), "#1D4ED8");
    await act(async () => saveButtons()[0].click());
    expect(container.querySelector("[data-settings-state]")).toBeNull();

    await act(async () => {
      window.history.pushState(null, "", "/vehicles");
      await Promise.resolve();
    });
    expect(bodyText()).not.toContain("Unsaved Changes");
  });
});
