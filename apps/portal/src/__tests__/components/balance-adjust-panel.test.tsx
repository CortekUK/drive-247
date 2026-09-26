/**
 * The Adjust balance panel — each of the three answers to "What happened?",
 * undo, and Request a payment call exactly the existing server path they are
 * meant to, with exactly this body. Recorded against a fake Supabase client;
 * nothing reaches a network.
 *
 *   A charge was wrong      → adjust-customer-balance {kind: charge_correction, …}
 *   Received outside        → payments insert (is_off_platform: true, the
 *                              Record Payment row) → apply-payment → adjust-
 *                              customer-balance {kind: off_platform_payment}
 *   Goodwill                → adjust-customer-balance {kind: goodwill, …}
 *   Undo (off-platform)     → reverse-payment → adjust-customer-balance {reverses_id}
 *   Request a payment       → adjust-customer-balance {payment_request} → the
 *                              existing Collect Payment dialog, for that amount
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedQuery, RecordingSupabase } from "../helpers/recording-supabase";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const RENTAL = "33333333-3333-4333-8333-333333333333";
const VEHICLE = "44444444-4444-4444-8444-444444444444";
const CHARGE = "55555555-5555-4555-8555-555555555555";
const EXT_CHARGE = "66666666-6666-4666-8666-666666666666";
const EXT = "77777777-7777-4777-8777-777777777777";
const PAYMENT = "88888888-8888-4888-8888-888888888888";

const h = vi.hoisted(() => ({
  rec: null as unknown as RecordingSupabase,
  canEdit: true,
  toasts: [] as any[],
  collect: [] as any[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { recordingSupabase } = await import("../helpers/recording-supabase");
  h.rec = recordingSupabase();
  return { supabase: h.rec.client, supabaseUntyped: h.rec.client };
});
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: TENANT, slug: "northwind", currency_code: "USD", timezone: "America/New_York" } }),
}));
vi.mock("@/hooks/use-manager-permissions", () => ({
  useManagerPermissions: () => ({ isManager: false, canView: () => true, canEdit: () => h.canEdit }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: any) => h.toasts.push(t) }) }));
vi.mock("@/components/customers/collect-payment-dialog", () => ({
  CollectPaymentDialog: (p: any) => {
    h.collect.push(p);
    return p.open ? <div data-testid="collect-dialog" data-amount={String(p.defaultAmount)} data-description={p.description} /> : null;
  },
}));

import { AdjustBalanceDialog } from "@/components/balance/adjust-balance-dialog";
import { AdjustmentHistory } from "@/components/balance/adjustment-history";
import { CustomerBalanceSection } from "@/components/balance/balance-sections";
import type { AdjustmentEntry } from "@/hooks/use-balance-adjustments";

/* ── the database this test pretends to be ────────────────────────────── */

const CHARGES = [
  { id: CHARGE, category: "Rental", amount: 500, remaining_amount: 200, due_date: "2026-09-01", reference: "r", rental_id: RENTAL, extension_id: null },
  { id: EXT_CHARGE, category: "Extension Rental", amount: 200, remaining_amount: 200, due_date: "2026-09-10", reference: "e", rental_id: RENTAL, extension_id: EXT },
];

let duplicate: any[] = [];
/** What useCustomerBalanceWithStatus reads from ledger_entries (its select names `type`). */
let balanceRows: any[] = [];
let adjustmentsError: any = null;
let applyOk = true;
let auditFailures = 0;

function answerQuery(q: RecordedQuery) {
  if (q.table === "ledger_entries" && q.action === "select" && q.columns?.startsWith("type")) return { data: balanceRows };
  if (q.table === "ledger_entries" && q.action === "select") return { data: CHARGES };
  if (q.table === "payments" && q.action === "insert") return { data: { id: PAYMENT, ...q.payload } };
  if (q.table === "payments" && q.action === "select" && q.filters.some((f) => f[0] === "eq" && f[1] === "amount")) return { data: duplicate };
  if (q.table === "rentals" && q.columns === "vehicle_id") return { data: { vehicle_id: VEHICLE } };
  if (q.table === "balance_adjustments") return adjustmentsError ? { error: adjustmentsError } : { data: [] };
  return { data: [] };
}

