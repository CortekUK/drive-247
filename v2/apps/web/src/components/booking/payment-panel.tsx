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
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  RotateCw,
} from "lucide-react";
import Link from "next/link";
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
  /**
   * `rentals.id`, so a page that watches for settlement after the payment knows
   * WHICH booking to watch once it has been reloaded from scratch.
   *
   * The booking page never needed it — it already knows the rental it just
   * created. The portal does: a 3-D Secure hop is a full navigation, so the
   * component that started the payment is gone and the returning page has only
   * the query string and this stash to reconstruct what happened. Optional in
   * practice (an older stash written before this field existed parses as null),
   * which is why the reader tolerates its absence rather than rejecting the
   * whole return.
   */
  rentalId: string | null;
  /**
   * The document-upload token that came back with the intent.
   *
   * WHY IT IS IN THE STASH AT ALL: a 3-D Secure hop is a full navigation, so the
   * `<Elements>` tree that held the minted intent is gone, and the only things
   * that survive are the query string and this stash. Without the token here, a
   * customer who happened to be sent to their bank would come back to a success
   * screen with no route to the upload step — the one customer who has just been
   * through the most friction would get the least help. Null for an older stash
   * written before this field existed, and for the portal's balance flow, which
   * has no documents step.
   */
  documentsToken: string | null;
}

function stashForReturn(
  intent: BookingPaymentIntentResponse,
  rentalId: string | null,
): void {
  const stash: PaymentReturn = {
    clientSecret: intent.clientSecret,
    publishableKey: intent.publishableKey,
    connectAccountId: intent.connectAccountId,
    rentalNumber: intent.rentalNumber,
    rentalId,
    documentsToken: intent.documentsToken ?? null,
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
    rentalId: typeof body.rentalId === "string" ? body.rentalId : null,
    // Tolerated rather than required, exactly like `rentalId`: a stash written
    // before this field existed must still resume a payment, not be discarded.
    documentsToken:
      typeof body.documentsToken === "string" ? body.documentsToken : null,
  };
}

/* ─────────────────────────────── the outcome ─────────────────────────────── */

/**
 * What the caller is told, and it is deliberately NOT "the booking is done".
 *
 * `documentsToken` is the route to the step that comes AFTER the money: the
 * licence photos and the selfie, which an operator then approves. Null means
 * there is no link to offer — the endpoint has not been redeployed, or this is
 * the portal's balance flow, which has no documents step. A null token must
 * degrade to today's plain "Done", never to a link that 404s.
 */
export type PaymentOutcome =
  | { kind: "succeeded"; rentalNumber: string | null; documentsToken: string | null }
  /** Taken, but the bank has not settled — a real Stripe state, not an error. */
  | { kind: "processing"; rentalNumber: string | null; documentsToken: string | null };

/**
 * The in-app route for a document-upload token.
 *
 * Exported so the panel and the booking page behind it cannot drift apart on
 * the path — `(booking)` is a route GROUP, so the segment is `/booking/...`
 * with no group name in it. `encodeURIComponent` is not decoration: the token
 * is an opaque bearer string minted server-side, and a path segment is the one
 * place a stray `/` or `#` in it would silently point somewhere else.
 */
export function bookingDocumentsHref(token: string): string {
  return `/booking/documents/${encodeURIComponent(token)}`;
}

/* ─────────────────── what the deployed endpoint actually reads ───────────── */

/**
 * The body `create-booking-payment-intent` destructures, on top of the payload
 * `use-payment-intent` documents.
 *
 * THE ONE FIELD THAT MATTERS IS `rentalId`. The endpoint refuses a request
 * without it — "the amount is computed from the rental, not supplied by the
 * caller" — because it prices the charge by summing that rental's OPEN LEDGER
 * CHARGES. So the booking must already be committed before this panel opens;
 * see `@/lib/booking/create-booking`.
 *
 * `expectedAmount` is in MAJOR units and is an INTEGRITY CHECK, never an
 * instruction: the server compares it with its own figure and refuses the whole
 * request if they differ by more than a cent, so the customer can never be shown
 * one number and charged another. `quotedTotalCents` on the base type is minor
 * units and is a different thing — the endpoint ignores it.
 *
 * These live here rather than in `use-payment-intent` because that hook's
 * request type is another workstream's file. Extra keys are ignored by the
 * function, so the documented payload is still sent unchanged.
 */
export interface BookingPaymentRequest extends BookingPaymentIntentRequest {
  /** `rentals.id`. Without it the endpoint 400s. */
  rentalId: string;
  /** Preferred over `tenantId` by the endpoint's own resolution order. */
  tenantSlug: string | null;
  /** `customers.id`, so the Stripe Customer is vaulted against the right person. */
  customerId: string;
  customerEmail: string;
  customerName: string;
  /** MAJOR units — dollars, not cents. See above. */
  expectedAmount: number;
}

