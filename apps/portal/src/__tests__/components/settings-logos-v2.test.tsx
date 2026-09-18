/**
 * Settings › Branding › Logos (`components/settings/appearance/logos-v2.tsx`,
 * v2 only): each card checks a file before anything is uploaded and says why
 * inline, fits a non-square small logo into a square on request, and hands the
 * form the uploaded URL.
 *
 * HARNESS: Testing Library. The checks and the help text are the real ones from
 * lib/appearance/logo.ts; only the browser-bound steps (decoding the image,
 * drawing it, uploading) are mocked, so every pixel size below is hand-picked.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/appearance/logo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appearance/logo")>()),
  loadLogoFile: vi.fn(),
  renderSmallLogo: vi.fn(),
  prepareLargeLogo: vi.fn(),
  uploadLogoBlob: vi.fn(),
  analyzeLogo: vi.fn(() => Promise.resolve(null)),
  removeLogoBackdrop: vi.fn(),
}));

import { LogosV2 } from "@/components/settings/appearance/logos-v2";
import {
  loadLogoFile,
  prepareLargeLogo,
  renderSmallLogo,
  uploadLogoBlob,
  type LoadedLogo,
} from "@/lib/appearance/logo";

const onFaviconChange = vi.fn();
const onLogoChange = vi.fn();
const onBusyChange = vi.fn();

function renderLogos(props: Partial<Parameters<typeof LogosV2>[0]> = {}) {
  return render(
    <LogosV2
      tenantId="t1"
      portalName="Northwind Rentals"
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
  it("introduces the two versions and says what each card is for", () => {
    renderLogos();
    expect(screen.getByRole("heading", { level: 2, name: "Logos" })).toBeInTheDocument();
    expect(
      screen.getByText("You need two versions of your logo: a small square icon, and your full logo with its name."),
    ).toBeInTheDocument();
    expect(within(card("small")).getByText("Used for your browser tab and the badge at the top of your sidebar.")).toBeInTheDocument();
    expect(within(card("large")).getByText("Shown on your sign-in page and your booking website.")).toBeInTheDocument();
  });

  it("builds the help text from the limits: types, 10 MB, and the minimum size", () => {
    renderLogos();
    expect(card("small").querySelector("[data-logo-help]")!.textContent).toBe(
      "PNG, WebP, JPG, SVG or ICO · up to 10 MB · square, at least 128 × 128 px (512 × 512 px is best)",
    );
    expect(card("large").querySelector("[data-logo-help]")!.textContent).toBe(
      "PNG, WebP, JPG or SVG · up to 10 MB · at least 400 × 100 px",
    );
  });

  it("the file pickers accept ICO for the small logo only", () => {
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

  it("rejects a small logo under 128 px a side", async () => {
    const image = loaded(127, 200);
    vi.mocked(loadLogoFile).mockResolvedValue(image);
    renderLogos();
    await pick("small", makeFile("icon.png", "image/png"));
    expect(within(card("small")).getByRole("alert")).toHaveTextContent(
      "This image is 127 × 200 px. The small logo needs to be at least 128 × 128 px, and 512 × 512 px looks sharpest.",
    );
    expect(image.release).toHaveBeenCalled();
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });

  it("rejects a large logo under 400 × 100 px", async () => {
    vi.mocked(loadLogoFile).mockResolvedValue(loaded(399, 120));
    renderLogos();
    await pick("large", makeFile("logo.png", "image/png"));
    expect(within(card("large")).getByRole("alert")).toHaveTextContent(
      "This image is 399 × 120 px. The large logo needs to be at least 400 px wide and 100 px tall.",
    );
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });

  it("rejects a large logo taller than it is wide, or more than 8:1", async () => {
    vi.mocked(loadLogoFile).mockResolvedValueOnce(loaded(500, 600)); // 0.83 : 1
    renderLogos();
    await pick("large", makeFile("logo.png", "image/png"));
    expect(within(card("large")).getByRole("alert")).toHaveTextContent("This image is taller than it is wide (500 × 600 px).");

    vi.mocked(loadLogoFile).mockResolvedValueOnce(loaded(3300, 400)); // 8.25 : 1
    await pick("large", makeFile("logo.png", "image/png"));
    expect(within(card("large")).getByRole("alert")).toHaveTextContent(
      "This image is more than 8 times wider than it is tall (3300 × 400 px)",
    );
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });
});

describe("Logos (v2): accepting a file", () => {
  it("offers to fit a non-square small logo into a square, and uploads only when asked", async () => {
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

  it("takes a roughly square small logo straight away (200 × 220 is 0.91 : 1)", async () => {
    vi.mocked(loadLogoFile).mockResolvedValue(loaded(200, 220));
    renderLogos();
    await pick("small", makeFile("icon.png", "image/png"));
    expect(within(card("small")).queryByRole("alert")).toBeNull();
    expect(uploadLogoBlob).toHaveBeenCalledWith(expect.any(Blob), "t1", "favicon");
    expect(onFaviconChange).toHaveBeenCalledWith("https://cdn.test/uploaded.png");
    expect(onLogoChange).not.toHaveBeenCalled();
  });

  it("takes a tiny SVG for the small logo: it is drawn at 512 px, so it has no pixel minimum", async () => {
    vi.mocked(loadLogoFile).mockResolvedValue(loaded(24, 24, true));
    renderLogos();
    await pick("small", makeFile("icon.svg", "image/svg+xml"));
    expect(within(card("small")).queryByRole("alert")).toBeNull();
    expect(renderSmallLogo).toHaveBeenCalled();
  });

  it("prepares and uploads a valid large logo, and reports busy while it works", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Remove small logo" }));
    expect(onFaviconChange).toHaveBeenCalledWith(null);
    expect(onLogoChange).not.toHaveBeenCalled();
    expect(uploadLogoBlob).not.toHaveBeenCalled();
  });
});

describe("Logos (v2): previews", () => {
  it("shows the small logo as the sidebar badge and the tab icon, and the large one on light and dark", () => {
    renderLogos({ faviconUrl: "https://cdn.test/fav.png", logoUrl: "https://cdn.test/logo.png" });
    expect(screen.getByAltText("Small logo in the sidebar")).toHaveAttribute("src", "https://cdn.test/fav.png");
    expect(screen.getByAltText("Small logo in the sidebar").className).toContain("h-8 w-8");
    expect(screen.getByAltText("Small logo in a browser tab").className).toContain("size-4");
    expect(screen.getByAltText("Large logo on a light background")).toHaveAttribute("src", "https://cdn.test/logo.png");
    expect(screen.getByAltText("Large logo on a dark background")).toHaveAttribute("src", "https://cdn.test/logo.png");
  });

  it("the sidebar badge falls back to the large logo, then initials, as the sidebar does", () => {
    const { rerender } = renderLogos({ logoUrl: "https://cdn.test/logo.png" });
    expect(screen.getByAltText("Small logo in the sidebar")).toHaveAttribute("src", "https://cdn.test/logo.png");
    rerender(
      <LogosV2
        tenantId="t1"
        portalName="Northwind Rentals"
        faviconUrl={null}
        logoUrl={null}
        onFaviconChange={onFaviconChange}
        onLogoChange={onLogoChange}
      />,
    );
    expect(screen.queryByAltText("Small logo in the sidebar")).toBeNull();
    expect(within(card("small")).getByText("NR")).toBeInTheDocument();
  });
});
