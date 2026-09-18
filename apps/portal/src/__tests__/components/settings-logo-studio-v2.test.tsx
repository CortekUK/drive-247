/**
 * Settings › Appearance › Logo (`components/settings/appearance/logo-studio.tsx`):
 * the v2 "Checking…" line while a logo is being analysed, so the advice does
 * not pop in late (or show the previous logo's verdict), and v1 unchanged.
 *
 * The uploader and the pixel analysis are mocked; nothing touches storage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const s = vi.hoisted(() => ({
  v2: true,
  resolve: null as null | ((value: unknown) => void),
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
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/settings/logo-upload-with-resize", () => ({ LogoUploadWithResize: () => <div data-testid="uploader" /> }));
vi.mock("@/lib/appearance/logo", () => ({
  analyzeLogo: () => new Promise((resolve) => (s.resolve = resolve)),
  recolorLogo: vi.fn(),
  removeLogoBackdrop: vi.fn(),
  uploadLogoBlob: vi.fn(),
}));

import { LogoStudio } from "@/components/settings/appearance/logo-studio";

let container: HTMLDivElement;
let root: Root;

function mount(logoUrl: string) {
  act(() =>
    root.render(
      <LogoStudio
        logoUrl={logoUrl}
        darkLogoUrl={null}
        onLogoChange={() => undefined}
        onDarkLogoChange={() => undefined}
        lightSidebar="#FFFFFF"
        darkSidebar="#000000"
      />,
    ),
  );
}

const CLEAN = { hasTransparency: true, hasSolidBackdrop: false, backdropColor: null, isDarkInk: false, isLightInk: false };
const CHECKING = "Checking how your logo looks on light and dark…";

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  s.v2 = true;
  s.resolve = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("LogoStudio, v2", () => {
  it("says it is checking until the analysis lands, then gives the verdict", async () => {
    mount("https://example.com/logo.png");
    expect(container.textContent).toContain(CHECKING);
    await act(async () => s.resolve!(CLEAN));
    expect(container.textContent).not.toContain(CHECKING);
    expect(container.textContent).toContain("This logo will look good in both light and dark mode.");
  });

  it("drops the previous logo's verdict while a new logo is checked", async () => {
    mount("https://example.com/a.png");
    await act(async () => s.resolve!(CLEAN));
    mount("https://example.com/b.png");
    expect(container.textContent).toContain(CHECKING);
    expect(container.textContent).not.toContain("This logo will look good");
  });

  it("stops checking when the pixels can't be read (analysis returns null)", async () => {
    mount("https://example.com/logo.png");
    await act(async () => s.resolve!(null));
    expect(container.textContent).not.toContain(CHECKING);
  });
});

describe("LogoStudio, v1 (flag off)", () => {
  it("shows no checking line", () => {
    s.v2 = false;
    mount("https://example.com/logo.png");
    expect(container.textContent).not.toContain(CHECKING);
  });
});
