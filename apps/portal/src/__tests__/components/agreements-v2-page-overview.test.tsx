/**
 * Agreements v2: the hero row (components/agreements-v2/agreements-overview-v2.tsx).
 *
 * Every expected number was worked out by hand from the fixture, not by running
 * the code. "Today" is Mon 21 Sep 2026, 14:00 local, so the eight 7-day weeks
 * ending today are (first day of each):
 *   0 Jul 28   1 Aug 4   2 Aug 11   3 Aug 18   4 Aug 25   5 Sep 1   6 Sep 8   7 Sep 15
 * i.e. Jul 28 00:00 .. Sep 21 23:59 (56 days).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

// The card is lane B's and has its own tests: here it is a stub that records
// what the row hands it.
const card = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
vi.mock("@/components/agreements-v2/create-template-card-v2", () => ({
  CreateTemplateCardV2: (props: Record<string, any>) => {
    card.props = props;
    return (
      <button type="button" data-testid="create-card" disabled={props.disabled} onClick={props.onCreate}>
        Create your template
      </button>
    );
  },
}));

import {
  AgreementsOverviewV2,
  agreementHeadlineV2,
  agreementWeeksV2,
  recentlyFailedV2,
  recentlySignedV2,
} from "@/components/agreements-v2/agreements-overview-v2";
import type { AgreementRowV2 } from "@/lib/agreements-v2/types";

// recharts' ResponsiveContainer constructs a ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

const TODAY = new Date(2026, 8, 21, 14, 0);
const at = (m: number, d: number, h = 12, min = 0) => new Date(2026, m - 1, d, h, min).toISOString();

const row = (over: Partial<AgreementRowV2> & { id: string }): AgreementRowV2 => ({
  kind: "rental",
  customerName: over.id.toUpperCase(),
  customerEmail: `${over.id}@example.com`,
  sentAt: null,
  status: "pending",
  rawStatus: "sent",
  rentalId: "r",
  rentalRef: "R-1",
  documentId: "d",
  templateId: null,
  title: null,
  message: null,
  cc: [],
  signedAt: null,
  signedDocumentId: null,
  resentFromId: null,
  hasContentSnapshot: false,
  ...over,
});

const ROWS: AgreementRowV2[] = [
  row({ id: "a", status: "signed", sentAt: at(9, 21, 9), signedAt: at(9, 21, 10) }), // week 7
  row({ id: "b", status: "signed", sentAt: at(7, 28, 0, 1), signedAt: at(9, 21, 11, 30) }), // week 0, signed late
  row({ id: "c", status: "signed", sentAt: at(7, 27, 23, 59) }), // the day before week 0
  row({ id: "e", status: "signed", sentAt: at(8, 20, 13), signedAt: at(8, 21, 9) }), // week 3
  row({ id: "p1", status: "pending", sentAt: at(9, 15, 0, 5) }), // week 7, its first minutes
  row({ id: "p2", status: "pending", sentAt: at(9, 22, 8) }), // tomorrow: not placed
  row({ id: "p3", status: "pending", sentAt: null }), // no time: not placed
  row({ id: "p4", status: "pending", sentAt: at(8, 20, 12) }), // week 3
  row({ id: "f1", status: "failed", rawStatus: "send_failed", sentAt: at(9, 14, 23, 55) }), // week 6, its last minutes
  row({ id: "f2", status: "failed", rawStatus: "credit_failed", sentAt: at(8, 2, 10) }), // week 0
];

describe("the weeks", () => {
  const weeks = agreementWeeksV2(ROWS, TODAY);

  it("are the last eight whole weeks, the last ending today", () => {
    expect(weeks.map((w) => w.label)).toEqual(["Jul 28", "Aug 4", "Aug 11", "Aug 18", "Aug 25", "Sep 1", "Sep 8", "Sep 15"]);
    expect(weeks[0].range).toBe("Jul 28 – Aug 3");
    expect(weeks[7].range).toBe("Sep 15 – Sep 21");
  });

  it("place each row once, in its week, under its status", () => {
    const counts = weeks.map((w) => [w.signed, w.pending, w.failed]);
    expect(counts).toEqual([
      [1, 0, 1], // Jul 28: b signed, f2 failed
      [0, 0, 0],
      [0, 0, 0],
      [1, 1, 0], // Aug 18: e signed, p4 pending
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 1], // Sep 8: f1 failed
      [1, 1, 0], // Sep 15: a signed, p1 pending
    ]);
    expect(weeks.map((w) => w.total)).toEqual([2, 0, 0, 2, 0, 0, 1, 2]);
  });

  it("leave out rows sent before the window, after today, or never", () => {
    // 10 rows; c (Jul 27), p2 (tomorrow) and p3 (no time) are not placed.
    expect(weeks.reduce((s, w) => s + w.total, 0)).toBe(7);
  });
});

describe("the headline and the two lists", () => {
  it("counts every row given: total, signed, pending, failed", () => {
    expect(agreementHeadlineV2(ROWS)).toEqual({ total: 10, signed: 4, pending: 4, failed: 2 });
  });

  it("recently signed: newest signature first, three at most", () => {
    // b signed Sep 21 11:30, a Sep 21 10:00, e Aug 21 09:00; c (Jul 27) is fourth.
    expect(recentlySignedV2(ROWS).map((r) => r.id)).toEqual(["b", "a", "e"]);
  });

  it("failed: newest send first", () => {
    expect(recentlyFailedV2(ROWS).map((r) => r.id)).toEqual(["f1", "f2"]);
  });
});

describe("AgreementsOverviewV2", () => {
  it("says the numbers in words, and names the latest signed and failed", () => {
    const { container } = render(
      <AgreementsOverviewV2 rows={ROWS} filtered={false} onCreateTemplate={() => {}} canCreateTemplate today={TODAY} />,
    );
    expect(container.querySelector("p.sr-only")?.textContent).toBe(
      "Agreements listed: 10. Signed: 4. Pending signature: 4. Failed: 2. Sent in the last 8 weeks: 7.",
    );
    expect(screen.getByText("Recently signed")).toBeInTheDocument();
    for (const name of ["B", "A", "E", "F1", "F2"]) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByText("C")).toBeNull(); // fourth signed: not listed
    expect(screen.queryByText("Filtered")).toBeNull();
  });

  it("marks a filtered list", () => {
    render(<AgreementsOverviewV2 rows={ROWS} filtered onCreateTemplate={() => {}} canCreateTemplate today={TODAY} />);
    expect(screen.getByText("Filtered")).toBeInTheDocument();
  });

  it("an empty list says so rather than showing blank lists", () => {
    render(<AgreementsOverviewV2 rows={[]} filtered={false} onCreateTemplate={() => {}} canCreateTemplate today={TODAY} />);
    expect(screen.getByText("Nothing signed yet.")).toBeInTheDocument();
    expect(screen.getByText("Nothing has failed.")).toBeInTheDocument();
  });

  it("the card is Create your template, wired to the page's handler and to the template grant", () => {
    const onCreate = vi.fn();
    const { rerender } = render(
      <AgreementsOverviewV2 rows={ROWS} filtered={false} onCreateTemplate={onCreate} canCreateTemplate today={TODAY} />,
    );
    fireEvent.click(screen.getByTestId("create-card"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(card.props?.disabled).toBe(false);
    rerender(
      <AgreementsOverviewV2 rows={ROWS} filtered={false} onCreateTemplate={onCreate} canCreateTemplate={false} today={TODAY} />,
    );
    expect(card.props?.disabled).toBe(true);
  });

  it("the card sits in the hero row's card slot, not inside the chart", () => {
    const { container } = render(
      <AgreementsOverviewV2 rows={ROWS} filtered={false} onCreateTemplate={() => {}} canCreateTemplate today={TODAY} />,
    );
    const slot = container.querySelector("[data-hero-card]");
    expect(slot?.firstElementChild).toBe(screen.getByTestId("create-card"));
    expect(container.querySelector("[data-hero-chart]")?.contains(screen.getByTestId("create-card"))).toBe(false);
  });
});
