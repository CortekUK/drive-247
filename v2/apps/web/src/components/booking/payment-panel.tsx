"use client";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { StripeElementsOptions } from "@stripe/stripe-js";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  usePaymentIntent,
  type BookingPaymentIntentRequest,
  type BookingPaymentIntentResponse,
  type PaymentIntentFailureKind,
} from "@/hooks/use-payment-intent";
import { buildBookingAppearance, BOOKING_ELEMENTS_FONTS } from "@/lib/stripe/appearance";
import { getStripeForAccount } from "@/lib/stripe/load-stripe";
import { cn } from "@/lib/utils";

/**
 * The card form, IN OUR PAGE.
 *
 * ── WHY A MODAL, and not an in-place swap of the checkout panel ──────────────
 * The two shapes on offer were "replace the right-hand column with the card
 * form" and "float the card form over the page". This is the float, for three
 * reasons that all point the same way:
 *
 *   1. Nothing is destroyed. The itemised bill, the dates and the driver's
 *      details are still on screen behind the scrim, so "wait, how much was
 *      it?" is answered by closing the dialog, not by re-entering the form.
 *   2. One shape at both ends of the breakpoint range. An in-place swap has to
 *      decide what happens to the sticky rail on a desktop AND to the fixed
 *      bottom bar on a phone; a dialog is the same component either way.
 *   3. Cancelling is free. Closing returns to a form that never changed, which
 *      is the behaviour a customer expects from "I'd rather not, actually".
 *
 * It is NOT a redirect and NOT a new tab: `<Elements>` mounts here, the card
 * fields are Stripe-hosted iframes inside this dialog, and `confirmPayment` is
 * called with `redirect: "if_required"` so the common case never leaves.
 *
 * ── THE ONE CASE THAT DOES LEAVE ─────────────────────────────────────────────
 * `redirect: "if_required"` still navigates away when the payment method has no
 * in-page challenge (some 3-D Secure flows, and every redirect-based method).
 * The customer comes back to `return_url` with `payment_intent_client_secret`
 * in the query string — but NOT with the publishable key or the connected
 * account id, without which Stripe.js cannot even be constructed. So those are
 * stashed in `sessionStorage` immediately before confirming and read back by
 * `readPaymentReturn()` below. sessionStorage, not local: it is scoped to the
 * tab that left, and it dies with it.
 */

/* ─────────────────────── returning from a 3-D Secure hop ─────────────────── */

const RETURN_STASH_KEY = "drive247.booking.payment-return";
/** Stripe appends this to `return_url`; its presence is what marks a return. */
const RETURN_SECRET_PARAM = "payment_intent_client_secret";

/** Everything needed to rebuild Stripe.js after a full page navigation. */
export interface PaymentReturn {
  clientSecret: string;
  publishableKey: string;
  connectAccountId: string | null;
  rentalNumber: string | null;
}

function stashForReturn(intent: BookingPaymentIntentResponse): void {
  const stash: PaymentReturn = {
    clientSecret: intent.clientSecret,
    publishableKey: intent.publishableKey,
    connectAccountId: intent.connectAccountId,
    rentalNumber: intent.rentalNumber,
  };
  try {
    window.sessionStorage.setItem(RETURN_STASH_KEY, JSON.stringify(stash));
  } catch {
    // Private mode, or storage full. The in-page path still works; only the
    // redirect path degrades, and it degrades to "we could not confirm",
    // never to a double charge.
  }
}

