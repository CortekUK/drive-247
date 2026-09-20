/**
 * Settings › Branding › Logos (`components/settings/appearance/logos-v2.tsx`,
 * v2 only): the Square icon and Full logo cards. Each checks a file before
 * anything is uploaded and says why inline (type, size, a pixel RANGE with both
 * ends, shape), fits a non-square icon into a square on request, and hands the
 * form the uploaded URL. No "small", "large" or "favicon" on screen, and no
 * "Remove the box".
 *
 * HARNESS: Testing Library. The checks and the help text are the real ones from
 * lib/appearance/logo.ts; only the browser-bound steps (decoding the image,
 * drawing it, uploading) are mocked, so every pixel size below is hand-picked.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
// The sidebar preview draws the real OrgMark, which reads the saved branding;
// the preview hands it the form's image and name, so the saved ones never show.
vi.mock("@/hooks/use-tenant-branding", () => ({
  useTenantBranding: () => ({ branding: { favicon_url: "https://cdn.test/saved.png" }, brandName: "Saved Name" }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/lib/appearance/logo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appearance/logo")>()),
  loadLogoFile: vi.fn(),
  renderSmallLogo: vi.fn(),
  prepareLargeLogo: vi.fn(),
  uploadLogoBlob: vi.fn(),
  // A logo with a solid box behind it: the v2 cards must no longer look, or offer to remove it.
  analyzeLogo: vi.fn(() => Promise.resolve({ hasSolidBackdrop: true })),
  removeLogoBackdrop: vi.fn(),
}));

import { LogosV2 } from "@/components/settings/appearance/logos-v2";
import {
  analyzeLogo,
  BRAND_MARK_FONT_STACK,
  clearBrandMarkCache,
  loadLogoFile,
  prepareLargeLogo,
  removeLogoBackdrop,
  renderSmallLogo,
  uploadLogoBlob,
  type LoadedLogo,
} from "@/lib/appearance/logo";
import { expectedMarkUrl, installCanvas, type CanvasStub } from "../helpers/canvas-stub";

const onFaviconChange = vi.fn();
const onLogoChange = vi.fn();
const onBusyChange = vi.fn();

function renderLogos(props: Partial<Parameters<typeof LogosV2>[0]> = {}) {
  return render(
    <LogosV2
      tenantId="t1"
      portalName="Northwind Rentals"
      tabTitle="Northwind Rentals - Portal"
      brandColor="#0F766E"
      markColor="#2563EB"
      faviconUrl={null}
      logoUrl={null}
      onFaviconChange={onFaviconChange}
      onLogoChange={onLogoChange}
      onBusyChange={onBusyChange}
      {...props}
    />,
  );
}

const card = (slot: "small" | "large") => document.querySelector<HTMLElement>(`[data-logo-card="${slot}"]`)!;

function makeFile(name: string, type: string, size = 2048) {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function loaded(width: number, height: number, vector = false): LoadedLogo {
  return { image: {} as HTMLImageElement, format: vector ? "SVG" : "PNG", width, height, vector, release: vi.fn() };
}

async function pick(slot: "small" | "large", file: File) {
  const input = card(slot).querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

beforeEach(() => {
  vi.mocked(loadLogoFile).mockReset();
  vi.mocked(renderSmallLogo).mockReset().mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  vi.mocked(prepareLargeLogo).mockReset().mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  vi.mocked(uploadLogoBlob).mockReset().mockResolvedValue("https://cdn.test/uploaded.png");
  onFaviconChange.mockReset();
  onLogoChange.mockReset();
  onBusyChange.mockReset();
});

describe("Logos (v2): copy", () => {
  it("introduces the two versions and names each card for what it is", () => {
    renderLogos();
    expect(screen.getByRole("heading", { level: 2, name: "Logos" })).toBeInTheDocument();
    expect(
      screen.getByText("You need two versions of your logo: a square icon, and your full logo with its name."),
    ).toBeInTheDocument();
    expect(within(card("small")).getByRole("heading", { level: 3 })).toHaveTextContent("Square icon");
    expect(within(card("large")).getByRole("heading", { level: 3 })).toHaveTextContent("Full logo");
    expect(within(card("small")).getByText("Shows in the browser tab and at the top of your sidebar.")).toBeInTheDocument();
    expect(within(card("large")).getByText("Shows on your sign-in page and your booking website.")).toBeInTheDocument();
  });

  it('never says "small logo", "large logo" or "favicon" on screen, or in a button name', () => {
    renderLogos({ faviconUrl: "https://cdn.test/fav.png", logoUrl: "https://cdn.test/logo.png" });
    const visible = document.body.textContent!.toLowerCase();
    const names = screen.getAllByRole("button").map((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").toLowerCase());
    const alts = Array.from(document.querySelectorAll("img")).map((img) => img.alt.toLowerCase());
    for (const text of [visible, ...names, ...alts]) {
      expect(text).not.toMatch(/small logo|large logo|favicon/);
    }
    expect(screen.getByRole("button", { name: "Replace square icon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove full logo" })).toBeInTheDocument();
  });

  it("opens with one highlighted line saying what works best, built from the limits", () => {
    renderLogos();
    const best = document.querySelector("[data-logo-best]")!;
    // SMALL_LOGO_RECOMMENDED_PX = 512, LARGE_LOGO_RECOMMENDED_WIDTH = 1200.
    expect(best.textContent).toBe(
      "Best results: a PNG with a transparent background. Square icon at least 512 × 512 px; full logo at least 1200 px wide.",
    );
    // Brand-tinted, in the v2 rounding, and above both cards.
    expect(best.className).toContain("rounded-xl");
    expect(best.className).toContain("bg-primary/10");
    expect(best.className).toContain("dark:text-[hsl(var(--v2-link,var(--primary)))]");
    expect(best.compareDocumentPosition(card("small")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("builds the help text from the limits: types, 10 MB, and the pixel range", () => {
    renderLogos();
    expect(card("small").querySelector("[data-logo-help]")!.textContent).toBe(
      "PNG, WebP, JPG, SVG or ICO · up to 10 MB · square, 128 to 4096 px a side",
    );
    expect(card("large").querySelector("[data-logo-help]")!.textContent).toBe(
      "PNG, WebP, JPG or SVG · up to 10 MB · 400 to 6000 px wide, 100 to 3000 px tall",
    );
  });

  it("the file pickers accept ICO for the square icon only", () => {
    renderLogos();
    const accept = (slot: "small" | "large") => card(slot).querySelector('input[type="file"]')!.getAttribute("accept")!;
    expect(accept("small").split(",")).toEqual(expect.arrayContaining([".png", ".webp", ".jpg", ".svg", ".ico"]));
    expect(accept("large")).not.toContain(".ico");
    expect(accept("large").split(",")).toEqual(expect.arrayContaining([".png", ".webp", ".jpg", ".svg"]));
  });
});

describe("Logos (v2): refusing a file before upload", () => {
  it("rejects a type the slot does not take, without opening it", async () => {
    renderLogos();
    await pick("small", makeFile("logo.gif", "image/gif"));
    expect(within(card("small")).getByRole("alert")).toHaveTextContent(
      "We can't use this type of file. Upload a PNG, WebP, JPG, SVG or ICO file.",
    );
    await pick("large", makeFile("favicon.ico", "image/x-icon"));
    expect(within(card("large")).getByRole("alert")).toHaveTextContent(
      "We can't use this type of file. Upload a PNG, WebP, JPG or SVG file.",
    );
    expect(loadLogoFile).not.toHaveBeenCalled();
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });

  it("rejects a file over 10 MB, saying how big it is", async () => {
    renderLogos();
    // 10 MB + 1 byte = 10.000001 MB, rounded up to one decimal: 10.1.
    await pick("large", makeFile("logo.png", "image/png", 10 * 1024 * 1024 + 1));
    expect(within(card("large")).getByRole("alert")).toHaveTextContent(
      "This file is 10.1 MB. Logos can be up to 10 MB, so save a smaller copy and try again.",
    );
    expect(loadLogoFile).not.toHaveBeenCalled();
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });

  it("rejects a square icon under 128 px a side", async () => {
    const image = loaded(127, 200);
    vi.mocked(loadLogoFile).mockResolvedValue(image);
    renderLogos();
    await pick("small", makeFile("icon.png", "image/png"));
    expect(within(card("small")).getByRole("alert")).toHaveTextContent(
      "This image is 127 × 200 px. The square icon needs to be at least 128 × 128 px, and 512 × 512 px looks sharpest.",
    );
    expect(image.release).toHaveBeenCalled();
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });

  it("rejects a square icon over 4096 px a side, even a square one", async () => {
    const image = loaded(4097, 4097); // square, one pixel past the top of the range
    vi.mocked(loadLogoFile).mockResolvedValue(image);
    renderLogos();
    await pick("small", makeFile("icon.png", "image/png"));
    expect(within(card("small")).getByRole("alert")).toHaveTextContent(
      "This image is 4097 × 4097 px. The square icon can be at most 4096 × 4096 px. Save a smaller copy (512 × 512 px is best) and try again.",
    );
    expect(within(card("small")).queryByRole("button", { name: "Fit into a square" })).toBeNull();
    expect(image.release).toHaveBeenCalled();
    expect(renderSmallLogo).not.toHaveBeenCalled();
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });

  it("rejects a full logo under 400 × 100 px", async () => {
    vi.mocked(loadLogoFile).mockResolvedValue(loaded(399, 120));
    renderLogos();
    await pick("large", makeFile("logo.png", "image/png"));
    expect(within(card("large")).getByRole("alert")).toHaveTextContent(
      "This image is 399 × 120 px. The full logo needs to be at least 400 px wide and 100 px tall.",
    );
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });

  it("rejects a full logo over 6000 px wide or 3000 px tall", async () => {
    // 6001 × 1000 is 6 : 1, inside the shape range: only the width is out.
    vi.mocked(loadLogoFile).mockResolvedValueOnce(loaded(6001, 1000));
    renderLogos();
    await pick("large", makeFile("logo.png", "image/png"));
    expect(within(card("large")).getByRole("alert")).toHaveTextContent(
      "This image is 6001 × 1000 px. The full logo can be at most 6000 px wide and 3000 px tall. Save a smaller copy (1200 px wide is plenty) and try again.",
    );
    // 3200 × 3001 is 1.07 : 1: only the height is out.
    vi.mocked(loadLogoFile).mockResolvedValueOnce(loaded(3200, 3001));
    await pick("large", makeFile("logo.png", "image/png"));
    expect(within(card("large")).getByRole("alert")).toHaveTextContent("This image is 3200 × 3001 px. The full logo can be at most 6000 px wide and 3000 px tall.");
    expect(prepareLargeLogo).not.toHaveBeenCalled();
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });

  it("rejects a full logo taller than it is wide, or more than 8:1", async () => {
    vi.mocked(loadLogoFile).mockResolvedValueOnce(loaded(500, 600)); // 0.83 : 1
    renderLogos();
    await pick("large", makeFile("logo.png", "image/png"));
    expect(within(card("large")).getByRole("alert")).toHaveTextContent(
      "This image is taller than it is wide (500 × 600 px). Use your full logo with its name here, and put a square version under Square icon.",
    );

    vi.mocked(loadLogoFile).mockResolvedValueOnce(loaded(3300, 400)); // 8.25 : 1
    await pick("large", makeFile("logo.png", "image/png"));
    expect(within(card("large")).getByRole("alert")).toHaveTextContent(
      "This image is more than 8 times wider than it is tall (3300 × 400 px)",
    );
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });
});

describe("Logos (v2): accepting a file", () => {
  it("offers to fit a non-square icon into a square, and uploads only when asked", async () => {
    const image = loaded(300, 200); // 1.5 : 1, outside 0.9 to 1.1
    vi.mocked(loadLogoFile).mockResolvedValue(image);
    renderLogos();
    await pick("small", makeFile("wide.png", "image/png"));
    const alert = within(card("small")).getByRole("alert");
    expect(alert).toHaveTextContent("This image is 300 × 200 px, so it isn't square.");
    expect(renderSmallLogo).not.toHaveBeenCalled();
    expect(uploadLogoBlob).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Fit into a square" }));
    });
    expect(renderSmallLogo).toHaveBeenCalledWith(image);
    expect(uploadLogoBlob).toHaveBeenCalledWith(expect.any(Blob), "t1", "favicon");
    expect(onFaviconChange).toHaveBeenCalledWith("https://cdn.test/uploaded.png");
    expect(image.release).toHaveBeenCalled();
    expect(within(card("small")).queryByRole("alert")).toBeNull();
  });

  it("takes a roughly square icon straight away (200 × 220 is 0.91 : 1)", async () => {
    vi.mocked(loadLogoFile).mockResolvedValue(loaded(200, 220));
    renderLogos();
    await pick("small", makeFile("icon.png", "image/png"));
    expect(within(card("small")).queryByRole("alert")).toBeNull();
    expect(uploadLogoBlob).toHaveBeenCalledWith(expect.any(Blob), "t1", "favicon");
    expect(onFaviconChange).toHaveBeenCalledWith("https://cdn.test/uploaded.png");
    expect(onLogoChange).not.toHaveBeenCalled();
  });

  it("takes a tiny SVG for the square icon: it is drawn at 512 px, so it has no pixel minimum", async () => {
    vi.mocked(loadLogoFile).mockResolvedValue(loaded(24, 24, true));
    renderLogos();
    await pick("small", makeFile("icon.svg", "image/svg+xml"));
    expect(within(card("small")).queryByRole("alert")).toBeNull();
    expect(renderSmallLogo).toHaveBeenCalled();
  });

  it("prepares and uploads a valid full logo, and reports busy while it works", async () => {
    const image = loaded(1600, 400);
    vi.mocked(loadLogoFile).mockResolvedValue(image);
    renderLogos();
    const file = makeFile("logo.jpg", "image/jpeg");
    await pick("large", file);
    expect(prepareLargeLogo).toHaveBeenCalledWith(file, image);
    expect(uploadLogoBlob).toHaveBeenCalledWith(expect.any(Blob), "t1", "logo");
    expect(onLogoChange).toHaveBeenCalledWith("https://cdn.test/uploaded.png");
    expect(onBusyChange.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining([true, false]));
    expect(onBusyChange.mock.calls.at(-1)![0]).toBe(false);
  });

  it("says so inline when the upload fails, and keeps the form as it was", async () => {
    vi.mocked(loadLogoFile).mockResolvedValue(loaded(800, 200));
    vi.mocked(uploadLogoBlob).mockRejectedValue(new Error("Failed to fetch"));
    renderLogos();
    await pick("large", makeFile("logo.png", "image/png"));
    expect(within(card("large")).getByRole("alert")).toHaveTextContent(
      "We couldn't upload this image. Check your connection and try again.",
    );
    expect(onLogoChange).not.toHaveBeenCalled();
  });

  it("Remove clears only the form's URL", () => {
    renderLogos({ faviconUrl: "https://cdn.test/fav.png", logoUrl: "https://cdn.test/logo.png" });
    fireEvent.click(screen.getByRole("button", { name: "Remove square icon" }));
    expect(onFaviconChange).toHaveBeenCalledWith(null);
    expect(onLogoChange).not.toHaveBeenCalled();
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });
});

describe("Logos (v2): previews", () => {
  it("shows the square icon in a browser tab and as the sidebar badge, and the full logo on the sign-in page", () => {
    renderLogos({ faviconUrl: "https://cdn.test/fav.png", logoUrl: "https://cdn.test/logo.png" });
    expect(screen.getByAltText("Square icon in a browser tab")).toHaveAttribute("src", "https://cdn.test/fav.png");
    expect(screen.getByAltText("Square icon in a browser tab").className).toContain("size-4");
    expect(screen.getByAltText("Square icon in the sidebar")).toHaveAttribute("src", "https://cdn.test/fav.png");
    expect(screen.getByAltText("Square icon in the sidebar").className).toContain("h-8 w-8");
    expect(screen.getByAltText("Full logo on the sign-in page")).toHaveAttribute("src", "https://cdn.test/logo.png");
    // The tab says what the portal sets as the page title.
    expect(within(card("small")).getByText("Northwind Rentals - Portal")).toBeInTheDocument();
    // One picture only for the full logo: the old light and dark tiles are gone.
    expect(screen.queryByAltText(/on a (light|dark) background/)).toBeNull();
  });

  it("puts no tile of ours around a logo: no white box, no muted fill, no padding on the image", () => {
    renderLogos({ faviconUrl: "https://cdn.test/fav.png", logoUrl: "https://cdn.test/logo.png" });
    for (const img of Array.from(document.querySelectorAll("[data-logo-card] img"))) {
      expect(img.className, img.getAttribute("alt")!).not.toMatch(/(^|\s)(bg-white|bg-muted|p-0\.5|p-\d|ring-\d?)(\s|$)/);
      expect(img.parentElement!.className, img.getAttribute("alt")!).not.toMatch(/(^|\s)bg-white(\s|$)/);
    }
    expect(document.querySelector('[class*="bg-[#0B1120]"]')).toBeNull();
  });

  it("the two previews are the same height, so the cards line up", () => {
    renderLogos();
    const small = card("small").querySelector("[data-logo-preview]")!;
    const large = card("large").querySelector("[data-logo-preview]")!;
    const height = (el: Element) => el.className.split(/\s+/).filter((c) => /^h-/.test(c));
    expect(height(small)).toEqual(["h-36"]);
    expect(height(large)).toEqual(["h-36"]);
  });

  it("never stands the full logo in for the square icon, in either picture", () => {
    // The reported case: a Full logo uploaded while the Square icon slot is
    // empty used to appear in this card's sidebar row AND in the real sidebar.
    renderLogos({ logoUrl: "https://cdn.test/logo.png" });
    const small = card("small");
    expect(small.innerHTML).not.toContain("cdn.test/logo.png");
    expect(within(small).queryByAltText("Square icon in the sidebar")).toBeNull();
    expect(within(small).queryByAltText("Square icon in a browser tab")).toBeNull();
    // Both places show the same thing instead: the portal name's initials.
    expect(within(small).getByText("NR")).toBeInTheDocument();
    // The full logo still belongs in its own card.
    expect(screen.getByAltText("Full logo on the sign-in page")).toHaveAttribute("src", "https://cdn.test/logo.png");
  });

  it("shows the name on the sign-in picture with no full logo, which is what the real page shows", () => {
    // login-v2's light hero is `logo_url || auth_logo_url`, else the name. The
    // preview has no auth_logo_url and does not need one: nothing in the
    // product ever sets that column to anything but a copy of logo_url (the
    // onboarding functions stamp all three together, `lib/tenant-logo-sync.ts`
    // keeps it tracking), and v2's Save deliberately leaves it out of the patch
    // so the sync clears it with the logo. So both fall to the name together.
    renderLogos({ logoUrl: null });
    const large = card("large");
    expect(large.querySelector("img")).toBeNull();
    expect(within(large).getByText("Northwind Rentals")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* The square icon card's two pictures always agree                            */
