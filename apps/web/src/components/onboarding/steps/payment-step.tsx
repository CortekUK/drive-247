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
import { CreditCard, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTheme } from "next-themes";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type {
  OnboardingError,
  PaymentStepProps,
} from "@/components/onboarding/onboarding-types";
import { SIGNUP_ERROR_COPY } from "@/components/onboarding/onboarding-types";
import { isMockSignup, mockCardOutcome, mockMarkPaid } from "@/components/onboarding/mock-signup";
import type { SignupPlan } from "@/lib/plans";
import type { PromoOffer } from "@/lib/promo-offer";
import { readReferralCodeFromDocument } from "@/lib/referral-cookie";
import { ScreenHead, SIGNUP_ENTER } from "@/components/onboarding/signup-ui";

/** "13 Oct 2026" — the day a trial ends and the card is first charged. */
function formatDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** The same day `n` months on, or that month's last day when it is shorter. */
function addMonths(from: Date, n: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth() + n, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(from.getDate(), lastDay));
  return d;
}

type BillingStop = { when: string; what: string; cents: number; wasCents?: number };

/**
 * What the card is charged, and when, from today until the price settles.
 *
 * Stripe bills a monthly subscription on the same day each month, clamped to
 * the month's last day (31 Jan -> 28 Feb), which is what `addMonths` does. A
 * code changes the first invoice (`amountDueCents`, Stripe's own figure) and,
 * when it repeats, the invoices after it until it runs out.
 */
function billingTimeline(
  plan: SignupPlan,
  promo: PromoOffer | null | undefined,
  amountDueCents: number | null | undefined,
): BillingStop[] {
  const today = new Date();
  const day = (n: number) => formatDay(addMonths(today, n).toISOString()) ?? "";
  const full = plan.amountCents;
  const discounted = promo && typeof amountDueCents === "number" ? amountDueCents : null;

  if (discounted === null || !promo) {
    return [
      { when: "Today", what: "Your first month", cents: full },
      { when: day(1), what: "Then every month on this date", cents: full },
    ];
  }

  const first: BillingStop = {
    when: "Today",
    what:
      promo.kind === "referral" && promo.referrerName
        ? `First month, with ${promo.referrerName}'s referral`
        : `First month, with ${promo.displayCode}`,
    cents: discounted,
    wasCents: full,
  };
  if (promo.duration === "forever") {
    return [first, { when: day(1), what: "Every month after, discount included", cents: discounted, wasCents: full }];
  }
  const months = promo.duration === "repeating" ? Math.max(1, promo.durationMonths ?? 1) : 1;
  if (months === 1) {
    return [first, { when: day(1), what: "Back to the full price, every month", cents: full }];
  }
  return [
    first,
    {
      when: day(1),
      what: months === 2 ? "Second month, discount still on" : `Months 2 to ${months}, discount still on`,
      cents: discounted,
      wasCents: full,
    },
    { when: day(months), what: "Discount ends, full price every month", cents: full },
  ];
}