function clearReturnStash(): void {
  try {
    window.sessionStorage.removeItem(RETURN_STASH_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Are we back from a Stripe redirect, and do we still have what we need?
 *
 * Both halves must agree — a `payment_intent_client_secret` in the URL that
 * does not match the stash is somebody else's link, and is ignored.
 */
export function readPaymentReturn(): PaymentReturn | null {
  if (typeof window === "undefined") return null;

  const urlSecret = new URLSearchParams(window.location.search).get(
    RETURN_SECRET_PARAM,
  );
  if (urlSecret === null || urlSecret === "") return null;

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(RETURN_STASH_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;

  const body: Record<string, unknown> = { ...parsed };
  const clientSecret = body.clientSecret;
  const publishableKey = body.publishableKey;
  if (typeof clientSecret !== "string" || typeof publishableKey !== "string") {
    return null;
  }
  if (clientSecret !== urlSecret) return null;

  return {
    clientSecret,
    publishableKey,
    connectAccountId:
      typeof body.connectAccountId === "string" ? body.connectAccountId : null,
    rentalNumber: typeof body.rentalNumber === "string" ? body.rentalNumber : null,
  };
}

/* ─────────────────────────────── the outcome ─────────────────────────────── */

export type PaymentOutcome =
  | { kind: "succeeded"; rentalNumber: string | null }
  /** Taken, but the bank has not settled — a real Stripe state, not an error. */
  | { kind: "processing"; rentalNumber: string | null };

/* ──────────────────────────────── the panel ──────────────────────────────── */

export interface PaymentPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Everything the server needs to price and book. Null while the form is
   * incomplete — the panel is never opened in that state.
   */
  request: BookingPaymentIntentRequest | null;
  /**
   * Already formatted, e.g. "$1,215.00" — the page's own total, used only until
   * the intent lands. See `formatMinorUnits` for why the intent then wins.
   */
  amountLabel: string;
  /** "2021 Chevrolet Camaro" — so the dialog says what is being paid for. */
  vehicleLabel: string;
  /** Non-null when this mount is a return from a Stripe redirect. */
  resume: PaymentReturn | null;
  onSucceeded?: (outcome: PaymentOutcome) => void;
}

export function PaymentPanel({
  open,
  onOpenChange,
  request,
  amountLabel,
  vehicleLabel,
  resume,
  onSucceeded,
}: PaymentPanelProps) {
  const { state, create, reset } = usePaymentIntent();
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  /**
   * Stripe could not render the card fields.
   *
   * Observed, not theorised: with a publishable key that does not match the
   * account the secret belongs to, `<Elements>` mounts, the iframes appear, and
   * the Payment Element quietly renders NOTHING — leaving a branded dialog with
   * a permanently disabled pay button and no explanation. `onLoadError` is the
   * only signal, so it is lifted here and turned into a real failure screen.
   */
  const [loadError, setLoadError] = useState<string | null>(null);

  // Held in a ref so a re-priced request does not re-trigger the effect below
  // and mint a second PaymentIntent mid-payment.
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    if (!open) {
      reset();
      setOutcome(null);
      setLoadError(null);
      return;
    }
    // A resume already HAS a client secret; asking for another would create a
    // second intent for a booking that may have just been paid.
    if (resume !== null) return;
    if (state.status !== "idle") return;

    const pending = requestRef.current;
    if (pending === null) return;

    void create(pending);
  }, [open, resume, state.status, create, reset]);

  const handleOutcome = useCallback(
    (next: PaymentOutcome) => {
      clearReturnStash();
      setOutcome(next);
      onSucceeded?.(next);
    },
    [onSucceeded],
  );

  /**
   * One shape for both routes in: a freshly minted intent, and a redirect
   * return rebuilt from the sessionStorage stash.
   *
   * MEMOISED, and that is not a micro-optimisation. The resume branch builds a
   * literal, so without this it is a new object on every render — which makes
   * `elementsOptions` new on every render too, and react-stripe-js reacts to a
   * changed `options` identity by pushing an update into the mounted Element.
   * A form that re-initialises under the customer's fingers is a form that
   * loses what they typed.
   */
  const intent = useMemo<BookingPaymentIntentResponse | null>(() => {
    if (resume !== null) {
      return {
        clientSecret: resume.clientSecret,
        publishableKey: resume.publishableKey,
        connectAccountId: resume.connectAccountId,
        rentalNumber: resume.rentalNumber,
        // A redirect carries no amount back; the button falls back to the
        // page's own label until the intent is retrieved.
        amount: null,
        currency: null,
      };
    }
    return state.status === "ready" ? state.intent : null;
  }, [resume, state]);

  const stripePromise = useMemo(
    () =>
      intent === null
        ? null
        : getStripeForAccount(intent.publishableKey, intent.connectAccountId),
    [intent],
  );

  /*
    The appearance is read off the live document, so it is built when an intent
    lands rather than at module scope — at module scope there is no document to
    read. `intent` is the dependency, and it only changes when a genuinely new
    secret arrives.
  */
  const elementsOptions = useMemo<StripeElementsOptions | null>(
    () =>
      intent === null
        ? null
        : {
            clientSecret: intent.clientSecret,
            appearance: buildBookingAppearance(),
            fonts: [...BOOKING_ELEMENTS_FONTS],
          },
    [intent],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        360px CONTRACT. `w-[calc(100%-1.5rem)]` leaves 336px on the narrowest
        phone we support; the padding is 16px a side rather than the primitive's
        24px, so the Payment Element gets 304px — comfortably above the ~250px
        where Stripe's own layout starts stacking. The body is the only thing
        that scrolls, and the confirm button lives OUTSIDE it, so it is reachable
        without scrolling to the end of the card fields.
      */}
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100svh-1.5rem)] w-[calc(100%-1.5rem)] max-w-[440px] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100svh-4rem)]"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <PanelHeader vehicleLabel={vehicleLabel} />

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5 sm:pb-5">
          {outcome !== null ? (
            <OutcomeView outcome={outcome} onClose={() => onOpenChange(false)} />
          ) : loadError !== null ? (
            <FailureView
              title="We could not show the card form"
              message={
                "Nothing has been charged. Please try again — if it keeps " +
                "happening, get in touch and we will take your booking directly."
              }
              detail={loadError}
              onRetry={
                request === null
                  ? null
                  : () => {
                      // A fresh intent, not a remount: a load failure usually
                      // means the secret or the account behind it is wrong, and
                      // re-rendering the same one fails the same way.
                      setLoadError(null);
                      reset();
                    }
              }
              onClose={() => onOpenChange(false)}
            />
          ) : state.status === "creating" ? (
            <BusyView label="Preparing a secure form…" />
          ) : state.status === "failed" ? (
            <FailureView
              title={FAILURE_TITLES[state.failure.kind]}
              message={state.failure.message}
              detail={state.failure.detail}
              onRetry={
                /*
                  `reset()` alone is the retry: it drops the panel back to
                  `idle`, and the effect above mints a fresh intent because the
                  dialog is still open. There is nothing to un-do — a failure
                  here means no PaymentIntent was ever created.
                */
                state.failure.retryable && request !== null
                  ? () => {
                      reset();
                    }
                  : null
              }
              onClose={() => onOpenChange(false)}
            />
          ) : intent !== null && stripePromise !== null && elementsOptions !== null ? (
            <Elements
              key={intent.clientSecret}
              stripe={stripePromise}
              options={elementsOptions}
            >
              <CardForm
                intent={intent}
                amountLabel={amountLabel}
                isResume={resume !== null}
                onOutcome={handleOutcome}
                onLoadError={setLoadError}
                onCancel={() => onOpenChange(false)}
              />
            </Elements>
          ) : (
            <BusyView label="Preparing a secure form…" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const FAILURE_TITLES: Readonly<Record<PaymentIntentFailureKind, string>> = {
  "not-deployed": "Card payment is not available here",
  unreachable: "We could not reach the payment service",
  rejected: "We could not start this payment",
  malformed: "We could not start this payment",
};

/* ─────────────────────────────── the header ──────────────────────────────── */

/**
 * The brand lockup.
 *
 * "Drive247" — capital D, no space, no hyphen. The mark is drawn with
 * `currentColor` rather than the literal hex `BrandMark` carries, so it takes
 * the surrounding text colour; and it is deliberately NOT `BrandMark`, which is
 * a `<Link>` and would offer a one-tap route off a half-finished payment.
 */
function PanelHeader({ vehicleLabel }: { vehicleLabel: string }) {
  return (
    <div className="border-b border-brand-border-soft px-4 pt-4 pb-3.5 sm:px-5 sm:pt-5">
      <div className="flex items-center gap-2 text-brand-text">
        <svg
          viewBox="0 0 28 28"
          fill="none"
          aria-hidden
          className="size-[18px] shrink-0"
        >
          <g
            stroke="currentColor"
            strokeWidth="4.66667"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 3.5V24.5" />
            <path d="M3.5 14H24.5" />
            <path d="M6.57532 6.57422L21.4247 21.4236" />
            <path d="M21.4247 6.57422L6.57532 21.4236" />
          </g>
        </svg>
        <span className="text-sm font-semibold tracking-[-0.01em]">Drive247</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-brand-text-subtle">
          <Lock aria-hidden strokeWidth={2} className="size-3" />
          Secure
        </span>
      </div>

      <DialogTitle className="mt-2.5 text-base sm:text-lg">
        Confirm and pay
      </DialogTitle>
      <DialogDescription className="mt-0.5 text-xs sm:text-sm">
        {vehicleLabel}
      </DialogDescription>
    </div>
  );
}

/* ──────────────────────────────── the form ───────────────────────────────── */

/**
 * The amount the intent will ACTUALLY take, formatted.
 *
 * The pay button must never name a figure different from the charge. It can:
 * `computeQuote` produces `grandTotal` as a plain float and rounds it ONCE into
 * `grandTotalCents`, and float arithmetic makes those two disagree by a cent for
 * some totals — measured here, 305.775 renders as "$305.78" through `Intl` while
 * `Math.round(305.775 * 100)` is 30577, i.e. $305.77. The server prices
 * independently and returns what it is charging, so once the intent exists that
 * is the only figure worth putting on the button.
 *
 * `/ 100` assumes a two-decimal currency, which is the assumption the whole
 * pricing path already makes (`grandTotalCents` is `grandTotal * 100`
 * unconditionally). Zero-decimal currencies would need fixing there first.
 */
function formatMinorUnits(amount: number | null, currency: string | null): string | null {
  if (amount === null || currency === null) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount / 100);
  } catch {
    // An unrecognised ISO code must not take the amount off the button.
    return null;
  }
}

