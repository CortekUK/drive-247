"use client";

import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTenant } from "@/contexts/TenantContext";
import { isLeanTenant } from "@/lib/lean-areas";
import { STRIPE_CONNECT_SETTINGS_PATH } from "@/lib/stripe-connect-status";

interface ConnectStripeRequiredDialogProps {
  open: boolean;
  /**
   * Omit on the /rentals/new route itself, where the dialog IS the page and
   * there is nothing behind it to dismiss back to. Provide it when the dialog
   * is raised from a button, so the operator can return to what they were on.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Route-level escape hatch for the canary tenant. Called when a tenant that
   * MAY dismiss closes the dialog; the route uses it to record the dismissal so
   * the form renders behind it. Without this, closing on the route would leave
   * a blank screen, because the route returns this dialog INSTEAD of the form.
   */
  onDismiss?: () => void;
}

/**
 * Shown to a lean tenant who clicked New Rental without a usable Stripe Connect
 * account. For every tenant but the canary it is a dead end by design — the
 * rental form cannot produce anything chargeable without Connect — so the only
 * forward action is to go and set it up.
 *
 * Raised from every rental-creation entry point AND from the /rentals/new route
 * itself, so typing the URL cannot bypass it.
 *
 * WHO GETS A CLOSE CONTROL
 * ------------------------
 * Only the canary (`northwind`), which will never have a real Connect account
 * because it exists to exercise the flow in Stripe TEST mode. For everybody
 * else there is NO "×" in the DOM at all, and Escape and click-outside are
 * both suppressed — the block is total.
 *
 * Closability is derived HERE, from the tenant, rather than taken as a prop.
 * Three call sites raise this dialog; a prop would let any one of them forget
 * to pass it and quietly hand a paying tenant a way out. Deriving it once means
 * the component cannot be mis-called. `isLeanTenant` fails closed on a null or
 * not-yet-resolved slug, so an unknown tenant gets the hard block — the safe
 * default.
 *
 * This is presentation only. It is NOT an authorisation control: the server
 * still refuses to take payments without a connected account, so dismissing
 * this reaches a form, never a payment.
 */
export function ConnectStripeRequiredDialog({
  open,
  onOpenChange,
  onDismiss,
}: ConnectStripeRequiredDialogProps) {
  const router = useRouter();
  const { tenantSlug } = useTenant();
  const closable = isLeanTenant(tenantSlug);

  /**
   * One funnel for all three dismissal gestures — the "×", Escape and
   * click-outside all reach the Root's onOpenChange. Ignoring the request when
   * `!closable` means the hard block holds even if a close control somehow
   * rendered.
   */
  const handleOpenChange = (next: boolean) => {
    if (next) return;
    if (!closable) return;
    onDismiss?.();
    onOpenChange?.(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        // Not rendered at all for a non-canary tenant, rather than hidden with
        // a utility class: the control must not exist, not merely be invisible.
        showCloseButton={closable}
        // For everyone but the canary there is no page behind the dialog to go
        // back to, so suppress the escape hatches entirely.
        onEscapeKeyDown={(e) => {
          if (!closable) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (!closable) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (!closable) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Connect Stripe to create rentals
          </DialogTitle>
          <DialogDescription>
            You need a connected Stripe account before you can take payments.
            Once Stripe is connected, you can create rentals as normal.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => router.push("/rentals")}>
            Back to rentals
          </Button>
          <Button onClick={() => router.push(STRIPE_CONNECT_SETTINGS_PATH)}>
            Set up Stripe Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConnectStripeRequiredDialog;
