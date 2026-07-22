"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useMigrationBlocker } from "@/hooks/use-migration-blocker";
import {
  Check,
  CheckCircle2,
  Circle,
  CreditCard,
  Link2,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";

const BENEFITS = [
  "Customer payments land straight in your own account",
  "Full Stripe Dashboard — every payout and fee visible",
  "You control your payout schedule and bank details",
  "Faster access to your money",
];

/** How long the "You're all set" confirmation lingers before the modal closes. */
const SUCCESS_LINGER_MS = 6000;

interface TaskRowProps {
  title: string;
  done: boolean;
  doneLabel?: string | null;
  actionLabel: string;
  actionIcon: React.ReactNode;
  loading: boolean;
  onAction: () => void;
}

function TaskRow({
  title,
  done,
  doneLabel,
  actionLabel,
  actionIcon,
  loading,
  onAction,
}: TaskRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4",
        done
          ? "border-green-200 bg-green-50/60 dark:border-green-900/50 dark:bg-green-950/20"
          : "border-[#f1f5f9] bg-white dark:border-border dark:bg-card",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 shrink-0">
          {done ? (
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500" />
          ) : (
            <Circle className="h-5 w-5 text-muted-foreground/50" />
          )}
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              "text-sm font-medium leading-snug",
              done
                ? "text-green-800 dark:text-green-300"
                : "text-foreground",
            )}
          >
            {title}
          </p>
          {done && doneLabel ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              <code className="text-[11px]">{doneLabel}</code>
            </p>
          ) : null}
        </div>
      </div>

      {done ? (
        <Badge
          variant="outline"
          className="shrink-0 self-start border-green-300 bg-white text-green-700 dark:border-green-900 dark:bg-transparent dark:text-green-400 sm:self-center"
        >
          <Check className="mr-1 h-3 w-3" aria-hidden="true" /> Connected
        </Badge>
      ) : (
        <Button
          onClick={onAction}
          disabled={loading}
          className="min-h-11 w-full shrink-0 bg-[#6366f1] text-white hover:bg-[#4f46e5] sm:w-auto"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Redirecting…
            </>
          ) : (
            <>
              <span className="mr-2 inline-flex" aria-hidden="true">
                {actionIcon}
              </span>
              {actionLabel}
            </>
          )}
        </Button>
      )}
    </div>
  );
}

/**
 * Operator-facing migration prompt. ONE component, two variants off `state`:
 *
 *   soft — dismissible reminder (X and "Remind me later" both record a dismissal,
 *          which suppresses it for 24h).
 *   hard — full-screen, genuinely inescapable: no close button, `onOpenChange`
 *          is a no-op and Esc / outside-click are both prevented. The only exit
 *          is completing both tasks (the hook then reports `state === 'off'`).
 */
