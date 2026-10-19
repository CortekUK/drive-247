"use client";

import { Elements, PaymentElement } from "@stripe/react-stripe-js";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  RotateCw,
} from "lucide-react-nw";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@nw/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@nw/components/ui/dialog";
import type { BookingPaymentIntentResponse } from "@nw/hooks/use-payment-intent";
import { cn } from "@nw/lib/utils";

import {
  describeElementLoadError,
  FAILURE_TITLES,
  LOAD_ERROR_COPY,
  outcomeDocumentsHref,
  useCardFormController,
  usePaymentPanelController,
  type BookingPaymentRequest,
  type PaymentOutcome,
  type PaymentPanelCopy,
  type PaymentReturn,
} from "./payment-panel-logic";

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

/*
  The state machine, the 3-D Secure stash, the wording and the endpoint's
  request shape live in `./payment-panel-logic` so the v2 dialog shares them.
  Re-exported here so every existing importer keeps its path.
*/
export {
  bookingDocumentsHref,
  readPaymentReturn,
  type BookingPaymentRequest,
  type PaymentOutcome,
  type PaymentPanelCopy,
  type PaymentReturn,
} from "./payment-panel-logic";

/* ──────────────────────────────── the panel ──────────────────────────────── */

export interface PaymentPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Everything the server needs to price the charge, INCLUDING the id of the
   * rental it prices from. Null until the booking has actually been written —
   * the panel is never opened before that, because an intent cannot be minted
   * without a rental and an empty card dialog is worse than an honest error.
   *
   * Ignored when `prepared` is supplied: that caller has already minted.
   */
  request: BookingPaymentRequest | null;
  /**
   * An intent the CALLER already minted, mounted straight into `<Elements>`.
   *
   * The booking flow lets the panel do the minting because the request and the
   * dialog open at the same moment. The portal cannot: its request type is the
   * narrow subset `create-booking-payment-intent` actually reads (see
   * `@/lib/stripe/create-balance-payment-intent`), and it wants a failure to
   * mint to appear INLINE next to the balance it failed on, not inside a dialog
   * the customer then has to dismiss. So it mints first and opens the dialog
   * only when there is a real card form to show.
   *
   * Distinct from `resume`, which carries the same shape but also asks the panel
   * to RESOLVE the intent before offering the form — a prepared intent is known
   * to be fresh, a resumed one may already be paid.
   */
  prepared?: BookingPaymentIntentResponse | null;
  /**
   * `rentals.id`, stashed for a 3-D Secure return. Taken from `request` when the
   * panel mints; supply it alongside `prepared`.
   */
  rentalId?: string | null;
  /**
   * Already formatted, e.g. "$1,215.00" — the page's own total, used only until
   * the intent lands. See `formatIntentAmount` for why the intent then wins.
   */
  amountLabel: string;
  /** "2021 Chevrolet Camaro" — so the dialog says what is being paid for. */
  vehicleLabel: string;
  /** Non-null when this mount is a return from a Stripe redirect. */
  resume: PaymentReturn | null;
  /** Overrides merged over the booking wording. See `PaymentPanelCopy`. */
  copy?: Partial<PaymentPanelCopy>;
  /**
   * Rendered inside the success view, above the close button.
   *
   * Stripe saying "succeeded" and the money appearing on the customer's account
   * are two different events separated by a webhook. The portal puts its
   * settlement watch here so the customer sees the second one happen without
   * leaving the dialog.
   */
  outcomeFooter?: React.ReactNode;
  onSucceeded?: (outcome: PaymentOutcome) => void;
}

