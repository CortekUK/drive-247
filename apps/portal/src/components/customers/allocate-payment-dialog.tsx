"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Banknote, Car, ListTree, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";

interface AllocatePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: { id: string; amount: number; remaining_amount: number } | null;
  customerId: string;
}

type Mode = "account" | "rental" | "item";

const CATEGORY_LABELS: Record<string, string> = {
  Rental: "Rental",
  Tax: "Tax",
  "Service Fee": "Service Fee",
  "Delivery Fee": "Delivery Fee",
  "Collection Fee": "Collection Fee",
  Insurance: "Insurance",
  Extras: "Extras",
  Fines: "Fines",
  Adjustment: "Adjustment",
  Other: "Other",
  "Extension Rental": "Extension · Rental",
  "Extension Tax": "Extension · Tax",
  "Extension Service Fee": "Extension · Service Fee",
  "Extension Insurance": "Extension · Insurance",
};

/**
 * AllocatePaymentDialog — lets staff direct an unapplied payment (a held credit
 * or partially-applied payment) at a target. The allocation engine (apply-payment)
 * does the real work; we just set where the money should land:
 *   - account → clear rental/category → FIFO across all the customer's open charges
 *   - rental  → restrict to one rental's charges
 *   - item    → restrict to one charge line (category) on one rental
 */
export const AllocatePaymentDialog = ({ open, onOpenChange, payment, customerId }: AllocatePaymentDialogProps) => {
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>("account");
  const [rentalId, setRentalId] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const currencyCode = tenant?.currency_code || "USD";

  useEffect(() => {
    if (!open) {
      setMode("account");
      setRentalId("");
      setCategory("");
      setLoading(false);
      inFlight.current = false;
    }
  }, [open]);

  // The customer's rentals (for rental / item targeting).
  const { data: rentals } = useQuery({
    queryKey: ["allocate-rentals", tenant?.id, customerId],
    queryFn: async () => {
      let q = supabase
        .from("rentals")
        .select("id, status, vehicles!rentals_vehicle_id_fkey(reg, make, model)")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false });
      if (tenant?.id) q = q.eq("tenant_id", tenant.id);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!customerId,
  });

  // Outstanding charge categories on the selected rental (for item targeting).
  const { data: categories } = useQuery({
    queryKey: ["allocate-categories", tenant?.id, rentalId],
    queryFn: async () => {
      let q = supabase
        .from("ledger_entries")
        .select("category, remaining_amount")
        .eq("rental_id", rentalId)
        .eq("type", "Charge")
        .gt("remaining_amount", 0);
      if (tenant?.id) q = q.eq("tenant_id", tenant.id);
      const { data, error } = await q;
      if (error) throw error;
      const totals: Record<string, number> = {};
      (data || []).forEach((e: any) => {
        totals[e.category] = (totals[e.category] || 0) + Number(e.remaining_amount || 0);
      });
      return Object.entries(totals).map(([cat, total]) => ({ category: cat, total }));
    },
    enabled: open && mode === "item" && !!rentalId,
  });

  const canSubmit =
    !loading &&
    !!payment &&
    (mode === "account" || (mode === "rental" && !!rentalId) || (mode === "item" && !!rentalId && !!category));

  const handleSubmit = async () => {
    if (inFlight.current || !canSubmit || !payment) return;
    inFlight.current = true;
    setLoading(true);
    try {
      // 1. Point the payment row at the chosen target. apply-payment reads
      //    rental_id + target_categories off the payment, so this is how we
      //    steer the allocation without changing the engine.
      const targetRentalId = mode === "account" ? null : rentalId;
      const targetCategories = mode === "item" ? [category] : null;

      const { error: updateError } = await supabase
        .from("payments")
        .update({ rental_id: targetRentalId, target_categories: targetCategories })
        .eq("id", payment.id);
      if (updateError) throw new Error(updateError.message);

      // 2. Run allocation. The payment already has a ledger entry (it's a held
      //    credit / partial), so apply-payment resumes via its re-entry path.
      const body: any = { paymentId: payment.id };
      if (targetCategories) body.targetCategories = targetCategories;
      const { data, error } = await supabase.functions.invoke("apply-payment", { body });
      if (error) throw new Error(error.message || "Allocation failed");
      if (!data?.ok) throw new Error(data?.error || data?.detail || "Allocation failed");

      logAction({
        action: "payment_allocated",
        entityType: "payment",
        entityId: payment.id,
        details: { mode, rental_id: targetRentalId, category, allocated: data?.allocated, remaining: data?.remaining },
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer-payments"], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["customer-balance"], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["customer-balance-status"], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["customers-list"], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["customer-balances-enhanced"], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["ledger-entries"], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["rental-charges-payments"], refetchType: "all" }),
      ]);

      const allocated = Number(data?.allocated || 0);
      const remaining = Number(data?.remaining || 0);
      toast({
        title: "Payment allocated",
        description: remaining > 0.005
          ? `Applied ${formatCurrency(allocated, currencyCode)}; ${formatCurrency(remaining, currencyCode)} left as credit.`
          : `Applied ${formatCurrency(allocated, currencyCode)}.`,
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to allocate payment.", variant: "destructive" });
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  };

  const remaining = payment?.remaining_amount ?? 0;

  const modeButton = (m: Mode, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-xs font-medium transition-colors",
        mode === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Allocate Payment</DialogTitle>
          <DialogDescription>
            {formatCurrency(remaining, currencyCode)} of this payment is unallocated. Choose where it should be applied.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-3 gap-2">
            {modeButton("account", <Banknote className="h-4 w-4" />, "Whole account")}
            {modeButton("rental", <Car className="h-4 w-4" />, "A rental")}
            {modeButton("item", <ListTree className="h-4 w-4" />, "A line item")}
          </div>

          {mode === "account" && (
            <p className="text-xs text-muted-foreground">
              Applies to the customer&apos;s open charges, oldest due date first.
            </p>
          )}

          {(mode === "rental" || mode === "item") && (
            <div className="space-y-1.5">
              <Label>Rental</Label>
              <Select value={rentalId} onValueChange={(v) => { setRentalId(v); setCategory(""); }}>
                <SelectTrigger><SelectValue placeholder="Select rental" /></SelectTrigger>
                <SelectContent>
                  {(rentals || []).map((r: any) => {
                    const v = r.vehicles;
                    const label = v ? (v.make && v.model ? `${v.make} ${v.model} (${v.reg})` : v.reg) : "Rental";
                    return (
                      <SelectItem key={r.id} value={r.id}>
                        {label} · {r.status}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === "item" && rentalId && (
            <div className="space-y-1.5">
              <Label>Charge line</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Select charge line" /></SelectTrigger>
                <SelectContent>
                  {(categories || []).length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No open charges on this rental</div>
                  ) : (
                    (categories || []).map((c) => (
                      <SelectItem key={c.category} value={c.category}>
                        {CATEGORY_LABELS[c.category] || c.category} — {formatCurrency(c.total, currencyCode)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Allocating...</> : "Allocate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