/* ─────────────────────────────── the wording ─────────────────────────────── */

/**
 * Every sentence the panel puts on screen, so a second caller can be honest
 * without a second dialog.
 *
 * The panel now serves two flows that are the same MECHANISM and completely
 * different EVENTS: a new booking being paid for, and an existing booking's
 * outstanding balance being settled from the customer portal. Telling someone
 * who just cleared a fuel charge on a rental they returned last week to go and
 * photograph their driving licence is not a cosmetic mismatch — it is a false
 * statement about what just happened.
 *
 * Overrides are `Partial`, merged over `BOOKING_COPY`, so the portal flow is
 * unaffected by changes here BY CONSTRUCTION — but only for the keys it
 * actually overrides. Checked, not assumed: `PORTAL_COPY`
 * (`app/(portal)/portal/payments/_components/pay-balances.tsx:76-92`) sets
 * `succeededTitle`, `succeededBody`, `processingTitle` and `processingBody` of
 * its own, so the booking flow's new "upload your licence" wording below can
 * never reach a balance payment. The two `documents*` labels need no override:
 * that branch is unreachable without a token, and only the booking endpoint
 * mints one.
 */
export interface PaymentPanelCopy {
  /** Dialog title. */
  title: string;
  /** The button that closes without paying. */
  cancelLabel: string;
  succeededTitle: string;
  succeededBody: string;
  /** Taken, but the bank has not settled. A real Stripe state, not an error. */
  processingTitle: string;
  processingBody: string;
  /** Prefix on the reference pill, e.g. "Booking" → "Booking R-42772e". */
  referencePrefix: string;
  /** Closes the outcome view. */
  doneLabel: string;
  /**
   * The primary action when the outcome carries a document-upload token.
   *
   * Only the booking flow ever reaches this branch — the portal's balance
   * payment has no token — but the label lives here rather than inline so the
   * promise of this type ("every sentence the panel puts on screen") stays
   * true, and so a second flow that one day mints a token cannot inherit
   * booking wording by accident.
   */
  documentsCtaLabel: string;
  /** The demoted close button beside it. Deferring is allowed; it is not done. */
  documentsDeferLabel: string;
  /**
   * The off-session mandate. NOT optional in either flow and not a formality:
   * `create-booking-payment-intent` sets `setup_future_usage: 'off_session'`
   * unconditionally, so the card really is vaulted for later charges on both
   * paths, and card-network rules require that to be stated where the card is
   * entered. Only the wording of "what you agreed to" differs.
   */
  mandate: string;
}

/**
 * ── THE COPY THAT IS NOT ALLOWED TO SAY "CONFIRMED" ──────────────────────────
 * Taking the money is no longer the end of the booking. After payment the
 * customer must send a photo of their driving licence and a selfie, those are
 * checked, and an OPERATOR then approves — and it is that approval, not this
 * screen, that sends the "booking confirmed" email (`notify-booking-approved`).
 *
 * So the previous succeededBody, "Your booking is confirmed. We have emailed the
 * details and what to bring on the day.", is now a false statement twice over:
 * nothing is confirmed, and no email has been sent at the moment this renders.
 * Nothing in this object may say confirmed, complete, all done or booked — an
 * operator can still reject, and a customer who was told otherwise turns up at a
 * depot expecting keys.
 */
