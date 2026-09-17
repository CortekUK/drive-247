/**
 * Settings › Appearance (`components/settings/appearance/appearance-settings.tsx`):
 * the v2 (northwind) states added on top of a screen every tenant renders, and
 * proof that the v1 render is unchanged when the flag is off.
 *
 * HARNESS: `react-dom/client` + `act`. Branding, tenant, permissions, theme
 * preview, router and the logo/favicon uploaders are mocked, so nothing here
 * touches Supabase or storage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const s = vi.hoisted(() => ({
  v2: true,
  permissionsLoading: false,
  canEdit: true,
  branding: {} as Record<string, any>,
  updateBranding: (() => Promise.resolve()) as (values: unknown) => Promise<unknown>,
  isUpdating: false,
  push: (() => undefined) as (url: string) => void,
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
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", company_name: "Northwind Rentals" } }) }));
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
    hasBrandingData: true,
    error: null,
    refetch: vi.fn(),
    isFetchingBranding: false,
  }),
}));
vi.mock("@/hooks/use-theme-preview", () => ({
  useThemePreview: () => ({ preview: vi.fn(), restore: vi.fn(), commit: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/settings/favicon-upload", () => ({ FaviconUpload: () => <div data-testid="favicon" /> }));
vi.mock("@/components/settings/appearance/logo-studio", () => ({ LogoStudio: () => <div data-testid="logo-studio" /> }));
vi.mock("@/components/settings/appearance/brand-color-field", () => ({ BrandColorField: () => null }));
vi.mock("@/components/settings/appearance/brand-swatches", () => ({
  // The real custom-hex box forwards every keystroke, like this one.
  BrandSwatches: ({ value, onChange, disabled }: any) => (
    <input data-testid="hex" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { AppearanceSettings } from "@/components/settings/appearance/appearance-settings";

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
const saveButtons = () => Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Save changes");

const originalPushState = window.history.pushState;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  s.v2 = true;
  s.permissionsLoading = false;
  s.canEdit = true;
  s.isUpdating = false;
  s.push = vi.fn();
  s.updateBranding = vi.fn().mockResolvedValue(undefined);
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

describe("Appearance, v2", () => {
  it("opens straight onto the saved branding when it is already cached (no skeleton left on screen)", () => {
    // Branding is cached by the theme provider long before this page opens, so
    // nothing changes after mount to re-run a hydration the reset effect undid.
    mount();
    expect(container.textContent).not.toContain("Loading appearance");
    expect(hex().value).toBe("#C6A256");
    expect(saveButtons()).toHaveLength(1);
    expect(saveButtons()[0].disabled).toBe(true);
  });

  it("waits for a manager's permissions before showing any control", () => {
    s.permissionsLoading = true;
    mount();
    expect(container.textContent).toContain("Loading appearance");
    expect(hex()).toBeNull();
  });

  it("points customers' site styling at Website → Site settings, not CMS", () => {
    mount();
    expect(container.querySelector('a[href="/cms/site-settings"]')?.textContent).toBe("Website → Site settings");
    expect(container.textContent).not.toContain("under CMS");
  });

  it("keeps both Save buttons off while the brand colour is half typed", () => {
    mount();
    type(hex(), "#1D");
    expect(container.textContent).toContain("That isn't a full colour code yet.");
    expect(saveButtons()).toHaveLength(2); // header + sticky try-on bar
    expect(saveButtons().every((b) => b.disabled)).toBe(true);
    type(hex(), "#1D4ED8");
    expect(saveButtons().every((b) => !b.disabled)).toBe(true);
  });

  it("shows a failed save inline, keeps the try-on dirty, and clears the message on the next edit", async () => {
    s.updateBranding = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    mount();
    type(hex(), "#1D4ED8");
    await act(async () => saveButtons()[0].click());
    const errors = container.querySelectorAll('[data-settings-state="save-error"]');
    // Once, in the sticky bar beside Save; the header copy only shows when that bar is not up.
    expect(errors).toHaveLength(1);
    expect(errors[0].textContent).toContain("Couldn't save. We couldn't reach the server. Your changes are still here.");
    expect(saveButtons()).toHaveLength(2); // still dirty: the sticky bar is still up
    expect(saveButtons()[0].disabled).toBe(false);

    type(hex(), "#1D4ED9");
    expect(container.querySelectorAll('[data-settings-state="save-error"]')).toHaveLength(0);
  });

  it("asks before leaving mid try-on instead of dropping it", async () => {
    mount();
    type(hex(), "#1D4ED8");
    await act(async () => {
      window.history.pushState(null, "", "/vehicles");
      await Promise.resolve();
    });
    expect(bodyText()).toContain("Unsaved Changes");
    expect(Array.from(document.body.querySelectorAll("button")).some((b) => b.textContent?.trim() === "Save & Leave")).toBe(true);
  });

  it("view-only: no leave prompt to answer, and the colour cannot change", async () => {
    s.canEdit = false;
    mount();
    expect(hex().disabled).toBe(true);
    await act(async () => {
      window.history.pushState(null, "", "/vehicles");
      await Promise.resolve();
    });
    expect(bodyText()).not.toContain("Unsaved Changes");
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
