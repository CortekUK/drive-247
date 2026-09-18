/**
 * FeedbackDialog — the v2 restyle, and v1 held still.
 *
 * "Send feedback to Drive247" stays, and stays reachable from the bottom-left
 * launcher. What changed is only how it looks on v2: it was v1-sized and
 * v1-coloured (hardcoded #6366f1 / #080812 / #737373 from the v1 design system,
 * `rounded-md` everywhere, 560px wide) sitting on a v2 portal whose other
 * dialogs are the popover surface with 26px corners, brand tokens and pills.
 *
 * Two halves, and the second is the one that protects ~56 paying tenants:
 *
 *  - v2 renders the compact version: the v2 dialog surface, pill chips with the
 *    v2 hover pair, `rounded-xl` fields, tokens instead of hexes.
 *  - v1's class strings are PINNED here verbatim. Not "contains indigo
 *    somewhere" — the exact strings, so a later tidy-up of the v2 branch that
 *    reaches into the shared markup fails here rather than in production.
 *
 * Behaviour is shared by both branches and is asserted on both: the four
 * feedback kinds all submit, and the screenshot guard still refuses a file that
 * is too large or the wrong format.
 *
 * HARNESS: `react-dom/client` + `act`, not `@testing-library/react` — the repo
 * lacks that package's `@testing-library/dom` peer, so `render()` throws at
 * import. Same approach as `connect-stripe-required-dialog.test.tsx`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { useFeedbackStore } from "@/stores/feedback-store";
import { V2Provider } from "@/lib/v2-context";

const submitMutate = vi.fn();
const markPrompted = vi.fn();
const toast = vi.fn();
let myFeedback: any[] = [];

vi.mock("@/hooks/use-tenant-feedback", async (importOriginal) => {
  // The limits are the thing under test in the guard cases, so they come from
  // the real module rather than being restated here.
  const actual = await importOriginal<typeof import("@/hooks/use-tenant-feedback")>();
  return {
    ...actual,
    useSubmitFeedback: () => ({ mutate: submitMutate, isPending: false }),
    useMarkFeedbackPrompted: () => markPrompted,
    useMyFeedback: () => ({ data: myFeedback }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/rentals",
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  myFeedback = [];
  useFeedbackStore.setState({ isOpen: false, prefillCategory: null, source: null });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

/** Radix portals the dialog to document.body, so query the whole document. */
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
const classesOf = (el: Element | null | undefined) => el?.getAttribute("class") ?? "";

const chip = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')).find(
    (b) => b.textContent?.trim() === label,
  )!;

const dropZone = () => document.querySelector<HTMLElement>('[role="button"][tabindex="0"]')!;
const textarea = () => document.querySelector<HTMLTextAreaElement>("#feedback-message")!;
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === text,
  )!;

async function open(v2: boolean) {
  await act(async () => {
    root.render(
      <V2Provider flags={v2 ? { chrome: true } : {}}>
        <FeedbackDialog />
      </V2Provider>,
    );
  });
  await act(async () => {
    useFeedbackStore.getState().open({ source: "sidebar" });
  });
}