/** "$79", "$79.20" from cents. */
function formatCents(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

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
 * Loaded into Stripe's iframe so the card form uses the site font (Inter).
 * Module-level on purpose: `fonts` is set once when <Elements> mounts, and a new
 * array identity on a theme toggle would trip react-stripe-js's
 * "unsupported prop change" warning.
 */
const STRIPE_ELEMENT_FONTS = [
  { cssSrc: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" },
];

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

/**
 * Narrow or wide, from the card form's height. The saved-Link view is about
 * 190px tall; the full card form (number, expiry, CVC, country, terms) is well
 * over 300px. Two thresholds so a few pixels of jitter never flip it back and
 * forth.
 */
const WIDE_ON_PX = 280;
const WIDE_OFF_PX = 240;

function useWideFlag(onWideChange?: (wide: boolean) => void) {
  const [on, setOn] = React.useState(false);
  const measure = React.useCallback((px: number) => {
    setOn((was) => (was ? px >= WIDE_OFF_PX : px >= WIDE_ON_PX));
  }, []);
  React.useEffect(() => {
    onWideChange?.(on);
  }, [on, onWideChange]);
  // Leaving the step puts the screen back to its narrow width.
  React.useEffect(() => () => onWideChange?.(false), [onWideChange]);
  return { on, measure };
}

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
  amountDueCents = null,
  promo = null,
  promoNotice = null,
  intentType = "payment",
  trialDays = 0,
  trialEndsAt = null,
  onApplyPromo,
  ownerName = "",
  companyName = "",
  onWideChange,
}: PaymentStepProps) {
  const wide = useWideFlag(onWideChange);
  const isTrial = intentType === "setup";

  const timeline = billingTimeline(plan, promo, amountDueCents);
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
  const appearance = React.useMemo<StripeElementsOptions["appearance"]>(() => {
    const dark = resolvedTheme === "dark";
    // Phones: 16px text in the card fields. iOS zooms the whole page into any
    // field set smaller than 16px the moment it is tapped (card number, expiry,
    // security code), and leaves it zoomed. Desktop keeps 15px.
    const phone =
      typeof window !== "undefined" && window.matchMedia("(max-width: 639.98px)").matches;
    // The Payment Element renders in Stripe's iframe, where `fontFamily:
    // "inherit"` has no page to inherit from: the labels fell back to the
    // browser serif (Sep 17 2026 screenshot). Name the site's font and load it
    // into the iframe through `fonts` below, and use the site's indigo (the
    // plan cards' `bg-indigo-600` / dark `bg-indigo-500`) for focus and accents.
    const brand = dark ? "#6366f1" : "#4f46e5";
    return {
      theme: dark ? "night" : "stripe",
      variables: {
        colorPrimary: brand,
        colorText: dark ? "#fafafa" : "#18181b",
        colorTextSecondary: dark ? "#a1a1aa" : "#52525b",
        colorTextPlaceholder: dark ? "#71717a" : "#a1a1aa",
        colorDanger: dark ? "#f87171" : "#dc2626",
        colorBackground: dark ? "#13131d" : "#ffffff",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontSizeBase: phone ? "16px" : "15px",
        fontWeightNormal: "400",
        fontWeightMedium: "500",
        borderRadius: "12px",
        spacingUnit: "4px",
      },
      rules: {
        ".Label": { fontWeight: "500", marginBottom: "6px" },
        ".Input": {
          border: `1px solid ${dark ? "#3f3f46" : "#e4e4e7"}`,
          boxShadow: "none",
          padding: "13px 16px",
        },
        ".Input:focus": {
          border: `1px solid ${brand}`,
          boxShadow: `0 0 0 3px ${dark ? "rgba(99,102,241,0.30)" : "rgba(79,70,229,0.15)"}`,
        },
        ".Input--invalid": { border: `1px solid ${dark ? "#f87171" : "#dc2626"}`, boxShadow: "none" },
        ".Tab": { border: `1px solid ${dark ? "#3f3f46" : "#e4e4e7"}`, boxShadow: "none" },
        ".Tab--selected": { border: `1px solid ${brand}`, color: brand },
      },
    };
  }, [resolvedTheme]);

  const elementsOptions = React.useMemo<StripeElementsOptions | null>(
    () =>
      // Localhost rehearsal: the real card form, in Stripe's deferred mode, with
      // no intent behind it. Folds away in every build. See mock-signup.ts.
      clientSecret && isMockSignup()
        ? {
            mode: "setup",
            currency: "usd",
            paymentMethodTypes: ["card"],
            appearance,
            fonts: STRIPE_ELEMENT_FONTS,
          }
        : clientSecret
        ? {
            clientSecret,
            appearance,
            fonts: STRIPE_ELEMENT_FONTS,
          }
        : null,
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
    // One narrow column while Stripe shows the compact Link view. When the full
    // card form opens it is too tall for that, so on a laptop the screen goes
    // two-column: what they are buying on the left, the card on the right.
    <div className={cn(SIGNUP_ENTER, wide.on && "lg:grid lg:grid-cols-2 lg:items-start lg:gap-10")}>
      <div className="min-w-0">
      <ScreenHead
        title={ownerName.trim() ? `Last step, ${ownerName.trim().split(/\s+/)[0]}` : "Last step"}
      />

      {/* Order summary — the last place the price is shown before it is taken. */}
      <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {plan.name}
            {mode === "test" && (
              <Badge variant="outline" className="text-[10px] tracking-wide">
                TEST MODE
              </Badge>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground max-sm:whitespace-nowrap">
            {plan.fleetBand}
          </p>
        </div>
        {isTrial ? (
          // Free trial: nothing today. The price and the day it starts are said
          // here, before the card is saved, so day 6 is never a surprise.
          <div className="shrink-0 text-right max-[359.98px]:shrink">
            <p className="text-2xl font-bold tracking-tighter">$0</p>
            <p className="text-xs text-muted-foreground">
              today · then {promo ? "discounted" : `$${plan.priceUsd}`}/month
            </p>
          </div>
        ) : promo && typeof amountDueCents === "number" ? (
          // A promo / referral code: the figure is Stripe's own first invoice,
          // so what is shown here is exactly what the card is charged.
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted-foreground line-through">
              <span className="sr-only">Was </span>${plan.priceUsd}/month
            </p>
            <p className="text-2xl font-bold tracking-tighter">{formatCents(amountDueCents)}</p>
            <p className="text-xs text-muted-foreground">due today</p>
          </div>
        ) : (
          <div className="shrink-0 text-right">
            <p className="text-2xl font-bold tracking-tighter">
              ${plan.priceUsd}
            </p>
            <p className="text-xs text-muted-foreground">/month</p>
          </div>
        )}
      </div>

      {/* No "applied" note: the code stays in its box with Remove beside it,
          and the timeline below shows what it takes off. */}
      {!promo && promoNotice && (
        <p className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400" role="status">
          {promoNotice}
        </p>
      )}

      {/* Offered even once a code is on: the fields are how you SWAP one, and
          hiding them left "use a different code" with nowhere to go. */}
      {onApplyPromo && (
        <DiscountCodeFields busy={busy} applied={promo ?? null} onApply={onApplyPromo} />
      )}

      {mode === "test" && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          No real payment will be taken.
        </p>
      )}

      {isTrial ? null : (
      // What they pay and when, as a short timeline: today, the next charge,
      // and where the price settles once a code runs out.
      <div className="mt-4">
        <ol>
          {timeline.map((stop, i) => {
            const last = i === timeline.length - 1;
            return (
              <li key={stop.when + stop.what} className={cn("relative pl-6", !last && "pb-3.5")}>
                {!last && (
                  <span aria-hidden className="absolute top-3.5 bottom-0 left-[4.5px] w-px bg-zinc-200 dark:bg-white/10" />
                )}
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-[5px] left-0 size-2.5 rounded-full",
                    i === 0
                      ? "bg-indigo-600 dark:bg-indigo-400"
                      : "border-2 border-zinc-300 bg-white dark:border-white/25 dark:bg-transparent",
                  )}
                />
                <div className="flex items-baseline justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{stop.when}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{stop.what}</p>
                  </div>
                  <p className="shrink-0 text-right text-sm font-semibold tabular-nums">
                    {stop.wasCents !== undefined && stop.wasCents !== stop.cents && (
                      <span className="mr-1.5 text-xs font-normal text-muted-foreground line-through">
                        <span className="sr-only">Was </span>
                        {formatCents(stop.wasCents)}
                      </span>
                    )}
                    {formatCents(stop.cents)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      )}

      </div>

      <div className={cn("mt-4 min-w-0", wide.on && "lg:mt-1")}>
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
          <PaymentForm
            busy={busy}
            onPaid={onPaid}
            onError={onError}
            intentType={intentType}
            onFormHeight={wide.measure}
          />
        </Elements>
      )}

      </div>
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
  intentType = "payment",
  onFormHeight,
}: {
  busy: boolean;
  onPaid(): void;
  onError(err: OnboardingError): void;
  /** Reports the card form's rendered height as Stripe swaps Link ↔ card fields. */
  onFormHeight?(px: number): void;
  /** "setup" = free trial: save the card with confirmSetup, charge nothing. */
  intentType?: "payment" | "setup";
}) {
  const stripe = useStripe();
  const elements = useElements();

  // Stripe gives no event for "Pay without Link"; the iframe just grows. Its
  // height is the honest signal for which view is showing.
  const elementBoxRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const box = elementBoxRef.current;
    if (!box || !onFormHeight) return;
    const ro = new ResizeObserver(([entry]) => onFormHeight(entry.contentRect.height));
    ro.observe(box);
    return () => ro.disconnect();
  }, [onFormHeight]);

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
      if (isMockSignup()) {
        // Localhost rehearsal: check the card fields like the real confirm
        // would, then stop. Nothing reaches Stripe beyond the form itself.
        const { error: fieldError } = await elements.submit();
        if (fieldError) {
          setMessage(fieldError.message ?? SIGNUP_ERROR_COPY.CARD_DECLINED);
          return;
        }
        await new Promise((r) => setTimeout(r, 1200));
        // ?scenario=card-declined / card-auth-failed: the same inline message
        // a real decline or failed bank check shows (see /dev/signup-states).
        const outcome = mockCardOutcome();
        if (outcome) {
          setMessage(SIGNUP_ERROR_COPY[outcome]);
          return;
        }
        mockMarkPaid();
        onPaid();
        return;
      }

      if (intentType === "setup") {
        // Free trial. The client secret is the subscription's SetupIntent, so
        // this saves the card (with 3-D Secure if the bank asks) and charges
        // nothing. signup-provision re-checks with Stripe that the card really
        // is on file before building the portal.
        const { error: setupError, setupIntent } = await stripe.confirmSetup({
          elements,
          redirect: "if_required",
          confirmParams: { return_url: `${window.location.origin}/?signup=resume` },
        });
        if (setupError) {
          handleStripeError(setupError, { setMessage, onError });
          return;
        }
        switch (setupIntent?.status) {
          case "succeeded":
          case "processing":
            onPaid();
            return;
          case "requires_payment_method":
            setMessage(SIGNUP_ERROR_COPY.CARD_DECLINED);
            return;
          case "requires_action":
          case "requires_confirmation":
            setMessage(SIGNUP_ERROR_COPY.CARD_AUTH_FAILED);
            return;
          case "canceled":
            onError({ code: "PAYMENT_EXPIRED", message: SIGNUP_ERROR_COPY.PAYMENT_EXPIRED });
            return;
          default:
            setMessage(SIGNUP_ERROR_COPY.INTERNAL);
            return;
        }
      }

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
      <div ref={elementBoxRef}>
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
      </div>

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
              : intentType === "setup"
                ? "Saving your card…"
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
    code === "setup_intent_unexpected_state" ||
    code === "resource_missing" ||
    code === "payment_intent_incompatible_payment_method"
  ) {
    onError({
      code: "PAYMENT_EXPIRED",
      message: stripeError.message ?? SIGNUP_ERROR_COPY.PAYMENT_EXPIRED,
    });
    return;
  }

  if (code === "payment_intent_authentication_failure" || code === "setup_intent_authentication_failure") {
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
        <a href="mailto:support@drive-247.com">Email support</a>
      </Button>
    </FallbackForm>
  );
}

