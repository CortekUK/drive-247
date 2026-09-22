/**
 * The v2 sidebar's tenant mark (OrgMark in components/shared/layout/org-switcher.tsx):
 * the square icon from Settings › Branding, else the tenant's initials. The
 * full logo is NOT in between — a wordmark with the company name in it is an
 * unreadable sliver at 32px, and a tenant who filled only the Full logo slot
 * found it here in a slot they never chose it for. The image sits on the
 * sidebar with no tile of ours around it, and Branding can draw the same mark
 * from its unsaved form.
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

import { OrgMark, OrgSwitcher } from "@/components/shared/layout/org-switcher";

const mark = () => screen.getByRole("button", { name: "Organization menu" });

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
  it("prefers the square icon, in light and dark mode", () => {
    const { unmount } = render(<OrgSwitcher collapsed />);
    expect(mark().querySelector("img")).toHaveAttribute("src", "https://cdn.test/small.png");
    unmount();
    h.theme = "dark";
    render(<OrgSwitcher collapsed />);
    expect(mark().querySelector("img")).toHaveAttribute("src", "https://cdn.test/small.png");
  });

  it("never stands the full logo in for the square icon, in either mode", () => {
    h.branding = { ...h.branding, favicon_url: null };
    const { unmount } = render(<OrgSwitcher collapsed />);
    expect(mark().querySelector("img")).toBeNull();
    expect(mark()).toHaveTextContent("NR");
    expect(document.body.innerHTML).not.toContain("cdn.test/large");
    unmount();
    h.theme = "dark";
    render(<OrgSwitcher collapsed />);
    expect(mark().querySelector("img")).toBeNull();
    expect(mark()).toHaveTextContent("NR");
    expect(document.body.innerHTML).not.toContain("cdn.test/large");
  });

  it("shows the tenant's initials when there is no square icon at all", () => {
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

  it("puts no tile of ours around the image: no muted fill, no padding (the white edges were ours)", () => {
    render(<OrgSwitcher collapsed />);
    const classes = mark().querySelector("img")!.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["h-8", "w-8", "object-contain"]));
    for (const tile of ["bg-muted", "p-0.5", "bg-white", "border", "ring-1"]) expect(classes).not.toContain(tile);
  });

  it("draws Branding's unsaved image and name when given a preview, whatever is saved", () => {
    const { container, rerender } = render(
      <OrgMark preview={{ src: "https://cdn.test/new-icon.png", name: "Southwind Cars", alt: "Square icon in the sidebar" }} />,
    );
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://cdn.test/new-icon.png");
    expect(img).toHaveAttribute("alt", "Square icon in the sidebar");
    // No image in the preview: the initials of the name being typed, not the saved logo.
    rerender(<OrgMark preview={{ src: null, name: "Southwind Cars" }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("SC");
  });
});
