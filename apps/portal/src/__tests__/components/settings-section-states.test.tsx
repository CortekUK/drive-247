/**
 * v2 Settings state kit (`components/settings-v2/section-states.tsx`).
 *
 * Every settings section builds its loading / empty / no-match / error /
 * read-only / dependency / save states from this kit, so these tests pin the
 * behaviour the sections rely on: actions fire, the search query is echoed, a
 * failed read offers a retry that calls refetch (and never falls through to the
 * form), and a broken image swaps to its icon tile.
 *
 * HARNESS: `react-dom/client` + `act`, not `@testing-library/react` (the repo
 * lacks its `@testing-library/dom` peer). Same approach as
 * `teaching-empty-states.test.tsx`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PackagePlus } from "lucide-react";

const perms = vi.hoisted(() => ({ edit: true }));

vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({
    canEditSettings: () => perms.edit,
    canViewSettings: () => true,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import {
  SettingsSectionSkeleton,
  SettingsEmptyState,
  SettingsNoMatch,
  SettingsLoadError,
  SettingsReadOnlyNotice,
  SettingsReadOnlyFieldset,
  SettingsDependencyNotice,
  SettingsSaveState,
  SettingsSectionBoundary,
  SettingsImage,
  TruncatedText,
  TabularValue,
  SETTINGS_READ_ONLY_COPY,
  describeLoadError,
  describeSaveError,
  formatSettingsMoney,
  formatSettingsNumber,
  settingsControlProps,
  useSettingsAccess,
  useSettingsSaveStatus,
  type SettingsSaveStatus,
} from "@/components/settings-v2/section-states";

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => root.render(node));
  return container;
}

function button(name: string | RegExp): HTMLButtonElement {
  const all = Array.from(container.querySelectorAll("button"));
  const hit = all.find((b) =>
    typeof name === "string" ? b.textContent?.trim() === name : name.test(b.textContent ?? ""),
  );
  if (!hit) throw new Error(`No button "${name}" in: ${all.map((b) => b.textContent).join(" | ")}`);
  return hit;
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  perms.edit = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("SettingsSectionSkeleton", () => {
  it("renders a busy status with the requested table rows", () => {
    render(<SettingsSectionSkeleton variant="table" rows={7} columns={3} label="Loading extras" />);
    const status = container.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("Loading extras");
    expect(container.querySelectorAll(".h-\\[45px\\]")).toHaveLength(7);
  });

  it("renders form pairs and cards", () => {
    render(<SettingsSectionSkeleton variant="form" rows={4} />);
    expect(container.querySelectorAll(".rounded-3xl")).toHaveLength(4);
    render(<SettingsSectionSkeleton variant="cards" rows={6} header />);
    expect(container.querySelectorAll(".rounded-2xl.bg-card")).toHaveLength(6);
  });

  it("stack: full-width cards one above another, never a multi-column grid", () => {
    render(<SettingsSectionSkeleton variant="stack" rows={3} label="Loading agreements" />);
    const cards = container.querySelectorAll(".rounded-2xl.bg-card");
    expect(cards).toHaveLength(3);
    const list = cards[0].parentElement as HTMLElement;
    expect(list.className).toContain("space-y-4");
    expect(list.className).not.toContain("grid");
  });

  it("never renders zero rows", () => {
    render(<SettingsSectionSkeleton variant="table" rows={0} />);
    expect(container.querySelectorAll(".h-\\[45px\\]")).toHaveLength(1);
  });
});

describe("SettingsEmptyState", () => {
  it("shows headline, body, points and fires the primary action", () => {
    const onAdd = vi.fn();
    render(
      <SettingsEmptyState
        icon={PackagePlus}
        headline="Sell add-ons with every booking"
        body="Child seats, GPS, extra drivers."
        points={["One", "Two", "Three", "Four"]}
        primaryAction={{ label: "Add an extra", onClick: onAdd }}
        secondaryAction={{ label: "See the booking page", href: "/settings?tab=branding" }}
      />,
    );
    expect(container.querySelector("h3")?.textContent).toBe("Sell add-ons with every booking");
    expect(container.querySelectorAll("li")).toHaveLength(3);
    act(() => button("Add an extra").click());
    expect(onAdd).toHaveBeenCalledTimes(1);
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/settings?tab=branding");
    expect(link.textContent).toBe("See the booking page");
  });

  it("compact variant drops the card surface and the points", () => {
    render(
      <SettingsEmptyState variant="compact" icon={PackagePlus} headline="No extras yet" body="Add one." points={["x"]} />,
    );
    const root = container.querySelector('[data-settings-state="empty"]')!;
    expect(root.className).not.toContain("bg-card");
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});

describe("SettingsNoMatch", () => {
  it("echoes the query and clears the search", () => {
    const onClear = vi.fn();
    render(<SettingsNoMatch query="  child seat 🚼  " noun="extras" onClear={onClear} />);
    expect(container.textContent).toContain("No extras match");
    expect(container.textContent).toContain("“child seat 🚼”");
    act(() => button("Clear search").click());
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("says filters when there is no query", () => {
    render(<SettingsNoMatch query="   " filtersActive noun="locations" onClear={() => {}} />);
    expect(container.textContent).toContain("No locations match these filters");
    expect(button("Clear filters")).toBeTruthy();
  });

  it("keeps a very long query on one truncated line with the full text in title", () => {
    const long = "a".repeat(500);
    render(<SettingsNoMatch query={long} onClear={() => {}} />);
    const echo = container.querySelector(`[title="${long}"]`)!;
    expect(echo.className).toContain("truncate");
  });
});

describe("SettingsLoadError", () => {
  it("names the thing and calls refetch on Try again", () => {
    const refetch = vi.fn();
    render(<SettingsLoadError thing="extras" error={new Error("Failed to fetch")} onRetry={refetch} />);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain("Couldn't load extras");
    expect(container.textContent).toContain("couldn't reach the server");
    act(() => button("Try again").click());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("disables the button while retrying", () => {
    const refetch = vi.fn();
    render(<SettingsLoadError thing="extras" onRetry={refetch} retrying />);
    const b = button(/Trying/);
    expect(b.disabled).toBe(true);
  });

  it("maps errors to short operator-safe reasons", () => {
    expect(describeLoadError({ code: "42501", message: "permission denied for table rental_extras" })).toMatch(
      /don't have access/,
    );
    expect(describeLoadError(new Error("syntax error at or near SELECT"))).toBe(
      "Something went wrong on our side. Nothing was changed.",
    );
    expect(describeLoadError(undefined)).toMatch(/Nothing was changed/);
  });
});

describe("SettingsSectionBoundary", () => {
  const base = { isLoading: false, isError: false, hasData: true, refetch: () => {}, thing: "extras" };

  it("shows the skeleton, then the error INSTEAD of the form, then content", () => {
    const refetch = vi.fn();
    render(
      <SettingsSectionBoundary {...base} isLoading hasData={false}>
        <form data-testid="form" />
      </SettingsSectionBoundary>,
    );
    expect(container.querySelector('[data-settings-state="loading"]')).toBeTruthy();
    expect(container.querySelector("form")).toBeNull();

    render(
      <SettingsSectionBoundary {...base} isError hasData={false} refetch={refetch}>
        <form />
      </SettingsSectionBoundary>,
    );
    expect(container.querySelector("form")).toBeNull();
    act(() => button("Try again").click());
    expect(refetch).toHaveBeenCalled();

    render(
      <SettingsSectionBoundary {...base} isError hasData>
        <form />
      </SettingsSectionBoundary>,
    );
    expect(container.querySelector("form")).toBeTruthy();
    expect(container.textContent).toContain("Couldn't refresh extras");
  });

  it("renders the empty node when the unfiltered set is empty", () => {
    render(
      <SettingsSectionBoundary {...base} isEmpty empty={<p>nothing yet</p>}>
        <form />
      </SettingsSectionBoundary>,
    );
    expect(container.textContent).toBe("nothing yet");
  });
});

describe("read-only", () => {
  it("shows the default copy", () => {
    render(<SettingsReadOnlyNotice />);
    expect(container.textContent).toBe(SETTINGS_READ_ONLY_COPY);
  });

  it("fieldset disables every control inside", () => {
    render(
      <SettingsReadOnlyFieldset readOnly>
        <input />
        <button type="button">Save</button>
        <button type="button" role="switch" />
      </SettingsReadOnlyFieldset>,
    );
    for (const el of Array.from(container.querySelectorAll("input,button"))) {
      expect(el.matches(":disabled")).toBe(true);
    }
  });

  it("useSettingsAccess and settingsControlProps agree with canEditSettings", () => {
    let access: ReturnType<typeof useSettingsAccess> | undefined;
    function Probe() {
      access = useSettingsAccess("extras");
      return null;
    }
    perms.edit = false;
    render(<Probe />);
    expect(access!.readOnly).toBe(true);
    expect(access!.controlProps.disabled).toBe(true);
    expect(access!.controlProps.title).toBe(SETTINGS_READ_ONLY_COPY);
    expect(settingsControlProps(true)).toEqual({ disabled: false, "aria-disabled": undefined, title: undefined });
    expect(settingsControlProps(true, true).disabled).toBe(true);
  });
});

describe("SettingsDependencyNotice", () => {
  it("renders title, body and fires the action", () => {
    const go = vi.fn();
    render(
      <SettingsDependencyNotice
        tone="warning"
        title="Connect Stripe to take deposits"
        body="Deposits stay off until Stripe is connected."
        action={{ label: "Connect Stripe", onClick: go }}
      />,
    );
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain("Deposits stay off");
    act(() => button("Connect Stripe").click());
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("info tone is a note and a link action is an anchor", () => {
    render(<SettingsDependencyNotice title="Lockbox is off" action={{ label: "Turn on", href: "/settings?tab=rental" }} />);
    expect(container.querySelector('[role="note"]')).toBeTruthy();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/settings?tab=rental");
  });
});

describe("SettingsSaveState", () => {
  it("renders each status", () => {
    const cases: [SettingsSaveStatus, string][] = [
      ["saving", "Saving…"],
      ["saved", "Saved"],
      ["dirty", "Unsaved changes"],
    ];
    for (const [status, text] of cases) {
      render(<SettingsSaveState status={status} />);
      expect(container.textContent).toContain(text);
    }
    render(<SettingsSaveState status="idle" />);
    expect(container.textContent).toBe("");
  });

  it("describeSaveError never shows database internals", () => {
    expect(describeSaveError(new Error('new row violates check constraint "rental_extras_price_check"'))).toBe(
      "One of the values isn't allowed. Check the fields and try again.",
    );
    expect(describeSaveError({ code: "23505", message: "duplicate key value violates unique constraint" })).toMatch(
      /already exists/,
    );
    expect(describeSaveError({ code: "42501", message: "permission denied for table tenants" })).toMatch(/Ask an admin/);
    expect(describeSaveError(new Error("Stripe account is not connected"))).toBe("Stripe account is not connected");
    expect(describeSaveError(undefined)).toMatch(/still here/);
  });

  it("error shows a shortened reason and retry/discard fire", () => {
    const retry = vi.fn();
    const discard = vi.fn();
    render(<SettingsSaveState status="error" error={new Error("x".repeat(400))} onRetry={retry} />);
    expect(container.textContent).toContain("Couldn't save.");
    expect(container.textContent!.length).toBeLessThan(200);
    act(() => button(/Retry/).click());
    expect(retry).toHaveBeenCalledTimes(1);

    render(<SettingsSaveState status="dirty" onDiscard={discard} />);
    act(() => button("Discard").click());
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("useSettingsSaveStatus: dirty -> saving -> saved -> idle", () => {
    vi.useFakeTimers();
    let set: (s: { isDirty: boolean; isPending: boolean; error?: unknown }) => void = () => {};
    function Probe() {
      const [s, setS] = useState({ isDirty: true, isPending: false } as { isDirty: boolean; isPending: boolean; error?: unknown });
      set = setS;
      const status = useSettingsSaveStatus({ ...s, savedMs: 1000 });
      return <span>{status}</span>;
    }
    render(<Probe />);
    expect(container.textContent).toBe("dirty");
    act(() => set({ isDirty: true, isPending: true }));
    expect(container.textContent).toBe("saving");
    act(() => set({ isDirty: false, isPending: false }));
    expect(container.textContent).toBe("saved");
    act(() => vi.advanceTimersByTime(1100));
    expect(container.textContent).toBe("idle");
    act(() => set({ isDirty: true, isPending: true }));
    act(() => set({ isDirty: true, isPending: false, error: new Error("boom") }));
    expect(container.textContent).toBe("error");
  });
});

describe("extreme data", () => {
  it("SettingsImage swaps to the icon tile on error and resets on a new src", () => {
    render(<SettingsImage src="https://example.test/broken.png" alt="Child seat" className="size-9" />);
    const img = container.querySelector("img")!;
    expect(img).toBeTruthy();
    act(() => {
      img.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    const tile = container.querySelector("[data-image-fallback]")!;
    expect(tile.getAttribute("aria-label")).toBe("Child seat");
    expect(tile.className).toContain("size-9");

    render(<SettingsImage src="https://example.test/other.png" alt="Child seat" className="size-9" />);
    expect(container.querySelector("img")).toBeTruthy();

    render(<SettingsImage src={null} alt="" />);
    expect(container.querySelector("[data-image-fallback]")?.getAttribute("aria-label")).toBe("No image");
  });

  it("TruncatedText truncates with the full text in title, and dashes a blank", () => {
    const long = "Premium child seat with ISOFIX 🚼 ".repeat(10);
    render(<TruncatedText text={long} />);
    const span = container.querySelector(".truncate")!;
    expect(span.getAttribute("title")).toBe(long);
    render(<TruncatedText text={"   "} />);
    expect(container.textContent).toBe("—");
    render(<TruncatedText text={null} />);
    expect(container.textContent).toBe("—");
  });

  it("formatters handle null, NaN, negative and huge values", () => {
    expect(formatSettingsMoney(null)).toBe("—");
    expect(formatSettingsMoney("abc")).toBe("—");
    expect(formatSettingsMoney(-12.5, "USD")).toBe("-$12.50");
    expect(formatSettingsMoney(1234567890.123, "USD")).toBe("$1,234,567,890.12");
    expect(formatSettingsMoney("0", "GBP")).toBe("£0.00");
    expect(formatSettingsNumber(undefined)).toBe("—");
    expect(formatSettingsNumber(Infinity)).toBe("—");
    expect(formatSettingsNumber(12500, { suffix: " mi" })).toBe("12,500 mi");
    expect(formatSettingsNumber(-3.456, { suffix: "%" })).toBe("-3.46%");
  });

  it("TabularValue tints negatives", () => {
    render(<TabularValue negative>-$5.00</TabularValue>);
    expect(container.querySelector("span")!.className).toContain("tabular-nums");
    expect(container.querySelector("span")!.className).toContain("text-red-500");
    expect(container.querySelector("span")!.className).not.toContain("truncate");
  });
});
