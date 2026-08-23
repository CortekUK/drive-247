"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTenantSubscription } from "@/hooks/use-tenant-subscription";

/**
 * Confirms a subscription the operator did not start from inside the portal.
 *
 * When a tenant subscribes through the portal they get a success toast on the
 * `?status=success` return. A tenant who paid through a sales link never passes
 * through that return at all — they pay on a page they were sent, then log in
 * some time later and are simply... not blocked. Nothing anywhere tells them the
 * payment landed, so the only confirmation they have is the absence of a
 * paywall, which is a poor thing to ask someone to infer after handing over money.
 *
 * Deliberately NOT a gate: it is dismissible, blocks nothing, and never appears
 * for a tenant who has no live subscription.
 *
 * Acknowledgement lives in localStorage keyed by the Stripe subscription id, so
 * it shows once per browser and never re-fires for a different subscription's
 * key. That is a per-device record rather than an account-wide one, chosen
 * deliberately: the alternative writes to `tenant_subscriptions`, which is the
 * row the whole billing invariant rests on, and a reassurance dialog is not
 * worth a write path into it. Seeing it once more on a second device is a
 * harmless outcome; corrupting billing state is not.
 *
 * The RECENT window stops an old subscription greeting someone months later on
 * a new laptop.
 */
const ACK_PREFIX = "d247.subActivated.";
const RECENT_DAYS = 7;

export function SubscriptionActivatedDialog() {
  const { subscription, isSubscribed, isResolved } = useTenantSubscription();
  const [open, setOpen] = useState(false);

  const subId = subscription?.stripe_subscription_id ?? null;

  useEffect(() => {
    if (!isResolved || !isSubscribed || !subId) return;

    // Only greet a subscription that actually started recently.
    const startedAt = subscription?.current_period_start || subscription?.created_at;
    if (startedAt) {
      const ageMs = Date.now() - new Date(startedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs > RECENT_DAYS * 24 * 60 * 60 * 1000) return;
    }

    try {
      if (window.localStorage.getItem(`${ACK_PREFIX}${subId}`)) return;
    } catch {
      // Private mode or blocked storage: show it. A duplicate reassurance beats
      // silently swallowing the only confirmation they get.
    }
    setOpen(true);
  }, [isResolved, isSubscribed, subId, subscription?.current_period_start, subscription?.created_at]);

  const acknowledge = () => {
    try {
      if (subId) window.localStorage.setItem(`${ACK_PREFIX}${subId}`, new Date().toISOString());
    } catch {
      /* storage unavailable — the dialog simply shows again next time */
    }
    setOpen(false);
  };

  if (!subscription) return null;

  const amount = (() => {
    const minor = Number(subscription.amount ?? 0);
    const currency = (subscription.currency || "usd").toUpperCase();
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
    } catch {
      return `${(minor / 100).toFixed(2)} ${currency}`;
    }
  })();

  const renews = subscription.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString(undefined, {
        day: "numeric", month: "long", year: "numeric",
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) acknowledge(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <DialogTitle>Your subscription is active</DialogTitle>
          <DialogDescription>
            Your payment went through and your account is fully set up. There&rsquo;s nothing else you need to do.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Plan</span>
            <span className="font-medium">{subscription.plan_name || "Subscription"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-medium">
              {amount} / {subscription.interval || "month"}
            </span>
          </div>
          {renews && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Renews</span>
              <span className="font-medium">{renews}</span>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Your receipt has been emailed to you. You can review invoices and payment details any time
          under Settings &rsaquo; Subscription.
        </p>

        <DialogFooter>
          <Button onClick={acknowledge} className="w-full sm:w-auto">
            Get started
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