export function PaymentPanel({
  open,
  onOpenChange,
  request,
  prepared = null,
  rentalId = null,
  amountLabel,
  vehicleLabel,
  resume,
  copy,
  outcomeFooter,
  onSucceeded,
}: PaymentPanelProps) {
  const {
    state,
    outcome,
    loadError,
    setLoadError,
    handleOutcome,
    intent,
    paidRentalId,
    text,
    stripePromise,
    elementsOptions,
    retryAfterLoadError,
    retryAfterMintFailure,
  } = usePaymentPanelController({
    open,
    request,
    prepared,
    rentalId,
    resume,
    copy,
    onSucceeded,
  });

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
        <PanelHeader vehicleLabel={vehicleLabel} title={text.title} />

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5 sm:pb-5">
          {outcome !== null ? (
            <OutcomeView
              outcome={outcome}
              text={text}
              footer={outcomeFooter}
              onClose={() => onOpenChange(false)}
            />
          ) : loadError !== null ? (
            <FailureView
              title={LOAD_ERROR_COPY.title}
              message={LOAD_ERROR_COPY.message}
              detail={loadError}
              cancelLabel={text.cancelLabel}
              onRetry={retryAfterLoadError}
              onClose={() => onOpenChange(false)}
            />
          ) : state.status === "creating" ? (
            <BusyView label="Preparing a secure form…" />
          ) : state.status === "failed" ? (
            <FailureView
              title={FAILURE_TITLES[state.failure.kind]}
              message={state.failure.message}
              detail={state.failure.detail}
              cancelLabel={text.cancelLabel}
              onRetry={retryAfterMintFailure}
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
                rentalId={paidRentalId}
                amountLabel={amountLabel}
                text={text}
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

/* ─────────────────────────────── the header ──────────────────────────────── */

/**
 * The brand lockup.
 *
 * "Drive247" — capital D, no space, no hyphen. The mark is drawn with
 * `currentColor` rather than the literal hex `BrandMark` carries, so it takes
 * the surrounding text colour; and it is deliberately NOT `BrandMark`, which is
 * a `<Link>` and would offer a one-tap route off a half-finished payment.
 */
function PanelHeader({
  vehicleLabel,
  title,
}: {
  vehicleLabel: string;
  title: string;
}) {
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

      <DialogTitle className="mt-2.5 text-base sm:text-lg">{title}</DialogTitle>
      <DialogDescription className="mt-0.5 text-xs sm:text-sm">
        {vehicleLabel}
      </DialogDescription>
    </div>
  );
}

/* ──────────────────────────────── the form ───────────────────────────────── */

function CardForm({
  intent,
  rentalId,
  amountLabel,
  text,
  isResume,
  onOutcome,
  onLoadError,
  onCancel,
}: {
  intent: BookingPaymentIntentResponse;
  /** Stashed before confirming, so a 3-D Secure return knows what was paid. */
  rentalId: string | null;
  amountLabel: string;
  text: PaymentPanelCopy;
  /** True when this mount is a return from a redirect: check before asking. */
  isResume: boolean;
  onOutcome: (outcome: PaymentOutcome) => void;
  /** Stripe could not render the fields — hand it up, never swallow it. */
  onLoadError: (detail: string) => void;
  onCancel: () => void;
}) {
  const {
    setCardComplete,
    cardComplete,
    processing,
    error,
    checkingReturn,
    handleSubmit,
    ready,
    payLabel,
  } = useCardFormController({
    intent,
    rentalId,
    amountLabel,
    isResume,
    onOutcome,
  });

  if (checkingReturn) {
    return <BusyView label="Checking that payment…" />;
  }

  return (
    <form onSubmit={handleSubmit} className="pt-4">
      <PaymentElement
        options={{ layout: "tabs" }}
        onChange={(event) => setCardComplete(event.complete)}
        onLoadError={(event) => onLoadError(describeElementLoadError(event.error))}
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
        By paying you authorise{" "}
        <strong className="font-medium text-brand-text">Drive247</strong>{" "}
        {text.mandate}
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
          {text.cancelLabel}
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
  cancelLabel,
  onRetry,
  onClose,
}: {
  title: string;
  message: string;
  /** Engineering detail. Logged, never rendered. */
  detail: string | null;
  cancelLabel: string;
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
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}

function OutcomeView({
  outcome,
  text,
  footer,
  onClose,
}: {
  outcome: PaymentOutcome;
  text: PaymentPanelCopy;
  footer: React.ReactNode;
  onClose: () => void;
}) {
  const succeeded = outcome.kind === "succeeded";

  /** See `outcomeDocumentsHref` for why this is succeeded-only and token-gated. */
  const documentsHref = outcomeDocumentsHref(outcome);

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
          {succeeded ? text.succeededTitle : text.processingTitle}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-brand-text-soft">
          {succeeded ? text.succeededBody : text.processingBody}
        </p>

        {outcome.rentalNumber !== null ? (
          <p className="mt-3 rounded-full bg-brand-stone px-3 py-1 text-[11px] font-medium text-brand-text-soft">
            {text.referencePrefix} {outcome.rentalNumber}
          </p>
        ) : null}
      </div>

      {footer !== undefined && footer !== null ? (
        <div className="mt-4">{footer}</div>
      ) : null}

      {documentsHref !== null ? (
        <div className="mt-5 space-y-2">
          {/*
            The link is the PRIMARY action and closing is the demoted one,
            because the booking is not finished and the screen must not offer
            "Done" as the obvious next tap.
          */}
          <Button asChild variant="brand" size="lg" className="h-12 w-full">
            <Link href={documentsHref}>
              {text.documentsCtaLabel}
              <ArrowRight aria-hidden strokeWidth={2} />
            </Link>
          </Button>
          <Button
            type="button"
            variant="brand-ghost"
            size="lg"
            className="h-11 w-full"
            onClick={onClose}
          >
            {text.documentsDeferLabel}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="brand"
          size="lg"
          className="mt-5 h-12 w-full"
          onClick={onClose}
        >
          {text.doneLabel}
        </Button>
      )}
    </div>
  );
}
