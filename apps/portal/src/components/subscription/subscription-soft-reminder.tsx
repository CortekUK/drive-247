"use client";

import { Button } from "@/components/ui/button";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";
import { useSoftSubscriptionBlock } from "@/hooks/use-soft-subscription-block";
import { useV2 } from "@/lib/v2-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreditCard, Mail, AlertTriangle } from "lucide-react";

/**
 * The SOFT counterpart to `SubscriptionGateDialog`.
 *
 * Same debt, same pay link, opposite posture: this one closes. Esc, the
 * overlay, the corner X and "Remind me later" all dismiss it, and
 * `useSoftSubscriptionBlock` then keeps it away for 24h on this device. The
 * dashboard behind it is fully usable — there is no blur, because nothing here
 * is saying "you cannot work".
 *
 * A separate component rather than a `soft` prop on the gate dialog. That file
 * is built around being inescapable — the preventDefaults, the blur, the
 * unconditional Sign out escape hatch, the dev escape — and every one of those
 * is wrong here. Threading a flag through it would leave the product's most
 * important modal carrying two opposite contracts in one tree.
 *
 * Self-gating: renders nothing unless the tenant is in soft mode AND owes
 * money AND has not dismissed it recently. Mounting it costs a healthy tenant
 * nothing.
 */
export function SubscriptionSoftReminder() {
  const { reminderVisible, dismiss, invoiceUrl } = useSoftSubscriptionBlock();
  const { openInvoice } = useTenantSubscription();

  /* Matches the gate dialog's v2 treatment — see the long note there for why
     the surface is themed but the primitive and its z-index are not. */
  const v2Theme = useV2("theme");
  const v2Surface = v2Theme
    ? " rounded-4xl sm:rounded-4xl border-0 bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/5 dark:ring-foreground/10"
    : "";

  if (!reminderVisible) return null;

  const amount =
    openInvoice && typeof openInvoice.amount_due === "number"
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: (openInvoice.currency || "usd").toUpperCase(),
        }).format(openInvoice.amount_due / 100)
      : null;

  return (
    <Dialog open onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className={`sm:max-w-md${v2Surface}`}>
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
          </div>
          <DialogTitle className="text-xl">Your subscription is unpaid</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {amount ? (
              <>
                You have an outstanding invoice of{" "}
                <span className="font-medium text-foreground">{amount}</span>.
              </>
            ) : (
              <>You have an outstanding subscription invoice.</>
            )}{" "}
            Please settle it to keep your account in good standing.
          </p>
        </DialogHeader>

        <div className="mt-2 flex flex-col gap-3">
          {invoiceUrl ? (
            <Button asChild className="w-full" size="lg">
              <a href={invoiceUrl} target="_blank" rel="noopener noreferrer">
                <CreditCard className="h-4 w-4" />
                Pay your pending invoice
              </a>
            </Button>
          ) : (
            /* No invoice URL synced — never render a dead button; give them a
               human instead. Same rule the hard gate follows. */
            <a
              href="mailto:support@drive-247.com"
              className="mx-auto inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <Mail className="h-4 w-4" />
              Contact support@drive-247.com to settle your invoice
            </a>
          )}

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={dismiss}
          >
            Remind me later
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Your dashboard stays available in the meantime.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
