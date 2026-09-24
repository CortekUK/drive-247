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
import { Car, Clock } from "lucide-react";
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

  it("renders nothing when every column fits", () => {
    const { container } = render(<RecordDock panels={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers one button per off-screen panel, and opens that panel", () => {
    render(
      <RecordDock
        panels={[
          { id: "stages", label: "Payments", icon: Car, content: () => <p>stage list</p> },
          { id: "context", label: "Activity", icon: Clock, content: () => <p>the timeline</p> },
        ]}
      />,
    );

    const stages = screen.getByRole("button", { name: /payments/i });
    expect(screen.getByRole("button", { name: /activity/i })).toBeTruthy();
    // Closed until asked for: a sheet that starts open would cover the record.
    expect(screen.queryByText("stage list")).toBeNull();

    fireEvent.click(stages);
    expect(screen.getByText("stage list")).toBeTruthy();
    expect(screen.queryByText("the timeline")).toBeNull();
  });

  it("clears the phone's home indicator", () => {
    const { container } = render(
      <RecordDock panels={[{ id: "a", label: "Stages", icon: Car, content: () => null }]} />,
    );
    const strip = container.querySelector("div.fixed");
    expect(strip?.className).toContain("env(safe-area-inset-bottom");
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
    expect(src(`components/${file}`)).toContain("env(safe-area-inset-bottom,0px)+4.5rem");
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
