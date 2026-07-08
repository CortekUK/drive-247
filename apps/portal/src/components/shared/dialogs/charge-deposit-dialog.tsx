import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, AlertCircle, Clock, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";

interface ChargeDepositDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  holdAmount: number;
  /**
   * Current deposit_hold_status on the rental. When "expired" the dialog opens
   * straight into the two-step Refresh → Charge flow (a dead Stripe auth can't
   * be captured; a fresh hold must be placed first).
   */
  holdStatus?: string | null;
  onSuccess?: () => void;
}

export const ChargeDepositDialog = ({
  open,
  onOpenChange,
  rentalId,
  holdAmount,
  holdStatus,
  onSuccess,
}: ChargeDepositDialogProps) => {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Two phases: "refresh" (hold expired — re-place it first) and "charge"
  // (hold is live — capture it). We seed the phase from holdStatus on open, and
  // can flip to "refresh" mid-flight if a charge discovers the auth is dead.
  const [phase, setPhase] = useState<"refresh" | "charge">("charge");

  const currency = tenant?.currency_code || "USD";

  // Partial captures are temporarily disabled until Stripe approves
  // multicapture for the platform's Connect accounts. Without multicapture,
  // a partial capture would release the uncaptured remainder back to the
  // customer (Stripe's default for single-capture PaymentIntents) and we'd
  // have to spin up a fresh authorisation for the remainder — which the
  // customer sees as the original hold dropping off and a new hold appearing
  // on their card. To avoid that surprise, the dialog locks to a FULL hold
  // capture for now. Re-enable the amount input once multicapture is granted.
  const schema = z.object({
    reason: z.string().min(1, "Reason is required"),
  });

  type FormData = z.infer<typeof schema>;

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { reason: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset({ reason: "" });
      setPhase(holdStatus === "expired" ? "refresh" : "charge");
    }
  }, [open, holdStatus, form]);

  const invalidateRentalQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["rental", rentalId] });
    queryClient.invalidateQueries({ queryKey: ["rental-totals"] });
    queryClient.invalidateQueries({ queryKey: ["rental-payment-breakdown"] });
    queryClient.invalidateQueries({ queryKey: ["rental-charges"] });
    queryClient.invalidateQueries({ queryKey: ["payments-data"] });
  };

  // Step 1 (only when expired): place a fresh hold on the saved card.
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("place-deposit-hold", {
        // manualOverride: this dialog is a deliberate staff action, allowed on
        // manually-extended rentals (auto-extend rentals are still refused
        // server-side regardless of this flag).
        body: { rentalId, tenantId: tenant?.id, manualOverride: true },
      });
      if (error) {
        let detail = error.message;
        try {
          const body = await error.context?.json?.();
          if (body?.error) detail = body.error;
        } catch {
          /* ignore parse errors */
        }
        throw new Error(detail);
      }
      if (data?.skipped) {
        throw new Error(data.message || "Could not place a hold (deposit may be disabled or zero).");
      }

      invalidateRentalQueries();
      toast({
        title: "Hold refreshed",
        description: `A fresh ${formatCurrency(holdAmount, currency)} hold is on the customer's saved card. You can charge it now.`,
      });
      setPhase("charge");
    } catch (err: any) {
      toast({
        title: "Couldn't refresh the hold",
        description: err.message || "The saved card may have been declined. Try a manual payment instead.",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  // Step 2: capture the live hold.
  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("capture-deposit-hold", {
        body: {
          rentalId,
          tenantId: tenant?.id,
          amount: holdAmount,
          reason: data.reason,
        },
      });
      if (error) throw new Error(error.message || "Capture failed");

      // The hold died between opening the dialog and charging (e.g. it expired
      // moments ago). The function self-healed and tells us to refresh first.
      if (result?.code === "hold_expired") {
        invalidateRentalQueries();
        setPhase("refresh");
        toast({
          title: "Hold expired",
          description: "This hold just expired. Refresh it to place a new one, then charge.",
          variant: "destructive",
        });
        return;
      }
      if (result?.success === false) {
        throw new Error(result.error || "Capture failed");
      }

      invalidateRentalQueries();
      toast({
        title: "Hold charged",
        description: `Charged ${formatCurrency(holdAmount, currency)}. Hold fully captured.`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast({
        title: "Failed to charge hold",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || refreshing;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
              {phase === "refresh" ? (
                <Clock className="h-4 w-4 text-amber-500" />
              ) : (
                <Shield className="h-4 w-4 text-amber-500" />
              )}
            </div>
            <div>
              <DialogTitle>{phase === "refresh" ? "Refresh Pre-Auth Hold" : "Charge Pre-Auth Hold"}</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                {phase === "refresh"
                  ? "This hold expired — place a fresh one first"
                  : `Capture from the ${formatCurrency(holdAmount, currency)} hold`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {phase === "refresh" ? (
          // ── Step 1: explain the Stripe 7-day boundary and offer Refresh ──
          <div className="space-y-4 pt-2">
            <Alert className="border-amber-500/60 bg-amber-500/10">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="space-y-1.5 pl-1">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                  This pre-authorization hold has expired.
                </p>
                <p className="text-xs leading-relaxed text-amber-900/85 dark:text-amber-100/85">
                  Stripe card holds only last about <strong>7 days</strong>. After that the bank
                  automatically releases the money back to the customer, so the old hold can no longer
                  be charged.
                  <br />
                  <br />
                  To take this deposit, <strong>refresh the hold</strong> — we&apos;ll place a fresh{" "}
                  {formatCurrency(holdAmount, currency)} hold on the customer&apos;s saved card. Once it&apos;s
                  back, you can charge it.
                </p>
              </AlertDescription>
            </Alert>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" onClick={onRefresh} disabled={busy}>
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing…" : "Refresh hold"}
              </Button>
            </div>
          </div>
        ) : (
          // ── Step 2: capture the live hold ──
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
              {/* Loud, up-front notice that partial captures are temporarily off.
                  Goes ABOVE the amount + reason so the operator reads it before
                  anything else and there's no surprise after they click charge. */}
              <Alert className="border-amber-500/60 bg-amber-500/10">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="space-y-1.5 pl-1">
                  <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                    Partial pre-auth charging is not available right now.
                  </p>
                  <p className="text-xs leading-relaxed text-amber-900/85 dark:text-amber-100/85">
                    Charging this hold will capture the <strong>full {formatCurrency(holdAmount, currency)}</strong>.
                    <br />
                    <strong>Coming soon:</strong> we&apos;re enabling partial charges as soon as Stripe approves
                    the <em>multicapture</em> feature for your account — you&apos;ll then be able to charge any
                    amount and keep the rest on hold automatically.
                  </p>
                </AlertDescription>
              </Alert>

              {/* Full-hold capture only — see comment block above the schema for
                  why. Showing the amount as static text instead of an input makes
                  it impossible to accidentally submit a partial value. */}
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Amount to charge</span>
                <span className="text-base font-semibold">{formatCurrency(holdAmount, currency)}</span>
              </div>

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        placeholder="e.g. damage to rear bumper, excess mileage, cleaning fee"
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {submitting ? "Charging…" : `Charge ${formatCurrency(holdAmount, currency)}`}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};
