import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { Shield, CreditCard, Mail, AlertCircle, RefreshCw, CheckCircle2 } from "lucide-react";
import { formatCurrency } from "@/lib/format-utils";
import { extractFunctionError } from "@/lib/edge-error";

interface AddHoldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  customerEmail?: string | null;
  onSuccess?: () => void;
}

// create-hold-checkout returns machine skip codes; show operators plain English.
const HOLD_SKIP_MESSAGES: Record<string, string> = {
  auto_extend_rental:
    "This is an auto-extension rental — deposits are never held on these (the renewal price replaces the deposit).",
  // Legacy code from before the guard was narrowed (Jul 2026); kept for safety.
  auto_extend_or_extended_rental:
    "This is an auto-extension rental — deposits are never held on these (the renewal price replaces the deposit).",
  // This one used to be a flat dead end. A Stripe authorisation lapses after
  // ~5-7 days and nothing tells us, so this rental can read 'held' over an
  // authorisation the bank already released (GMT, Aug 2026 — "I cannot refresh
  // the hold"). The operator gets a Check with Stripe button next to it.
  hold_already_active:
    "This rental is recorded as already holding a deposit. If that authorisation has since expired or been released, Stripe knows — we don't, until we ask.",
  deposit_disabled_for_tenant: "Security deposits are disabled in your settings.",
  deposit_amount_is_zero: "The deposit amount is 0 — set a deposit amount in settings or on the rental first.",
};
const describeHoldSkip = (code: string): string => HOLD_SKIP_MESSAGES[code] || `Hold not placed (${code}).`;

// ── Reading verify-deposit-hold's answer ────────────────────────────────────
// The function answers with { verified, liveHold, status, changed, needsReview?,
// message }. Only ONE of its shapes means "you may now authorise this card
// again", and it is not simply "liveHold is not true":
//
//   • requires_action / requires_confirmation / processing at Stripe -> it
//     returns liveHold:false with NO needsReview, because no funds are held
//     YET. The authorisation is still in flight; a second one double-holds
//     the customer.
//   • workerOwnsRow (the row is 'processing'/'refreshing' because
//     place-deposit-hold or the refresh cron is mid-flight on it) -> it writes
//     nothing but still carries the DEAD_HOLD_MESSAGES copy, which literally
//     says "Place a new hold to re-authorise the deposit". Following that
//     advice while a worker is authorising is the double-hold we are trying to
//     avoid — create-hold-checkout only guards on 'held', not on those two.
//   • the lost-race report -> liveHold:false with whatever status the row now
//     carries.
//
// So we invert the test: resolved ONLY when Stripe was consulted conclusively
// (verified) AND reported no live authorisation AND the resulting status is one
// of the three terminal-dead values. Everything else — including a malformed or
// truncated response — keeps the door shut. Failing closed costs the operator
// one more click; failing open costs the renter a second hold on their card.
type VerifyOutcome = "resolved" | "live" | "in_progress" | "needs_review";

// Mirrors PI_STATUS_TO_HOLD_STATUS in supabase/functions/verify-deposit-hold:
// canceled -> expired, succeeded -> captured, requires_payment_method -> failed.
const CONCLUSIVELY_DEAD = ["expired", "captured", "failed"];

const classifyVerify = (data: any): VerifyOutcome => {
  if (data?.verified !== true || data?.needsReview === true) return "needs_review";
  // `!== false` (not `=== true`): a missing/renamed field must read as "live".
  if (data?.liveHold !== false) return "live";
  return CONCLUSIVELY_DEAD.includes(String(data?.status)) ? "resolved" : "in_progress";
};

// Deliberately NOT the server's message for this class — see above, its copy can
// tell the operator to place a new hold while one is still being authorised.
const describeInProgress = (status: unknown): string =>
  `This deposit hold is still being worked on${status ? ` (currently ${status})` : ""} — either the card is still authorising or another update is finishing it off. Nothing was changed. Wait a moment and check again rather than placing a second hold.`;