/** React tracks the DOM value, so a bare `el.value = …` is not seen by onChange. */
async function type(value: string) {
  const el = textarea();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Hand the hidden `<input type=file>` a file, the way a browser would. */
async function attach(file: File) {
  const input = fileInput();
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const fileOf = (name: string, type: string, bytes: number) =>
  new File([new Uint8Array(bytes)], name, { type });

/* ── v1: the exact strings, so nothing in the v2 work can move them ───────── */

describe("FeedbackDialog — v1 markup is unchanged", () => {
  beforeEach(() => open(false));

  it("keeps the v1 dialog, title and description classes", () => {
    expect(classesOf(dialog())).toContain("sm:max-w-[560px] max-h-[90vh] overflow-y-auto");
    // None of the v2 surface tokens leak onto a v1 tenant.
    expect(classesOf(dialog())).not.toContain("rounded-4xl");
    expect(classesOf(dialog())).not.toContain("bg-popover");

    expect(classesOf(document.querySelector("h2"))).toContain(
      "text-[#080812] dark:text-white",
    );
    const desc = Array.from(document.querySelectorAll("p")).find((p) =>
      p.textContent?.startsWith("Tell us what's broken"),
    );
    expect(classesOf(desc)).toContain("text-[#737373]");
  });

  it("keeps the v1 type chips", () => {
    expect(classesOf(chip("Note"))).toBe(
      "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors border-[#f1f5f9] dark:border-border bg-[#f8fafc] dark:bg-muted text-[#404040] dark:text-gray-300 hover:border-[#e2e8f0]",
    );
    // "bug" is the default selection, and v1 paints it with the category hex.
    expect(classesOf(chip("Bug"))).toBe(
      "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors border-transparent text-white",
    );
    expect(chip("Bug").style.backgroundColor).toBe("rgb(220, 38, 38)");
  });

  it("keeps the v1 field, drop zone and send button", () => {
    expect(textarea().rows).toBe(6);
    expect(classesOf(textarea())).toContain("resize-none text-[14px]");
    expect(classesOf(dropZone())).toContain(
      "gap-1 rounded-md border border-dashed px-4 py-6 text-center transition-colors",
    );
    expect(classesOf(dropZone())).toContain(
      "border-[#e2e8f0] dark:border-border bg-[#f8fafc] dark:bg-muted/40 hover:border-[#6366f1]",
    );
    expect(classesOf(buttonByText("Send feedback"))).toContain(
      "bg-[#6366f1] text-[13px] text-white hover:bg-[#4f46e5]",
    );
  });

  it("keeps the v1 history card and link", async () => {
    myFeedback = [
      { id: "f1", category: "note", status: "open", message: "hi", created_at: "2026-09-01" },
    ];
    await open(false);
    const link = buttonByText("Your feedback (1)");
    expect(classesOf(link)).toBe(
      "self-start text-[13px] font-medium text-[#6366f1] hover:underline",
    );
    await click(link);
    const card = Array.from(document.querySelectorAll("div")).find((d) =>
      classesOf(d).startsWith("rounded-md border border-[#f1f5f9]"),
    );
    expect(classesOf(card)).toBe("rounded-md border border-[#f1f5f9] dark:border-border p-3");
  });
});

/* ── v2: smaller, calmer, on tokens ───────────────────────────────────────── */

describe("FeedbackDialog — v2 is the compact version", () => {
  beforeEach(() => open(true));

  it("wears the v2 dialog surface and a narrower card", () => {
    const cls = classesOf(dialog());
    expect(cls).toContain("sm:max-w-[480px]");
    expect(cls).toContain("max-h-[85vh]");
    for (const token of [
      "rounded-4xl",
      "sm:rounded-4xl",
      "border-0",
      "bg-popover",
      "text-popover-foreground",
      "shadow-xl",
      "ring-1",
      "ring-foreground/5",
      "dark:ring-foreground/10",
    ]) {
      expect(cls).toContain(token);
    }
    // The v1 width and the v1 heading colour are both gone.
    expect(cls).not.toContain("sm:max-w-[560px]");
    // The primitive's own `tracking-tight` survives twMerge; the v1 weight,
    // size and hex do not.
    expect(classesOf(document.querySelector("h2"))).toBe(
      "tracking-tight text-base font-medium",
    );
  });

  it("renders the type chips as pills with the v2 hover pair", () => {
    const note = chip("Note");
    expect(classesOf(note)).toContain("rounded-full");
    expect(classesOf(note)).not.toContain("rounded-md");
    expect(classesOf(note)).toContain("hover:bg-primary/10");
    expect(classesOf(note)).toContain("dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]");
    // Brand token, not the four category hexes and not a grey hover.
    expect(classesOf(chip("Bug"))).toContain("bg-primary text-primary-foreground");
    expect(chip("Bug").style.backgroundColor).toBe("");
    expect(classesOf(note)).not.toContain("#");
  });

  it("tightens the field and the drop zone onto tokens", () => {
    expect(textarea().rows).toBe(5);
    expect(classesOf(textarea())).toContain("text-[13px]");
    const zone = classesOf(dropZone());
    expect(zone).toContain("rounded-xl");
    expect(zone).not.toContain("rounded-md");
    expect(zone).toContain("border-border bg-muted/30");
    expect(zone).toContain("hover:bg-primary/10");
    expect(zone).not.toContain("#");
  });

  it("lets the send button keep the brand token", () => {
    const cls = classesOf(buttonByText("Send feedback"));
    // The Button's own primary token, which is the tenant's brand colour —
    // v1's hardcoded indigo pair is gone and nothing replaced it.
    expect(cls).toContain("bg-primary text-primary-foreground hover:bg-primary/90");
    expect(cls).not.toContain("#6366f1");
    expect(cls).not.toContain("#4f46e5");
    expect(cls).toContain("text-[13px]");
  });

  it("uses the v2 link token for the history toggle", async () => {
    myFeedback = [
      { id: "f1", category: "note", status: "open", message: "hi", created_at: "2026-09-01" },
    ];
    await open(true);
    const cls = classesOf(buttonByText("Your feedback (1)"));
    expect(cls).toContain("text-primary");
    expect(cls).toContain("dark:text-[hsl(var(--v2-link,var(--primary)))]");
    expect(cls).not.toContain("dark:text-indigo-300");
    expect(cls).not.toContain("#6366f1");
  });
});

/* ── behaviour, identical on both ─────────────────────────────────────────── */

describe.each([
  ["v1", false],
  ["v2", true],
])("FeedbackDialog — behaviour on %s", (_name, v2) => {
  it.each([
    ["Bug", "bug"],
    ["Improvement", "improvement"],
    ["Feature Request", "feature_request"],
    ["Note", "note"],
  ])("submits a %s", async (label, value) => {
    await open(v2);
    await click(chip(label));
    await type("something happened");
    await click(buttonByText("Send feedback"));

    expect(submitMutate).toHaveBeenCalledTimes(1);
    expect(submitMutate.mock.calls[0][0]).toMatchObject({
      category: value,
      message: "something happened",
      screenshot: null,
      pagePath: "/rentals",
      source: "sidebar",
    });
  });

  it("refuses a screenshot over 5MB", async () => {
    await open(v2);
    await attach(fileOf("huge.png", "image/png", 5 * 1024 * 1024 + 1));

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Image too large", variant: "destructive" }),
    );
    // Nothing was attached, so the drop zone is still the drop zone.
    expect(document.querySelector('img[alt="Screenshot preview"]')).toBeNull();
  });

  it("refuses a screenshot in an unsupported format", async () => {
    await open(v2);
    await attach(fileOf("notes.pdf", "application/pdf", 10));

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Unsupported image", variant: "destructive" }),
    );
    expect(document.querySelector('img[alt="Screenshot preview"]')).toBeNull();
  });

  it("accepts a screenshot inside the limit", async () => {
    await open(v2);
    (URL as any).createObjectURL = vi.fn(() => "blob:preview");
    (URL as any).revokeObjectURL = vi.fn();
    await attach(fileOf("shot.png", "image/png", 1024));

    expect(toast).not.toHaveBeenCalled();
    expect(document.querySelector('img[alt="Screenshot preview"]')).not.toBeNull();
  });
});