export function MigrationBlockerDialog() {
  const {
    state,
    stripeConnected,
    paymentConfirmed,
    bothComplete,
    connectedAccountId,
    connectStripe,
    confirmPayment,
    dismiss,
    connectingStripe,
    confirmingPayment,
    dismissing,
  } = useMigrationBlocker();

  const isHard = state === "hard";
  const isSoft = state === "soft";

  // If the tasks complete while the modal is open, hold it open briefly on a
  // success screen rather than yanking it away the instant `state` flips off.
  const wasOpenRef = useRef(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (isHard || isSoft) wasOpenRef.current = true;
  }, [isHard, isSoft]);

  useEffect(() => {
    if (bothComplete && wasOpenRef.current) {
      setShowSuccess(true);
      wasOpenRef.current = false;
      const t = setTimeout(() => setShowSuccess(false), SUCCESS_LINGER_MS);
      return () => clearTimeout(t);
    }
  }, [bothComplete]);

  const open = isHard || isSoft || showSuccess;
  if (!open) return null;

  const truncatedAccount = connectedAccountId
    ? connectedAccountId.length > 18
      ? `${connectedAccountId.slice(0, 12)}…${connectedAccountId.slice(-4)}`
      : connectedAccountId
    : null;

  // ── Success ───────────────────────────────────────────────────────────────
  if (showSuccess) {
    return (
      <Dialog open onOpenChange={() => setShowSuccess(false)}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-lg p-6 [&>button:last-child]:hidden">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/40">
              <CheckCircle2
                className="h-7 w-7 text-green-600 dark:text-green-500"
                aria-hidden="true"
              />
            </div>
            <DialogTitle className="text-xl font-medium">
              You&apos;re all set
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-relaxed">
              Your Stripe account is connected and your payment details are
              confirmed.
            </DialogDescription>
            <p className="mt-4 w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
              🎁 100 credits have been added to your balance.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Soft / Hard ───────────────────────────────────────────────────────────
  const body = (
    <>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Stripe now requires rental platforms in our region to settle payments
        through a Stripe account that you own and control directly — rather than
        one managed on your behalf.
      </p>

      <ul className="mt-4 space-y-2.5">
        {BENEFITS.map((b) => (
          <li key={b} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e0e7ff] dark:bg-[#6366f1]/20"
            >
              <Check className="h-3 w-3 text-[#6366f1]" />
            </span>
            <span className="text-sm leading-snug text-foreground/90">{b}</span>
          </li>
        ))}
      </ul>

      <p className="mt-5 rounded-lg border border-[#f1f5f9] bg-[#f8fafc] px-4 py-3 text-sm font-medium text-foreground dark:border-border dark:bg-muted/30">
        {isHard
          ? "This takes about 3 minutes. Complete both steps to restore full access to your dashboard."
          : "Complete both steps below to keep your payments running without interruption."}
      </p>

      <div className="mt-5 space-y-3">
        <TaskRow
          title="Connect your Stripe account"
          done={stripeConnected}
          doneLabel={truncatedAccount}
          actionLabel="Connect with Stripe"
          actionIcon={<Link2 className="h-4 w-4" />}
          loading={connectingStripe}
          onAction={connectStripe}
        />
        <TaskRow
          title="Confirm your payment details"
          done={paymentConfirmed}
          doneLabel={null}
          actionLabel="Confirm details"
          actionIcon={<CreditCard className="h-4 w-4" />}
          loading={confirmingPayment}
          onAction={confirmPayment}
        />
      </div>

      <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium leading-snug text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
        🎁 Complete both and we&apos;ll add 100 free credits to your account — on
        us.
      </p>
    </>
  );

  if (isHard) {
    return (
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            // Full-screen on every breakpoint — this is a hard block, not a modal.
            "left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto rounded-none border-0 p-0 shadow-none sm:rounded-none",
            // No close affordance at all.
            "[&>button:last-child]:hidden",
          )}
        >
          <div className="mx-auto w-full max-w-xl px-5 py-8 sm:px-8 sm:py-14">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-[#e0e7ff] dark:bg-[#6366f1]/20">
              <ShieldAlert
                className="h-6 w-6 text-[#6366f1]"
                aria-hidden="true"
              />
            </div>
            <DialogHeader className="space-y-2 text-left sm:text-left">
              <DialogTitle className="text-2xl font-medium tracking-tight sm:text-3xl">
                Action required
              </DialogTitle>
              <DialogDescription className="text-base">
                Complete your payment setup to continue
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6">{body}</div>

            <p className="mt-8 border-t border-[#f1f5f9] pt-5 text-sm text-muted-foreground dark:border-border">
              Need a hand?{" "}
              <a
                href="mailto:support@drive-247.com"
                className="font-medium text-[#6366f1] underline-offset-4 hover:underline"
              >
                support@drive-247.com
              </a>
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Soft — dismissible.
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-lg p-5 sm:p-6 [&>button:last-child]:hidden">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Remind me later"
          className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#6366f1] focus:ring-offset-2"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <DialogHeader className="space-y-2 pr-8 text-left sm:text-left">
          <DialogTitle className="text-xl font-medium tracking-tight">
            Payment upgrade — action needed
          </DialogTitle>
          <DialogDescription className="sr-only">
            Connect your own Stripe account and confirm your payment details.
          </DialogDescription>
        </DialogHeader>

        {body}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={dismiss}
            disabled={dismissing}
            className="min-h-11 w-full text-muted-foreground sm:w-auto"
          >
            {dismissing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Remind me later
              </>
            ) : (
              "Remind me later"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
