/**
 * The v2 feedback box — words and stars, and nothing else.
 *
 * `FeedbackDialogV2` is a NEW component beside the v1 dialog (V2_PLAN §3), and
 * the dashboard layout picks between them. What these cases hold onto:
 *
 *  - the four category chips and the screenshot field are GONE. They belong to
 *    the support ticket system, and a test that only checked the new parts
 *    would pass just as happily if they came back.
 *  - the rating reaches the database, because `tenant_feedback` has no `rating`
 *    column yet and it therefore rides in the message. That compromise is the
 *    single most likely thing to be broken by accident, so the exact composed
 *    string is asserted rather than "contains a 4 somewhere".
 *  - `category: "note"` on every submission, since the column is NOT NULL with
 *    a CHECK constraint and the UI no longer asks.
 *
 * HARNESS: `react-dom/client` + `act`, not `@testing-library/react` — the repo
 * lacks that package's `@testing-library/dom` peer, so `render()` throws at
 * import. Same approach as `feedback-dialog-v2.test.tsx`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  FeedbackDialogV2,
} from "@/components/feedback/feedback-dialog-v2";
import { useFeedbackStore } from "@/stores/feedback-store";

const submitMutate = vi.fn();
const markPrompted = vi.fn();
let myFeedback: any[] = [];

vi.mock("@/hooks/use-tenant-feedback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-tenant-feedback")>();
  return {
    ...actual,
    useSubmitFeedback: () => ({ mutate: submitMutate, isPending: false }),
    useMarkFeedbackPrompted: () => markPrompted,
    useMyFeedback: () => ({ data: myFeedback }),
  };
});

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
const textarea = () => document.querySelector<HTMLTextAreaElement>("#feedback-message")!;
const star = (n: number) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${n} out of 5"]`)!;
const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === text,
  )!;

async function open() {
  await act(async () => {
    root.render(<FeedbackDialogV2 />);
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

/**
 * `composeMessage` is GONE, and these assertions replace it.
 *
 * It existed only to smuggle the rating into `message` as a "4/5 stars" first
 * line while `tenant_feedback` had no rating column. The column now exists
 * (`rating smallint NULL`), so the rating travels in its own field and the
 * message is just the words somebody typed.
 *
 * Pinned rather than deleted: a future edit that re-prefixes the message would
 * silently corrupt the one free-text field a human actually reads, which is
 * the same class of mistake as `source` once being folded into `page_path`.
 */
describe("the rating travels in its own column, not inside the message", () => {
  beforeEach(async () => {
    await open();
  });

  it("sends the words untouched and the rating as a number", async () => {
    await type("the calendar is slow");
    await click(star(4));
    await click(buttonByText("Send feedback"));

    const sent = submitMutate.mock.calls.at(-1)?.[0];
    expect(sent.message).toBe("the calendar is slow");
    expect(sent.rating).toBe(4);
    expect(sent.message).not.toMatch(/stars/);
  });

  it("sends a null rating when no star was picked", async () => {
    await type("the calendar is slow");
    await click(buttonByText("Send feedback"));

    const sent = submitMutate.mock.calls.at(-1)?.[0];
    expect(sent.message).toBe("the calendar is slow");
    expect(sent.rating ?? null).toBeNull();
  });

  it("trims, so a stray newline never becomes the whole message", async () => {
    await type("  hello  ");
    await click(buttonByText("Send feedback"));

    expect(submitMutate.mock.calls.at(-1)?.[0].message).toBe("hello");
  });
});

describe("FeedbackDialogV2 — what it asks for", () => {
  beforeEach(() => open());

  it("opens with the warmer title and no category chips", () => {
    expect(dialog()).not.toBeNull();
    expect(dialog().textContent).toContain("How's it going?");
    // The four v1 kinds, by the labels they were rendered with.
    for (const label of ["Bug", "Improvement", "Feature Request", "Note"]) {
      expect(
        Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent?.trim() === label,
        ),
        label,
      ).toBe(false);
    }
  });

  it("has no screenshot field of any kind", () => {
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(dialog().textContent?.toLowerCase()).not.toContain("screenshot");
    // The v1 drop zone was a focusable div with role=button.
    expect(document.querySelector('[role="button"][tabindex="0"]')).toBeNull();
  });

  it("offers exactly five stars, and says what they mean", () => {
    for (let n = 1; n <= 5; n += 1) expect(star(n)).toBeTruthy();
    expect(document.querySelector('button[aria-label="6 out of 5"]')).toBeNull();
    expect(dialog().textContent).toContain("Stars optional");
  });

  it("stamps the prompt cooldown on open, however it ends", () => {
    expect(markPrompted).toHaveBeenCalled();
  });
});

describe("FeedbackDialogV2 — sending", () => {
  it("sends the words, the rating and a plain `note` category", async () => {
    await open();
    await click(star(4));
    await type("the calendar is slow");
    await click(buttonByText("Send feedback"));

    expect(submitMutate).toHaveBeenCalledTimes(1);
    expect(submitMutate.mock.calls[0][0]).toMatchObject({
      category: "note",
      message: "the calendar is slow",
      rating: 4,
      pagePath: "/rentals",
      source: "sidebar",
    });
    // No screenshot key is sent at all — the field is gone, not merely empty.
    expect(submitMutate.mock.calls[0][0].screenshot).toBeUndefined();
  });

  it("sends without a rating — the words are the required part", async () => {
    await open();
    await type("just so you know");
    await click(buttonByText("Send feedback"));

    expect(submitMutate.mock.calls[0][0]).toMatchObject({
      category: "note",
      message: "just so you know",
    });
  });

  it("clicking the same star again clears it", async () => {
    await open();
    await click(star(3));
    expect(star(3).getAttribute("aria-pressed")).toBe("true");
    await click(star(3));
    expect(star(3).getAttribute("aria-pressed")).toBe("false");

    await type("no stars from me");
    await click(buttonByText("Send feedback"));
    expect(submitMutate.mock.calls[0][0].message).toBe("no stars from me");
  });

  it("will not send an empty box, stars or no stars", async () => {
    await open();
    await click(star(5));
    expect(buttonByText("Send feedback").disabled).toBe(true);
    await type("   ");
    expect(buttonByText("Send feedback").disabled).toBe(true);
  });
});

describe("FeedbackDialogV2 — what you've sent", () => {
  it("shows an empty state rather than a blank panel", async () => {
    await open();
    await click(buttonByText("See what you've sent"));
    expect(dialog().textContent).toContain("Nothing yet");
  });

  it("lists past submissions and whether they were answered", async () => {
    myFeedback = [
      {
        id: "f1",
        message: "5/5 stars\n\nlove the new rail",
        status: "resolved",
        created_at: "2026-09-01T10:00:00.000Z",
      },
      {
        id: "f2",
        message: "the calendar is slow",
        status: "open",
        created_at: "2026-09-02T10:00:00.000Z",
      },
    ];
    await open();
    await click(buttonByText("See what you've sent"));

    expect(dialog().textContent).toContain("love the new rail");
    expect(dialog().textContent).toContain("Answered");
    expect(dialog().textContent).toContain("With the team");
  });
});