export const AddHoldDialog = ({
  open,
  onOpenChange,
  rentalId,
  customerEmail,
  onSuccess,
}: AddHoldDialogProps) => {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [stripeLoading, setStripeLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  // Set when create-hold-checkout refuses because the rental still claims a
  // live hold. Rather than closing the door, we surface the reconcile action.
  const [holdConflict, setHoldConflict] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  // true when the reconcile left us no better off — either the authorisation is
  // genuinely live, or Stripe couldn't be read and a human has to look.
  const [verifyUnresolved, setVerifyUnresolved] = useState(false);

  const currency = tenant?.currency_code || "USD";
  const holdAmount = Number(tenant?.global_deposit_amount) || 0;
  const busy = stripeLoading || emailLoading || verifying;

  // Reset the conflict panel each time the dialog opens — a stale "already
  // active" warning from a previous visit would be worse than none at all.
  useEffect(() => {
    if (open) {
      setHoldConflict(false);
      setVerifyMessage(null);
      setVerifyUnresolved(false);
    }
  }, [open]);

  // Ask Stripe what the existing authorisation is really doing and write the
  // answer back. If it turns out to be dead, the guard that blocked us clears
  // and the operator can place a fresh hold without leaving this dialog.
  const handleVerify = async () => {
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-deposit-hold", {
        body: { rentalId },
      });
      if (error) throw new Error(await extractFunctionError(error, "Could not check the hold with Stripe."));

      queryClient.invalidateQueries({ queryKey: ["rental", rentalId] });

      const outcome = classifyVerify(data);
      setVerifyUnresolved(outcome !== "resolved");
      setVerifyMessage(
        outcome === "resolved"
          ? data?.message || "Stripe has no live authorisation on this rental — you can place a new hold."
          : outcome === "live"
            ? data?.message || "Stripe still has a live authorisation on this rental."
            : outcome === "needs_review"
              ? data?.message ||
                "We couldn't confirm this hold with Stripe, so nothing was changed. Check the rental in Stripe before placing another hold."
              : describeInProgress(data?.status)
      );

      // ONLY a conclusively dead authorisation reopens the placement options.
      // Anything else — live, mid-authorisation, worker-owned, unreadable —
      // leaves them shut, because the alternative is authorising the card twice.
      if (outcome === "resolved") setHoldConflict(false);
    } catch (err: any) {
      // The check itself failed (function not deployed, Stripe unreachable, 5xx).
      // Do NOT leave the operator with two greyed-out buttons and no way out —
      // that is the same dead end this panel exists to remove. Re-enable them
      // and say why: create-hold-checkout runs its own liveness probe and, when
      // that probe can't be completed, treats the hold as ALIVE and refuses. So
      // the worst case here is a second refusal with a fresher message, never a
      // second authorisation.
      setHoldConflict(false);
      setVerifyUnresolved(true);
      setVerifyMessage(
        `We couldn't reach Stripe to check this hold${err?.message ? ` (${err.message})` : ""}. You can still try to place a hold — if the authorisation is genuinely still live, the request will be refused again.`
      );
      toast({
        title: "Could not check with Stripe",
        description: err.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setVerifying(false);
    }
  };

  // Derive the booking app's origin from the portal origin so local dev hits
  // the local booking app, not production.
  //   test.portal.localhost:3001  -> test.localhost:3000
  //   test.portal.drive-247.com   -> test.drive-247.com
  const getBookingOrigin = (): string => {
    if (typeof window === "undefined") return "";
    const host = window.location.host.replace(".portal.", ".").replace(":3001", ":3000");
    return `${window.location.protocol}//${host}`;
  };

  const handlePlaceViaStripe = async () => {
    setStripeLoading(true);
    try {
      const portalOrigin = window.location.origin;
      const { data, error } = await supabase.functions.invoke("create-hold-checkout", {
        body: {
          rentalId,
          successUrl: `${portalOrigin}/rentals/${rentalId}?hold=placed&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${portalOrigin}/rentals/${rentalId}?hold=cancelled`,
        },
      });
      if (error) throw new Error(error.message || "Failed to create hold checkout");
      if (data?.skipped) {
        // "Already active" is resolvable in-place — show the reconcile panel
        // instead of a toast that vanishes and leaves the operator stuck.
        if (data.skipped === "hold_already_active") {
          setHoldConflict(true);
          setVerifyMessage(null);
          setVerifyUnresolved(false);
          return;
        }
        toast({ title: "Hold not placed", description: describeHoldSkip(data.skipped), variant: "destructive" });
        return;
      }
      if (!data?.url) throw new Error("No checkout URL returned");

      window.open(data.url, "_blank");
      toast({
        title: "Checkout opened",
        description: "Hold will be placed when the customer completes authorisation.",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed", variant: "destructive" });
    } finally {
      setStripeLoading(false);
    }
  };

  const handleSendEmail = async () => {
    if (!customerEmail) {
      toast({ title: "No email", description: "Customer has no email on file.", variant: "destructive" });
      return;
    }
    setEmailLoading(true);
    try {
      const bookingOrigin = getBookingOrigin();
      // Step 1: Create hold-only checkout session
      const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke("create-hold-checkout", {
        body: {
          rentalId,
          successUrl: `${bookingOrigin}/booking-success?type=hold&status=placed&rental_id=${rentalId}&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${bookingOrigin}/booking-cancelled?rental_id=${rentalId}`,
        },
      });
      if (checkoutError) throw new Error(checkoutError.message || "Failed to create hold session");
      if (checkoutData?.skipped) {
        if (checkoutData.skipped === "hold_already_active") {
          setHoldConflict(true);
          setVerifyMessage(null);
          setVerifyUnresolved(false);
          return;
        }
        toast({ title: "Hold not created", description: describeHoldSkip(checkoutData.skipped), variant: "destructive" });
        return;
      }
      if (!checkoutData?.url) throw new Error("No checkout URL returned");

      // Step 2: Email the link (reuse existing invoice email function with overrides)
      const { error: emailError } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          rentalId,
          tenantId: tenant?.id,
          recipientEmail: customerEmail,
          paymentUrl: checkoutData.url,
          overrideAmount: holdAmount,
          overrideDescription: `Security deposit authorisation (hold only — not a charge)`,
        },
      });
      if (emailError) throw new Error(emailError.message || "Failed to send email");

      toast({
        title: "Hold link sent",
        description: `Emailed ${customerEmail}. The hold will appear once the customer completes authorisation.`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed", variant: "destructive" });
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
              <Shield className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <DialogTitle>Place Pre-Auth Hold</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                {formatCurrency(holdAmount, currency)} will be authorised on the customer's card — not captured.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* The dead end, made walkable. create-hold-checkout refused because the
            rental still reads as holding a deposit — but that flag can be stale
            (an expired Stripe authorisation never reports back to us), which is
            exactly the state GMT got stuck in. Offer the reconcile right here. */}
        {holdConflict && (
          <Alert className="border-amber-500/60 bg-amber-500/10">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="space-y-2 pl-1">
              <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                A deposit hold is already recorded on this rental.
              </p>
              <p className="text-xs leading-relaxed text-amber-900/85 dark:text-amber-100/85">
                {HOLD_SKIP_MESSAGES.hold_already_active} Check with Stripe to bring this rental up to
                date — if the authorisation is gone, you&apos;ll be able to place a new one straight away.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleVerify}
                disabled={busy}
                className="mt-1"
              >
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${verifying ? "animate-spin" : ""}`} />
                {verifying ? "Checking…" : "Check with Stripe"}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Outcome of the reconcile. Rendered outside the conflict panel because
            a dead authorisation clears that panel but the operator still needs
            to be told what happened. */}
        {verifyMessage && (
          <div
            className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed ${
              verifyUnresolved
                ? "border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-100"
                : "border-emerald-500/40 bg-emerald-500/5 text-emerald-900 dark:text-emerald-100"
            }`}
          >
            {verifyUnresolved ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
            <span>{verifyMessage}</span>
          </div>
        )}

        <div className="grid gap-3 pt-2">
          <button
            type="button"
            disabled={busy || holdConflict}
            onClick={handlePlaceViaStripe}
            className="group flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="mt-0.5 h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
              <CreditCard className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {stripeLoading ? "Opening…" : "Place via Stripe"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Opens Stripe Checkout in a new tab. Use this if the customer is with you.
              </div>
            </div>
          </button>

          <button
            type="button"
            disabled={busy || holdConflict || !customerEmail}
            onClick={handleSendEmail}
            className="group flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="mt-0.5 h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
              <Mail className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">
                {emailLoading ? "Sending…" : "Send email link"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {customerEmail
                  ? `Emails ${customerEmail} with a hold link. Customer authorises at their convenience.`
                  : "Customer has no email on file."}
              </div>
            </div>
          </button>
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
