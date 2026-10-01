"use client";

/**
 * The invoice sheet's own actions: Edit and Cancel / Restore. (Delete reuses
 * components/invoices/delete-invoice-dialog.tsx, wired by the table.)
 *
 * EDIT changes only what an invoice really owns: its issue date, due date and
 * notes. Its money is the sum of its charges, so amounts are not edited here.
 *
 * CANCEL marks the invoice `cancelled` — nothing is collected on it, and it
 * reads Cancelled everywhere (the struck-through sum in the table). RESTORE
 * puts it back to `paid` or `pending`, whichever its charges say.
 *
 * Every write is filtered by `tenant_id` as well as the id (V2_PLAN §5: RLS is
 * off on `invoices`), and every change is audit-logged as `invoice_updated`.
 */

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";
import { Textarea } from "@/components/ui-v2/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";
import type { FinanceInvoice } from "./finance-data";
import { DateField } from "./date-field";

/** After any change: the invoice list (and so the sheet, which reads from it) refetches. */
function useInvalidateInvoices() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
    queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
  };
}

export function EditInvoiceDialog({
  invoice,
  open,
  onOpenChange,
}: {
  invoice: FinanceInvoice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const { logAction } = useAuditLog();
  const invalidate = useInvalidateInvoices();
  const [issued, setIssued] = useState("");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");

  // Fresh from the invoice every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setIssued(invoice.invoice_date?.slice(0, 10) ?? "");
    setDue(invoice.due_date?.slice(0, 10) ?? "");
    setNotes(invoice.notes ?? "");
  }, [open, invoice]);

  const save = useMutation({
    mutationFn: async () => {
      if (!tenant?.id) throw new Error("No tenant");
      if (!issued) throw new Error("An invoice needs an issue date.");
      const { error } = await supabase
        .from("invoices")
        .update({ invoice_date: issued, due_date: due || null, notes: notes.trim() || null })
        .eq("id", invoice.id)
        .eq("tenant_id", tenant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      logAction({
        action: "invoice_updated",
        entityType: "invoice",
        entityId: invoice.id,
        details: { invoice_number: invoice.invoice_number, change: "edited", invoice_date: issued, due_date: due || null },
      });
      invalidate();
      toast({ title: "Invoice updated", description: `${invoice.invoice_number} has been saved.` });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Couldn't save the invoice", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {invoice.invoice_number}</DialogTitle>
          <DialogDescription>
            The amounts come from the invoice&apos;s charges, so only its dates and notes change here.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="inv-issued">Issued</Label>
              <DateField ariaLabel="Issued" value={issued} onChange={setIssued} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inv-due">Due</Label>
              <DateField ariaLabel="Due" value={due} onChange={setDue} min={issued} clearable placeholder="No due date" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="inv-notes">Notes</Label>
            <Textarea id="inv-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !issued}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelInvoiceDialog({
  invoice,
  owes,
  open,
  onOpenChange,
}: {
  invoice: FinanceInvoice;
  /** What is still owed — decides what a restored invoice goes back to. */
  owes: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const { logAction } = useAuditLog();
  const invalidate = useInvalidateInvoices();
  const cancelled = invoice.status === "cancelled";
  const next = cancelled ? (owes > 0.005 ? "pending" : "paid") : "cancelled";

  const run = useMutation({
    mutationFn: async () => {
      if (!tenant?.id) throw new Error("No tenant");
      const { error } = await supabase
        .from("invoices")
        .update({ status: next })
        .eq("id", invoice.id)
        .eq("tenant_id", tenant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      logAction({
        action: "invoice_updated",
        entityType: "invoice",
        entityId: invoice.id,
        details: { invoice_number: invoice.invoice_number, change: cancelled ? "restored" : "cancelled", status: next },
      });
      invalidate();
      toast({
        title: cancelled ? "Invoice restored" : "Invoice cancelled",
        description: cancelled
          ? `${invoice.invoice_number} is active again.`
          : `${invoice.invoice_number} is cancelled. Nothing will be collected on it.`,
      });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: cancelled ? "Couldn't restore the invoice" : "Couldn't cancel the invoice", description: e.message, variant: "destructive" }),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{cancelled ? `Restore ${invoice.invoice_number}?` : `Cancel ${invoice.invoice_number}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {cancelled
              ? "The invoice becomes active again, and anything still owed on it is due."
              : "The invoice stays on record but nothing will be collected on it. Payments already made are not refunded. You can restore it later."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep as is</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              run.mutate();
            }}
            disabled={run.isPending}
          >
            {run.isPending ? "Saving…" : cancelled ? "Restore invoice" : "Cancel invoice"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
