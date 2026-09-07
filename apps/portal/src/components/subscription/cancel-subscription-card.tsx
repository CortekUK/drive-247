"use client";

/**
 * "Need to cancel? Contact support."
 *
 * ── what this deliberately is not ───────────────────────────────────────────
 *
 * It is not a Cancel Subscription button. A one-click cancel on a billing page
 * ends a business relationship with no conversation, usually over something a
 * person could have fixed in five minutes. Nothing here touches Stripe.
 *
 * ── and not a dead end either ───────────────────────────────────────────────
 *
 * "Contact support" as a mailto: or a phone number is the thing this replaces.
 * Submitting files a real request that lands in the super admin's queue AND
 * emails the team, and the card then SHOWS the operator that their request is
 * open — with the date — so they are never left wondering whether it was heard.
 *
 * Quiet by design: this sits at the bottom of Billing in muted type, because a
 * prominent red panel is an invitation, and the page's job is the plan, the
 * credits and the invoices above it.
 */

import { useState } from "react";
import { Clock, LifeBuoy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Textarea } from "@/components/ui-v2/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui-v2/dialog";
import { useCancellationRequest } from "@/hooks/use-cancellation-request";
import { toast } from "sonner";

const SUPPORT_EMAIL = "support@drive-247.com";

export function CancelSubscriptionCard() {
  const { pending, hasPending, isLoading, submit } = useCancellationRequest();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  /* Nothing at all until the query has answered. A card that says "no request
     open" and then flips to "request received" reads as a bug. */
  if (isLoading) return null;

  if (hasPending && pending) {
    return (
      <div className="flex items-start gap-3 rounded-2xl bg-muted/40 px-5 py-4">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Cancellation request received</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Sent{" "}
            {new Date(pending.created_at).toLocaleDateString(undefined, {
              day: "numeric", month: "long", year: "numeric",
            })}
            . Someone from the team will be in touch. Your subscription is unchanged in the
            meantime — billing continues as normal until we have spoken.
          </p>
        </div>
      </div>
    );
  }

  const handleSubmit = () => {
    submit.mutate(
      { reason },
      {
        onSuccess: () => {
          setOpen(false);
          setReason("");
          toast.success("Cancellation request sent", {
            description: "The team has been notified and will be in touch.",
          });
        },
        /* Never silent. The insert is the request; if it did not land, saying
           so is the only honest option — the alternative is an operator who
           believes they have cancelled and has not. */
        onError: (error: Error) => {
          toast.error("Could not send your request", {
            description: `${error.message}. You can also email ${SUPPORT_EMAIL}.`,
          });
        },
      },
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/30 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Need to cancel?</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Talk to us first — there is usually something we can do.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2 rounded-full"
          onClick={() => setOpen(true)}
        >
          <LifeBuoy className="h-3.5 w-3.5" />
          Contact support
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Request cancellation</DialogTitle>
            <DialogDescription>
              This sends a message to the Drive247 team. Nothing is cancelled now — your
              subscription and your data are untouched until somebody has spoken to you.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="cancel-reason" className="text-[13px] font-medium">
              What is prompting this? <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Too expensive, missing a feature, closing the business…"
              className="min-h-[110px] resize-y rounded-2xl"
              maxLength={2000}
            />
            <p className="text-[11px] text-muted-foreground">
              It helps us answer usefully rather than with a form letter.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submit.isPending}>
              Never mind
            </Button>
            <Button onClick={handleSubmit} disabled={submit.isPending} className="gap-2">
              {submit.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