function answerInvoke(call: { name: string; body: any }) {
  if (call.name === "apply-payment") return applyOk ? { data: { ok: true } } : { data: { ok: false, error: "allocation failed" } };
  if (call.name === "reverse-payment") return { data: { success: true } };
  if (call.name === "adjust-customer-balance") {
    if (call.body.kind === "off_platform_payment" && !call.body.reverses_id && auditFailures > 0) {
      auditFailures -= 1;
      return { data: { error: "network hiccup" } };
    }
    return { data: { ok: true, kind: call.body.kind, adjustmentId: "adj-1", entryId: "le-1", paymentId: call.body.payment_id ?? null, reversesId: call.body.reverses_id ?? null, signedAmount: 0 } };
  }
  return { data: null };
}

beforeEach(() => {
  h.rec.reset();
  h.rec.onQuery = answerQuery;
  h.rec.onInvoke = answerInvoke;
  h.canEdit = true;
  h.toasts.length = 0;
  h.collect.length = 0;
  duplicate = [];
  balanceRows = [];
  adjustmentsError = null;
  applyOk = true;
  auditFailures = 0;
});

// `any`: two copies of @types/react are installed; QueryClientProvider types its children against the other one.
function wrap(ui: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const RENTAL_OPTION = { id: RENTAL, label: "rental R-1001", vehicleId: VEHICLE, refusal: null };

function openOnRental(extra: Partial<React.ComponentProps<typeof AdjustBalanceDialog>> = {}) {
  return wrap(<AdjustBalanceDialog open onOpenChange={() => {}} customerId={CUSTOMER} rental={RENTAL_OPTION} currency="USD" {...extra} />);
}

const pick = (label: RegExp | string) => fireEvent.click(screen.getByRole("button", { name: label }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const adjustCalls = () => h.rec.invokes.filter((c) => c.name === "adjust-customer-balance");

/* ── (a) a charge was wrong ───────────────────────────────────────────── */

describe("A charge was wrong", () => {
  it("credits one charge: adjust-customer-balance with the charge, its rental and its extension", async () => {
    openOnRental();
    pick(/A charge was wrong/);
    await screen.findByRole("option", { name: /Extension Rental/ });
    type("Which charge?", EXT_CHARGE);
    type("Reason", "wrong_rate");
    type("Amount", "40");
    type("Note", "Weekly rate, not daily");
    pick("Take $40.00 off");
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));
    expect(adjustCalls()[0].body).toEqual({
      customerId: CUSTOMER,
      tenantId: TENANT,
      kind: "charge_correction",
      amount: 40,
      direction: "decrease",
      reason_code: "wrong_rate",
      note: "Weekly rate, not daily",
      charge_id: EXT_CHARGE,
      rentalId: RENTAL,
      extensionId: EXT,
    });
    expect(h.rec.queries.some((q) => q.table === "payments" && q.action === "insert")).toBe(false);
  });

  it("'Charged too little' can only add: the body says increase", async () => {
    openOnRental();
    pick(/A charge was wrong/);
    await screen.findByRole("option", { name: /^Rental/ });
    type("Which charge?", CHARGE);
    type("Reason", "undercharged");
    expect(screen.getByRole("radio", { name: "Take money off" })).toBeDisabled();
    type("Amount", "15");
    type("Note", "Forgot the child seat");
    pick("Add $15.00");
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));
    expect(adjustCalls()[0].body).toMatchObject({ direction: "increase", amount: 15, charge_id: CHARGE, rentalId: RENTAL, extensionId: null });
  });

  it("will not credit more than the charge", async () => {
    openOnRental();
    pick(/A charge was wrong/);
    await screen.findByRole("option", { name: /^Rental/ });
    type("Which charge?", CHARGE);
    type("Reason", "overcharged");
    type("Amount", "500.01");
    type("Note", "x");
    expect(screen.getByRole("button", { name: "Take $500.01 off" })).toBeDisabled();
    expect(screen.getByText("That is more than the charge ($500.00).")).toBeInTheDocument();
  });
});