const BOOKING_COPY: PaymentPanelCopy = {
  title: "Confirm and pay",
  cancelLabel: "Back to my booking",
  succeededTitle: "Payment received",
  succeededBody:
    "One step left — we need a photo of your driving licence and a selfie to confirm this booking. We have also emailed you the link.",
  processingTitle: "Payment is being confirmed",
  processingBody:
    "Your bank has not settled this yet. We will email you the moment it clears, with a link to upload your driving licence and a selfie — we confirm the booking once we have checked those.",
  referencePrefix: "Booking",
  doneLabel: "Done",
  documentsCtaLabel: "Upload my documents",
  documentsDeferLabel: "I'll do this later",
  mandate:
    "to store this card securely and to charge it later, without you present, " +
    "for the amounts you agreed to on this page — the security deposit, any " +
    "instalments, and post-rental charges such as fuel, excess mileage, tolls, " +
    "fines or damage. You can ask us to remove the card once the rental is " +
    "closed and settled.",
};

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
    // second intent for a booking that may have just been paid. A prepared
    // intent is likewise already minted — by the caller, deliberately.
    if (resume !== null || prepared !== null) return;
    if (state.status !== "idle") return;

    const pending = requestRef.current;
    if (pending === null) return;

    void create(pending);
  }, [open, resume, prepared, state.status, create, reset]);

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
        // The stash DOES carry this one, deliberately — see `PaymentReturn`.
        documentsToken: resume.documentsToken,
        // Only the relative token survives a hop; the absolute URL is the
        // server's own and is not needed to build the in-app link.
        documentsUrl: null,
      };
    }
    if (prepared !== null) return prepared;
    return state.status === "ready" ? state.intent : null;
  }, [resume, prepared, state]);

  /** The booking the payment belongs to, whichever route supplied the intent. */
  const paidRentalId = request?.rentalId ?? rentalId;

  const text = useMemo<PaymentPanelCopy>(
    () => ({ ...BOOKING_COPY, ...copy }),
    [copy],
  );

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
              title="We could not show the card form"
              message={
                "Nothing has been charged. Please try again — if it keeps " +
                "happening, get in touch and we will take your booking directly."
              }
              detail={loadError}
              cancelLabel={text.cancelLabel}
              onRetry={
                // Nothing to re-mint from when the caller owns the intent: the
                // portal's retry is its own "Try again" beside the balance,
                // which mints afresh and reopens this dialog.
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
              cancelLabel={text.cancelLabel}
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
 * ── THE UNIT, VERIFIED AGAINST THE DEPLOYED FUNCTION ────────────────────────
 * `create-booking-payment-intent` returns `amount: amountDue` — the rounded
 * MAJOR-unit figure (dollars), not the `amountMinorUnits` it hands Stripe — and
 * `currency` lower-cased, straight off `tenants.currency_code`. An earlier
 * reading of this as minor units divided by 100 a second time and would have
 * printed "$3.06" on a button that charges $305.77. It is formatted as-is, and
 * `Intl` accepts a lower-case ISO code.
 */
function formatIntentAmount(amount: number | null, currency: string | null): string | null {
  if (amount === null || currency === null) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    // An unrecognised ISO code must not take the amount off the button.
    return null;
  }
}

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
        // `intent` on a resume is rebuilt from the sessionStorage stash, so the
        // token here is the one that was minted before the hop, not a fresh one.
        const documentsToken = intent.documentsToken ?? null;
        if (paymentIntent.status === "succeeded") {
          onOutcome({
            kind: "succeeded",
            rentalNumber: intent.rentalNumber,
            documentsToken,
          });
          return;
        }
        if (paymentIntent.status === "processing") {
          onOutcome({
            kind: "processing",
            rentalNumber: intent.rentalNumber,
            documentsToken,
          });
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
  }, [
    isResume,
    stripe,
    intent.clientSecret,
    intent.rentalNumber,
    intent.documentsToken,
    onOutcome,
  ]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (stripe === null || elements === null || processing) return;

      setProcessing(true);
      setError(null);

      // Written BEFORE confirming: if Stripe navigates away for 3-D Secure the
      // next line of this function never runs.
      stashForReturn(intent, rentalId);

      // Same page, so a returning customer lands on the booking they were on.
      //
      // DELIBERATELY NOT the documents page, tempting as that is now there is
      // one. The stash above is keyed to this URL: `readPaymentReturn()` only
      // fires where Stripe's `payment_intent_client_secret` and the stash meet,
      // and the whole resume path — re-checking whether the hop actually
      // succeeded before offering the form again — lives on the booking page.
      // Sending 3-D Secure straight to `/booking/documents/…` would strand that
      // stash, skip the "did this actually pay?" check, and lose the outcome.
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
      // Straight off the intent that was just paid, so the handoff link and the
      // charge provably belong to the same rental.
      const documentsToken = intent.documentsToken ?? null;
      if (paymentIntent.status === "succeeded") {
        onOutcome({
          kind: "succeeded",
          rentalNumber: intent.rentalNumber,
          documentsToken,
        });
        return;
      }
      if (paymentIntent.status === "processing") {
        onOutcome({
          kind: "processing",
          rentalNumber: intent.rentalNumber,
          documentsToken,
        });
        return;
      }

      clearReturnStash();
      setProcessing(false);
      setError(
        "That payment was not completed. Nothing has been charged — please try again.",
      );
    },
    [stripe, elements, processing, intent, rentalId, onOutcome],
  );

  if (checkingReturn) {
    return <BusyView label="Checking that payment…" />;
  }

  const ready = stripe !== null && elements !== null;
  const payLabel = formatIntentAmount(intent.amount, intent.currency) ?? amountLabel;

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

  /**
   * The upload step, offered only when there is a real link to offer.
   *
   * SUCCEEDED ONLY, on purpose. A `processing` payment has not been taken yet;
   * pushing that customer into an upload flow invites them to do work on a
   * booking their bank may still decline, so they are told the link is coming
   * by email and nothing more. And a null token — the endpoint not yet
   * redeployed, or an older 3-D Secure stash — falls back to the plain Done
   * button rather than a link that would 404. The email carries the same link,
   * so no customer is stranded by that fallback.
   */
  const documentsHref =
    succeeded && outcome.documentsToken !== null
      ? bookingDocumentsHref(outcome.documentsToken)
      : null;

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
