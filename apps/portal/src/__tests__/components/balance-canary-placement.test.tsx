/**
 * Where the balance work is placed — and proof that nobody else sees a change.
 *
 * The two host screens are the v2 customer record's Money section and the v2
 * rental's Payments stage. The `customers` and `rentals` v2 areas are WIDENED
 * by `tenants.portal_experience = 'v2'` (nasir, squad, every self-serve
 * signup), but `finances` is slug-only (northwind). So the placements must key
 * on `useV2("finances")` and nothing else, and with it off each screen must
 * render EXACTLY what it rendered before this work: the frozen copies of both
 * files at 61f877d1 (src/__tests__/fixtures/*-head.tsx) are rendered beside
 * today's and must produce identical HTML.
 *
 * With it on: the balance header (the shared reducer's number), the Adjust
 * balance panel, and the scoped Finances views are mounted with the right scope.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { V2Provider, type V2Flags } from "@/lib/v2-context";
import { isV2 } from "@/lib/v2";

const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const RENTAL = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({ balance: [] as any[], scoped: [] as any[], rentalBalance: [] as any[], ledger: null as any }));

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "t1", slug: "northwind", currency_code: "USD", timezone: "America/New_York" } }),
}));
vi.mock("@/components/customers/customer-statement-dialog", () => ({ CustomerStatementDialog: () => null }));
vi.mock("@/components/customers/collect-payment-dialog", () => ({ CollectPaymentDialog: () => null }));
vi.mock("@/components/balance/balance-sections", () => ({
  CustomerBalanceSection: (p: any) => {
    h.balance.push(p);
    return <div data-testid="customer-balance-section" />;
  },
  RentalBalanceSection: (p: any) => {
    h.rentalBalance.push(p);
    return <div data-testid="rental-balance-section" />;
  },
}));
vi.mock("@/components/finances/scoped-finances", () => ({
  ScopedFinances: (p: any) => {
    h.scoped.push(p);
    return <div data-testid="scoped-finances" data-views={p.views.join(",")} />;
  },
}));
// The Payments stage's reads, answered from a fixed ledger.
vi.mock("@/hooks/use-payment-links", () => ({ useRentalPaymentLinks: () => ({ data: [] }) }));
vi.mock("@/hooks/use-rental-extension-totals", () => ({ useRentalExtensionTotals: () => ({ data: [] }) }));
vi.mock("@/hooks/use-rental-ledger-data", () => ({ useRentalTotals: () => ({ data: { outstanding: 150 } }) }));
vi.mock("@/components/rentals-v2/rental-detail/payments-model", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/rentals-v2/rental-detail/payments-model")>();
  return { ...real, useRentalLedgerRows: () => ({ ledger: h.ledger, isLoading: false, error: null, refetch: () => {} }) };
});
vi.mock("@/components/payment-plans/rental-payment-plan", () => ({ RentalPaymentPlanSection: () => <div data-testid="plan-section" /> }));
vi.mock("@/components/rentals-v2/rental-detail/payments-actions", () => ({ PaymentActions: () => <div data-testid="payment-actions" /> }));

import { SectionMoney } from "@/components/customers-v2/customer-detail/section-money";
import { SectionMoneyAtHead } from "../fixtures/section-money-head";
import { StagePayments } from "@/components/rentals-v2/rental-detail/stage-payments";
import { StagePaymentsAtHead } from "../fixtures/stage-payments-head";
import { buildLedger } from "@/components/rentals-v2/rental-detail/payments-model";

/* ── fixtures ─────────────────────────────────────────────────────────── */

const RECORDS: Record<string, any> = {
  empty: { id: CUSTOMER, identity: { name: "Ghulam" }, rentals: [], ledger: [], links: [], billing: { stripeCustomerId: null, methodsUsed: [] } },
  busy: {
    id: CUSTOMER,
    identity: { name: "Ghulam" },
    rentals: [{ id: RENTAL, ref: "R-1001", vehicle: "Corolla", reg: "ABC", start: "2026-09-01", end: null, total: 500, outstanding: 200, status: "Active" }],
    ledger: [
      { id: "l1", date: "2026-09-01", label: "Rental", ref: "R-1001", kind: "charge", amount: 500 },
      { id: "l2", date: "2026-09-02", label: "Payment", ref: null, kind: "payment", amount: -320, unallocated: 20 },
      { id: "l3", date: "2026-09-03", label: "Goodwill", ref: null, kind: "refund", amount: -30 },
    ],
    links: [{ id: "k1", label: "Rental R-1001", amount: 200, status: "Sent", sentAt: "2026-09-04", url: "https://pay.example/x" }],
    billing: { stripeCustomerId: "cus_1", methodsUsed: ["Card"] },
  },
};

const LEDGERS: Record<string, any> = {
  empty: buildLedger({
    rental: { id: RENTAL, start_date: "2026-09-01", end_date: "2026-09-08" },
    chargeRows: [],
    paymentRows: [],
    applicationRows: [],
    refundRows: [],
    extensionRows: [],
    depositEventRows: [],
    linkStateById: new Map(),
  }),
  busy: buildLedger({
    rental: { id: RENTAL, start_date: "2026-09-01", end_date: "2026-09-08" },
    chargeRows: [
      { id: "c1", category: "Rental", amount: 500, remaining_amount: 150, entry_date: "2026-09-01", due_date: "2026-09-01" },
      { id: "c2", category: "Adjustment", amount: -30, remaining_amount: -30, entry_date: "2026-09-03", due_date: "2026-09-03", reference: "Goodwill · ADJ-1a2b3c4d" },
    ],
    paymentRows: [{ id: "p1", amount: 350, status: "Applied", payment_date: "2026-09-02", method: "Cash", created_at: "2026-09-02T10:00:00Z", remaining_amount: 0 }],
    applicationRows: [{ payment_id: "p1", charge_entry_id: "c1", amount_applied: 350 }],
    refundRows: [],
    extensionRows: [],
    depositEventRows: [],
    linkStateById: new Map(),
  }),
};