/* ── (b) money received outside the platform ──────────────────────────── */

async function fillOffPlatform() {
  pick(/I received money outside the platform/);
  type("Reason", "paid_by_transfer");
  type("Amount", "200");
  type("Received on", "2026-09-20");
  type("How was it paid?", "Zelle");
  type("Note", "Zelle from their husband");
}

describe("I received money outside the platform", () => {
  it("is Record Payment's own row with the flag in the same insert, then apply-payment, then the audit", async () => {
    openOnRental();
    await fillOffPlatform();
    pick("Record $200.00 received");
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));

    expect(h.rec.order).toEqual(["select:payments", "insert:payments", "invoke:apply-payment", "invoke:adjust-customer-balance", ...h.rec.order.slice(4)]);
    const insert = h.rec.queries.find((q) => q.table === "payments" && q.action === "insert")!;
    expect(insert.payload).toEqual({
      customer_id: CUSTOMER,
      vehicle_id: VEHICLE,
      rental_id: RENTAL,
      amount: 200,
      payment_date: "2026-09-20",
      method: "Zelle",
      payment_type: "Payment",
      status: "Completed",
      remaining_amount: 200,
      tenant_id: TENANT,
      verification_status: "approved",
      booking_source: "admin",
      is_off_platform: true,
    });
    expect(h.rec.invokes.find((c) => c.name === "apply-payment")!.body).toEqual({ paymentId: PAYMENT });
    expect(adjustCalls()[0].body).toEqual({
      customerId: CUSTOMER,
      tenantId: TENANT,
      kind: "off_platform_payment",
      payment_id: PAYMENT,
      reason_code: "paid_by_transfer",
      note: "Zelle from their husband",
    });
  });

  it("a failed apply-payment is rolled back exactly as Record Payment does, and nothing is audited", async () => {
    applyOk = false;
    openOnRental();
    await fillOffPlatform();
    pick("Record $200.00 received");
    await screen.findByText("allocation failed");
    const deletes = h.rec.queries.filter((q) => q.action === "delete");
    expect(deletes.map((d) => [d.table, d.filters])).toEqual([
      ["ledger_entries", [["eq", "payment_id", PAYMENT], ["eq", "type", "Payment"], ["eq", "tenant_id", TENANT]]],
      ["payments", [["eq", "id", PAYMENT], ["eq", "tenant_id", TENANT]]],
    ]);
    expect(adjustCalls()).toHaveLength(0);
  });

  it("if the note fails to save, the payment stays and 'Save the note again' records it", async () => {
    auditFailures = 1;
    openOnRental();
    await fillOffPlatform();
    pick("Record $200.00 received");
    await screen.findByRole("button", { name: "Save the note again" });
    expect(screen.getByText(/The payment was recorded and applied, but its note was not saved/)).toBeInTheDocument();
    expect(h.rec.queries.filter((q) => q.action === "delete")).toHaveLength(0);
    pick("Save the note again");
    await waitFor(() => expect(adjustCalls()).toHaveLength(2));
    expect(adjustCalls()[1].body).toEqual(adjustCalls()[0].body);
    // one payment, never two
    expect(h.rec.queries.filter((q) => q.table === "payments" && q.action === "insert")).toHaveLength(1);
  });

  it("a likely duplicate waits for a yes before anything is written", async () => {
    duplicate = [{ id: "old", amount: 200, payment_date: "2026-09-18", method: "Cash", status: "Applied" }];
    openOnRental();
    await fillOffPlatform();
    pick("Record $200.00 received");
    await screen.findByText("This may be a duplicate.");
    expect(h.rec.queries.some((q) => q.action === "insert")).toBe(false);
    pick("Yes, record it");
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));
    expect(h.rec.queries.filter((q) => q.action === "insert")).toHaveLength(1);
  });

  it("held on the account (customer scope): no rental, apply-payment holds it as credit, as Collect Payment does", async () => {
    wrap(
      <AdjustBalanceDialog
        open
        onOpenChange={() => {}}
        customerId={CUSTOMER}
        rentals={[{ id: RENTAL, label: "R-1001 · Corolla" }]}
        currency="USD"
      />,
    );
    pick(/I received money outside the platform/);
    type("Which rental was it for?", "__account__");
    type("Reason", "paid_in_person");
    type("Amount", "75.50");
    type("Note", "Cash at the desk");
    pick("Record $75.50 received");
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));
    const insert = h.rec.queries.find((q) => q.action === "insert")!;
    expect(insert.payload).toMatchObject({ rental_id: null, vehicle_id: null, amount: 75.5, is_off_platform: true });
    expect(h.rec.invokes.find((c) => c.name === "apply-payment")!.body).toEqual({ paymentId: PAYMENT, holdAsCredit: true });
    expect(h.rec.queries.some((q) => q.table === "rentals")).toBe(false);
  });

  it("customer scope, on a rental: the rental's vehicle is read from the rental", async () => {
    wrap(<AdjustBalanceDialog open onOpenChange={() => {}} customerId={CUSTOMER} rentals={[{ id: RENTAL, label: "R-1001" }]} currency="USD" />);
    pick(/I received money outside the platform/);
    type("Which rental was it for?", RENTAL);
    type("Reason", "paid_in_person");
    type("Amount", "10");
    type("Note", "x");
    pick("Record $10.00 received");
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));
    expect(h.rec.queries.find((q) => q.action === "insert")!.payload).toMatchObject({ rental_id: RENTAL, vehicle_id: VEHICLE });
  });
});

