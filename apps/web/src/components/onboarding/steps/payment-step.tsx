"use client";

/**
 * Step 2 of the self-serve signup dialog — take the first subscription payment
 * INLINE, without ever leaving the dialog.
 *
 * How that is possible: `signup-payment-intent` creates the subscription with
 * `payment_behavior: "default_incomplete"` and
 * `payment_method_types: ["card"]`, then hands us the first invoice's
 * PaymentIntent client secret. Card-only is load-bearing — it means a 3-D
 * Secure challenge renders in Stripe's own iframe instead of a full-page
 * redirect, so `redirect: "if_required"` genuinely never redirects. The
 * `return_url` we pass is a legally-required fallback that is not expected to
 * fire.
 *
 * The second thing shaping this file: **a successful confirm charges a real
 * card and there is no client-side refund.** So every failure mode below is
 * handled explicitly and the step never guesses. In particular it never renders
 * an empty Elements box: if the publishable key or the client secret is
 * missing, that is a configuration failure and it says so, with a way out.
 */

import * as React from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { Stripe, StripeElementsOptions } from "@stripe/stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CreditCard, Loader2, Lock, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTheme } from "next-themes";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type {
  OnboardingError,
  PaymentStepProps,
} from "@/components/onboarding/onboarding-types";
import { SIGNUP_ERROR_COPY } from "@/components/onboarding/onboarding-types";

/**
 * `loadStripe` memoised per publishable key.
 *
 * Calling it during render creates a NEW Stripe instance every time, which
 * remounts the Elements iframe and throws away whatever the user had typed into
 * the card field. Module scope (not a ref) because the dialog can be closed and
 * reopened, and re-downloading Stripe.js on every reopen is a visible stall.
 */
const stripeJsCache = new Map<string, Promise<Stripe | null>>();

/**
 * How long to wait for Stripe.js before declaring it unavailable.
 *
 * THIS IS THE DIFFERENCE BETWEEN A FAILURE MESSAGE AND AN ETERNAL SKELETON.
 * `loadStripe` injects a <script> and settles on its `onload` / `onerror`. A
 * content blocker, corporate proxy or captive portal frequently STALLS that
 * request instead of failing it — no error event ever fires, so the promise
 * never settles, `stripeJs` stays "loading", and the card area renders its
 * placeholder forever with nothing on screen explaining why.
 *
 * 12s is comfortably past a slow-but-working 3G fetch of the ~200KB script
 * (which the dialog-open prewarm has usually already cached anyway), while
 * being short enough that a blocked user gets an actionable message instead of
 * assuming the site is broken.
 */
const STRIPE_JS_TIMEOUT_MS = 12_000;

/**
 * `attempt` is part of the cache key, not a decoration.
 *
 * A failed load must be genuinely re-attemptable, and the publishable key is
 * identical across attempts — so keying on the key alone meant every retry
 * handed back the SAME promise, including the one that had hung forever behind
 * a content blocker. Bumping the attempt yields a fresh key, hence a fresh
 * `loadStripe`, and leaves the dead promise behind rather than awaiting it
 * again.
 */
function getStripeJs(publishableKey: string, attempt: number): Promise<Stripe | null> {
  const cacheKey = `${attempt}::${publishableKey}`;
  const cached = stripeJsCache.get(cacheKey);
  if (cached) return cached;
  // loadStripe can throw synchronously on a malformed key; normalise that into
  // the same rejected-promise path as a network failure.
  let promise: Promise<Stripe | null>;
  try {
    promise = loadStripe(publishableKey);
  } catch (e) {
    promise = Promise.reject(e);
  }
  stripeJsCache.set(cacheKey, promise);
  return promise;
}

type StripeJsState = "idle" | "loading" | "ready" | "failed";

