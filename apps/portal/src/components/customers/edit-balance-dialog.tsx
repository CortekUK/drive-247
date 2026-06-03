"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ArrowDownCircle, ArrowUpCircle, Loader2, Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useTenant } from "@/contexts/TenantContext";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency, getCurrencySymbol } from "@/lib/format-utils";

interface EditBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
  /** Current outstanding (positive) or credit balance, for context only. */
  currentOutstanding?: number;
  currentCredit?: number;
}

type Direction = "increase" | "decrease";

/**
 * EditBalanceDialog — adjusts a customer's balance WITHOUT overwriting the
 * (derived) balance number. It posts an auditable Adjustment ledger entry via
 * the `adjust-customer-balance` edge function:
 *   - "Add a charge"  → increases what the customer owes
 *   - "Give credit"   → decreases what the customer owes (credit note / write-off)
 * The live balance recomputes from the ledger, so it stays perfectly in sync.
 */
export const EditBalanceDialog = ({
  open,
  onOpenChange,
  customerId,
  customerName,
  currentOutstanding = 0,
  currentCredit = 0,
}: EditBalanceDialogProps) => {
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();
  const queryClient = useQueryClient();

  const [direction, setDirection] = useState<Direction>("decrease");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const currencyCode = tenant?.currency_code || "USD";
  const currencySymbol = getCurrencySymbol(currencyCode);

  useEffect(() => {
    if (!open) {
      setDirection("decrease");
      setAmount("");
      setReason("");
      setLoading(false);
      inFlight.current = false;
    }
  }, [open]);

  const parsedAmount = parseFloat(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const canSubmit = validAmount && reason.trim().length > 0 && !loading;

  const handleSubmit = async () => {
    if (inFlight.current || !canSubmit) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("adjust-customer-balance", {
        body: {
          customerId,
          tenantId: tenant?.id,
          amount: parsedAmount,
          direction,
          reason: reason.trim(),
        },
      });
      if (error) throw new Error(error.message || "Failed to adjust balance");
      if (!data?.ok) throw new Error(data?.error || "Failed to adjust balance");

      logAction({
        action: "customer_balance_adjusted",
        entityType: "customer",
        entityId: customerId,
        details: { direction, amount: parsedAmount, reason: reason.trim() },
      });

      // Refresh every surface that reads the derived balance.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer-balance"], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["customer-balance-status"], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["customers-list"], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["customer-balances-enhanced"], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["ledger-entries"], refetchType: "all" }),
      ]);

      toast({
        title: "Balance adjusted",
        description: `${direction === "increase" ? "Charged" : "Credited"} ${formatCurrency(parsedAmount, currencyCode)} to ${customerName}.`,
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to adjust balance.", variant: "destructive" });
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Adjust Balance
          </DialogTitle>
          <DialogDescription>
            Post a manual adjustment to {customerName}&apos;s account. This records an
            auditable Adjustment entry — the balance recalculates automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Current balance context */}
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Current</span>
            {currentOutstanding > 0.005 ? (
              <span className="font-medium text-red-600">Owes {formatCurrency(currentOutstanding, currencyCode)}</span>
            ) : currentCredit > 0.005 ? (
              <span className="font-medium text-green-600">In credit {formatCurrency(currentCredit, currencyCode)}</span>
            ) : (
              <span className="font-medium text-muted-foreground">Settled</span>
            )}
          </div>

          {/* Direction toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDirection("decrease")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors",
                direction === "decrease"
                  ? "border-green-600 bg-green-600/10 text-green-700 dark:text-green-400"
                  : "hover:bg-muted text-muted-foreground"
              )}
            >
              <ArrowDownCircle className="h-4 w-4" />
              Give credit
            </button>
            <button
              type="button"
              onClick={() => setDirection("increase")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors",
                direction === "increase"
                  ? "border-red-600 bg-red-600/10 text-red-700 dark:text-red-400"
                  : "hover:bg-muted text-muted-foreground"
              )}
            >
              <ArrowUpCircle className="h-4 w-4" />
              Add a charge
            </button>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            {direction === "decrease"
              ? "Reduces what the customer owes (discount, goodwill, correction)."
              : "Increases what the customer owes (extra fee, correction)."}
          </p>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="adjust-amount">Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">{currencySymbol}</span>
              <Input
                id="adjust-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-7 text-lg font-semibold h-11"
              />
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="adjust-reason">Reason <span className="text-red-500">*</span></Label>
            <Textarea
              id="adjust-reason"
              placeholder="e.g. Goodwill discount for late vehicle delivery"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {loading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
            ) : (
              direction === "increase" ? "Add charge" : "Give credit"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