/* ── (c) goodwill ─────────────────────────────────────────────────────── */

describe("Goodwill", () => {
  it("lowers the balance on the chosen rental: adjust-customer-balance, direction decrease", async () => {
    wrap(<AdjustBalanceDialog open onOpenChange={() => {}} customerId={CUSTOMER} rentals={[{ id: RENTAL, label: "R-1001" }]} currency="USD" />);
    pick(/Goodwill or an agreed reduction/);
    type("Where does it go?", RENTAL);
    type("Reason", "late_delivery");
    type("Amount", "30");
    type("Note", "Car was two hours late");
    pick("Lower the balance by $30.00");
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));
    expect(adjustCalls()[0].body).toEqual({
      customerId: CUSTOMER,
      tenantId: TENANT,
      kind: "goodwill",
      amount: 30,
      direction: "decrease",
      reason_code: "late_delivery",
      note: "Car was two hours late",
      rentalId: RENTAL,
    });
  });

  it("on the account by default", async () => {
    wrap(<AdjustBalanceDialog open onOpenChange={() => {}} customerId={CUSTOMER} rentals={[]} currency="USD" />);
    pick(/Goodwill or an agreed reduction/);
    type("Reason", "loyalty");
    type("Amount", "5");
    type("Note", "x");
    pick("Lower the balance by $5.00");
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));
    expect(adjustCalls()[0].body.rentalId).toBeNull();
  });

  it("a rental the balance does not count (day-by-day or cancelled) cannot take a correction or goodwill", () => {
    openOnRental({ rental: { ...RENTAL_OPTION, refusal: "This rental is billed day by day, so its balance comes from the daily bills. Adjust the customer account instead." } });
    expect(screen.getByRole("button", { name: /A charge was wrong/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Goodwill or an agreed reduction/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /I received money outside the platform/ })).toBeEnabled();
  });
});

