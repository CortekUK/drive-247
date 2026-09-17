/**
 * The v2 settings kit (`components/settings-v2/settings-kit.tsx`): no breadcrumb,
 * a bold page title over semibold section titles with no line under them,
 * left-aligned rows, and ONE sticky save bar per page that the sections defer to.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// section-states reads permissions; keep the auth store and Supabase out of it.
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ canEditSettings: () => true, canViewSettings: () => true }),
}));

import {
  SETTINGS_PAGE_TITLE,
  SETTINGS_SECTION_TITLE,
  SettingsPageHeader,
  SettingsPageHeaderSkeleton,
  SettingsPageSaveProvider,
  SCROLL_TO_SECTION_MAX_FRAMES,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsStickySaveBar,
  UnitGroup,
  UnitGroups,
  Unit,
  useScrollToSection,
} from "@/components/settings-v2/settings-kit";
import { SectionSaveBar } from "@/components/settings-v2/business-section-save";
import { SaveFooter, SectionHeader } from "@/components/settings-v2/pricing-money-parts";

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

describe("headings", () => {
  it("the page title is bold and heavier than a section title, both in the heading font", () => {
    expect(SETTINGS_PAGE_TITLE.split(" ")).toEqual(["font-heading", "text-2xl", "font-bold", "tracking-tight", "text-foreground"]);
    expect(SETTINGS_SECTION_TITLE.split(" ")).toEqual(["font-heading", "text-base", "font-semibold", "tracking-tight", "text-foreground"]);
    expect(SETTINGS_PAGE_TITLE).not.toContain("font-sans");
  });

  it("SettingsPageHeader has no breadcrumb: just the bold title and its description", () => {
    const { container } = render(<SettingsPageHeader title="Tax and fees" description="Charges added on top of the rental price." />);
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    const h1 = container.querySelector("h1")!;
    expect(h1.textContent).toBe("Tax and fees");
    expect(h1.getAttribute("class")).toBe(SETTINGS_PAGE_TITLE);
    expect(container.querySelector("p")!.textContent).toBe("Charges added on top of the rental price.");
  });

  it("the header skeleton reserves the title and description lines only (no 20px breadcrumb line)", () => {
    const { container } = render(<SettingsPageHeaderSkeleton />);
    const lines = Array.from(container.firstElementChild!.children);
    expect(lines.map((line) => classes(line).find((c) => /^h-\d+$/.test(c)))).toEqual(["h-8", "h-5"]);
  });

  it("a panel title and a section header are semibold with no line under them", () => {
    const { container } = render(
      <>
        <SettingsPanel title="Optional modules" description="Each one adds a page.">
          <SettingsRow label="Fleet health" />
        </SettingsPanel>
        <SectionHeader id="weekend" title="Weekend pricing" />
      </>,
    );
    const panelTitle = container.querySelector("section h2")!;
    expect(panelTitle.getAttribute("class")).toBe(SETTINGS_SECTION_TITLE);
    expect(classes(panelTitle.parentElement)).not.toContain("border-b");
    expect(container.querySelector("#weekend")!.getAttribute("class")).toBe(SETTINGS_SECTION_TITLE);
  });
});

describe("rows", () => {
  it("lay out as a left-aligned grid: a 420px label column, controls right after it", () => {
    const { container } = render(
      <SettingsRow label="Minimum driver age" note={<p>note</p>}>
        <input aria-label="age" />
      </SettingsRow>,
    );
    const grid = container.firstElementChild!.firstElementChild!;
    expect(classes(grid)).toEqual(
      expect.arrayContaining(["md:grid", "md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]", "md:items-center", "md:gap-x-10"]),
    );
    expect(classes(grid)).not.toContain("md:justify-between");
    const controls = grid.children[1];
    expect(classes(controls)).toContain("justify-start");
    expect(classes(controls)).not.toContain("md:justify-end");
    expect(classes(container.firstElementChild!.lastElementChild)).toContain("mt-1.5");
  });

  it("keeps each unit beside its own box, with groups spaced further apart", () => {
    const { container } = render(
      <UnitGroups>
        <UnitGroup>
          <input aria-label="days" />
          <Unit>days</Unit>
        </UnitGroup>
        <UnitGroup>
          <input aria-label="hours" />
          <Unit>hours</Unit>
        </UnitGroup>
      </UnitGroups>,
    );
    const outer = container.firstElementChild!;
    expect(classes(outer)).toContain("gap-x-4");
    expect(Array.from(outer.children).map((group) => classes(group).includes("gap-1.5"))).toEqual([true, true]);
  });
});

describe("the page save bar", () => {
  const bar = (over: Partial<Parameters<typeof SettingsStickySaveBar>[0]> = {}) => {
    const props = { dirty: false, saving: false, onSave: vi.fn(), onReset: vi.fn(), ...over };
    render(<SettingsStickySaveBar {...props} />);
    return props;
  };

  it("sticks to the bottom of the window and waits for a genuine change", () => {
    const props = bar();
    const region = screen.getByRole("region", { name: "Save changes" });
    expect(classes(region.parentElement)).toEqual(expect.arrayContaining(["sticky", "bottom-4"]));
    expect(classes(region)).toContain("rounded-full");
    const reset = screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement;
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("with a change: says so, and Reset and Save changes both work", () => {
    const props = bar({ dirty: true });
    expect(screen.getByRole("region", { name: "Save changes" }).textContent).toContain("Unsaved changes");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("while saving both buttons wait; a failure says why", () => {
    bar({ dirty: true, saving: true });
    expect((screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Save changes/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("region", { name: "Save changes" }).textContent).toContain("Saving…");
  });

  it("an error reads as a sentence", () => {
    bar({ dirty: true, error: new Error("permission denied for table tenants") });
    expect(screen.getByRole("alert").textContent).toBe("Couldn't save. You don't have permission to change this. Ask an admin.");
  });
});

describe("sections inside a page save bar", () => {
  const failed = new Error("Failed to fetch");
  const businessSave = (status: "dirty" | "error") => ({
    isPending: false,
    error: status === "error" ? failed : null,
    status,
    run: vi.fn(),
  });
  const moneySave = (status: "dirty" | "error") => ({
    status,
    saving: false,
    error: status === "error" ? failed : null,
    save: vi.fn(),
    trigger: vi.fn(),
    retry: vi.fn(),
  });

  it("outside one, a panel keeps its own Save footer on a divider line", () => {
    const { container } = render(
      <SettingsPanel footer={<SectionSaveBar save={businessSave("dirty")} isDirty onSave={vi.fn()} />}>
        <SettingsRow label="Minimum driver age" />
      </SettingsPanel>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(classes(container.querySelector("section")!.lastElementChild)).toContain("border-t");
  });

  it("inside one, a dirty section shows no Save, and its footer collapses with no line", () => {
    const { container } = render(
      <SettingsPageSaveProvider>
        <SettingsPanel footer={<SectionSaveBar save={businessSave("dirty")} isDirty onSave={vi.fn()} />}>
          <SettingsRow label="Minimum driver age" />
        </SettingsPanel>
        <SettingsPanel footer={<SaveFooter save={moneySave("dirty")} />}>
          <SettingsRow label="Sales tax" />
        </SettingsPanel>
      </SettingsPageSaveProvider>,
    );
    expect(container.querySelectorAll("button")).toHaveLength(0);
    for (const panel of Array.from(container.querySelectorAll("section"))) {
      const footer = panel.lastElementChild!;
      expect(classes(footer)).toEqual(expect.arrayContaining(["empty:hidden"]));
      expect(classes(footer)).not.toContain("border-t");
      expect(footer.childNodes).toHaveLength(0);
    }
  });

  it("inside one, a failed section save still says why, without a button", () => {
    render(
      <SettingsPageSaveProvider>
        <SettingsPanel footer={<SectionSaveBar save={businessSave("error")} isDirty onSave={vi.fn()} />}>
          <SettingsRow label="Minimum driver age" />
        </SettingsPanel>
        <SettingsPanel footer={<SaveFooter save={moneySave("error")} />}>
          <SettingsRow label="Sales tax" />
        </SettingsPanel>
      </SettingsPageSaveProvider>,
    );
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toEqual([
      "Couldn't save. We couldn't reach the server. Your changes are still here.",
      "Couldn't save. We couldn't reach the server. Your changes are still here.",
    ]);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("sections of a longer page (General)", () => {
  it("a section carries its deep-link id, a semibold title it is labelled by, and room under the sticky top bar", () => {
    const { container } = render(
      <SettingsSection anchor="tax-and-fees" title="Tax and fees" description="Charges added on top of the rental price." action={<span>View only</span>}>
        <p>BODY</p>
      </SettingsSection>,
    );
    const section = container.querySelector("section")!;
    expect(section.id).toBe("settings-tax-and-fees");
    expect(section.getAttribute("aria-labelledby")).toBe("settings-tax-and-fees-title");
    expect(classes(section)).toEqual(expect.arrayContaining(["scroll-mt-24", "space-y-3"]));
    const h2 = section.querySelector("h2")!;
    expect(h2.id).toBe("settings-tax-and-fees-title");
    expect(h2.textContent).toBe("Tax and fees");
    expect(h2.getAttribute("class")).toBe(SETTINGS_SECTION_TITLE);
    expect(section.textContent).toContain("Charges added on top of the rental price.");
    expect(section.textContent).toContain("View only");
    expect(section.textContent).toContain("BODY");
  });
});

describe("useScrollToSection", () => {
  let frames: FrameRequestCallback[] = [];
  let scrolled: Element[] = [];
  const originalRaf = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  const originalScroll = Element.prototype.scrollIntoView;

  beforeEach(() => {
    frames = [];
    scrolled = [];
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
    Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
      expect(arg).toEqual({ block: "start" });
      scrolled.push(this);
    };
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancel;
    Element.prototype.scrollIntoView = originalScroll;
  });

  /** Runs every frame queued so far (and none queued while running). */
  const flushFrames = () => {
    const queued = frames;
    frames = [];
    act(() => queued.forEach((cb) => cb(0)));
  };

  function Harness({ target, ready, mounted = true }: { target: string | null; ready: boolean; mounted?: boolean }) {
    useScrollToSection(target, ready);
    return mounted ? <section id="settings-tax-and-fees">Tax and fees</section> : null;
  }

  it("waits until the page is ready, then scrolls the section to the top once", () => {
    const { rerender, container } = render(<Harness target="settings-tax-and-fees" ready={false} />);
    flushFrames();
    expect(scrolled).toHaveLength(0);

    rerender(<Harness target="settings-tax-and-fees" ready />);
    flushFrames();
    expect(scrolled).toEqual([container.querySelector("#settings-tax-and-fees")]);

    // A later render for the same link (say the rental row refetched) does not
    // scroll again, so an operator who scrolled back up stays there.
    rerender(<Harness target="settings-tax-and-fees" ready={false} />);
    rerender(<Harness target="settings-tax-and-fees" ready />);
    flushFrames();
    expect(scrolled).toHaveLength(1);
  });

  it("finds a section that mounts a couple of frames late", () => {
    const { rerender } = render(<Harness target="settings-tax-and-fees" ready mounted={false} />);
    flushFrames(); // frame 1: not there yet
    flushFrames(); // frame 2: still not there
    expect(scrolled).toHaveLength(0);
    rerender(<Harness target="settings-tax-and-fees" ready mounted />);
    flushFrames(); // frame 3: found
    expect(scrolled).toHaveLength(1);
  });

  it("gives up after SCROLL_TO_SECTION_MAX_FRAMES frames when the section never appears", () => {
    render(<Harness target="settings-security-deposit" ready />);
    let requested = 0;
    while (frames.length > 0) {
      requested += frames.length;
      flushFrames();
    }
    // One frame asked for by the effect, then one after each of the first 29
    // misses: 1 + 29 = 30 attempts in all.
    expect(SCROLL_TO_SECTION_MAX_FRAMES).toBe(30);
    expect(requested).toBe(30);
    expect(scrolled).toHaveLength(0);
  });

  it("no target does nothing; a new deep link after it scrolls again", () => {
    const { rerender } = render(<Harness target={null} ready />);
    flushFrames();
    expect(frames).toHaveLength(0);
    expect(scrolled).toHaveLength(0);

    rerender(<Harness target="settings-tax-and-fees" ready />);
    flushFrames();
    expect(scrolled).toHaveLength(1);

    // Back to the index (no target), then the same link again: a fresh scroll.
    rerender(<Harness target={null} ready />);
    rerender(<Harness target="settings-tax-and-fees" ready />);
    flushFrames();
    expect(scrolled).toHaveLength(2);
  });
});
