"use client";

/**
 * Every money action a Finances row offers, and the dialogs they open — ONE
 * copy, shared by the Finances page and `ScopedFinances` (a rental's or a
 * customer's own Finances), so the two can never offer different things.
 *
 * SAFETY: no new money path. Each action opens a dialog or calls a hook that
 * another screen already uses — AddPaymentDialog, RefundDialog, the Payments
 * tab's approve / reject / remove-link / reverse, the payment plan's own
 * actions, the fines tab's row actions (`useFineRowActions`) and
 * AddFineDialog, the Invoices tab's Send and Delete dialogs. Lifted out of
 * `finances-view.tsx` unchanged.
 *
 *   const refresh = useFinancesRefresh();
 *   const fineActions = useFineRowActions({ onChanged: refresh });
 *   const act = useFinanceActions({ currency, receipts, fineActions });
 *   …act.onReceiptAction(row, "refund")…
 *   return <>{page}{act.dialogs}<FinePaymentDialog actions={fineActions} /></>;
 *
 * The HOST runs the fines tab's row actions (`useFineRowActions`) and mounts
 * their one payment window, exactly as `fines/page.tsx` does, and hands them
 * in — so each screen has one copy of the fine hook, never two.
 */

import { useCallback, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { RefundDialog } from "@/components/shared/dialogs/refund-dialog";
import { SendInvoiceEmailDialog } from "@/components/invoices/send-invoice-email-dialog";
import { DeleteInvoiceDialog } from "@/components/invoices/delete-invoice-dialog";
import AddFineDialog from "@/components/fines/add-fine-dialog";
import type { useFineRowActions } from "@/components/fines/use-fine-row-actions";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { usePaymentVerificationActions } from "@/hooks/use-payment-verification";
import { useToast } from "@/hooks/use-toast";
import type { EnhancedFine } from "@/hooks/use-fines-data";
import { supabase } from "@/integrations/supabase/client";
import type { BillInvoice, BillRow, ReceiptRow } from "@/lib/finances/types";
import {
  FINANCES_QUERY_KEY,
  RejectPaymentDialog,
  RemoveLinkDialog,
  ReversePaymentDialog,
  type DialogPayment,
} from "./finance-dialogs";
import { PlanActionHost, type PlanActionRequest } from "./plan-actions";
import { refundCategoryOf } from "./finance-rules";
import type { ReceiptAction } from "./received-table";

/** Where money is taken from: the portal's own payment window, aimed at a bill or not. */
export type CollectTarget = { bill: BillRow | null };

export const toDialogPayment = (r: ReceiptRow): DialogPayment => ({
  paymentId: r.paymentId,
  customerName: r.customerName,
  amountCents: r.amountCents,
});

/** Which `invoices` row an action is for: by id when the model has it, else by rental and number. */
export interface InvoiceRef {
  id: string | null;
  rentalId: string;
  number: string | null;
}

/** The invoice a bill action means: the one chosen in the panel, else the bill's newest. */
export function invoiceRefOf(bill: BillRow, invoice?: BillInvoice | null): InvoiceRef {
  if (invoice) return { id: invoice.id || null, rentalId: invoice.rentalId ?? bill.rentalId, number: invoice.number };
  return { id: bill.invoiceId ?? null, rentalId: bill.rentalId, number: bill.invoiceNumber };
}

/** The Invoices tab's list select, so its Send and Delete dialogs get the row they expect. */
export const INVOICE_DIALOG_SELECT =
  "*, customers:customer_id (name, email, phone), vehicles:vehicle_id (reg, make, model), rentals:rental_id (start_date, end_date, monthly_amount)";

/** Everything Finances reads is under `["finances"]`: refresh it after any money action. */
export function useFinancesRefresh(): () => void {
  const qc = useQueryClient();
  return useCallback(() => void qc.invalidateQueries({ queryKey: FINANCES_QUERY_KEY }), [qc]);
}

export interface FinanceActionsOptions {
  currency: string;
  /** The fines tab's row actions, run by the host (`useFineRowActions({ onChanged: refresh })`). */
  fineActions: ReturnType<typeof useFineRowActions>;
  /** Every receipt in view (the unfiltered model's, when there is one), to name a payment in a dialog. */
  receipts: ReceiptRow[];
  /** What Add fine starts from (a rental's or a customer's own Finances). */
  addFinePreset?: { customerId?: string; rentalId?: string; vehicleId?: string };
}

export function useFinanceActions({ currency, receipts, fineActions, addFinePreset }: FinanceActionsOptions) {
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();

  /* ── who may do what ─────────────────────────────────────────────────── */

  const mayPayments = canEdit("payments");
  // The plan's actions run through payment-plan-manage, which asks for rentals.
  const mayPlans = mayPayments && canEdit("rentals");
  const mayInvoices = canEdit("invoices");
  const mayFines = canEdit("fines");

  /* ── dialog state ────────────────────────────────────────────────────── */

  const [collect, setCollect] = useState<CollectTarget | null>(null);
  const [refund, setRefund] = useState<ReceiptRow | null>(null);
  const [reject, setReject] = useState<DialogPayment | null>(null);
  const [removeLink, setRemoveLink] = useState<DialogPayment | null>(null);
  const [reverse, setReverse] = useState<DialogPayment | null>(null);
  const [planRequest, setPlanRequest] = useState<PlanActionRequest | null>(null);
  const [addFine, setAddFine] = useState(false);
  const [invoiceToEmail, setInvoiceToEmail] = useState<any | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<any | null>(null);

  const { approvePayment, isLoading: verifying } = usePaymentVerificationActions();
  const refresh = useFinancesRefresh();

  // The fines tab's own Record Payment and Waive Fine, from the host's one
  // copy of `useFineRowActions`.
  const recordFinePayment = (fine: EnhancedFine) => void fineActions.openPaymentDialog(fine);
  const waiveFine = (fine: EnhancedFine) => fineActions.waiveFineAction.mutate(fine.id);

  const approve = (paymentId: string) => approvePayment.mutate(paymentId, { onSuccess: refresh });

  const onReceiptAction = (row: ReceiptRow, action: ReceiptAction) => {
    switch (action) {
      case "approve":
        return approve(row.paymentId);
      case "reject":
        return setReject(toDialogPayment(row));
      case "refund":
        return setRefund(row);
      case "remove_link":
        return setRemoveLink(toDialogPayment(row));
      case "reverse":
        return setReverse(toDialogPayment(row));
    }
  };

  const findReceipt = (paymentId: string) => receipts.find((r) => r.paymentId === paymentId) ?? null;

  /** Reject from Needs attention, naming the payment when it is in view. */
  const rejectById = (paymentId: string) => {
    const r = findReceipt(paymentId);
    setReject(r ? toDialogPayment(r) : { paymentId, customerName: "the customer", amountCents: 0 });
  };

  /**
   * One `invoices` row, read exactly as the Invoices tab reads its list (the
   * same select), so its Send and Delete dialogs get the row they expect. By
   * id when the model has it; else by rental and number.
   */
  const readInvoice = async (ref: InvoiceRef): Promise<any | null> => {
    if (!tenant?.id || (!ref.id && !ref.number)) return null;
    let q = supabase
      .from("invoices" as any)
      .select(INVOICE_DIALOG_SELECT)
      .eq("tenant_id", tenant.id);
    q = ref.id ? q.eq("id", ref.id) : q.eq("rental_id", ref.rentalId).eq("invoice_number", ref.number);
    const { data, error } = await q.maybeSingle();
    if (error || !data) {
      toast({ title: "Couldn't open that invoice", description: error?.message ?? "It could not be found.", variant: "destructive" });
      return null;
    }
    return data;
  };

  const emailInvoice = async (bill: BillRow, invoice?: BillInvoice) => {
    const row = await readInvoice(invoiceRefOf(bill, invoice));
    if (row) setInvoiceToEmail(row);
  };

  const deleteInvoice = async (bill: BillRow, invoice?: BillInvoice) => {
    const row = await readInvoice(invoiceRefOf(bill, invoice));
    if (row) setInvoiceToDelete(row);
  };

  const dialogs: ReactNode = (
    <>
      {collect && (
        <AddPaymentDialog
          open
          onOpenChange={(open) => !open && setCollect(null)}
          customer_id={collect.bill?.customerId || undefined}
          rental_id={collect.bill?.rentalId || undefined}
          extensionId={collect.bill?.extensionId ?? undefined}
          defaultAmount={collect.bill ? collect.bill.balanceCents / 100 : undefined}
          onPaymentSuccess={refresh}
        />
      )}
      {refund && refund.rentalId && (
        <RefundDialog
          open
          onOpenChange={(open) => !open && setRefund(null)}
          rentalId={refund.rentalId}
          paymentId={refund.paymentId}
          extensionId={refund.extensionId ?? undefined}
          category={refundCategoryOf(refund)}
          totalAmount={refund.amountCents / 100}
          paidAmount={(refund.amountCents - refund.refundedCents) / 100}
          onSuccess={refresh}
        />
      )}
      <RejectPaymentDialog payment={reject} onOpenChange={(open) => !open && setReject(null)} />
      <RemoveLinkDialog payment={removeLink} currency={currency} onOpenChange={(open) => !open && setRemoveLink(null)} />
      <ReversePaymentDialog payment={reverse} currency={currency} onOpenChange={(open) => !open && setReverse(null)} />
      <PlanActionHost request={planRequest} onClose={() => setPlanRequest(null)} />
      {mayFines && (
        <AddFineDialog
          open={addFine}
          onOpenChange={setAddFine}
          preselectedCustomerId={addFinePreset?.customerId}
          preselectedRentalId={addFinePreset?.rentalId}
          preselectedVehicleId={addFinePreset?.vehicleId}
        />
      )}
      <SendInvoiceEmailDialog
        open={!!invoiceToEmail}
        onOpenChange={(open) => !open && setInvoiceToEmail(null)}
        invoice={invoiceToEmail}
      />
      {/* The Invoices tab's own delete, wired as that tab wires it. */}
      <DeleteInvoiceDialog
        open={!!invoiceToDelete}
        onOpenChange={(open) => !open && setInvoiceToDelete(null)}
        invoice={invoiceToDelete}
        onDeleted={refresh}
      />
    </>
  );

  return {
    may: { payments: mayPayments, plans: mayPlans, invoices: mayInvoices, fines: mayFines },
    verifying,
    refresh,
    finesBusy: fineActions.waiveFineAction.isPending,
    recordFinePayment,
    waiveFine,
    approve,
    rejectById,
    onReceiptAction,
    collect: (bill: BillRow | null) => setCollect({ bill }),
    planFix: (request: PlanActionRequest) => setPlanRequest(request),
    addFine: () => setAddFine(true),
    emailInvoice,
    deleteInvoice,
    dialogs,
  };
}

export type FinanceActions = ReturnType<typeof useFinanceActions>;
