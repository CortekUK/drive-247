/**
 * The `/dev` control for the teaching empty states —
 * `components/dev/empty-state-preview.tsx`.
 *
 * Rendered for real with `react-dom/client` + `act` (the repo lacks
 * `@testing-library/react`'s peer, same as the other render suites). What is
 * checked: the build gate renders NOTHING outside development; in development
 * there is one switch per listing page, a link to open it, "All on" / "All
 * off", and — the part that matters — flipping a switch writes the key and
 * the rows re-render from the store without a reload.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { EmptyStatePreview } from "@/components/dev/empty-state-preview";
import { EMPTY_STATE_PAGES, FORCE_EMPTY_STATE_KEY } from "@/lib/dev-overrides";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.unstubAllEnvs();
});

const render = () => {
  act(() => root.render(<EmptyStatePreview />));
};

const rows = () =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-empty-state-page]"));

const rowFor = (id: string) =>
  container.querySelector<HTMLElement>(`[data-empty-state-page="${id}"]`)!;

const switchIn = (row: HTMLElement) => row.querySelector<HTMLButtonElement>("button[role=switch]")!;

const click = (el: Element) => {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const buttonNamed = (text: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;

const count = () => container.querySelector('[data-testid="empty-state-preview-count"]')!.textContent;

describe("EmptyStatePreview outside development", () => {
  it("renders nothing at all — the build gate", () => {
    expect(process.env.NODE_ENV).not.toBe("development");
    window.localStorage.setItem(FORCE_EMPTY_STATE_KEY, '["vehicles"]');
    render();
    expect(container.innerHTML).toBe("");
  });
});

describe("EmptyStatePreview in development", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  it("lists one row per listing page, in manifest order, each with a switch and an open link", () => {
    render();
    const ids = rows().map((r) => r.dataset.emptyStatePage);
    expect(ids).toEqual(EMPTY_STATE_PAGES.map((p) => p.id));

    for (const page of EMPTY_STATE_PAGES) {
      const row = rowFor(page.id);
      expect(row.textContent, page.id).toContain(page.label);
      expect(switchIn(row), page.id).not.toBeNull();
      // A plain anchor into a new tab — not `next/link`, which would need a
      // router (and an IntersectionObserver) the /dev gate test does not have.
      const link = row.querySelector<HTMLAnchorElement>("a")!;
      expect(link.getAttribute("href"), page.id).toBe(page.href);
      expect(link.getAttribute("target"), page.id).toBe("_blank");
    }
    expect(count()).toBe("0 of 7 on");
  });

  it("flipping a switch writes the key and the row re-renders without a reload", () => {
    render();
    const vehicles = rowFor("vehicles");
    expect(vehicles.dataset.forced).toBe("false");
    expect(switchIn(vehicles).getAttribute("aria-checked")).toBe("false");

    click(switchIn(vehicles));

    expect(window.localStorage.getItem(FORCE_EMPTY_STATE_KEY)).toBe('["vehicles"]');
    expect(rowFor("vehicles").dataset.forced).toBe("true");
    expect(switchIn(rowFor("vehicles")).getAttribute("aria-checked")).toBe("true");
    // Only that row.
    expect(rowFor("customers").dataset.forced).toBe("false");
    expect(count()).toBe("1 of 7 on");

    click(switchIn(rowFor("vehicles")));
    expect(window.localStorage.getItem(FORCE_EMPTY_STATE_KEY)).toBeNull();
    expect(rowFor("vehicles").dataset.forced).toBe("false");
    expect(count()).toBe("0 of 7 on");
  });

  it("All on / All off", () => {
    render();
    click(buttonNamed("All on"));
    expect(rows().every((r) => r.dataset.forced === "true")).toBe(true);
    expect(count()).toBe("7 of 7 on");
    expect(buttonNamed("All on").disabled).toBe(true);

    click(buttonNamed("All off"));
    expect(rows().every((r) => r.dataset.forced === "false")).toBe(true);
    expect(window.localStorage.getItem(FORCE_EMPTY_STATE_KEY)).toBeNull();
    expect(buttonNamed("All off").disabled).toBe(true);
  });

  it("picks up a value already in storage on mount", () => {
    window.localStorage.setItem(FORCE_EMPTY_STATE_KEY, '["rentals","payments"]');
    render();
    expect(rowFor("rentals").dataset.forced).toBe("true");
    expect(rowFor("payments").dataset.forced).toBe("true");
    expect(rowFor("vehicles").dataset.forced).toBe("false");
    expect(count()).toBe("2 of 7 on");
  });

  it("follows a change made in another tab", () => {
    render();
    act(() => {
      window.localStorage.setItem(FORCE_EMPTY_STATE_KEY, '["invoices"]');
      window.dispatchEvent(new StorageEvent("storage", { key: FORCE_EMPTY_STATE_KEY }));
    });
    expect(rowFor("invoices").dataset.forced).toBe("true");
    expect(count()).toBe("1 of 7 on");
  });
});
