/**
 * The v2 leave guard: `lib/leave-guard.ts` (the guarded router slot) and
 * `hooks/use-leave-guard-v2.ts` (every way out of a page with unsaved edits).
 *
 * HARNESS: `react-dom/client` + `act`, a mocked `useRouter`, and the real jsdom
 * history. A Back is simulated the way a browser delivers it after popping our
 * same-URL sentinel: the current entry loses the sentinel marker (same URL) and
 * a `popstate` fires. Every expected value is written out by hand.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

import {
  hasLeaveGuard,
  runThroughLeaveGuard,
  setLeaveGuard,
  useGuardedRouter,
} from "@/lib/leave-guard";
import {
  LEAVE_GUARD_SENTINEL_KEY,
  isLeavingHref,
  useLeaveGuardV2,
  type LeaveGuardV2,
  type UseLeaveGuardV2Options,
} from "@/hooks/use-leave-guard-v2";

/* -------------------------------------------------------------------------- */
/* lib/leave-guard                                                             */
/* -------------------------------------------------------------------------- */

describe("lib/leave-guard", () => {
  it("with no guard installed, the navigation runs at once", () => {
    expect(hasLeaveGuard()).toBe(false);
    const proceed = vi.fn();
    runThroughLeaveGuard("/vehicles", proceed);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("a guard that takes the navigation over keeps it; one that declines lets it run", () => {
    const kept: Array<() => void> = [];
    const dispose = setLeaveGuard((href, proceed) => {
      if (href === "/stay") return false;
      kept.push(proceed);
      return true;
    });
    const later = vi.fn();
    runThroughLeaveGuard("/vehicles", later);
    expect(later).not.toHaveBeenCalled();
    expect(kept).toHaveLength(1);
    kept[0]();
    expect(later).toHaveBeenCalledTimes(1);

    const now = vi.fn();
    runThroughLeaveGuard("/stay", now);
    expect(now).toHaveBeenCalledTimes(1);
    dispose();
    expect(hasLeaveGuard()).toBe(false);
  });

  it("a disposer only clears its own guard", () => {
    const disposeFirst = setLeaveGuard(() => true);
    const disposeSecond = setLeaveGuard(() => true);
    disposeFirst();
    expect(hasLeaveGuard()).toBe(true);
    disposeSecond();
    expect(hasLeaveGuard()).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Rendering helpers                                                           */
/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;
let guard: LeaveGuardV2;
let guardedPush: (href: string, options?: { scroll?: boolean }) => void;

function Probe(props: UseLeaveGuardV2Options) {
  guard = useLeaveGuardV2(props);
  guardedPush = useGuardedRouter().push;
  return (
    <div>
      <a href="/vehicles" data-testid="other-page">
        Vehicles
      </a>
      <a href="/settings" data-testid="same-path">
        Settings
      </a>
      <a href="/settings?tab=general#currency" data-testid="hash-only">
        Currency
      </a>
      <a href="/customers" target="_blank" data-testid="new-tab">
        Customers
      </a>
      <span data-open={guard.open ? "yes" : "no"} />
    </div>
  );
}

const baseOptions = (over: Partial<UseLeaveGuardV2Options> = {}): UseLeaveGuardV2Options => ({
  enabled: true,
  isDirty: true,
  canSave: true,
  onSave: vi.fn(async () => true),
  onDiscard: vi.fn(),
  ...over,
});

function render(options: UseLeaveGuardV2Options) {
  act(() => root.render(<Probe {...options} />));
}

function click(testId: string, init: MouseEventInit = {}) {
  const anchor = container.querySelector(`[data-testid="${testId}"]`) as HTMLAnchorElement;
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => {
    anchor.dispatchEvent(event);
  });
  return event;
}

/** What a browser does on Back from our sentinel: same URL, no marker, then popstate. */
function backOffSentinel() {
  act(() => {
    const { [LEAVE_GUARD_SENTINEL_KEY]: _marker, ...rest } = (window.history.state ?? {}) as Record<string, unknown>;
    window.history.replaceState(rest, "", window.location.href);
    window.dispatchEvent(new PopStateEvent("popstate", { state: rest }));
  });
}

beforeEach(() => {
  window.history.replaceState({ __NA: true }, "", "/settings?tab=general");
  nav.push.mockReset();
  nav.replace.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Links                                                                       */
/* -------------------------------------------------------------------------- */

describe("useLeaveGuardV2: links", () => {
  it("asks before a link to another page, and a Don't save puts the forms back first, then goes", () => {
    const options = baseOptions();
    render(options);
    const event = click("other-page");
    expect(event.defaultPrevented).toBe(true);
    expect(guard.open).toBe(true);
    expect(nav.push).not.toHaveBeenCalled();

    const order: string[] = [];
    (options.onDiscard as ReturnType<typeof vi.fn>).mockImplementation(() => order.push("discard"));
    nav.push.mockImplementation((href: string) => order.push(`push ${href}`));
    act(() => guard.discard());
    expect(order).toEqual(["discard", "push /vehicles"]);
    expect(guard.open).toBe(false);
  });

  it("catches the same pathname with a different search (/settings from /settings?tab=general)", () => {
    render(baseOptions());
    const event = click("same-path");
    expect(event.defaultPrevented).toBe(true);
    expect(guard.open).toBe(true);
  });

  it("lets a hash jump on the same page, a new-tab link and a modified click through", () => {
    render(baseOptions());
    expect(click("hash-only").defaultPrevented).toBe(false);
    expect(click("new-tab").defaultPrevented).toBe(false);
    expect(click("other-page", { metaKey: true }).defaultPrevented).toBe(false);
    expect(guard.open).toBe(false);
  });

  it("does nothing while the page is clean", () => {
    render(baseOptions({ isDirty: false }));
    expect(click("other-page").defaultPrevented).toBe(false);
    expect(guard.open).toBe(false);
  });

  it("isLeavingHref compares pathname and search, never the hash", () => {
    expect(isLeavingHref("/settings?tab=general")).toBe(false);
    expect(isLeavingHref("/settings?tab=general#fees")).toBe(false);
    expect(isLeavingHref("/settings")).toBe(true);
    expect(isLeavingHref("/settings?tab=fees")).toBe(true);
    expect(isLeavingHref("https://example.org/settings")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The guarded router                                                          */
/* -------------------------------------------------------------------------- */

describe("useLeaveGuardV2: the guarded router", () => {
  it("a guarded push asks first; Save saves, then pushes", async () => {
    const options = baseOptions();
    render(options);
    act(() => guardedPush("/cms"));
    expect(guard.open).toBe(true);
    expect(nav.push).not.toHaveBeenCalled();

    await act(async () => {
      await guard.save();
    });
    expect(options.onSave).toHaveBeenCalledTimes(1);
    expect(options.onDiscard).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/cms");
    expect(guard.open).toBe(false);
  });

  it("a failed save keeps the dialog open and the page where it is", async () => {
    render(baseOptions({ onSave: vi.fn(async () => false) }));
    act(() => guardedPush("/cms"));
    await act(async () => {
      await guard.save();
    });
    expect(guard.open).toBe(true);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("Save does nothing when the page cannot save every edit", async () => {
    const options = baseOptions({ canSave: false });
    render(options);
    act(() => guardedPush("/cms"));
    await act(async () => {
      await guard.save();
    });
    expect(options.onSave).not.toHaveBeenCalled();
    expect(guard.open).toBe(true);
  });

  it("Cancel stays: nothing is pushed or discarded", () => {
    const options = baseOptions();
    render(options);
    act(() => guardedPush("/cms"));
    act(() => guard.cancel());
    expect(guard.open).toBe(false);
    expect(nav.push).not.toHaveBeenCalled();
    expect(options.onDiscard).not.toHaveBeenCalled();
  });

  it("a clean page, or a push to the page already open, goes straight through (options kept only when given)", () => {
    render(baseOptions({ isDirty: false }));
    act(() => guardedPush("/cms"));
    expect(nav.push).toHaveBeenCalledWith("/cms");
    expect(nav.push.mock.calls[0]).toHaveLength(1);
    act(() => guardedPush("/cms", { scroll: false }));
    expect(nav.push.mock.calls[1]).toEqual(["/cms", { scroll: false }]);

    render(baseOptions({ isDirty: true }));
    act(() => guardedPush("/settings?tab=general"));
    expect(nav.push).toHaveBeenCalledTimes(3);
    expect(guard.open).toBe(false);
  });

  it("disabled (every v1 tenant) installs no guard at all", () => {
    render(baseOptions({ enabled: false }));
    expect(hasLeaveGuard()).toBe(false);
    act(() => guardedPush("/cms"));
    expect(nav.push).toHaveBeenCalledWith("/cms");
    expect(click("other-page").defaultPrevented).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Back and Forward                                                            */
/* -------------------------------------------------------------------------- */

describe("useLeaveGuardV2: Back", () => {
  it("while dirty, stands on a same-URL sentinel that keeps the router's own state", () => {
    const before = window.history.length;
    render(baseOptions());
    expect(window.history.length).toBe(before + 1);
    expect(window.history.state).toEqual({ __NA: true, [LEAVE_GUARD_SENTINEL_KEY]: true });
    expect(window.location.pathname + window.location.search).toBe("/settings?tab=general");
  });

  it("pushes no sentinel for a clean page or a disabled guard", () => {
    const before = window.history.length;
    render(baseOptions({ isDirty: false }));
    render(baseOptions({ enabled: false, isDirty: true }));
    expect(window.history.length).toBe(before);
  });

  it("Back off the sentinel opens the dialog; Don't save discards, then goes back once more", () => {
    const options = baseOptions();
    render(options);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    backOffSentinel();
    expect(guard.open).toBe(true);
    expect(back).not.toHaveBeenCalled();

    act(() => guard.discard());
    expect(options.onDiscard).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("Cancel after a Back puts the sentinel back", () => {
    render(baseOptions());
    vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    backOffSentinel();
    const before = window.history.length;
    act(() => guard.cancel());
    expect(window.history.length).toBe(before + 1);
    expect(window.history.state?.[LEAVE_GUARD_SENTINEL_KEY]).toBe(true);
  });

  it("a sentinel left on a page that is clean again is skipped: Back just goes back", () => {
    render(baseOptions());
    render(baseOptions({ isDirty: false }));
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    backOffSentinel();
    expect(guard.open).toBe(false);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("a popstate to another URL is left alone", () => {
    render(baseOptions());
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    act(() => {
      window.history.replaceState({ __NA: true }, "", "/vehicles");
      window.dispatchEvent(new PopStateEvent("popstate", { state: { __NA: true } }));
    });
    expect(guard.open).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });
});

describe("useLeaveGuardV2: reload", () => {
  it("prompts before unload only while dirty", () => {
    render(baseOptions());
    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    render(baseOptions({ isDirty: false }));
    const cleanEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });
});
