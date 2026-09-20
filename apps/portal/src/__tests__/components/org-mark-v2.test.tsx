/**
 * The v2 sidebar's tenant mark (OrgMark in components/shared/layout/org-switcher.tsx):
 * the small logo from Settings › Branding first, then the full logo (its dark
 * version in dark mode), then the tenant's initials.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  theme: "light",
  branding: {} as Record<string, string | null>,
}));

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: h.theme }) }));
vi.mock("@/hooks/use-tenant-branding", () => ({
  useTenantBranding: () => ({ branding: h.branding, brandName: "Northwind Rentals" }),
}));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ isManager: false, canView: () => true }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { OrgSwitcher } from "@/components/shared/layout/org-switcher";

// The collapsed rail used to be the menu's trigger and is now a link straight
// to Settings — see org-switcher.tsx. The mark itself is unchanged.
const mark = () => screen.getByRole("link", { name: "Settings" });

beforeEach(() => {
  h.theme = "light";
  h.branding = {
    app_name: "Northwind Rentals",
    favicon_url: "https://cdn.test/small.png",
    logo_url: "https://cdn.test/large.png",
    dark_logo_url: "https://cdn.test/large-dark.png",
  };
});

describe("OrgMark (v2 sidebar)", () => {
  it("prefers the small logo, in light and dark mode", () => {
    const { unmount } = render(<OrgSwitcher collapsed />);
    expect(mark().querySelector("img")).toHaveAttribute("src", "https://cdn.test/small.png");
    unmount();
    h.theme = "dark";
    render(<OrgSwitcher collapsed />);
    expect(mark().querySelector("img")).toHaveAttribute("src", "https://cdn.test/small.png");
  });

  it("falls back to the full logo, and its dark version in dark mode", () => {
    h.branding = { ...h.branding, favicon_url: null };
    const { unmount } = render(<OrgSwitcher collapsed />);
    expect(mark().querySelector("img")).toHaveAttribute("src", "https://cdn.test/large.png");
    unmount();
    h.theme = "dark";
    render(<OrgSwitcher collapsed />);
    expect(mark().querySelector("img")).toHaveAttribute("src", "https://cdn.test/large-dark.png");
  });

  it("shows the tenant's initials when there is no logo at all", () => {
    h.branding = { app_name: "Northwind Rentals", favicon_url: null, logo_url: null, dark_logo_url: null };
    render(<OrgSwitcher collapsed />);
    expect(mark().querySelector("img")).toBeNull();
    expect(mark()).toHaveTextContent("NR");
  });

  it("is rounded like the rest of v2 (no rounded-md)", () => {
    render(<OrgSwitcher collapsed />);
    const img = mark().querySelector("img")!;
    expect(img.className).toContain("rounded-lg");
    expect(img.className).not.toContain("rounded-md");
  });
});
