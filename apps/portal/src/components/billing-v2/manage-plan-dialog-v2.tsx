"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui-v2/button";
import { Textarea } from "@/components/ui-v2/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-v2/dialog";
import { useCancellationRequest } from "@/hooks/use-cancellation-request";
import { useSubscriptionPlans, type SubscriptionPlan } from "@/hooks/use-subscription-plans";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import { useTraxOptional } from "@/components/trax/trax-provider";
import { formatBillDate, formatMoney } from "@/lib/integration-billing/catalog";

const SUPPORT_EMAIL = "support@drive-247.com";

export type PlanAction = "upgrade" | "cancel";

/**
 * Upgrade plan / Cancel subscription, opened from their own buttons at the top
 * of v2 Billing. Neither changes Stripe from this screen:
 *
 *   - Upgrade: the other plans set up for this tenant, and a way to talk to
 *     us about moving. Plans are per-tenant and switching mid-subscription is
 *     not self-serve (checkout refuses a second subscription), so it goes
 *     through the team.
 *   - Cancel: a cancellation REQUEST to the team (the same request as v1's
 *     "Need to cancel?" card — `go_live_requests`, emailed to the team). Once
 *     one is open it says so, with the date, instead of offering another.
 *
 * "Talk to us" opens the Help panel's support chat when the app has it, and
 * falls back to email.
 */
export function ManagePlanDialogV2({
  open,
  onOpenChange,
  action,
  currentPlanName,
  readOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which one the page's button asked for: Upgrade plan or Cancel subscription. */
  action: PlanAction;
  currentPlanName: string | null;
  readOnly: boolean;
}) {
  const trax = useTraxOptional();
  const contactSupport = (subject: string) => {
    onOpenChange(false);
    if (trax) {
      trax.openSheet();
    } else {
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-7 sm:max-w-[460px]">
        {action === "upgrade" ? (
          <UpgradeView
            currentPlanName={currentPlanName}
            onTalk={(plan) => contactSupport(plan ? `Upgrade to ${plan}` : "Upgrade my plan")}
          />
        ) : (
          <CancelView onClose={() => onOpenChange(false)} readOnly={readOnly} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Placeholder plans for the skeleton: only their shapes are ever seen. */
const SKELETON_PLANS = skeletonRows(2, (f) => ({
  id: f.id,
  name: f.text(1, 2),
  amount: f.int(9900, 29900),
  currency: "usd",
  interval: "month",
  features: skeletonRows(3, (g) => g.text(3, 6)),
})) as unknown as SubscriptionPlan[];

function UpgradeView({
  currentPlanName,
  onTalk,
}: {
  currentPlanName: string | null;
  onTalk: (planName: string | null) => void;
}) {
  const { data: loadedPlans, isLoading: plansLoading } = useSubscriptionPlans();
  const isLoading = useSkeletonLoading(plansLoading);
  // While loading, the real list renders placeholder plans under <AutoSkeleton>.
  const plans = isLoading ? SKELETON_PLANS : loadedPlans;
  const current = (currentPlanName ?? "").toLowerCase();
  const others = (plans ?? []).filter((p) => p.name.toLowerCase() !== current);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Upgrade plan</DialogTitle>
        <DialogDescription>
          Plans are set up for your business by the Drive247 team. Pick one and we&apos;ll move you over, with the change
          applied from your next bill.
        </DialogDescription>
      </DialogHeader>

      {!isLoading && others.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          There are no other plans set up for your account yet. Tell us what you need and we&apos;ll put one together.
        </p>
      ) : (
        <AutoSkeleton loading={isLoading}>
        <ul className="divide-y divide-border/60">
          {others.map((p) => (
            <li key={p.id} className="py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(p.amount, p.currency)} / {p.interval === "year" ? "year" : "month"}
                  </p>
                </div>
                <Button size="sm" variant="outline" className="h-8 shrink-0 rounded-lg" onClick={() => onTalk(p.name)}>
                  Choose
                </Button>
              </div>
              {p.features?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {p.features.slice(0, 4).map((f) => (
                    <li key={f} className="text-xs text-muted-foreground">
                      {f}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        </AutoSkeleton>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={() => onTalk(null)} className="gap-2">
          Talk to us instead
        </Button>
      </DialogFooter>
    </>
  );
}

function CancelView({ onClose, readOnly }: { onClose: () => void; readOnly: boolean }) {
  const { pending, hasPending, isLoading: requestLoading, submit } = useCancellationRequest();
  const isLoading = useSkeletonLoading(requestLoading);
  const [reason, setReason] = useState("");

  const send = () => {
    submit.mutate(
      { reason },
      {
        onSuccess: () => {
          setReason("");
          onClose();
          toast.success("Cancellation request sent", { description: "The team has been notified and will be in touch." });
        },
        // Never silent: an operator must not believe they have cancelled when they have not.
        onError: (error: Error) => {
          toast.error("Could not send your request", { description: `${error.message}. You can also email ${SUPPORT_EMAIL}.` });
        },
      },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Cancel subscription</DialogTitle>
        <DialogDescription>
          This sends a message to the Drive247 team. Nothing is cancelled now — your subscription and your data are
          untouched until somebody has spoken to you.
        </DialogDescription>
      </DialogHeader>

      {/* While loading, the form (the usual answer) is its own skeleton. */}
      {!isLoading && hasPending && pending ? (
        <div className="rounded-xl bg-muted/50 px-4 py-3">
          <p className="text-sm">
            Request sent {formatBillDate(pending.created_at)}. Someone from the team will be in touch; billing continues as
            normal until then.
          </p>
        </div>
      ) : (
        <AutoSkeleton loading={isLoading} className="flex flex-col gap-4">
          <div className="space-y-2">
            <label htmlFor="cancel-reason-v2" className="text-[13px] font-medium">
              What is prompting this? <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id="cancel-reason-v2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Too expensive, missing a feature, closing the business…"
              className="min-h-[100px] resize-y rounded-xl"
              maxLength={2000}
              disabled={readOnly}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={onClose} disabled={submit.isPending}>
              Never mind
            </Button>
            <Button onClick={send} disabled={readOnly || submit.isPending} className="gap-2">
              {submit.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Contact support
            </Button>
          </DialogFooter>
        </AutoSkeleton>
      )}
    </>
  );
}
