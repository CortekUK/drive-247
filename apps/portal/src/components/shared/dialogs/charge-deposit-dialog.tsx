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
  /**
   * rentals.deposit_hold_expires_at. Drives the expiry copy in both phases.
   * The dialog used to state a flat "about 7 days" — but the real window
   * depends on the account (extended authorization can reach 30 days) and,
   * more importantly, the operator needs the actual date, not a rule of thumb.
   */
  holdExpiresAt?: string | null;
  onSuccess?: () => void;
}

// Local to this dialog: the rental page has its own copy for the breakdown row.
// Not worth a shared module for two call sites with different phrasing needs.
const formatHoldExpiry = (expiresAt: string | null | undefined) => {
  if (!expiresAt) return null;
  const ts = new Date(expiresAt);
  if (Number.isNaN(ts.getTime())) return null;
  const dateLabel = ts.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const msLeft = ts.getTime() - Date.now();
  if (msLeft <= 0) return { lapsed: true, urgent: true, dateLabel, remaining: null as string | null };
  const hoursLeft = Math.floor(msLeft / 3_600_000);
  const daysLeft = Math.floor(hoursLeft / 24);
  const remaining =
    daysLeft >= 1
      ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
      : hoursLeft >= 1
        ? `${hoursLeft} hour${hoursLeft === 1 ? "" : "s"} left`
        : "under an hour left";
  // 3 days matches the warning window used on the rental page's deposit row.
  return { lapsed: false, urgent: daysLeft < 3, dateLabel, remaining };
};

export const ChargeDepositDialog = ({
  open,
  onOpenChange,
  rentalId,
  holdAmount,
  holdStatus,
  holdExpiresAt,
  onSuccess,
}: ChargeDepositDialogProps) => {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Set the moment a refresh succeeds. onRefresh does not (and should not)
  // await the parent's refetch before flipping to the charge phase, so for a
  // beat `holdExpiresAt` is still the OLD, lapsed timestamp — long enough to
  // render "this authorisation lapsed … the capture will likely be declined"
  // in red underneath a green "Hold refreshed" toast, over an authorisation
  // that was just placed successfully. Suppress the stale line until a fresher
  // prop arrives.
  const [justRefreshed, setJustRefreshed] = useState(false);

  // Two phases: "refresh" (hold expired — re-place it first) and "charge"
  // (hold is live — capture it). We seed the phase from holdStatus on open, and
  // can flip to "refresh" mid-flight if a charge discovers the auth is dead.
  const [phase, setPhase] = useState<"refresh" | "charge">("charge");

  const currency = tenant?.currency_code || "USD";
  const expiry = formatHoldExpiry(holdExpiresAt);

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
      setJustRefreshed(false);
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
      setJustRefreshed(true);
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
        // Whatever we placed a moment ago is gone too — stop suppressing the
        // expiry line on the strength of that refresh.
        setJustRefreshed(false);
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
          // ── Step 1: explain that the authorisation lapsed, and offer Refresh ──
          <div className="space-y-4 pt-2">
            <Alert className="border-amber-500/60 bg-amber-500/10">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="space-y-1.5 pl-1">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                  This pre-authorization hold has expired.
                </p>
                <p className="text-xs leading-relaxed text-amber-900/85 dark:text-amber-100/85">
                  {/* This used to read "Stripe card holds only last about 7 days".
                      That number is not ours to quote — the window depends on the
                      card and the account (extended authorization reaches 30 days),
                      and an operator handling a 90-day rental needs the actual date
                      this authorisation died, not a rule of thumb. */}
                  {/* Only quote the date when it has actually passed. A hold can
                      also die early (the bank pulls it, or it's cancelled), in
                      which case deposit_hold_expires_at is still in the future
                      and naming it would just confuse the operator. */}
                  {expiry?.lapsed ? (
                    <>
                      The authorisation on the customer&apos;s card lapsed on{" "}
                      <strong>{expiry.dateLabel}</strong>. Card authorisations are temporary — once one
                      expires the bank releases the money back to the customer, so the old hold can no
                      longer be charged.
                    </>
                  ) : (
                    <>
                      Card authorisations are temporary. Once one lapses — or the bank releases it early
                      — the money goes back to the customer, so the old hold can no longer be charged.
                    </>
                  )}
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

              {/* When this authorisation dies. An operator charging a long rental
                  deserves to know they're working against a clock — and if the
                  date is already past, that the capture is likely to fail. */}
              {justRefreshed ? (
                // We just placed a fresh hold; holdExpiresAt hasn't caught up yet.
                // Anything derived from it right now describes the authorisation we
                // REPLACED, so say what we actually know instead.
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  A fresh authorisation was just placed — its expiry date will appear once the rental
                  refreshes.
                </p>
              ) : expiry && (
                <p
                  className={`flex items-start gap-1.5 text-xs ${
                    expiry.lapsed ? "text-red-500 font-medium" : expiry.urgent ? "text-amber-500 font-medium" : "text-muted-foreground"
                  }`}
                >
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {expiry.lapsed
                    ? `This authorisation lapsed on ${expiry.dateLabel} — the capture will likely be declined. Check with Stripe from the rental page if you're unsure.`
                    : `Authorisation expires ${expiry.dateLabel} · ${expiry.remaining}`}
                </p>
              )}

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
