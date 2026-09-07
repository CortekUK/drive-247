"use client";

/**
 * Step 3 of the dialog — payment, inline, with Stripe's real Payment Element.
 *
 * WHAT IS REAL HERE, EXACTLY
 * --------------------------
 * The card form is Stripe's own, mounted with a **test-mode publishable key**
 * (`journeyStripePublishableKey`, which refuses any key not prefixed
 * `pk_test_`). The fields, the card-brand detection, the inline validation and
 * the error messages are Stripe's, not a mock-up. On submit, `elements.submit()`
 * runs Stripe's validation and `stripe.createPaymentMethod({ elements })`
 * tokenises the card against Stripe's **test** API — so a malformed number is
 * rejected by Stripe itself, and what comes back is a genuine test-mode
 * PaymentMethod carrying the real brand and last four digits, which the next
 * screen shows.
 *
 * WHAT IS NOT REAL
 * ----------------
 * No PaymentIntent, no Customer and no Subscription is created, and **no money
 * moves**. The live step gets its client secret from `signup-payment-intent`,
 * which creates a Stripe Customer and an incomplete Subscription for an
 * authenticated user with signup metadata — i.e. it requires a real
 * `auth.users` row to already exist. Calling it would create precisely what this
 * route promises not to create, so it is not called, and the "payment succeeded"
 * transition is ours, not Stripe's.
 *
 * That is why Elements runs in **deferred-intent mode** (`mode` + `amount`
 * instead of `clientSecret`): it is the only way to render the genuine Payment
 * Element with no intent behind it.
 *
 * `mode: "payment"` rather than `"subscription"`, deliberately: it is the
 * configuration Stripe documents alongside `paymentMethodCreation: "manual"`,
 * and an integration error in `stripe.elements()` throws during render. The
 * amount and the wording on screen still describe the monthly subscription the
 * live flow actually starts.
 *
 * NO HINTS ON SCREEN. Nothing here names a card number, an expiry or a postcode.
 * This has to read as the checkout an operator would actually be handed.
 */

import * as React from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { Stripe, StripeElementsOptions } from "@stripe/stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CreditCard, Loader2, Lock, TriangleAlert } from "lucide-react";
import { useTheme } from "next-themes";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { journeyStripePublishableKey } from "@/lib/signup-journey";
import { formatPlanPriceUsd, type SignupPlan } from "@/lib/plans";

/** What the card step hands to the handoff screen. */
export interface JourneyPaymentOutcome {
  /** Card brand as Stripe reported it ("visa"), or null when not reached. */
  brand: string | null;
  last4: string | null;
  /**
   * True when Stripe was never reached — no key, blocked script, or an
   * infrastructure error. The next screen simply stays quiet about the card
   * rather than claiming one was checked.
   */
  simulated: boolean;
}

/**
 * `loadStripe` memoised per key. Calling it during render mints a new Stripe
 * instance every time, which remounts the iframe and throws away whatever was
 * typed into the card field.
 */
const stripeJsCache = new Map<string, Promise<Stripe | null>>();

/**
 * A blocked Stripe.js request very often STALLS rather than failing, so
 * `loadStripe` never settles and there is no error event to catch. Without a
 * deadline the card area renders a skeleton for ever with nothing explaining it.
 */
const STRIPE_JS_TIMEOUT_MS = 12_000;

/**
 * The Payment Element runs in a cross-origin iframe, so `fontFamily: "inherit"`
 * — which is what this used to say — resolves against THAT document, not ours.
 * The result was a card form in the browser's default serif sitting inside a
 * sans-serif page. A named stack is the only thing that crosses the boundary.
 *
 * `Inter` first because the site is set in it (`next/font/google` in the root
 * layout); the system stack behind it is what actually renders when the iframe
 * has no copy of Inter, and it is close enough that nothing looks borrowed.
 */
const ELEMENTS_FONT_FAMILY =
  'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function getStripeJs(
  publishableKey: string,
  attempt: number,
): Promise<Stripe | null> {
  const cacheKey = `${attempt}::${publishableKey}`;
  const cached = stripeJsCache.get(cacheKey);
  if (cached) return cached;
  let promise: Promise<Stripe | null>;
  try {
    promise = loadStripe(publishableKey);
  } catch (e) {
    // A malformed key throws synchronously; normalise it into the same rejected
    // path as a network failure.
    promise = Promise.reject(e);
  }
  stripeJsCache.set(cacheKey, promise);
  return promise;
}