/* ── undo ─────────────────────────────────────────────────────────────── */

const entry = (over: Partial<AdjustmentEntry>): AdjustmentEntry => ({
  id: "adj-9",
  kind: "goodwill",
  amountCents: -3000,
  reasonCode: "goodwill",
  note: "Nice",
  rentalId: RENTAL,
  extensionId: null,
  ledgerEntryId: "le",
  paymentId: null,
  targetChargeId: null,
  reversesId: null,
  createdBy: "u1",
  createdByName: "Kristen",
  createdAt: "2026-09-20T10:00:00.000Z",
  undoneBy: null,
  paymentStatus: null,
  paymentMethod: null,
  reversedWithoutUndo: false,
  ...over,
});

async function undoFirst() {
  pick(/^Undo /);
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Why undo it?"), { target: { value: "entered_by_mistake" } });
  fireEvent.change(within(dialog).getByLabelText("Note"), { target: { value: "Wrong customer" } });
  fireEvent.click(within(dialog).getByRole("button", { name: /^Undo [−+]/ }));
}

describe("Undo — a reversing entry, never a delete", () => {
  it("goodwill: one adjust-customer-balance call with reverses_id", async () => {
    wrap(<AdjustmentHistory customerId={CUSTOMER} entries={[entry({})]} unrecorded={[]} currency="USD" canEdit />);
    await undoFirst();
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));
    expect(h.rec.invokes.map((c) => c.name)).toEqual(["adjust-customer-balance"]);
    expect(adjustCalls()[0].body).toEqual({ customerId: CUSTOMER, tenantId: TENANT, kind: "goodwill", reverses_id: "adj-9", reason_code: "entered_by_mistake", note: "Wrong customer" });
    expect(h.rec.queries.some((q) => q.action === "delete" || q.action === "update")).toBe(false);
  });

  it("off-platform: the existing reverse-payment first, then the reversing entry", async () => {
    wrap(
      <AdjustmentHistory
        customerId={CUSTOMER}
        entries={[entry({ kind: "off_platform_payment", amountCents: -20000, paymentId: PAYMENT, ledgerEntryId: null, paymentStatus: "Applied", paymentMethod: "Zelle" })]}
        unrecorded={[]}
        currency="USD"
        canEdit
      />,
    );
    await undoFirst();
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));
    expect(h.rec.invokes.map((c) => c.name)).toEqual(["reverse-payment", "adjust-customer-balance"]);
    expect(h.rec.invokes[0].body).toEqual({ paymentId: PAYMENT, reason: "Wrong customer" });
    expect(adjustCalls()[0].body).toMatchObject({ kind: "off_platform_payment", reverses_id: "adj-9" });
  });

  it("off-platform already reversed from Finances: only the entry is recorded", async () => {
    wrap(
      <AdjustmentHistory
        customerId={CUSTOMER}
        entries={[entry({ kind: "off_platform_payment", amountCents: -20000, paymentId: PAYMENT, paymentStatus: "Reversed", reversedWithoutUndo: true })]}
        unrecorded={[]}
        currency="USD"
        canEdit
      />,
    );
    expect(screen.getByText(/The payment was reversed elsewhere/)).toBeInTheDocument();
    pick(/Undo Paid outside the platform/);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Why undo it?"), { target: { value: "customer_disputed" } });
    fireEvent.change(within(dialog).getByLabelText("Note"), { target: { value: "Bounced" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Undo [−+]/ }));
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));
    expect(h.rec.invokes.map((c) => c.name)).toEqual(["adjust-customer-balance"]);
  });

  it("shows who, when and why, and an undone entry offers no second undo", () => {
    wrap(
      <AdjustmentHistory
        customerId={CUSTOMER}
        entries={[
          entry({ id: "u", amountCents: 3000, reversesId: "adj-9", createdByName: "Sam", reasonCode: "wrong_customer", note: "Other Sam" }),
          entry({ undoneBy: { id: "u", at: "2026-09-21T09:00:00.000Z", byName: "Sam" } }),
        ]}
        unrecorded={[]}
        currency="USD"
        canEdit
      />,
    );
    const rows = screen.getAllByTestId("adjustment-entry");
    expect(rows[1]).toHaveTextContent("Kristen");
    expect(rows[1]).toHaveTextContent("Goodwill");
    expect(rows[1]).toHaveTextContent("“Nice”");
    expect(rows[1]).toHaveTextContent("Undone");
    expect(rows[0]).toHaveTextContent("Wrong customer");
    expect(screen.queryByRole("button", { name: /^Undo / })).toBeNull();
  });

  it("a viewer sees the history but no Undo", () => {
    wrap(<AdjustmentHistory customerId={CUSTOMER} entries={[entry({})]} unrecorded={[]} currency="USD" canEdit={false} />);
    expect(screen.getByTestId("adjustment-entry")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull();
  });
});

