import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { CurrencyInput } from "@/components/shared/forms/currency-input";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Pencil, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";

interface TakeDepositDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  customerId?: string | null;
  vehicleId?: string | null;
  tenantId?: string | null;
  /** Tenant's configured deposit, used to pre-fill. May be 0. */
  defaultAmount: number;
  currencyCode?: string;
  currencySymbol?: string;
  /** Called once the Security Deposit charge exists, with the agreed amount. */
  onReady: (amount: number) => void;
}

/**
 * TakeDepositDialog — raises a Security Deposit charge on a rental that does not
 * have one yet, so the operator can collect a deposit mid-rental.
 *
 * Why this exists: a payment can only settle against a charge. Taking a deposit
 * payment with no 'Security Deposit' ledger Charge behind it does not "collect a
 * deposit" — FIFO finds nothing to allocate to and the money sits as an
 * unapplied Credit on the customer's account. So the charge is raised FIRST, and
 * only then is the payment dialog opened against it.
 *
 * The amount is deliberately awkward to change: it is pre-filled from the
 * tenant's configured deposit and read-only until the operator explicitly asks
 * to edit and confirms. The failure this guards against is typing 20 when you
 * meant 100 — cheap to prevent here, expensive to discover at vehicle return.
 */
export function TakeDepositDialog({
  open,
  onOpenChange,
  rentalId,
  customerId,
  vehicleId,
  tenantId,
  defaultAmount,
  currencyCode = "USD",
  currencySymbol = "$",
  onReady,
}: TakeDepositDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState<number | undefined>(defaultAmount > 0 ? defaultAmount : undefined);
  const [unlocked, setUnlocked] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-arm every time the dialog opens: a previous session's unlock must not
  // carry over, or the friction is only ever paid once per page load.
  useEffect(() => {
    if (open) {
      setAmount(defaultAmount > 0 ? defaultAmount : undefined);
      setUnlocked(defaultAmount <= 0); // nothing to protect when there is no default
      setConfirmOpen(false);
      setSaving(false);
    }
  }, [open, defaultAmount]);

  const value = Number(amount) || 0;
  const canContinue = value > 0 && !saving;

  const handleContinue = async () => {
    if (!canContinue) return;
    if (!customerId) {
      toast({
        title: "No customer on this rental",
        description: "A deposit charge has to belong to a customer. Open the rental and set one first.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      // Re-check under the button rather than trusting what the row rendered:
      // another operator (or a tab left open) may have raised the deposit since
      // this page loaded, and a second charge would double the customer's bill.
      const { data: existing, error: readErr } = await supabase
        .from("ledger_entries")
        .select("id, amount, remaining_amount")
        .eq("rental_id", rentalId)
        .eq("type", "Charge")
        .eq("category", "Security Deposit");

      if (readErr) throw readErr;

      if (existing && existing.length > 0) {
        const outstanding = existing.reduce((s, e: any) => s + Number(e.remaining_amount || 0), 0);
        toast({
          title: "Deposit already raised",
          description:
            outstanding > 0
              ? `This rental already has a deposit of ${formatCurrency(outstanding, currencyCode)} outstanding. Collecting that instead.`
              : "This rental already has a deposit charge, and it is fully paid.",
        });
        await queryClient.invalidateQueries({ queryKey: ["rental-payment-breakdown"] });
        onOpenChange(false);
        if (outstanding > 0) onReady(outstanding);
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const { error: insErr } = await supabase.from("ledger_entries").insert({
        customer_id: customerId,
        rental_id: rentalId,
        vehicle_id: vehicleId ?? null,
        tenant_id: tenantId ?? null,
        entry_date: today,
        due_date: today,
        type: "Charge",
        category: "Security Deposit",
        amount: value,
        remaining_amount: value,
      });

      if (insErr) throw insErr;

      // The charge is what every downstream surface reads — breakdown, balance,
      // allocation, refund eligibility. Refresh before handing off so the
      // payment dialog opens against the row that now exists.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rental-payment-breakdown"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-charges"] }),
        queryClient.invalidateQueries({ queryKey: ["rental-totals"] }),
      ]);

      toast({
        title: "Deposit added",
        description: `${formatCurrency(value, currencyCode)} deposit raised on this rental. Take the payment next.`,
      });
      onOpenChange(false);
      onReady(value);
    } catch (e: any) {
      console.error("[TakeDeposit] failed to raise deposit charge:", e);
      toast({
        title: "Couldn't add the deposit",
        description: e?.message || "The deposit charge was not created. Nothing has been charged to the customer.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary shrink-0" />
              Take a deposit
            </DialogTitle>
            <DialogDescription>
              This adds a refundable deposit to the rental. You'll take the payment on the next step.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Label htmlFor="deposit-amount" className="text-sm">Deposit amount</Label>
            <div className="flex items-center gap-2">
              <CurrencyInput
                id="deposit-amount"
                value={amount}
                onChange={setAmount}
                currencySymbol={currencySymbol}
                readOnly={!unlocked}
                disabled={saving}
                className={!unlocked ? "bg-muted cursor-not-allowed" : undefined}
              />
              {!unlocked && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={saving}
                  onClick={() => setConfirmOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit
                </Button>
              )}
            </div>

            {defaultAmount > 0 && !unlocked && (
              <p className="text-xs text-muted-foreground">
                Pre-filled from your deposit settings ({formatCurrency(defaultAmount, currencyCode)}).
              </p>
            )}

            {defaultAmount <= 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  No deposit amount is set in your settings, so enter one for this rental.
                </AlertDescription>
              </Alert>
            )}

            {unlocked && defaultAmount > 0 && value !== defaultAmount && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                This differs from your usual deposit of {formatCurrency(defaultAmount, currencyCode)}.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleContinue} disabled={!canContinue}>
              {saving ? "Adding…" : "Continue to payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change the deposit amount?</AlertDialogTitle>
            <AlertDialogDescription>
              The amount is pre-filled from your deposit settings
              {defaultAmount > 0 ? ` (${formatCurrency(defaultAmount, currencyCode)})` : ""}. Only change it if this
              rental genuinely needs a different deposit — the customer is charged whatever you enter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => setUnlocked(true)}>Yes, edit it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