type StripeJsState = "loading" | "ready" | "failed";

interface JourneyPaymentStepProps {
  plan: SignupPlan;
  /** The address given on the account step, handed to Stripe as a default. */
  email: string;
  onBack(): void;
  onPaid(outcome: JourneyPaymentOutcome): void;
}

export function JourneyPaymentStep({
  plan,
  email,
  onBack,
  onPaid,
}: JourneyPaymentStepProps) {
  const { resolvedTheme } = useTheme();

  // Resolved once: reading env on every render is free, but a changing value
  // would remount Elements.
  const publishableKey = React.useMemo(() => journeyStripePublishableKey(), []);

  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const [stripeJs, setStripeJs] = React.useState<StripeJsState>("loading");

  const stripePromise = React.useMemo(
    () => (publishableKey ? getStripeJs(publishableKey, loadAttempt) : null),
    [publishableKey, loadAttempt],
  );

  /**
   * Resolve Stripe.js ourselves before mounting `<Elements>`: `loadStripe`
   * RESOLVES TO NULL when the script is blocked outright, and
   * `<Elements stripe={null}>` renders a permanently empty box instead of
   * failing.
   */
  React.useEffect(() => {
    if (!stripePromise) {
      setStripeJs("failed");
      return;
    }
    let settled = false;
    setStripeJs("loading");

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setStripeJs("failed");
    }, STRIPE_JS_TIMEOUT_MS);

    stripePromise
      .then((stripe) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        setStripeJs(stripe ? "ready" : "failed");
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        setStripeJs("failed");
      });

    return () => {
      // Doubles as the unmount guard: nothing above may setState after teardown.
      settled = true;
      window.clearTimeout(timer);
    };
  }, [stripePromise]);

  /**
   * Memoised on `resolvedTheme` alone. A fresh object identity every render
   * makes react-stripe-js re-issue `elements.update()` continuously, which
   * visibly flickers the card field.
   */
  const appearance = React.useMemo<StripeElementsOptions["appearance"]>(
    () => ({
      theme: resolvedTheme === "dark" ? "night" : "stripe",
      variables: {
        colorPrimary: "#6366f1",
        borderRadius: "8px",
        fontFamily: ELEMENTS_FONT_FAMILY,
      },
    }),
    [resolvedTheme],
  );

  const elementsOptions = React.useMemo<StripeElementsOptions>(
    () => ({
      mode: "payment",
      amount: plan.amountCents,
      currency: plan.currency,
      // Card only: it is what the live flow uses, and it keeps every redirect
      // payment method — which would take the browser away mid-flow — off the
      // element entirely.
      paymentMethodTypes: ["card"],
      // Required to call `stripe.createPaymentMethod({ elements })` without an
      // intent to confirm.
      paymentMethodCreation: "manual",
      appearance,
    }),
    [plan.amountCents, plan.currency, appearance],
  );

  const price = formatPlanPriceUsd(plan);

  const carryOnWithoutCard = (reason: string) => {
    console.info(`[signup-journey] continued without a card: ${reason}`);
    onPaid({ brand: null, last4: null, simulated: true });
  };

  return (
    <div>
      {/* The amount, stated once, in type rather than in a box. */}
      <div className="flex items-baseline justify-between gap-6">
        <span className="text-sm text-muted-foreground">Due today</span>
        <span className="text-[32px] leading-none font-bold tracking-tighter">
          {price}
        </span>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        This starts your monthly subscription. Today covers your first month, it
        renews on the same date each month, and you can manage it from your
        portal at any time.
      </p>

      <Separator className="my-7" />

      {!publishableKey ? (
        <PaymentUnavailablePanel
          onSkip={() => carryOnWithoutCard("no test publishable key available")}
        />
      ) : stripeJs === "failed" ? (
        <PaymentUnavailablePanel
          onRetry={() => {
            stripeJsCache.clear();
            setLoadAttempt((n) => n + 1);
          }}
          onSkip={() => carryOnWithoutCard("Stripe.js did not load")}
        />
      ) : stripeJs === "loading" ? (
        <div
          className="space-y-2"
          role="status"
          aria-label="Loading the secure payment form"
        >
          <div className="h-11 animate-pulse rounded-md bg-muted" />
          <div className="h-11 animate-pulse rounded-md bg-muted" />
          <div className="h-11 animate-pulse rounded-md bg-muted" />
        </div>
      ) : (
        <ElementsBoundary
          onFallback={() =>
            carryOnWithoutCard("Stripe Elements failed to mount")
          }
        >
          <Elements stripe={stripePromise} options={elementsOptions}>
            <JourneyCardForm
              plan={plan}
              email={email}
              onBack={onBack}
              onPaid={onPaid}
              onSkip={carryOnWithoutCard}
            />
          </Elements>
        </ElementsBoundary>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The card form. Must live inside <Elements> — useStripe/useElements read it
// from context.
// ---------------------------------------------------------------------------

function JourneyCardForm({
  plan,
  email,
  onBack,
  onPaid,
  onSkip,
}: {
  plan: SignupPlan;
  email: string;
  onBack(): void;
  onPaid(outcome: JourneyPaymentOutcome): void;
  onSkip(reason: string): void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  const [submitting, setSubmitting] = React.useState(false);
  const [elementReady, setElementReady] = React.useState(false);
  const [elementError, setElementError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  /**
   * Backstop for a Payment Element that never becomes interactive. Stripe emits
   * `onLoadError` for most failures but not all — a throw inside
   * `stripe.elements()` surfaces as an unhandled rejection that never reaches
   * this component — so the timer guarantees something actionable appears.
   */
  React.useEffect(() => {
    if (elementReady || elementError) return;
    const timer = window.setTimeout(() => {
      setElementError(
        "The card form didn't finish loading. Check your connection and try again.",
      );
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [elementReady, elementError]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !stripe || !elements) return;

    setSubmitting(true);
    setMessage(null);

    try {
      // Stripe's own validation of what is in the fields. Returns an error for
      // an empty or malformed card without touching the network.
      const { error: submitError } = await elements.submit();
      if (submitError) {
        // `||`, not `??`. Stripe can answer with an EMPTY message — its inline
        // validation has already marked the offending field inside the iframe
        // and it does not always repeat itself — and an empty string is a
        // perfectly good value that `??` would keep. The row below only renders
        // when `message` is truthy, so that produced the worst outcome
        // available: a button that visibly did nothing and explained nothing.
        setMessage(submitError.message || "Please check your card details.");
        return;
      }

      // The one real network call on this screen. Creates a TEST-mode
      // PaymentMethod — an object, not a charge.
      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod(
        { elements },
      );

      if (pmError) {
        if (
          pmError.type === "card_error" ||
          pmError.type === "validation_error"
        ) {
          // Stripe's own wording names the actual reason and is far more
          // useful than anything we would write. `||` for the same reason as
          // above: an empty message must still put something on screen.
          setMessage(pmError.message || "Please check your card details.");
          return;
        }
        // Infrastructure, not the card. This must not dead-end.
        onSkip(`createPaymentMethod failed: ${pmError.type}`);
        return;
      }

      onPaid({
        brand: paymentMethod?.card?.brand ?? null,
        last4: paymentMethod?.card?.last4 ?? null,
        simulated: false,
      });
    } catch (e) {
      console.warn(
        "[signup-journey] Stripe threw during payment method creation:",
        e,
      );
      // A throw is NOT automatically grounds for carrying on as though the card
      // had been taken. Stripe throws for two very different situations and
      // they need opposite handling:
      //
      //   - the element is not mounted yet. Entirely recoverable — the fields
      //     are seconds away. Say so and let them press again. Skipping here
      //     is what turned "you pressed too early" into "You're live."
      //   - anything else is infrastructure, and dead-ending someone who has
      //     just typed a card is worse than continuing without one.
      const notReady =
        !elementReady ||
        (e instanceof Error && /ready element/i.test(e.message));
      if (notReady) {
        setMessage("The card form is still loading. Give it a moment and try again.");
        return;
      }
      onSkip("Stripe threw during payment method creation");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* The element renders its own labels and inline validation inside its
          iframe — it must not be wrapped in a <Label>, which would point at
          nothing. */}
      {/*
        `defaultValues.billingDetails.email` is the address collected on the
        account step, and it is load-bearing, not a courtesy.
        ────────────────────────────────────────────────────────────────────
        Stripe offers Link's "Save my information for faster checkout" inside
        this element. With no email to work from it renders that section
        EXPANDED — email, mobile, full name — and `elements.submit()` then
        refuses until the email is filled, even though the section is labelled
        "Optional". Handing Stripe the address it is asking for collapses that
        section back to a single checkbox and lets validation pass, and it
        spares the operator retyping the address they gave a screen ago.

        There is deliberately NO `onChange` clearing the error message here.
        Stripe fires `onChange` for its own re-renders — including the one that
        expands the Link section on a failed submit — so a handler that wiped
        `message` on change erased the reason for the failure in the same frame
        it appeared, leaving a button that visibly did nothing and said nothing.
        The message is cleared where it should be: at the top of the next
        submit.
      */}
      <PaymentElement
        options={{
          layout: "tabs",
          defaultValues: email ? { billingDetails: { email } } : undefined,
        }}
        onReady={() => setElementReady(true)}
        onLoadError={({ error }) => {
          console.error(
            "[signup-journey] PaymentElement failed to load:",
            error,
          );
          setElementError(
            error?.message ||
              "The card form couldn't load. Check your connection and try again.",
          );
        }}
      />

      {!elementReady && elementError && (
        <div className="mt-4">
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>We couldn&apos;t load the card form</AlertTitle>
            <AlertDescription>{elementError}</AlertDescription>
          </Alert>
          <SkipLink onClick={() => onSkip("card form never became ready")} />
        </div>
      )}

      {/*
        No skeleton of our own under the element. `<PaymentElement>` renders
        Stripe's loader inside its own iframe while it is coming up, so a second
        set of grey bars underneath it is two loading states stacked — and on a
        slow connection, which is exactly when it shows, it stays on screen long
        enough to read as a broken layout. The 15-second backstop above is what
        covers an element that never arrives at all.
      */}

      <div aria-live="polite" className="mt-4 min-h-5">
        {submitting && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Confirming your card…
          </p>
        )}
        {!submitting && message && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {message}
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        // `elementReady` is part of this, and it is load-bearing. Without it the
        // button went live the moment Stripe.js finished loading, while the card
        // fields were STILL SKELETONS — press it then and `createPaymentMethod`
        // throws "Could not find a ready element to create a payment method
        // from", which used to land in the catch below and carry the journey
        // forward to "You're live." A payment that never happened, reported as
        // success. On a slow connection that is the likeliest thing to happen
        // in front of an audience.
        disabled={submitting || !stripe || !elements || !elementReady}
        className="mt-4 h-12 w-full bg-indigo-600 text-[15px] text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Confirming…
          </>
        ) : (
          <>
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            Pay {formatPlanPriceUsd(plan)} and continue
          </>
        )}
      </Button>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden="true" />
          Card details go straight to Stripe. We never see them.
        </p>
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
        >
          Back
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Non-Elements states
// ---------------------------------------------------------------------------

/**
 * The escape hatch, and the only place it is offered.
 *
 * Deliberately not a general "skip payment" button: the point of this step is
 * the card form, so the way past it appears only where the card form has
 * already failed.
 */
function SkipLink({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 text-sm font-semibold text-indigo-600 underline underline-offset-4 dark:text-indigo-400"
    >
      Skip for now and add a card from your portal
    </button>
  );
}

/**
 * One panel for every reason the card form cannot be shown. The operator never
 * needs to know which — the remedy is the same either way.
 */
function PaymentUnavailablePanel({
  onRetry,
  onSkip,
}: {
  onRetry?(): void;
  onSkip(): void;
}) {
  return (
    <div>
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>We couldn&apos;t load the payment form</AlertTitle>
        <AlertDescription>
          Our payment provider didn&apos;t load — an ad blocker or a filtering
          proxy is the usual cause. Check that, then try again.
        </AlertDescription>
      </Alert>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {onRetry && (
          <Button type="button" variant="outline" onClick={onRetry}>
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        )}
        <SkipLink onClick={onSkip} />
      </div>
    </div>
  );
}

/**
 * Catches a synchronous throw out of `stripe.elements()`.
 *
 * `<Elements>` builds the elements group during render, so an integration error
 * in the options object throws through React rather than resolving as a
 * rejected promise — which would take the whole dialog down to a blank panel at
 * the exact moment someone is watching it. This turns that into the carry-on
 * path instead.
 *
 * A class because `componentDidCatch` has no hook equivalent.
 */
class ElementsBoundary extends React.Component<
  { onFallback(): void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  /**
   * `componentDidCatch` rather than `getDerivedStateFromError` for the callback:
   * it runs in the commit phase, so telling the parent to move on is not a
   * setState during another component's render — and it fires exactly once per
   * error, so there is no loop to guard against.
   */
  componentDidCatch(error: unknown) {
    console.error("[signup-journey] Stripe Elements failed to mount:", error);
    this.props.onFallback();
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          One moment…
        </div>
      );
    }
    return this.props.children;
  }
}