/**
 * One field for a promo OR a referral code, always open.
 *
 * `promo-code-lookup` decides the kind from the code itself, so the box does
 * not need to ask. It was two labelled boxes behind a "Have a code?" link;
 * Ghulam asked for one box, always showing, named for both kinds so somebody
 * holding a friend's referral code can see it belongs here.
 *
 * The subscription carries a single discount, so applying a code REPLACES the
 * one on it, and the line under the box says which one went.
 */
export function DiscountCodeFields({
  busy,
  applied,
  onApply,
}: {
  busy: boolean;
  /** The code already on this subscription, if any. */
  applied: PromoOffer | null;
  onApply(code: string | null): Promise<string | null>;
}) {
  const [value, setValue] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [replaced, setReplaced] = React.useState<string | null>(null);

  /*
   * A referral arriving by link is already APPLIED by the provider before this
   * step renders. Showing the box empty under that reads as "we lost it", so
   * the carried code is put back in it.
   */
  React.useEffect(() => {
    const carried = readReferralCodeFromDocument();
    if (carried) setValue((v) => v || carried);
  }, []);

  // The applied code lives in the box, so the box is where it is removed.
  const appliedCode = applied?.displayCode ?? null;
  React.useEffect(() => {
    if (appliedCode) setValue(appliedCode);
  }, [appliedCode]);
  const showingApplied = !!appliedCode && value.trim().toUpperCase() === appliedCode.toUpperCase();

  const remove = async () => {
    if (pending || busy) return;
    setPending(true);
    setError(null);
    setReplaced(null);
    try {
      await onApply(null);
      setValue("");
    } finally {
      setPending(false);
    }
  };

  const submit = async () => {
    const code = value.trim();
    if (!code || pending || busy) return;

    const previous = applied?.displayCode ?? null;
    const isReplacement = !!previous && previous.toUpperCase() !== code.toUpperCase();

    setPending(true);
    setError(null);
    setReplaced(null);
    try {
      const failure = await onApply(code);
      if (failure) {
        setError(failure);
        return;
      }
      if (isReplacement) setReplaced(previous);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="signup-discount-code" className="mb-1 block text-xs font-medium text-muted-foreground">
        Promo or referral code
      </label>
      <div className="flex gap-2">
        <Input
          id="signup-discount-code"
          value={value}
          onChange={(e) => {
            setValue(e.target.value.toUpperCase());
            setError(null);
            setReplaced(null);
          }}
          placeholder="Enter a code"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? "signup-discount-code-error" : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          className="h-9 font-mono text-sm uppercase placeholder:font-sans placeholder:normal-case max-sm:h-11 max-sm:text-base"
        />
        {showingApplied ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 max-sm:h-11 max-sm:px-4"
            disabled={pending || busy}
            onClick={() => void remove()}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : "Remove"}
          </Button>
        ) : (
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 max-sm:h-11 max-sm:px-4"
            disabled={!value.trim() || pending || busy}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : "Apply"}
          </Button>
        )}
      </div>
      {error && (
        <p id="signup-discount-code-error" className="mt-1.5 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {replaced && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400" role="status">
          {replaced} was replaced. Only one code can be on a subscription.
        </p>
      )}
    </form>
  );
}