export function PaymentStep({
  plan,
  clientSecret,
  publishableKey,
  mode,
  busy,
  error,
  onRetryIntent,
  onPaid,
  onError,
}: PaymentStepProps) {
  const { resolvedTheme } = useTheme();
  const [stripeJs, setStripeJs] = React.useState<StripeJsState>("idle");

  /**
   * Bumped by the failure panel's "Try again". It is a dependency of the memo
   * below purely so a retry produces a genuinely NEW promise: the publishable
   * key does not change between attempts, so without this the memo would hand
   * back the same hung or rejected promise and "Try again" would do nothing
   * visible.
   */
  const [loadAttempt, setLoadAttempt] = React.useState(0);

  const stripePromise = React.useMemo(
    () => (publishableKey ? getStripeJs(publishableKey, loadAttempt) : null),
    [publishableKey, loadAttempt],
  );

  const retryStripeJs = React.useCallback(() => {
    setLoadAttempt((n) => n + 1);
  }, []);

  /**
   * Resolve the Stripe.js promise ourselves before mounting `<Elements>`.
   *
   * Two distinct failures are handled here, and only one of them is obvious:
   *
   * 1. `loadStripe` RESOLVES TO NULL when the script is blocked outright —
   *    `<Elements stripe={null}>` renders a silent, permanently empty box
   *    rather than failing, so we have to detect it before mounting.
   * 2. `loadStripe` NEVER SETTLES when the request is stalled rather than
   *    refused, which is what most content blockers and filtering proxies
   *    actually do — no `onerror` fires, so there is nothing to catch. Without
   *    the timeout the component sits in "loading" indefinitely and the user
   *    stares at a skeleton with no error, no retry and no explanation.
   *
   * Both land on "failed", which renders the panel that names ad blockers as
   * the likely cause and offers a retry.
   */
  React.useEffect(() => {
    if (!stripePromise) {
      setStripeJs("idle");
      return;
    }
    let settled = false;
    setStripeJs("loading");

    // No cache eviction here: the dead entry is keyed by the CURRENT attempt,
    // and `retryStripeJs` moves to a new attempt — so a retry mints a fresh key
    // and never reaches this promise again.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      setStripeJs("failed");
    }, STRIPE_JS_TIMEOUT_MS);

    stripePromise
      .then((stripe) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        setStripeJs(stripe ? "ready" : "failed");
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        setStripeJs("failed");
      });

    return () => {
      // `settled` doubles as the unmount guard: nothing above may call setState
      // after this effect is torn down.
      settled = true;
      clearTimeout(timer);
    };
  }, [stripePromise]);

  /**
   * Appearance must track the site theme, including a mid-flow toggle.
   * Memoised on `resolvedTheme` ALONE: a fresh object identity on every render
   * makes react-stripe-js re-issue `elements.update()` continuously, which
   * visibly flickers the card field.
   */
  const appearance = React.useMemo<StripeElementsOptions["appearance"]>(
    () => ({
      theme: resolvedTheme === "dark" ? "night" : "stripe",
      variables: {
        colorPrimary: "#6366f1",
        borderRadius: "8px",
        fontFamily: "inherit",
      },
    }),
    [resolvedTheme],
  );

  const elementsOptions = React.useMemo<StripeElementsOptions | null>(
    () => (clientSecret ? { clientSecret, appearance } : null),
    [clientSecret, appearance],
  );

  // A CONFIG_MISSING from the server means an env var is absent in Supabase —
  // no amount of retrying fixes it, so we offer the human path instead.
  const isConfigError = error?.code === "CONFIG_MISSING";

  /**
   * Grace window before we are willing to call an empty step "broken".
   *
   * The provider fires `signup-payment-intent` on entering this step, and there
   * is at least one render where nothing has arrived yet and `busy` has not
   * been flipped. Declaring a configuration failure in that frame would flash a
   * red panel at every single user. Waiting a few seconds costs nothing — the
   * skeleton is showing meanwhile — and the panel then only appears when the
   * step really is stuck with nothing to render.
   */
  const [graceElapsed, setGraceElapsed] = React.useState(false);
  React.useEffect(() => {
    if (clientSecret) {
      setGraceElapsed(false);
      return;
    }
    const timer = window.setTimeout(() => setGraceElapsed(true), 4000);
    return () => window.clearTimeout(timer);
  }, [clientSecret]);

  // Nothing in flight, no secret, no key and no error to explain it: something
  // is misconfigured upstream. Treat it as a config failure rather than leaving
  // a spinner that never resolves.
  const isUnexplainedGap =
    graceElapsed &&
    !busy &&
    !isConfigError &&
    (!clientSecret || !publishableKey) &&
    !error;

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {/* Order summary — the last place the price is shown before it is taken. */}
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {plan.name}
            {mode === "test" && (
              <Badge variant="outline" className="text-[10px] tracking-wide">
                TEST MODE
              </Badge>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {plan.fleetBand}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-bold tracking-tighter">
            ${plan.priceUsd}
          </p>
          <p className="text-xs text-muted-foreground">/month</p>
        </div>
      </div>

      {mode === "test" && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          No real payment will be taken.
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        You&apos;re starting a monthly subscription. Today&apos;s payment covers
        your first month; it renews on the same date each month and you can
        manage it from your portal.
      </p>

      <Separator className="my-4" />

      {isConfigError || isUnexplainedGap ? (
        <ConfigurationErrorPanel />
      ) : stripeJs === "failed" ? (
        <StripeJsFailurePanel
          busy={busy}
          onRetryIntent={onRetryIntent}
          onRetryStripeJs={retryStripeJs}
        />
      ) : !clientSecret || !publishableKey || stripeJs !== "ready" ? (
        <PaymentSkeleton hasError={Boolean(error)} onRetryIntent={onRetryIntent} busy={busy} />
      ) : (
        // Keyed on the client secret: it is immutable once Elements is mounted,
        // so a brand-new PaymentIntent (after an expiry, or a plan change) must
        // get a brand-new Elements tree. The theme deliberately does NOT key
        // this — appearance updates in place so a theme toggle never wipes the
        // card the user is halfway through typing.
        <Elements
          key={clientSecret}
          stripe={stripePromise}
          options={elementsOptions ?? { clientSecret }}
        >
          <PaymentForm busy={busy} onPaid={onPaid} onError={onError} />
        </Elements>
      )}

      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        Payments are processed by Stripe. We never see your card details.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The card form. Must live inside <Elements> — useStripe/useElements read it
// from context.
// ---------------------------------------------------------------------------

/**
 * How long a `confirmPayment` call has to be in flight before we assume the
 * user is looking at a 3-D Secure challenge.
 *
 * Stripe.js exposes no callback for "the challenge iframe opened", and a plain
 * confirm on a card that needs no authentication resolves well inside this
 * window. So: past this point the promise is almost certainly blocked on the
 * user's bank, and saying "waiting for your bank" is more honest than a generic
 * spinner that looks stuck. It changes wording only — nothing branches on it.
 */
const BANK_CHALLENGE_HINT_MS = 2500;

function PaymentForm({
  busy,
  onPaid,
  onError,
}: {
  busy: boolean;
  onPaid(): void;
  onError(err: OnboardingError): void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const [submitting, setSubmitting] = React.useState(false);
  const [awaitingBank, setAwaitingBank] = React.useState(false);
  const [elementReady, setElementReady] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  /** Set by `onLoadError`, or by the readiness deadline below. */
  const [elementError, setElementError] = React.useState<string | null>(null);

  /**
   * Deadline for `<PaymentElement>` becoming interactive.
   *
   * `STRIPE_JS_TIMEOUT_MS` guards only `loadStripe`; by the time this component
   * renders, Stripe.js has ALREADY loaded successfully. Everything after that —
   * `stripe.elements()`, the element's own iframe, and its authenticated lookup
   * of the PaymentIntent — had no deadline at all, which is the gap that let a
   * bad publishable key present as a permanent skeleton rather than an error.
   *
   * Stripe does emit `onLoadError` for most of those failures, but not all of
   * them (a throw inside `stripe.elements()` surfaces as an unhandled rejection
   * and never reaches this component), so the timer is the backstop that
   * guarantees the user always ends up with something actionable.
   */
  React.useEffect(() => {
    if (elementReady || elementError) return;
    const timer = window.setTimeout(() => {
      setElementError(SIGNUP_ERROR_COPY.STRIPE_UNAVAILABLE);
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [elementReady, elementError]);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!submitting) {
      setAwaitingBank(false);
      return;
    }
    const timer = window.setTimeout(
      () => setAwaitingBank(true),
      BANK_CHALLENGE_HINT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [submitting]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Three independent guards, because this is the one submit in the flow
    // that moves money: local in-flight flag, the shell's busy flag, and
    // Stripe.js actually being ready.
    if (submitting || busy || !stripe || !elements) return;

    setSubmitting(true);
    setMessage(null);
    setNotice(null);

    try {
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          // Never expected to be used: card-only payments complete in the
          // iframe. Stripe requires it to be present regardless.
          return_url: `${window.location.origin}/?signup=resume`,
        },
      });

      if (stripeError) {
        handleStripeError(stripeError, { setMessage, onError });
        return;
      }

      switch (paymentIntent?.status) {
        case "succeeded":
          onPaid();
          return;

        case "processing":
          // Asynchronous payment method. Stripe has accepted it and it will
          // settle; both `signup-resume` and `signup-provision` re-verify the
          // subscription against Stripe before anything is written, so it is
          // safe to move on.
          setNotice(
            "Your payment is going through. You can carry on setting up.",
          );
          onPaid();
          return;

        case "requires_payment_method":
          setMessage(SIGNUP_ERROR_COPY.CARD_DECLINED);
          return;

        case "requires_action":
        case "requires_confirmation":
          // With `redirect: "if_required"` Stripe resolves these itself, so
          // landing here means authentication was started and abandoned.
          setMessage(SIGNUP_ERROR_COPY.CARD_AUTH_FAILED);
          return;

        case "canceled":
          onError({
            code: "PAYMENT_EXPIRED",
            message: SIGNUP_ERROR_COPY.PAYMENT_EXPIRED,
          });
          return;

        default:
          setMessage(SIGNUP_ERROR_COPY.INTERNAL);
          return;
      }
    } catch {
      // confirmPayment rejecting (rather than resolving with an error) is a
      // transport failure. No charge was taken.
      setMessage(SIGNUP_ERROR_COPY.STRIPE_UNAVAILABLE);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form id="signup-payment-form" onSubmit={handleSubmit} noValidate>
      {/*
        `layout: "tabs"` matches the rest of the platform's Stripe surfaces.
        The element renders its own labels and inline field validation, and it
        is keyboard-accessible inside its iframe — we must not wrap it in our
        own <Label>, which would point at nothing.
      */}
      <PaymentElement
        options={{ layout: "tabs" }}
        onReady={() => setElementReady(true)}
        /**
         * The one event that names why the card form did not appear.
         *
         * It was previously not wired at all, and that is how a corrupted
         * `STRIPE_UAE_LIVE_PUBLISHABLE_KEY` cost a day: Stripe.js loaded fine,
         * <Elements> mounted fine, and then the element could not authenticate
         * to resolve the PaymentIntent. `onReady` simply never fired, the two
         * placeholder bars below rendered forever, and the only trace was an
         * error in the browser console that nobody was looking at.
         */
        onLoadError={({ error: loadError }) => {
          console.error("[signup] PaymentElement failed to load:", loadError);
          setElementError(
            loadError?.message ?? SIGNUP_ERROR_COPY.STRIPE_UNAVAILABLE,
          );
        }}
        onChange={() => {
          // Any edit invalidates the previous decline message.
          if (message) setMessage(null);
        }}
      />

      {/*
        A card form that never becomes ready must not read as "still loading"
        indefinitely. Whichever arrives first — an explicit load error or the
        readiness deadline — replaces the placeholder with something the user
        can act on.
      */}
      {!elementReady && elementError && (
        <Alert variant="destructive" className="mt-3">
          <TriangleAlert />
          <AlertTitle>We couldn&apos;t load the card form</AlertTitle>
          <AlertDescription>{elementError}</AlertDescription>
        </Alert>
      )}

      {!elementReady && !elementError && (
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          <div className="h-10 animate-pulse rounded-md bg-muted" />
        </div>
      )}

      {/*
        One polite live region for every asynchronous state this step can be in,
        so a screen-reader user is told what is happening without having to go
        looking for it.
      */}
      <div aria-live="polite" className="mt-3 space-y-2">
        {submitting && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {awaitingBank
              ? "Waiting for your bank…"
              : "Confirming your payment…"}
          </p>
        )}
        {notice && !message && (
          <p className="text-sm text-muted-foreground">{notice}</p>
        )}
        {message && <p className="text-sm text-red-600 dark:text-red-400">{message}</p>}
      </div>
    </form>
  );
}

/**
 * Maps a Stripe.js error onto either an inline message (the user can fix it
 * right here) or an `OnboardingError` for the shell (the step itself cannot
 * recover — the PaymentIntent needs recreating).
 *
 * Nothing is reported through BOTH channels: the shell renders its own banner
 * from `state.error`, so surfacing a decline that way as well would print the
 * same sentence twice.
 */
function handleStripeError(
  stripeError: { type?: string; code?: string; message?: string },
  {
    setMessage,
    onError,
  }: {
    setMessage(msg: string): void;
    onError(err: OnboardingError): void;
  },
): void {
  const code = stripeError.code ?? "";

  // The PaymentIntent is gone or in a state that cannot be confirmed — usually
  // an `incomplete_expired` subscription (~23 h). Nothing was charged; the
  // shell mints a fresh one.
  if (
    code === "payment_intent_unexpected_state" ||
    code === "resource_missing" ||
    code === "payment_intent_incompatible_payment_method"
  ) {
    onError({
      code: "PAYMENT_EXPIRED",
      message: stripeError.message ?? SIGNUP_ERROR_COPY.PAYMENT_EXPIRED,
    });
    return;
  }

  if (code === "payment_intent_authentication_failure") {
    setMessage(SIGNUP_ERROR_COPY.CARD_AUTH_FAILED);
    return;
  }

  if (stripeError.type === "card_error") {
    // Stripe's own message names the actual reason ("Your card has
    // insufficient funds.") and is far more actionable than our generic copy.
    setMessage(stripeError.message ?? SIGNUP_ERROR_COPY.CARD_DECLINED);
    return;
  }

  if (stripeError.type === "validation_error") {
    setMessage(stripeError.message ?? "Please check your card details.");
    return;
  }

  if (
    stripeError.type === "api_connection_error" ||
    stripeError.type === "api_error" ||
    stripeError.type === "rate_limit_error"
  ) {
    setMessage(SIGNUP_ERROR_COPY.STRIPE_UNAVAILABLE);
    return;
  }

  setMessage(stripeError.message ?? SIGNUP_ERROR_COPY.INTERNAL);
}

// ---------------------------------------------------------------------------
// Non-Elements states
// ---------------------------------------------------------------------------

/**
 * EVERY branch of this step renders `<form id="signup-payment-form">`, including
 * the ones that have no card field in them.
 *
 * The dialog footer holds the step's primary button and reaches this form by id
 * (`<Button type="submit" form="signup-payment-form">`). It disables that button
 * only while `state.payment.clientSecret` is null — which it cannot improve on,
 * because whether Stripe.js finished loading is known only here. So in the
 * window where a client secret HAS arrived but Elements is not mounted (Stripe.js
 * still downloading, or blocked outright), the footer shows an enabled
 * "Pay $199 and continue" button. If the fallback branches rendered a bare
 * `<div>`, that button would point at nothing and clicking it would do nothing
 * at all — a dead primary CTA on the one screen that takes money.
 *
 * Giving each fallback the same form id with a submit handler that performs that
 * branch's own recovery means the footer button is always live and always does
 * the most sensible thing available.
 */
function FallbackForm({
  onSubmit,
  children,
}: {
  onSubmit?(): void;
  children: React.ReactNode;
}) {
  return (
    <form
      id="signup-payment-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      {children}
    </form>
  );
}

function PaymentSkeleton({
  hasError,
  busy,
  onRetryIntent,
}: {
  hasError: boolean;
  busy: boolean;
  onRetryIntent(): void;
}) {
  // When the shell is carrying an error it has already rendered the banner —
  // all this needs to add is the way to try again.
  if (hasError && !busy) {
    return (
      <FallbackForm onSubmit={onRetryIntent}>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t load the payment form.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={onRetryIntent}
          className="mt-3"
        >
          <CreditCard className="h-4 w-4" />
          Try again
        </Button>
      </FallbackForm>
    );
  }

  return (
    // No submit handler: the intent (or Stripe.js) is still on its way, and the
    // right response to an early press is to swallow it, not to restart a
    // request that is already in flight.
    <FallbackForm>
      <div
        className="space-y-2"
        role="status"
        aria-label="Loading the secure payment form"
      >
        <div className="h-10 animate-pulse rounded-md bg-muted" />
        <div className="h-10 animate-pulse rounded-md bg-muted" />
        <div className="h-10 animate-pulse rounded-md bg-muted" />
      </div>
    </FallbackForm>
  );
}

/** §5 row 14 — Stripe.js itself never loaded. */
function StripeJsFailurePanel({
  busy,
  onRetryIntent,
  onRetryStripeJs,
}: {
  busy: boolean;
  onRetryIntent(): void;
  onRetryStripeJs(): void;
}) {
  // Clearing the cache alone was not enough to retry. `stripePromise` is
  // memoised on the publishable key, and the key is identical between attempts,
  // so the memo never re-ran and the component kept awaiting the promise it
  // already had. `onRetryStripeJs` bumps an attempt counter that the memo also
  // depends on, which is what actually forces a fresh `loadStripe`.
  const retry = () => {
    if (busy) return;
    stripeJsCache.clear();
    onRetryStripeJs();
    onRetryIntent();
  };

  return (
    <FallbackForm onSubmit={retry}>
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>We couldn&apos;t load the payment form</AlertTitle>
        <AlertDescription>
          {SIGNUP_ERROR_COPY.STRIPE_JS_UNAVAILABLE}
        </AlertDescription>
      </Alert>
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={retry}
        className="mt-3"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CreditCard className="h-4 w-4" />
        )}
        Try again
      </Button>
    </FallbackForm>
  );
}

/** §5 row 36 — a Stripe key is missing server-side. Retrying cannot fix it. */
function ConfigurationErrorPanel() {
  return (
    // Deliberately inert. The dialog hides its primary button for a
    // CONFIG_MISSING error, but this panel also covers `isUnexplainedGap`, where
    // there is no error code for the dialog to react to — so the form still has
    // to exist, and submitting it must not pretend a retry will help.
    <FallbackForm>
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Signup is temporarily unavailable</AlertTitle>
        <AlertDescription>{SIGNUP_ERROR_COPY.CONFIG_MISSING}</AlertDescription>
      </Alert>
      <Button
        asChild
        className="mt-4 bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        <a href="/strategy-call">Book a strategy call</a>
      </Button>
    </FallbackForm>
  );
}
