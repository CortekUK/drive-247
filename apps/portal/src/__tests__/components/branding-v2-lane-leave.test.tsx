/**
 * Settings › Branding (v2): the save bar and the leave dialog with a LOGO
 * edit in the form. The logo try-on is new (a new icon or logo now shows in
 * the sidebar and the browser tab before Save), so leaving with one pending
 * must still ask "Save" or "Don't save", Don't save must take the try-on back
 * off the portal, and Save (from the bar or the dialog) must keep it.
 *
 * HARNESS: `react-dom/client` + `act`, the same mocks as
 * settings-appearance-v2-states: branding, tenant, permissions, theme preview
 * and router are mocked; the swatches are a hex box and the logo cards a stub
 * with buttons that change each logo or report an upload in progress.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const s = vi.hoisted(() => ({
  branding: {} as Record<string, any>,
  updateBranding: (() => Promise.resolve()) as (values: unknown) => Promise<unknown>,
  push: (() => undefined) as (url: string) => void,
  preview: (() => undefined) as (patch: unknown) => void,
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
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/lib/v2-context", () => ({
  useV2: () => true,
  usePortalExperience: () => ({ onV2: false, lean: false }),
  usePortalOnV2: () => false,
}));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", company_name: "Northwind Rentals" } }) }));
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
  LogosV2: ({ faviconUrl, logoUrl, onFaviconChange, onLogoChange, onBusyChange }: any) => (
    <div data-testid="logos-v2" data-favicon={faviconUrl ?? ""} data-logo={logoUrl ?? ""}>
      <button type="button" onClick={() => onFaviconChange("https://cdn.test/new-icon.png")}>
        Use new icon
      </button>
      <button type="button" onClick={() => onLogoChange("https://cdn.test/new-logo.png")}>
        Use new logo
      </button>
      <button type="button" onClick={() => onBusyChange?.(true)}>
        Start uploading
      </button>
    </div>
  ),
}));

import { AppearanceSettings } from "@/components/settings/appearance/appearance-settings";

let container: HTMLDivElement;
let root: Root;

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

const nameInput = () => container.querySelector<HTMLInputElement>("#app_name")!;
const logos = () => container.querySelector<HTMLElement>('[data-testid="logos-v2"]')!;
const buttonsNamed = (name: string, scope: ParentNode = container) =>
  Array.from(scope.querySelectorAll("button")).filter((b) => b.textContent?.trim() === name);
const click = (name: string) => act(() => buttonsNamed(name)[0].click());
const saveBar = () => container.querySelector<HTMLElement>("[data-settings-save-bar]");
const leaveDialog = () => document.body.querySelector<HTMLElement>('[data-leave-dialog="v2"]');

/** A sidebar-style link outside the page, clicked the way a person would. */
async function clickLinkTo(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = "Vehicles";
  document.body.appendChild(link);
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
  s.push = vi.fn();
  s.preview = vi.fn();
  s.restore = vi.fn();
  s.commit = vi.fn();
  s.updateBranding = vi.fn().mockResolvedValue(undefined);
  s.branding = {
    primary_color: "#C6A256",
    light_primary_color: "#C6A256",
    app_name: "Northwind",
    meta_title: null,
    logo_url: "https://cdn.test/logo.png",
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

describe("Branding (v2): a logo edit, the save bar and the leave dialog", () => {
  it("a new square icon makes the page dirty: the bar's Save sends it, keeps the try-on, and the bar settles", async () => {
    mount();
    const save = () => buttonsNamed("Save changes")[0];
    expect(save().disabled).toBe(true);

    click("Use new icon");
    expect(save().disabled).toBe(false);
    await act(async () => save().click());

    expect(s.updateBranding).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(s.updateBranding).mock.calls[0][0] as Record<string, unknown>;
    expect(sent).toMatchObject({ favicon_url: "https://cdn.test/new-icon.png", logo_url: "https://cdn.test/logo.png", app_name: "Northwind" });
    // Left out on purpose, so useTenantBranding's logo sync handles them.
    expect(sent).not.toHaveProperty("dark_logo_url");
    expect(sent).not.toHaveProperty("auth_logo_url");
    expect(s.commit).toHaveBeenCalledTimes(1);
    expect(s.restore).not.toHaveBeenCalled();
    // Saved: nothing left to save.
    expect(save().disabled).toBe(true);
    expect(saveBar()).not.toBeNull();
  });

  it("leaving with a new logo and a new name asks first; Don't save takes the try-on off and goes", async () => {
    mount();
    click("Use new logo");
    type(nameInput(), "Northwind Cars");
    await clickLinkTo("/vehicles");

    const dialog = leaveDialog()!;
    expect(dialog).not.toBeNull();
    expect(s.push).not.toHaveBeenCalled();
    await act(async () => buttonsNamed("Don't save", dialog)[0].click());

    expect(s.updateBranding).not.toHaveBeenCalled();
    expect(s.restore).toHaveBeenCalled();
    expect(s.push).toHaveBeenCalledWith("/vehicles");
  });

  it("the leave dialog's Save keeps the new logo, then goes where the link pointed", async () => {
    mount();
    click("Use new logo");
    await clickLinkTo("/vehicles");
    await act(async () => buttonsNamed("Save", leaveDialog()!)[0].click());

    expect(vi.mocked(s.updateBranding).mock.calls[0][0]).toMatchObject({ logo_url: "https://cdn.test/new-logo.png" });
    expect(s.commit).toHaveBeenCalledTimes(1);
    expect(s.restore).not.toHaveBeenCalled();
    expect(s.push).toHaveBeenCalledWith("/vehicles");
    expect(leaveDialog()).toBeNull();
  });

  it("while a logo is still uploading, leaving offers only Don't save", async () => {
    mount();
    type(nameInput(), "Northwind Cars");
    click("Start uploading");
    await clickLinkTo("/vehicles");
    const dialog = leaveDialog()!;
    expect(buttonsNamed("Save", dialog)).toHaveLength(0);
    expect(buttonsNamed("Don't save", dialog)).toHaveLength(1);
  });

  it("Reset after a logo try-on puts the saved logo back in the form and on the portal", () => {
    mount();
    click("Use new icon");
    click("Use new logo");
    expect(logos().getAttribute("data-favicon")).toBe("https://cdn.test/new-icon.png");
    click("Reset");
    expect(s.restore).toHaveBeenCalledTimes(1);
    expect(logos().getAttribute("data-favicon")).toBe("");
    expect(logos().getAttribute("data-logo")).toBe("https://cdn.test/logo.png");
    expect(buttonsNamed("Save changes")[0].disabled).toBe(true);
  });
});