function CardForm({
  intent,
  amountLabel,
  isResume,
  onOutcome,
  onLoadError,
  onCancel,
}: {
  intent: BookingPaymentIntentResponse;
  amountLabel: string;
  /** True when this mount is a return from a redirect: check before asking. */
  isResume: boolean;
  onOutcome: (outcome: PaymentOutcome) => void;
  /** Stripe could not render the fields — hand it up, never swallow it. */
  onLoadError: (detail: string) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const [cardComplete, setCardComplete] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A redirect return must resolve the existing intent BEFORE offering the form
  // again — otherwise a customer who already paid is invited to pay twice.
  const [checkingReturn, setCheckingReturn] = useState(isResume);

  useEffect(() => {
    if (!isResume || stripe === null) return;

    let cancelled = false;
    void stripe
      .retrievePaymentIntent(intent.clientSecret)
      .then((result) => {
        if (cancelled) return;
        const paymentIntent = result.paymentIntent;
        if (paymentIntent === undefined) {
          setError(
            result.error?.message ??
              "We could not confirm the outcome of that payment. Please contact us before trying again.",
          );
          setCheckingReturn(false);
          return;
        }
        if (paymentIntent.status === "succeeded") {
          onOutcome({ kind: "succeeded", rentalNumber: intent.rentalNumber });
          return;
        }
        if (paymentIntent.status === "processing") {
          onOutcome({ kind: "processing", rentalNumber: intent.rentalNumber });
          return;
        }
        // requires_payment_method / requires_confirmation: the hop failed and
        // the same intent can be retried, so fall through to the form.
        setError(
          paymentIntent.status === "requires_payment_method"
            ? "That card was not accepted. Try another one — nothing has been charged."
            : null,
        );
        setCheckingReturn(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(
          "We could not confirm the outcome of that payment. Please contact us before trying again.",
        );
        setCheckingReturn(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isResume, stripe, intent.clientSecret, intent.rentalNumber, onOutcome]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (stripe === null || elements === null || processing) return;

      setProcessing(true);
      setError(null);

      // Written BEFORE confirming: if Stripe navigates away for 3-D Secure the
      // next line of this function never runs.
      stashForReturn(intent);

      // Same page, so a returning customer lands on the booking they were on.
      const returnUrl = `${window.location.origin}${window.location.pathname}`;

      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });

      if (result.error) {
        clearReturnStash();
        setProcessing(false);
        setError(
          result.error.message ??
            "That payment could not be completed. Nothing has been charged.",
        );
        return;
      }

      const paymentIntent = result.paymentIntent;
      if (paymentIntent.status === "succeeded") {
        onOutcome({ kind: "succeeded", rentalNumber: intent.rentalNumber });
        return;
      }
      if (paymentIntent.status === "processing") {
        onOutcome({ kind: "processing", rentalNumber: intent.rentalNumber });
        return;
      }

      clearReturnStash();
      setProcessing(false);
      setError(
        "That payment was not completed. Nothing has been charged — please try again.",
      );
    },
    [stripe, elements, processing, intent, onOutcome],
  );

  if (checkingReturn) {
    return <BusyView label="Checking that payment…" />;
  }

  const ready = stripe !== null && elements !== null;
  const payLabel = formatMinorUnits(intent.amount, intent.currency) ?? amountLabel;

  return (
    <form onSubmit={handleSubmit} className="pt-4">
      <PaymentElement
        options={{ layout: "tabs" }}
        onChange={(event) => setCardComplete(event.complete)}
        onLoadError={(event) =>
          onLoadError(
            event.error.message ??
              `Payment Element failed to load (${event.error.type}).`,
          )
        }
      />

      {/*
        Stripe attribution, required when the card fields are embedded rather
        than served from Stripe's own checkout page.
      */}
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] leading-4 text-brand-text-subtle">
        <Lock aria-hidden strokeWidth={2} className="size-3" />
        Powered by Stripe · your card details never touch our servers
      </p>

      {/*
        OFF-SESSION MANDATE. The card is vaulted, not just charged once: the
        security deposit, any installment schedule and post-rental charges are
        all taken later without the customer present. Card-network rules and
        Stripe's own terms require that to be stated at the point of consent,
        and the consent tick in the booking form is not it — the customer has
        not seen a card at that point.
      */}
      <p className="mt-3 rounded-[10px] border border-brand-border-soft bg-brand-stone/45 px-3 py-2.5 text-[11px] leading-relaxed text-brand-text-soft">
        By paying you authorise <strong className="font-medium text-brand-text">Drive247</strong>{" "}
        to store this card securely and to charge it later, without you present,
        for the amounts you agreed to on this page — the security deposit, any
        instalments, and post-rental charges such as fuel, excess mileage, tolls,
        fines or damage. You can ask us to remove the card once the rental is
        closed and settled.
      </p>

      {error !== null ? (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-[10px] border border-danger-subtle bg-danger-light px-3 py-2 text-xs leading-relaxed text-brand-text"
        >
          <AlertTriangle
            aria-hidden
            strokeWidth={1.75}
            className="mt-px size-3.5 shrink-0 text-danger"
          />
          <span>{error}</span>
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        <Button
          type="submit"
          variant="brand"
          size="lg"
          className="h-12 w-full"
          disabled={!ready || !cardComplete || processing}
        >
          {processing ? (
            <>
              <Loader2 aria-hidden className="animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <Lock aria-hidden strokeWidth={2} />
              Pay {payLabel}
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="brand-ghost"
          size="lg"
          className="h-11 w-full"
          disabled={processing}
          onClick={onCancel}
        >
          Back to my booking
        </Button>
      </div>
    </form>
  );
}

/* ─────────────────────────────── the states ──────────────────────────────── */

function BusyView({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12">
      <Loader2
        aria-hidden
        className="size-6 animate-spin text-brand-text-subtle"
      />
      <p className="text-sm text-brand-text-soft">{label}</p>
    </div>
  );
}

function FailureView({
  title,
  message,
  detail,
  onRetry,
  onClose,
}: {
  title: string;
  message: string;
  /** Engineering detail. Logged, never rendered. */
  detail: string | null;
  onRetry: (() => void) | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (detail !== null) console.warn(`[payment] ${detail}`);
  }, [detail]);

  return (
    <div className="pt-5">
      <div className="flex flex-col items-center text-center">
        <span className="grid size-11 place-items-center rounded-full bg-warning-light">
          <AlertTriangle
            aria-hidden
            strokeWidth={1.75}
            className="size-5 text-warning"
          />
        </span>
        <h3 className="mt-3 text-sm font-semibold text-brand-text">{title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-brand-text-soft">
          {message}
        </p>
      </div>

      <div className="mt-5 space-y-2">
        {onRetry !== null ? (
          <Button
            type="button"
            variant="brand"
            size="lg"
            className="h-12 w-full"
            onClick={onRetry}
          >
            <RotateCw strokeWidth={2} />
            Try again
          </Button>
        ) : null}
        <Button
          type="button"
          variant={onRetry === null ? "brand" : "brand-ghost"}
          size="lg"
          className={cn("w-full", onRetry === null ? "h-12" : "h-11")}
          onClick={onClose}
        >
          Back to my booking
        </Button>
      </div>
    </div>
  );
}

function OutcomeView({
  outcome,
  onClose,
}: {
  outcome: PaymentOutcome;
  onClose: () => void;
}) {
  const succeeded = outcome.kind === "succeeded";

  return (
    <div className="pt-5">
      <div className="flex flex-col items-center text-center">
        <span
          className={cn(
            "grid size-11 place-items-center rounded-full",
            succeeded ? "bg-success-light" : "bg-info-light",
          )}
        >
          {succeeded ? (
            <CheckCircle2
              aria-hidden
              strokeWidth={1.75}
              className="size-5 text-success"
            />
          ) : (
            <Clock aria-hidden strokeWidth={1.75} className="size-5 text-info" />
          )}
        </span>

        <h3 className="mt-3 text-sm font-semibold text-brand-text">
          {succeeded ? "Payment received" : "Payment is being confirmed"}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-brand-text-soft">
          {succeeded
            ? "Your booking is confirmed. We have emailed the details and what to bring on the day."
            : "Your bank has not settled this yet. We will email you the moment it clears — there is nothing more to do."}
        </p>

        {outcome.rentalNumber !== null ? (
          <p className="mt-3 rounded-full bg-brand-stone px-3 py-1 text-[11px] font-medium text-brand-text-soft">
            Booking {outcome.rentalNumber}
          </p>
        ) : null}
      </div>

      <Button
        type="button"
        variant="brand"
        size="lg"
        className="mt-5 h-12 w-full"
        onClick={onClose}
      >
        Done
      </Button>
    </div>
  );
}
