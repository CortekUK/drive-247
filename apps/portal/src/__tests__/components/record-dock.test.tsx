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
import { RecordDock, RecordDockNav } from "@/components/ui-v2/record-dock";

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
    expect(centre.className).toContain("-translate-y-5");
    expect(centre.className).toContain("size-14");
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
    expect(centre.className).toContain("-translate-y-5");
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
