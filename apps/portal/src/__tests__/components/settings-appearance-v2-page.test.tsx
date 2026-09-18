/**
 * Settings › Branding (v2, northwind) with its real parts: the section order,
 * the five named brand colours and the Custom pill, the contrast advice, the
 * "Restore default colour" action, and the logo cards in place of LogoStudio
 * and FaviconUpload. Plus the v1 render those parts must not touch.
 *
 * HARNESS: Testing Library. Branding, tenant, permissions, theme preview and
 * Supabase are mocked; LogoStudio and FaviconUpload (v1 only) are stubs.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  v2: true,
  branding: {} as Record<string, any>,
  preview: (() => undefined) as (palette: unknown) => void,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/v2-context", () => ({
  useV2: () => s.v2,
  // The provider now carries the tenant-level half of the same answer
  // (`onV2` = tenants.portal_experience, `lean` = that OR the slug list).
  // All-false here leaves the `LEAN_TENANTS` slug list to decide, which is
  // what these cases meant before the column existed.
  usePortalExperience: () => ({ onV2: false, lean: false }),
  usePortalOnV2: () => false,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", company_name: "Northwind Rentals" } }) }));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true, isLoading: false }),
}));
vi.mock("@/hooks/use-tenant-branding", () => ({
  useTenantBranding: () => ({
    branding: s.branding,
    updateBranding: vi.fn().mockResolvedValue(undefined),
    isUpdating: false,
    hasBrandingData: true,
    error: null,
    refetch: vi.fn(),
    isFetchingBranding: false,
  }),
}));
vi.mock("@/hooks/use-theme-preview", () => ({
  useThemePreview: () => ({ preview: s.preview, restore: vi.fn(), commit: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/settings/favicon-upload", () => ({ FaviconUpload: () => <div data-testid="favicon-upload" /> }));
vi.mock("@/components/settings/appearance/logo-studio", () => ({ LogoStudio: () => <div data-testid="logo-studio" /> }));

import { AppearanceSettings } from "@/components/settings/appearance/appearance-settings";

const SetupResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  s.v2 = true;
  s.preview = vi.fn();
  s.branding = {
    primary_color: "#1D4ED8",
    light_primary_color: "#1D4ED8",
    app_name: "Northwind",
    logo_url: null,
    dark_logo_url: null,
    favicon_url: null,
  };
  // Radix's popper constructs a ResizeObserver; the shared setup's stub is not a class.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = SetupResizeObserver;
});

const pressedSwatches = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));

describe("Branding (v2): layout", () => {
  it("renders Portal name, then Brand colour, then Logos, as section headings", () => {
    render(<AppearanceSettings />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Portal name", "Brand colour", "Logos"]);
    expect(screen.getByRole("textbox", { name: "Portal name" })).toHaveAttribute("maxLength", "60");
  });

  it("shows the two logo cards instead of LogoStudio and the favicon uploader", () => {
    render(<AppearanceSettings />);
    expect(screen.queryByTestId("logo-studio")).toBeNull();
    expect(screen.queryByTestId("favicon-upload")).toBeNull();
    expect(screen.getByText("You need two versions of your logo: a small square icon, and your full logo with its name.")).toBeInTheDocument();
    expect(document.querySelector('[data-logo-card="small"]')).not.toBeNull();
    expect(document.querySelector('[data-logo-card="large"]')).not.toBeNull();
  });
});

describe("Branding (v2): brand colour", () => {
  it("offers exactly five named colours and a Custom pill, with no helper line", () => {
    render(<AppearanceSettings />);
    expect(pressedSwatches().map((b) => b.getAttribute("aria-label"))).toEqual(["Indigo", "Blue", "Teal", "Rose", "Graphite"]);
    // The name is printed under each dot, not only in its label.
    for (const name of ["Indigo", "Blue", "Teal", "Rose", "Graphite"]) {
      expect(within(screen.getByRole("button", { name })).getByText(name)).toBeInTheDocument();
    }
    const custom = screen.getByRole("button", { name: /^Custom colour/ });
    expect(custom).toHaveTextContent("Custom");
    expect(custom.className).toContain("rounded-full");
    expect(custom.className).toContain("hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]");
    expect(document.body.textContent).not.toContain("Pick one colour");
  });

  it("marks the chosen colour pressed, and a colour outside the five as Custom", () => {
    render(<AppearanceSettings />);
    // #1D4ED8 is not one of the five.
    expect(pressedSwatches().filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Custom colour, #1D4ED8" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Teal" }));
    expect(screen.getByRole("button", { name: "Teal" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Custom colour" })).toBeInTheDocument();
    expect(s.preview).toHaveBeenCalledWith(expect.objectContaining({ primary_color: "#0F766E", light_primary_color: "#0F766E" }));
  });

  it("falls back to Indigo #442DD7 when no brand colour is stored", () => {
    s.branding = { ...s.branding, primary_color: null, light_primary_color: null };
    render(<AppearanceSettings />);
    expect(screen.getByRole("button", { name: "Indigo" })).toHaveAttribute("aria-pressed", "true");
  });

  it("never says a good colour is easy to read, but still warns about a low-contrast one, with a fix", () => {
    render(<AppearanceSettings />);
    expect(document.body.textContent).not.toContain("easy to read");

    // #777777: luminance 0.1845, so white text is 1.05 / 0.2345 = 4.48:1 and
    // near-black 0.2345 / 0.0530 = 4.42:1. Neither reaches 4.5: 'good'.
    fireEvent.click(screen.getByRole("button", { name: /^Custom colour/ }));
    fireEvent.change(screen.getByLabelText("Your exact brand colour"), { target: { value: "#777777" } });
    const fix = screen.getByRole("button", { name: "Fix it for me" });
    const warning = fix.closest("div.border")!;
    expect(warning.textContent).toContain("Readable, though small text on this colour will be a little soft.");
    expect(warning.className).toContain("rounded-xl");
    expect(warning.className).not.toContain("rounded-md");

    // One 6% step darker: 119 - 119 × 0.06 = 111.86, so #707070, which carries
    // white at 1.05 / 0.2120 = 4.95:1. The warning goes, with no "easy to read" line.
    fireEvent.click(fix);
    expect(screen.getByRole("button", { name: "Custom colour, #707070" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fix it for me" })).toBeNull();
    expect(document.body.textContent).not.toContain("easy to read");
  });

  it("restores Indigo (not Drive Gold) from its own action, after a short confirm", () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Restore default colour" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("This sets your brand colour back to Indigo.");
    expect(dialog.textContent).not.toContain("Drive Gold");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore Indigo" }));
    expect(screen.getByRole("button", { name: "Indigo" })).toHaveAttribute("aria-pressed", "true");
    // Distinct from the page's Reset, which only discards edits.
    expect(screen.getByRole("button", { name: "Reset" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Restore default colour" })).toBeDisabled();
  });
});

describe("Appearance (v1, flag off): untouched", () => {
  it("still renders LogoStudio, the favicon uploader, twelve swatches with their helper line, and the verdict", () => {
    s.v2 = false;
    const { rerender } = render(<AppearanceSettings />);
    // v1 hydrates when the branding query lands (a new object), as on a cold load.
    s.branding = { ...s.branding };
    rerender(<AppearanceSettings />);
    expect(screen.getByTestId("logo-studio")).toBeInTheDocument();
    expect(screen.getByTestId("favicon-upload")).toBeInTheDocument();
    expect(pressedSwatches()).toHaveLength(12);
    expect(document.body.textContent).toContain("Pick one colour — everything else in your portal is worked out from it.");
    // #1D4ED8 against white is about 6.7:1.
    expect(document.body.textContent).toContain("Text on this colour will be white and easy to read.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Appearance");
    expect(document.querySelector("[data-logo-card]")).toBeNull();
  });
});
