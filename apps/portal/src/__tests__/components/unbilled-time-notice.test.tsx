import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnbilledTimeNotice } from "@/components/rentals/unbilled-time-notice";

/**
 * Pinned to the real incident. Rental R-1ac41d (RevTek Rentals): a catch-up run
 * created five backfill extensions on 2026-08-25 carrying billing to 2026-07-31,
 * then auto-extend paused fifteen minutes later. The renter kept the car until
 * 2026-09-02. Balance Due showed $33.00; roughly $1,874 was actually owed,
 * because 33 days had never been converted into a charge at all.
 */
const REAL = {
  rentalStatus: "Closed",
  // end_date lags reality: it only advances when an extension is PAID.
  rentalEndDate: "2026-07-24",
  weeklyRate: 365,
  taxPercent: 7,
  currency: "USD",
  extensions: [
    { new_end_date: "2026-07-24", cancelled_at: null, display_status: "paid" },
    { new_end_date: "2026-07-31", cancelled_at: null, display_status: "approved" },
  ],
  returnedAt: "2026-09-03T02:54:24.364Z", // 2026-09-02 22:54 New York
  tenantTimeZone: "America/New_York",
};

describe("UnbilledTimeNotice — the R-1ac41d case", () => {
  it("counts 33 unbilled days, not 34 — the return is a LOCAL date", () => {
    // 02:54Z is still 2026-09-02 in New York. Counting the UTC date would add a
    // day, and a day here is $55.79.
    render(<UnbilledTimeNotice {...REAL} />);
    expect(screen.getByText(/33 days of this rental/i)).toBeInTheDocument();
  });

  it("bills through 2026-07-31 (the extension), NOT the 2026-07-24 on the rental", () => {
    render(<UnbilledTimeNotice {...REAL} />);
    expect(screen.getByText(/2026-07-31/)).toBeInTheDocument();
  });

  it("shows both bases, because pro-rata vs whole-week is the operator's decision", () => {
    render(<UnbilledTimeNotice {...REAL} />);
    expect(screen.getByText(/\$1,841\.16/)).toBeInTheDocument(); // 33 days pro-rata
    expect(screen.getByText(/\$1,952\.75/)).toBeInTheDocument(); // 5 whole weeks
  });

  it("says nothing when billing already covers the return — no false alarm", () => {
    const { container } = render(
      <UnbilledTimeNotice
        {...REAL}
        extensions={[{ new_end_date: "2026-09-30", cancelled_at: null, display_status: "paid" }]}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores a cancelled extension when working out how far billing reached", () => {
    render(
      <UnbilledTimeNotice
        {...REAL}
        extensions={[
          { new_end_date: "2026-07-31", cancelled_at: null, display_status: "approved" },
          { new_end_date: "2026-12-31", cancelled_at: "2026-08-01T00:00:00Z", display_status: "cancelled" },
        ]}
      />
    );
    expect(screen.getByText(/33 days of this rental/i)).toBeInTheDocument();
  });

  it("stays silent on a cancelled rental", () => {
    const { container } = render(<UnbilledTimeNotice {...REAL} rentalStatus="Cancelled" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stays silent on a closed rental with no return record rather than guessing", () => {
    const { container } = render(<UnbilledTimeNotice {...REAL} returnedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("warns on a car still out, measured to today", () => {
    render(<UnbilledTimeNotice {...REAL} rentalStatus="Active" returnedAt={null} />);
    expect(screen.getByText(/is still out as of/i)).toBeInTheDocument();
  });

  it("drops the money estimate rather than printing $0 when no rate is known", () => {
    render(<UnbilledTimeNotice {...REAL} weeklyRate={0} />);
    expect(screen.getByText(/33 days of this rental/i)).toBeInTheDocument();
    expect(screen.queryByText(/pro-rata/i)).toBeNull();
  });
});
