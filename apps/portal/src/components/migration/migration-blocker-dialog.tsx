"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMigrationBlocker } from "@/hooks/use-migration-blocker";
import {
  Check,
  CheckCircle2,
  CreditCard,
  Link2,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";

const BENEFITS = [
  "Payments land straight in your own account",
  "Full Stripe Dashboard — payouts and fees visible",
  "You control your payout schedule and bank details",
  "Faster access to your money",
];

/** How long the "You're all set" confirmation lingers before the modal closes. */
const SUCCESS_LINGER_MS = 6000;

/**
 * Everything here is deliberately light-mode only (no `dark:` variants and
 * explicit colours rather than theme tokens): this prompt must look identical
 * and friendly for every operator regardless of their theme.
 */

interface TaskCardProps {
  step: number;
  title: string;
  done: boolean;
  doneLabel?: string | null;
  actionLabel: string;
  icon: React.ReactNode;
  loading: boolean;
  onAction: () => void;
}

function TaskCard({
  step,
  title,
  done,
  doneLabel,
  actionLabel,
  icon,
  loading,
  onAction,
}: TaskCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border p-4 transition-colors",
        done ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-white",
      )}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            done ? "bg-emerald-500 text-white" : "bg-indigo-100 text-indigo-600",
          )}
        >
          {done ? <Check className="h-4 w-4" /> : step}
        </span>
        <p
          className={cn(
            "text-sm font-semibold leading-snug",
            done ? "text-emerald-900" : "text-slate-900",
          )}
        >
          {title}
        </p>
      </div>

      {done ? (
        <p className="mt-auto flex min-h-[2.75rem] items-center text-xs font-medium text-emerald-700">
          <CheckCircle2 className="mr-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{doneLabel ? doneLabel : "All done"}</span>
        </p>
      ) : (
        <Button
          onClick={onAction}
          disabled={loading}
          className="mt-auto min-h-11 w-full rounded-xl bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Redirecting…
            </>
          ) : (
            <>
              <span className="mr-2 inline-flex" aria-hidden="true">
                {icon}
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
 *   soft — dismissible (X and "Remind me later" both record a dismissal, which
 *          suppresses it for 24h).
 *   hard — genuinely inescapable: no close button, `onOpenChange` is a no-op and
 *          Esc / outside-click are prevented. The only exit is completing both
 *          tasks (the hook then reports `state === 'off'`).
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
    ? connectedAccountId.length > 20
      ? `${connectedAccountId.slice(0, 14)}…${connectedAccountId.slice(-4)}`
      : connectedAccountId
    : null;

  // ── Success ───────────────────────────────────────────────────────────────
  if (showSuccess) {
    return (
      <Dialog open onOpenChange={() => setShowSuccess(false)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-3xl border-slate-200 !bg-white p-7 text-slate-900 [&>button:last-child]:hidden">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" />
            </div>
            <DialogTitle className="text-xl font-semibold text-slate-900">
              You&apos;re all set 🎉
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-relaxed text-slate-600">
              Your Stripe account is connected and your payment details are confirmed.
            </DialogDescription>
            <p className="mt-5 w-full rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              🎁 100 credits have been added to your balance.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Shared card body (fits without scrolling) ─────────────────────────────
  const card = (
    <>
      {/* Friendly header */}
      <div className="flex items-start gap-3.5 pr-10">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-sm"
        >
          <Sparkles className="h-5 w-5 text-white" />
        </span>
        <div className="min-w-0">
          <DialogTitle className="text-lg font-semibold leading-tight tracking-tight text-slate-900 sm:text-xl">
            {isHard ? "Action required" : "Payment upgrade — action needed"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-slate-500">
            {isHard
              ? "Complete your payment setup to continue"
              : "Takes about 3 minutes"}
          </DialogDescription>
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-slate-600">
        Stripe now requires rental platforms in our region to settle payments through a
        Stripe account that you own and control directly — rather than one managed on
        your behalf.
      </p>

      {/* Benefits — 2×2 grid keeps it compact */}
      <div className="mt-4 grid gap-x-5 gap-y-2.5 rounded-2xl bg-indigo-50/60 p-4 sm:grid-cols-2">
        {BENEFITS.map((b) => (
          <div key={b} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-600"
            >
              <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />
            </span>
            <span className="text-[13px] leading-snug text-slate-700">{b}</span>
          </div>
        ))}
      </div>

      {/* Tasks — side by side on desktop, stacked on mobile */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <TaskCard
          step={1}
          title="Connect your Stripe account"
          done={stripeConnected}
          doneLabel={truncatedAccount}
          actionLabel="Connect with Stripe"
          icon={<Link2 className="h-4 w-4" />}
          loading={connectingStripe}
          onAction={connectStripe}
        />
        <TaskCard
          step={2}
          title="Confirm your payment details"
          done={paymentConfirmed}
          doneLabel={null}
          actionLabel="Confirm details"
          icon={<CreditCard className="h-4 w-4" />}
          loading={confirmingPayment}
          onAction={confirmPayment}
        />
      </div>

      {/* Reward + dismiss on one line — keeps everything above the fold */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="rounded-2xl bg-amber-50 px-4 py-2.5 text-[13px] font-medium leading-snug text-amber-900">
          🎁 Complete both and we&apos;ll add{" "}
          <span className="font-semibold">100 free credits</span> to your account — on us.
        </p>
        {!isHard && (
          <Button
            variant="ghost"
            onClick={dismiss}
            disabled={dismissing}
            className="min-h-11 shrink-0 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            {dismissing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            Remind me later
          </Button>
        )}
      </div>

      {isHard && (
        <p className="mt-4 border-t border-slate-100 pt-4 text-[13px] text-slate-500">
          Need a hand?{" "}
          <a
            href="mailto:support@drive-247.com"
            className="font-medium text-indigo-600 underline-offset-4 hover:underline"
          >
            support@drive-247.com
          </a>
        </p>
      )}
    </>
  );

  const contentClasses =
    "w-[calc(100vw-1.5rem)] max-w-2xl rounded-3xl border-slate-200 !bg-white p-5 text-slate-900 shadow-xl sm:p-7 max-h-[92dvh] overflow-y-auto [&>button:last-child]:hidden";

  // ── Hard: inescapable ─────────────────────────────────────────────────────
  if (isHard) {
    return (
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className={contentClasses}
        >
          {card}
        </DialogContent>
      </Dialog>
    );
  }

  // ── Soft: dismissible (X always visible, pinned to the card) ───────────────
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className={contentClasses}>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Remind me later"
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        {card}
      </DialogContent>
    </Dialog>
  );
}