/* ── Request a payment, and the section around it ─────────────────────── */

describe("Request a payment", () => {
  it("adds the charge with what it is for, then opens the existing Collect Payment dialog for that amount", async () => {
    wrap(<CustomerBalanceSection customerId={CUSTOMER} customerName="Ghulam" rentals={[]} currency="USD" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Request a payment/ })).toBeEnabled());
    pick(/Request a payment/);
    type("Amount", "300");
    type("What it's for", "Parking ticket from 12 Sep");
    pick("Add $300.00 and continue");
    await waitFor(() => expect(adjustCalls()).toHaveLength(1));
    expect(adjustCalls()[0].body).toEqual({
      customerId: CUSTOMER,
      tenantId: TENANT,
      kind: "charge_correction",
      amount: 300,
      direction: "increase",
      reason_code: "payment_request",
      note: "Parking ticket from 12 Sep",
      rentalId: null,
    });
    const collect = await screen.findByTestId("collect-dialog");
    expect(collect).toHaveAttribute("data-amount", "300");
    expect(collect).toHaveAttribute("data-description", "Parking ticket from 12 Sep");
  });

  it("what is already owed can be collected with no new charge: the Collect dialog opens for that amount", async () => {
    balanceRows = [{ type: "Charge", amount: 500, remaining_amount: 120, due_date: "2026-09-01", category: "Rental", rental_id: RENTAL }];
    wrap(<CustomerBalanceSection customerId={CUSTOMER} customerName="Ghulam" rentals={[]} currency="USD" />);
    await screen.findByText("Owes you $120.00");
    pick("Collect $120.00");
    const collect = await screen.findByTestId("collect-dialog");
    expect(collect).toHaveAttribute("data-amount", "120");
    expect(collect.getAttribute("data-description")).toBeNull();
    expect(adjustCalls()).toHaveLength(0);
  });

  it("before the migration is applied, the section says so and offers no change", async () => {
    adjustmentsError = { code: "42P01", message: 'relation "public.balance_adjustments" does not exist' };
    wrap(<CustomerBalanceSection customerId={CUSTOMER} customerName="Ghulam" rentals={[]} currency="USD" />);
    await screen.findByText(/switch on once the database update for them is applied/);
    expect(screen.getByRole("button", { name: /Adjust balance/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Request a payment/ })).toBeDisabled();
  });

  it("a read-only account sees the balance but no actions", async () => {
    h.canEdit = false;
    wrap(<CustomerBalanceSection customerId={CUSTOMER} rentals={[]} currency="USD" />);
    await screen.findByTestId("balance-header");
    expect(screen.queryByRole("button", { name: /Adjust balance/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Request a payment/ })).toBeNull();
  });
});

/* keep `act` referenced for older runners that warn on unused imports */
void act;