const DETAIL = {
  rental: { id: RENTAL, customer_id: CUSTOMER, vehicle_id: "v1", status: "Active", rental_number: "R-1001", start_date: "2026-09-01", end_date: "2026-09-08", customers: { name: "Ghulam" } },
} as any;

// `any`: two copies of @types/react are installed; QueryClientProvider types its children against the other one.
function withFlags(flags: V2Flags, ui: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <V2Provider flags={flags}>{ui}</V2Provider>
    </QueryClientProvider>,
  );
}

/** Every v2 area a row-flagged tenant (nasir, squad) is on — i.e. everything except the slug-only `finances`. */
const ROW_FLAGGED: V2Flags = { customers: true, rentals: true, theme: true, chrome: true, dashboard: true, finances: false };

beforeEach(() => {
  h.balance.length = 0;
  h.scoped.length = 0;
  h.rentalBalance.length = 0;
});

describe("who is on the canary", () => {
  it("only northwind; a row-flagged v2 tenant (on the v2 customer and rental screens) is not", () => {
    expect(isV2("finances", "northwind")).toBe(true);
    for (const slug of ["nasir", "squad"]) {
      expect(isV2("customers", slug, true), slug).toBe(true);
      expect(isV2("rentals", slug, true), slug).toBe(true);
      expect(isV2("finances", slug, true), slug).toBe(false);
    }
  });
});

describe("customer record · Money", () => {
  it.each(Object.keys(RECORDS))("off the canary (%s): identical HTML to the section as it stood before", (key) => {
    const props = { c: RECORDS[key], set: () => {}, onJump: () => {}, canEdit: true, currency: "USD" } as any;
    const today = withFlags(ROW_FLAGGED, <SectionMoney {...props} />);
    const before = withFlags(ROW_FLAGGED, <SectionMoneyAtHead {...props} />);
    expect(today.container.innerHTML).toBe(before.container.innerHTML);
    expect(today.container.innerHTML.length).toBeGreaterThan(100);
    expect(h.balance).toHaveLength(0);
    expect(h.scoped).toHaveLength(0);
  });

  it("on the canary: balance first, then the scoped Finances views for this customer", () => {
    const props = { c: RECORDS.busy, set: () => {}, onJump: () => {}, canEdit: true, currency: "USD" } as any;
    withFlags({ ...ROW_FLAGGED, finances: true }, <SectionMoney {...props} />);
    expect(screen.getByTestId("customer-balance-section")).toBeInTheDocument();
    expect(h.balance.at(-1)).toMatchObject({ customerId: CUSTOMER, customerName: "Ghulam", currency: "USD", rentals: RECORDS.busy.rentals });
    expect(h.scoped.at(-1)).toMatchObject({ scope: { customerId: CUSTOMER }, views: ["billed", "received", "upcoming", "fines"] });
    // the balance comes before the views
    const html = document.body.innerHTML;
    expect(html.indexOf("customer-balance-section")).toBeLessThan(html.indexOf("scoped-finances"));
    // the classic tiles (a second, differently computed "outstanding") are not drawn beside it
    expect(screen.queryByText("Net position")).toBeNull();
    // the payment requests list stays
    expect(screen.getByText("Payment requests")).toBeInTheDocument();
  });
});

describe("rental · Payments stage", () => {
  it.each(Object.keys(LEDGERS))("off the canary (%s): identical HTML to the stage as it stood before", (key) => {
    h.ledger = LEDGERS[key];
    const today = withFlags(ROW_FLAGGED, <StagePayments detail={DETAIL} onStage={() => {}} refetch={() => {}} />);
    const before = withFlags(ROW_FLAGGED, <StagePaymentsAtHead detail={DETAIL} onStage={() => {}} refetch={() => {}} />);
    expect(today.container.innerHTML).toBe(before.container.innerHTML);
    expect(today.container.innerHTML).toContain("Outstanding");
    expect(h.rentalBalance).toHaveLength(0);
    expect(h.scoped).toHaveLength(0);
  });

  it("on the canary: the rental's Adjust balance panel, its fines, and billed / received — scoped to this rental", () => {
    h.ledger = LEDGERS.busy;
    withFlags({ ...ROW_FLAGGED, finances: true }, <StagePayments detail={DETAIL} onStage={() => {}} refetch={() => {}} />);
    expect(screen.getByTestId("rental-balance-section")).toBeInTheDocument();
    expect(h.rentalBalance.at(-1).rental).toMatchObject({ id: RENTAL, customer_id: CUSTOMER });
    const views = screen.getAllByTestId("scoped-finances").map((n) => n.getAttribute("data-views"));
    expect(views).toEqual(["fines", "billed,received"]);
    for (const p of h.scoped.slice(-2)) expect(p.scope).toEqual({ rentalId: RENTAL });
    // everything that was there before is still there
    expect(screen.getByTestId("plan-section")).toBeInTheDocument();
    expect(screen.getByTestId("payment-actions")).toBeInTheDocument();
  });
});
