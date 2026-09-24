/**
 * The record dock: how a record's side columns are reached on a phone.
 *
 * The three record screens (rental, customer, vehicle) are three columns on a
 * desktop and the side two do not fit on a phone. These tests hold the two
 * halves of the answer:
 *
 *   1. the dock itself — it offers exactly the panels the page says are off
 *      screen, opens one at a time, and closes when a row inside acts;
 *   2. the pages and the sidebar agreeing about who owns what, which is a
 *      source check because the rail and the page are siblings that share only
 *      the URL (see the header of `rental-detail-v2.tsx`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ArrowLeft, Car, Clock } from "lucide-react";
import { RecordDock, RecordDockNav, contextTabPanels } from "@/components/ui-v2/record-dock";

const src = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");

/** jsdom has no matchMedia; vaul and the dock both ask for one. */
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("the record dock", () => {
  beforeEach(() => stubMatchMedia(false));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const stages = { id: "stages", label: "Payments", icon: Car, content: () => <p>stage list</p> };
  const context = { id: "context", label: "Activity", icon: Clock, content: () => <p>the timeline</p> };
  const back = { href: "/rentals", label: "All rentals", icon: ArrowLeft };

  it("renders nothing when every column fits", () => {
    // Not even the Back arrow: a bar holding one link is furniture, not
    // navigation, and it would sit over the record for no reason.
    const { container } = render(<RecordDock back={back} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers one control per off-screen panel, and opens that panel", () => {
    render(<RecordDock back={back} primary={stages} secondary={[context]} />);

    expect(screen.getByRole("button", { name: /activity/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /all rentals/i }).getAttribute("href")).toBe("/rentals");
    // Closed until asked for: a sheet that starts open would cover the record.
    expect(screen.queryByText("stage list")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /payments/i }));
    expect(screen.getByText("stage list")).toBeTruthy();
    expect(screen.queryByText("the timeline")).toBeNull();
  });

  it("puts the record's own nav in the middle, raised and brand-coloured", () => {
    render(<RecordDock back={back} primary={stages} secondary={[context]} />);
    const centre = screen.getByRole("button", { name: /payments/i });
    // The sketch: one circle, larger than its neighbours, breaking the bar's
    // top edge. `-translate-y-5` is what lifts it; the ring cuts the hole.
    // Toned down Sep 25 2026: still the focal point, no longer looming.
    expect(centre.className).toContain("-translate-y-3");
    expect(centre.className).toContain("size-12");
    // …and still a 44px target.
    expect(centre.className).not.toMatch(/size-(8|9|10|11)/);
    expect(centre.className).toContain("bg-primary");
    expect(centre.className).toContain("rounded-full");
    // …and it is between the two flanks, not beside them.
    const bar = centre.parentElement!;
    const order = Array.from(bar.children);
    expect(order.indexOf(centre)).toBe(1);
    expect(order).toHaveLength(3);
    // Equal-width flanks are what keep it on the screen's centre line.
    expect((order[0] as HTMLElement).className).toContain("flex-1 basis-0");
    expect((order[2] as HTMLElement).className).toContain("flex-1 basis-0");
  });

  it("carries icons, never labels", () => {
    render(<RecordDock back={back} primary={stages} secondary={[context]} />);
    const bar = screen.getByRole("navigation");
    // Two labelled buttons made a bar wider than the screen. The names live on
    // `aria-label` and on the sheet's title instead, so nothing is lost.
    expect(bar.textContent).toBe("");
    expect(screen.getByRole("button", { name: /activity/i }).querySelector("svg")).toBeTruthy();
  });

  it("promotes the only panel into the middle when there is no rail to show", () => {
    // The tablet case: the rail fits, the context column does not.
    render(<RecordDock back={back} secondary={[context]} />);
    const centre = screen.getByRole("button", { name: /activity/i });
    expect(centre.className).toContain("-translate-y-3");
  });

  it("floats clear of the bottom edge and the phone's home indicator", () => {
    const { container } = render(<RecordDock primary={stages} />);
    const strip = container.querySelector("div.fixed");
    expect(strip?.className).toContain("env(safe-area-inset-bottom");
    // The gap under the bar is what makes it read as floating rather than as a
    // toolbar welded to the edge.
    expect(strip?.className).toContain("+1rem)]");
    expect(screen.getByRole("navigation").className).toContain("rounded-full");
  });

  it("marks where you are, and closes the sheet once a row is taken", () => {
    const close = vi.fn();
    render(
      <RecordDockNav
        groups={[{ items: [{ id: "customer", label: "Customer", icon: Car }, { id: "payments", label: "Payments", icon: Clock }] }]}
        current="payments"
        onSelect={() => {}}
        close={close}
      />,
    );
    expect(screen.getByRole("button", { name: /payments/i }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /customer/i }).getAttribute("aria-current")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /customer/i }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("each context view gets its own icon", () => {
  beforeEach(() => stubMatchMedia(false));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const tabs = [
    { id: "overview", label: "At a glance", icon: Car, content: <p>the glance</p> },
    { id: "timeline", label: "Timeline", icon: Clock, content: <p>the timeline</p> },
  ];
  const back = { href: "/rentals", label: "All rentals", icon: ArrowLeft };

  it("turns a rail's tabs into one dock panel each", () => {
    const panels = contextTabPanels(tabs);
    expect(panels.map((p) => p.label)).toEqual(["At a glance", "Timeline"]);
    expect(panels.map((p) => p.id)).toEqual(["overview", "timeline"]);
  });

  it("opens the view itself, with no tab strip in the way", () => {
    render(<RecordDock primary={{ id: "n", label: "Nav", icon: Car, content: () => <p>nav</p> }} secondary={contextTabPanels(tabs)} />);

    // Both are on the bar. Neither is behind the other.
    fireEvent.click(screen.getByRole("button", { name: /timeline/i }));
    expect(screen.getByText("the timeline")).toBeTruthy();
    // The sheet holds the view, not a chooser: a tablist here would mean the
    // operator still has to pick after tapping.
    expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(0);
    expect(screen.queryByText("the glance")).toBeNull();
  });

  it("splits the views either side of the circle", () => {
    render(
      <RecordDock
        back={back}
        primary={{ id: "n", label: "Nav", icon: Car, content: () => <p>nav</p> }}
        secondary={contextTabPanels([...tabs, { id: "third", label: "Messages", icon: Clock, content: <p>msgs</p> }])}
      />,
    );
    const bar = screen.getByRole("navigation");
    const [leftGroup, , rightGroup] = Array.from(bar.children) as HTMLElement[];
    // Back weights the left, so three views split 1 | 2 and the bar reads
    // two-and-two around the circle — the sketch's shape.
    expect(Array.from(leftGroup.children).map((e) => e.getAttribute("aria-label"))).toEqual(["All rentals", "At a glance"]);
    expect(Array.from(rightGroup.children).map((e) => e.getAttribute("aria-label"))).toEqual(["Timeline", "Messages"]);
  });

  it("falls back to an icon when a tab has none", () => {
    const [panel] = contextTabPanels([{ id: "x", label: "Nameless", content: <p>x</p> }]);
    expect(panel.icon).toBeTruthy();
  });
});

describe("the three record screens hand their columns to the dock", () => {
  const pages = [
    ["rentals-v2/rental-detail/rental-detail-v2.tsx", "railFits", "contextFits"],
    ["customers-v2/customer-detail/customer-detail-v2.tsx", "railFits", "overviewFits"],
    ["vehicles-v2/vehicle-detail-v2.tsx", "railFits", "readoutFits"],
  ] as const;

  it.each(pages)("%s draws the context column only when it fits", (file, rail, context) => {
    const text = src(`components/${file}`);
    expect(text).toContain("RecordDock");
    expect(text).toContain(`const ${rail} = useWiderThan(768)`);
    expect(text).toContain(`{${context} ? (`);
    // The old floating button is gone: the dock is the one place a hidden
    // column is reached from, or a phone gets two competing pills.
    expect(text).not.toContain("ResponsiveContextRail");
  });

  it.each(pages)("%s leaves room for the dock above the last row", (file) => {
    // One shared figure, so three screens cannot each guess a different one
    // and leave their last row under the bar.
    expect(src(`components/${file}`)).toContain("DOCK_CLEARANCE");
  });

  it.each(pages)("%s gives the dock a way back to its list", (file) => {
    expect(src(`components/${file}`)).toMatch(/back=\{\{ href: "\/(rentals|customers|vehicles)"/);
  });

  it.each(pages)("%s gives every context view its own icon", (file) => {
    // Not one panel holding the whole column: that put a tab strip inside the
    // sheet and every view two taps deep.
    const text = src(`components/${file}`);
    expect(text).toContain("contextTabPanels(");
    expect(text).toMatch(/(customerRailTabs|rentalRailTabs|vehicleRailTabs)/);
  });

  it.each(pages)("%s puts the record's own nav on the circle", (file) => {
    // `primary` IS the middle. A screen that passed its sections as
    // `secondary` would push them out to a flank and leave the circle to
    // whatever happened to be first.
    const text = src(`components/${file}`);
    expect(text).toMatch(/primary=\{\s*railFits/);
    expect(text).toContain("RecordDockNav");
  });

  it("gives the phone's sheet back to the navigation", () => {
    // On a phone the sidebar IS the sheet behind the top bar's burger. While a
    // record rail took that slot there was no way from a rental to anywhere
    // else in the portal except its own Back link.
    const text = src("components/shared/layout/app-sidebar-v2.tsx");
    for (const guard of [
      "isRentalDetailPage && rentalDetailId && !isMobile",
      "isVehicleDetailPage && vehicleDetailId && !isMobile",
      "isCustomerDetailPage && customerDetailId && !isMobile",
    ]) {
      expect(text).toContain(guard);
    }
  });

  it("asks for the safe area only on v2, where the dock exists", () => {
    // v1's document is held byte-for-byte by root-layout-v1-parity.test.tsx.
    const text = src("app/layout.tsx");
    expect(text).toContain("viewport-fit=cover");
    expect(text).toContain("v2Flags.theme");
  });
});

/*
 * No two icons on one bar.
 *
 * The circle wears the stage or section the operator is ON, and the flanks
 * wear that record's context views. They are chosen in different files, so
 * nothing stopped the same glyph appearing twice on the same bar — and it did:
 * a rental's Payments stage and its Payment Plan view were both `CreditCard`,
 * so standing on Payments put two identical marks side by side, one of which
 * silently did something else.
 *
 * Read from source rather than by rendering, because the context views need a
 * loaded record to build and this rule is about the CHOICE, not the render.
 */
describe("a record's icons are all different from each other", () => {
  // Only entries that are a nav item or a context view: those carry an id AND
  // a label. `MARK` and the other icon maps living in the same files carry
  // neither, and counting them made this scan answer a different question.
  const ENTRY = /\bid:\s*"[^"]+",\s*label:\s*"[^"]*",\s*icon:\s*([A-Z][A-Za-z0-9]*)/g;
  const iconNames = (file: string) => [...src(file).matchAll(ENTRY)].map((m) => m[1]);
  const iconsIn = (file: string) => new Set(iconNames(file));

  const records = [
    ["rental", "components/rentals-v2/rental-detail/stages.ts", "components/rentals-v2/rental-detail/right-rail.tsx"],
    ["customer", "components/customers-v2/customer-detail/sections.ts", "components/customers-v2/customer-detail/overview-rail.tsx"],
    ["vehicle", "components/vehicles-v2/sections.ts", "components/vehicles-v2/overview-rail.tsx"],
  ] as const;

  it.each(records)("a %s's context views share no icon with its stages or sections", (_r, navFile, railFile) => {
    const nav = iconsIn(navFile);
    const rail = iconsIn(railFile);
    expect(nav.size).toBeGreaterThan(3); // the scan found the list at all
    expect(rail.size).toBeGreaterThan(1);
    expect([...rail].filter((icon) => nav.has(icon))).toEqual([]);
  });

  it.each(records)("a %s's context views are all different from each other", (_r, _navFile, railFile) => {
    const names = iconNames(railFile);
    expect(names.length).toBeGreaterThan(1);
    expect(names.length).toBe(new Set(names).size);
  });

  it("and none of them is the Back arrow", () => {
    for (const [, , railFile] of records) expect(iconsIn(railFile).has("ArrowLeft")).toBe(false);
  });
});
