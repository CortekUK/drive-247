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
 * else there is NO "×" in the DOM at all, NO "Skip for now" button, and Escape
 * and click-outside are both suppressed — the block is total.
 *
 * The canary gets a LABELLED skip as well as the "×". They do the same thing,
 * and the duplication is the point: the "×" is a dismiss affordance, not an
 * invitation, so an operator testing the flow reads the dialog as a dead end
 * and turns back. A button that says what it does is the discoverable half.
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
        // Wider than the `max-w-md` default (28rem). At that width the title
        // wrapped to two lines, the description to three, and the three footer
        // buttons had no room between them — the whole thing read as cramped.
        className="p-7 sm:max-w-[34rem] sm:p-8"
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
        {/* The icon sits on its own tile above the title rather than inline
            beside it. Inline, it competed with the first word for the start of
            the reading line and pushed the title into an early wrap in a narrow
            dialog; stacked, the title gets the full width and the eye lands on
            the sentence rather than on a glyph. */}
        <DialogHeader className="space-y-0">
          <div className="mb-5 flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <CreditCard className="size-5" />
          </div>
          <DialogTitle className="text-[22px] font-semibold leading-[1.25] tracking-[-0.01em]">
            Connect Stripe to create rentals
          </DialogTitle>
          {/* `pr-8` keeps the second line clear of the close "×", which is
              absolutely positioned in the top-right corner of the content. */}
          <DialogDescription className="pr-8 pt-2.5 text-[14px] leading-relaxed">
            You need a connected Stripe account before you can take payments.
            Once Stripe is connected, you can create rentals as normal.
          </DialogDescription>
        </DialogHeader>
        {/* Three actions of near-equal weight in one narrow row is what made
            this read as cluttered: the eye had to compare "Skip for now
            (testing)", "Back to rentals" and "Set up Stripe Connect" before it
            could find the one that matters.

            `sm:items-center` + a real gap replaces the primitive's `space-x-2`,
            and the skip stays pushed to the far left via its own `sm:mr-auto`
            — so the two decisions ("go set it up" / "go back") sit together on
            the right and the testing-only escape hatch is visibly apart from
            them rather than lined up as a third peer. */}
        <DialogFooter className="mt-8 gap-2.5 sm:items-center sm:gap-3 sm:space-x-0">
          {/*
            Canary-only, and rendered conditionally rather than disabled: for a
            paying tenant the button must not EXIST, so there is nothing to
            re-enable from devtools and nothing to mis-read as an option.

            It routes through `handleOpenChange` rather than calling `onDismiss`
            directly, so it inherits the `!closable` refusal there too. That is
            belt and braces — if this conditional were ever loosened by mistake,
            the handler still declines and the block holds.

            Same funnel as the "×", so on /rentals/new it records the dismissal
            that flips `blocked` false and lets the form render behind. Skipping
            reaches a FORM, never a payment: the server still refuses to charge
            without a connected account.
          */}
          {closable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground sm:mr-auto"
              onClick={() => handleOpenChange(false)}
            >
              Skip for now (testing)
            </Button>
          )}
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