/*                                                                             */
/* The complaint: with the square icon removed the sidebar row showed the      */
/* tenant's initials and the browser tab beside it showed the Drive247         */
/* platform icon, so removing the icon looked like it had half worked. Both    */
/* now come from `resolveBrandIcon`, the chain the real tab uses.              */
/* -------------------------------------------------------------------------- */

describe("Logos (v2): the tab and the sidebar show the same thing", () => {
  let canvas: CanvasStub | null = null;

  beforeEach(() => {
    // The drawn marks are cached for the life of the module: without this a
    // test that stubs a canvas hands its drawing to the one that stubs none.
    clearBrandMarkCache();
  });

  afterEach(() => {
    canvas?.restore();
    canvas = null;
  });

  /** The <img> in the tab picture and the one in the sidebar row, if any. */
  const pictures = () => {
    const small = card("small");
    return {
      tab: small.querySelector<HTMLImageElement>("[data-preview-tab] img"),
      sidebar: small.querySelector<HTMLImageElement>("[data-preview-sidebar-row] img"),
      sidebarText: small.querySelector("[data-preview-sidebar-row]")!.textContent,
    };
  };

  it("with a square icon set, both show that one file", () => {
    canvas = installCanvas();
    renderLogos({ faviconUrl: "https://cdn.test/fav.png", logoUrl: "https://cdn.test/logo.png" });
    const { tab, sidebar } = pictures();
    expect(tab!.src).toBe("https://cdn.test/fav.png");
    expect(sidebar!.src).toBe(tab!.src);
    expect(canvas.drawn).toHaveLength(0); // nothing to draw: there is an icon
  });

  it("with the icon removed and a full logo present, both show the initials mark — neither shows the logo", () => {
    canvas = installCanvas();
    renderLogos({ faviconUrl: null, logoUrl: "https://cdn.test/logo.png", markColor: "#BE123C" });
    const { tab, sidebar } = pictures();
    // #BE123C carries white text (6.29:1, from the brand preset table).
    const expected = expectedMarkUrl({
      initials: "NR",
      background: "#BE123C",
      foreground: "#FFFFFF",
      fontFamily: BRAND_MARK_FONT_STACK,
    });
    expect(tab!.getAttribute("src")).toBe(expected);
    expect(sidebar!.getAttribute("src")).toBe(expected);
    expect(card("small").innerHTML).not.toContain("cdn.test/logo.png");
    expect(card("small").innerHTML).not.toContain("/icons/favicon-light.png");
  });

  it("with both removed, both still show the initials mark, drawn once", () => {
    canvas = installCanvas();
    renderLogos({ faviconUrl: null, logoUrl: null, markColor: "#2563EB" });
    const { tab, sidebar } = pictures();
    const expected = expectedMarkUrl({
      initials: "NR",
      background: "#2563EB",
      foreground: "#FFFFFF",
      fontFamily: BRAND_MARK_FONT_STACK,
    });
    expect(tab!.getAttribute("src")).toBe(expected);
    expect(sidebar!.getAttribute("src")).toBe(expected);
    // One drawing, reused: two <img> with different srcs would be two pictures.
    expect(canvas.drawn).toHaveLength(1);
    expect(canvas.drawn[0].texts).toEqual(["NR"]);
  });

  it("removing the icon swaps both pictures at once, and putting one back swaps them back", () => {
    canvas = installCanvas();
    const { rerender } = renderLogos({ faviconUrl: "https://cdn.test/fav.png", markColor: "#2563EB" });
    expect(pictures().tab!.src).toBe("https://cdn.test/fav.png");

    const props = {
      tenantId: "t1",
      portalName: "Northwind Rentals",
      tabTitle: "Northwind Rentals - Portal",
      brandColor: "#0F766E",
      markColor: "#2563EB",
      logoUrl: null,
      onFaviconChange,
      onLogoChange,
    };
    rerender(<LogosV2 {...props} faviconUrl={null} />);
    const removed = pictures();
    expect(removed.tab!.getAttribute("src")).toMatch(/^data:image\/png/);
    expect(removed.sidebar!.getAttribute("src")).toBe(removed.tab!.getAttribute("src"));

    rerender(<LogosV2 {...props} faviconUrl="https://cdn.test/fav2.png" />);
    expect(pictures().tab!.src).toBe("https://cdn.test/fav2.png");
    expect(pictures().sidebar!.src).toBe("https://cdn.test/fav2.png");
  });

  it("without a canvas, the tab shows the platform icon the real tab would, and the sidebar its own chip", () => {
    // jsdom has no canvas, so this is the server-render case: nothing can be
    // drawn, and each place falls back to what it really shows in that state.
    renderLogos({ faviconUrl: null, logoUrl: "https://cdn.test/logo.png" });
    const { tab, sidebar, sidebarText } = pictures();
    expect(tab!.getAttribute("src")).toBe("/icons/favicon-light.png");
    expect(tab!.alt).toBe("Default icon in a browser tab");
    expect(sidebar).toBeNull();
    expect(sidebarText).toContain("NR");
  });
});

describe("Logos (v2): no Remove the box", () => {
  it("never inspects a stored logo or offers to cut its box out", async () => {
    renderLogos({ logoUrl: "https://cdn.test/boxed.jpg" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: /Remove the box/ })).toBeNull();
    expect(document.body.textContent).not.toContain("solid box");
    expect(analyzeLogo).not.toHaveBeenCalled();
    expect(removeLogoBackdrop).not.toHaveBeenCalled();
  });
});
