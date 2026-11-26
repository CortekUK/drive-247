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
import { Check, ChevronRight, CreditCard, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
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
import {
  buildApplePayTerms,
  formatFirstPayment,
  resolveTrialEnd,
  type ApplePayTerms,
} from "@/components/onboarding/apple-pay-terms";
import { formatPlanPriceUsd, type SignupPlan, type SignupPlanId } from "@/lib/plans";
import type { PromoOffer } from "@/lib/promo-offer";
import {
  BLACK_FRIDAY_CODE,
  BLACK_FRIDAY_FINE_PRINT,
  BLACK_FRIDAY_HEADLINE,
  BLACK_FRIDAY_MONTHS,
  blackFridayCents,
  formatUsdCents,
} from "@/lib/black-friday";
import { readReferralCodeFromDocument } from "@/lib/referral-cookie";
import { ColumnButton, ScreenHead, SIGNUP_LABEL } from "@/components/onboarding/signup-ui";

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

/** The day the trial ends and the card is first charged, as "1 December". */
function firstPaymentLabel(trialEndsAt: string | null, trialDays: number): string | null {
  const when = resolveTrialEnd(trialEndsAt, trialDays);
  return when ? formatFirstPayment(when) : null;
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
  bill = null,
  onApplyPromo,
  ownerName = "",
  companyName = "",
  portalSlug = "",
  onWideChange,
  plans = [],
  onChangePlan,
  topSlot = null,
}: PaymentStepProps) {
  // Plans you can switch to: the live catalogue, with the current plan in it.
  const switchable = plans.length > 1 && onChangePlan ? plans : [];
  const wide = useWideFlag(onWideChange);
  const isTrial = intentType === "setup";
  const firstPayment = isTrial ? firstPaymentLabel(trialEndsAt, trialDays) : null;

  // Memoised so a re-render never hands Stripe's element a new options object.
  const applePayTerms = React.useMemo(
    () => buildApplePayTerms({ plan, promo, isTrial, trialDays, trialEndsAt, slug: portalSlug }),
    [plan, promo, isTrial, trialDays, trialEndsAt, portalSlug],
  );

  const timeline = billingTimeline(plan, promo, amountDueCents);
  // The server put BF30 on this subscription (Black Friday, lib/black-friday.ts).
  const blackFriday = promo?.displayCode === BLACK_FRIDAY_CODE;
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
        borderRadius: "0px",
        spacingUnit: "4px",
      },
      // The signup's fields are bare underlines (the portal's onboarding
      // questions), so the card fields are too: no box, a rule that turns
      // indigo and thickens on focus, the label small and muted above it.
      rules: {
        ".Label": {
          fontWeight: "500",
          fontSize: "13px",
          marginBottom: "4px",
          color: dark ? "#a1a1aa" : "#71717a",
        },
        ".Input": {
          border: "none",
          borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.15)" : "rgba(24,24,27,0.15)"}`,
          borderRadius: "0px",
          backgroundColor: "transparent",
          boxShadow: "none",
          padding: "12px 0px",
          fontSize: phone ? "17px" : "18px",
        },
        ".Input:focus": {
          border: "none",
          borderBottom: `1px solid ${brand}`,
          boxShadow: `inset 0 -1px 0 0 ${brand}`,
        },
        ".Input--invalid": {
          border: "none",
          borderBottom: `1px solid ${dark ? "#f87171" : "#dc2626"}`,
          boxShadow: "none",
        },
        ".Tab": { border: `1px solid ${dark ? "#3f3f46" : "#e4e4e7"}`, boxShadow: "none" },
        ".Tab--selected": { border: `1px solid ${brand}`, color: brand },
      },
    };
  }, [resolvedTheme]);

  const elementsOptions = React.useMemo<StripeElementsOptions | null>(
    () =>
      // Localhost rehearsal: the real card form, in Stripe's deferred mode, with
      // no intent behind it. Folds away in every build. See mock-signup.ts.
      //
      // FREE TRIAL: deferred mode too, with the currency stated. A SetupIntent
      // carries no currency, so a form built from its client secret let Apple
      // Pay and Google Pay fall back to the Stripe ACCOUNT's default, and the
      // signup bills through the UAE account: the wallet sheet read
      // "Starter plan AED 129.00 per month". Built in deferred mode with
      // currency "usd" the sheet reads $129.00, and PaymentForm then confirms
      // the same SetupIntent by its client secret (elements.submit() first).
      // Card only, like the subscription (`payment_method_types: ["card"]`).
      clientSecret && (isMockSignup() || intentType === "setup")
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
    [clientSecret, appearance, intentType],
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
    // Centred (Ghulam, 2026-11-23): the heading across the top, then two
    // columns on a laptop, what they are buying on the left and the card on
    // the right. One centred column on a phone.
    <div>
      <ScreenHead
        title={ownerName.trim() ? `Last step, ${ownerName.trim().split(/\s+/)[0]}` : "Last step"}
      />

      {/* "Pay with Apple Pay in Safari" inside the Facebook / Instagram app. */}
      {topSlot ? <div className="mx-auto mt-6 w-full max-w-[34rem] lg:max-w-[66rem]">{topSlot}</div> : null}

      <div className="mx-auto mt-10 w-full max-w-[66rem] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-start lg:gap-16">
      <div className="min-w-0">
      <div className="signup-rise signup-rise-3 mx-auto max-w-[34rem] lg:mx-0">
      {/*
        Every plan, always on show (Ghulam, 2026-11-23: "you should be able to
        see the plans in that same UI"). The plans differ only in fleet size,
        so that is all each row says, beside its price. A tap switches the
        plan, as "Change plan" used to (a new intent for the new price).
      */}
      {switchable.length > 0 && (
        <>
          {/* A label like Stripe's "Card number" on the right (same size,
              weight and grey), so the two columns start on one line. */}
          <p id="signup-plan-label" className={cn(SIGNUP_LABEL, "mb-1")}>
            Plan
          </p>
          {/* The pills reach 16px past the column on each side, so the words
              inside them line up with everything under them (Ghulam,
              2026-11-23: "the alignment"). */}
          <div className="-mx-4">
            <PlanPicker
              plans={switchable}
              currentId={plan.id}
              busy={busy}
              blackFriday={blackFriday}
              onPick={(id) => {
                if (id !== plan.id) onChangePlan?.(id);
              }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Every plan has everything. Pick the one that fits your fleet.
          </p>
        </>
      )}

      {/* Order summary — the last place the price is shown before it is taken.
          Flat, between two hairlines, like everything else on the page. With
          the plans listed it is kept only for a free trial ("$0 today, then
          $129/month"); otherwise the timeline below already says what is paid
          today, and the row would say it twice. */}
      {(switchable.length === 0 || isTrial) && (
      <div className={cn("flex items-center justify-between gap-4 border-y border-foreground/10 py-4 dark:border-white/10", switchable.length > 0 && "mt-4")}>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[17px] font-medium">
            {/* With the plans listed above, the name and fleet size would only
                repeat the ticked row: this line is about the money. */}
            {switchable.length > 0 ? "Due today" : plan.name}
            {mode === "test" && (
              <Badge variant="outline" className="text-[10px] tracking-wide">
                TEST MODE
              </Badge>
            )}
          </p>
          {switchable.length > 0 ? null : (
            <p className="mt-0.5 text-xs text-muted-foreground max-sm:whitespace-nowrap">
              {plan.fleetBand}
            </p>
          )}
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
      )}

      {isTrial && (
        // Said right under the price, where people decide whether to give a
        // card: the trial really is free and they can leave without paying.
        // The reminder line is the owner's call (2026-11-19); the email itself
        // ships separately and must go out 3 days before `trial_end`.
        <div className="mt-2 space-y-0.5 text-xs leading-relaxed text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">No charge today.</span>{" "}
            {firstPayment
              ? `Your first payment is on ${firstPayment}. Cancel before then and you won't be charged.`
              : "Cancel before your trial ends and you won't be charged."}
          </p>
          <p>We&apos;ll email you 3 days before your trial ends.</p>
        </div>
      )}

      {blackFriday && (
        // Black Friday (lib/black-friday.ts). Shown only once the server has
        // put BF30 on the subscription, so it never promises what Stripe won't
        // charge. "No charge for 14 days" stays above it.
        <div className="mt-3 rounded-2xl bg-indigo-600/[0.06] px-4 py-3 dark:bg-indigo-400/[0.10]" data-testid="bf-offer">
          <p className="text-sm font-semibold text-foreground">{BLACK_FRIDAY_HEADLINE}</p>
          <p className="mt-0.5 text-sm text-foreground">
            <span className="text-muted-foreground line-through">
              <span className="sr-only">Was </span>${plan.priceUsd}
            </span>{" "}
            {/* The server's figure (feat-001 spec 08.12); the preview only
                covers an older deploy that does not send `bill`. */}
            <span className="font-semibold">
              {formatUsdCents(bill?.discountedBillCents ?? blackFridayCents(plan.amountCents))}/mo
            </span>{" "}for{" "}
            {BLACK_FRIDAY_MONTHS} months, then ${plan.priceUsd}.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{BLACK_FRIDAY_FINE_PRINT}</p>
        </div>
      )}

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
      </div>

      <div className="signup-rise signup-rise-4 mx-auto mt-10 w-full min-w-0 max-w-[34rem] lg:mx-0 lg:mt-0 lg:max-w-none">
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
            clientSecret={clientSecret}
            onFormHeight={wide.measure}
            applePayTerms={applePayTerms}
          />
        </Elements>
      )}

      {/*
        The money button, under the card and lined up with it (Ghulam,
        2026-11-23), no longer in the footer's corner. It keeps its words
        because it starts a trial on their card, or takes money. Outside
        <Elements>, so it submits the card form by its id; every branch above
        renders `signup-payment-form`. Nothing to press until there is an intent
        to confirm, and none at all when the step cannot take payment.
      */}
      {!(isConfigError || isUnexplainedGap) && (
        <div className="mt-6">
          <ColumnButton form="signup-payment-form" busy={busy} disabled={!clientSecret}>
            {busy ? (
              isTrial ? "Saving your card…" : "Processing payment…"
            ) : (
              <>
                {isTrial ? `Start my ${trialDays}-day free trial` : `Pay $${plan.priceUsd} and build my portal`}
                <ChevronRight className="size-4" />
              </>
            )}
          </ColumnButton>
        </div>
      )}

      </div>
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
  clientSecret,
  onFormHeight,
  applePayTerms,
}: {
  /** The SetupIntent's secret: the trial form is deferred, so confirmSetup is told which intent. */
  clientSecret?: string | null;
  /** What the Apple Pay sheet shows in place of "Amount Pending". */
  applePayTerms?: ApplePayTerms;
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
  const paymentElementOptions = React.useMemo(
    () => ({
      layout: "tabs" as const,
      /*
       * No Link. A visitor whose email Stripe recognises was shown Link's saved
       * card ("Visa Debit ... Confirm", "Change payment method") with Link's
       * own black Confirm button, a second primary action beside "Start my
       * free trial" that does not finish the signup. With Link off the form is
       * always Card, Apple Pay and Google Pay, and the purple button below is
       * the only way through. Client-side only: the subscription is created
       * card-only (`payment_method_types: ["card"]`), and Link reached the form
       * as card autofill, which this option controls.
       */
      wallets: { link: "never" as const },
      ...(applePayTerms ? { applePay: applePayTerms } : {}),
    }),
    [applePayTerms],
  );

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
        // The trial form is in deferred mode (see elementsOptions): Stripe
        // wants the fields checked first, then the intent named.
        const { error: submitError } = await elements.submit();
        if (submitError) {
          setMessage(submitError.message ?? SIGNUP_ERROR_COPY.CARD_DECLINED);
          return;
        }
        const { error: setupError, setupIntent } = await stripe.confirmSetup({
          elements,
          ...(clientSecret ? { clientSecret } : {}),
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
        options={paymentElementOptions}
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
 * One field for a promo OR a referral code, behind a small "Have a code?" link.
 *
 * `promo-code-lookup` decides the kind from the code itself, so the box does
 * not need to ask. It is one box named for both kinds, so somebody holding a
 * friend's referral code can see it belongs here. Since 2026-11-19 it starts
 * closed (the owner: the big empty box drew the eye away from the card on the
 * last step), and opens on a tap. It starts OPEN, filled, whenever a code is
 * already in play: one applied to the subscription, or one carried in by a
 * referral link / ?ref= (the d247_ref cookie).
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
  const [open, setOpen] = React.useState(Boolean(applied));
  const inputRef = React.useRef<HTMLInputElement>(null);
  /** Focus the box only when it was opened by a tap, never on arrival. */
  const focusOnOpenRef = React.useRef(false);

  /*
   * A referral arriving by link is already APPLIED by the provider before this
   * step renders. Showing the box empty (or hidden) under that reads as "we
   * lost it", so the carried code is put back in an open box.
   */
  React.useEffect(() => {
    const carried = readReferralCodeFromDocument();
    if (carried) {
      setValue((v) => v || carried);
      setOpen(true);
    }
  }, []);

  // The applied code lives in the box, so the box is where it is removed.
  const appliedCode = applied?.displayCode ?? null;
  React.useEffect(() => {
    if (appliedCode) {
      setValue(appliedCode);
      setOpen(true);
    }
  }, [appliedCode]);

  React.useEffect(() => {
    if (open && focusOnOpenRef.current) {
      focusOnOpenRef.current = false;
      inputRef.current?.focus();
    }
  }, [open]);
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

  if (!open) {
    return (
      <p className="mt-2 text-xs">
        <button
          type="button"
          aria-expanded={false}
          disabled={busy}
          onClick={() => {
            focusOnOpenRef.current = true;
            setOpen(true);
          }}
          className="relative font-medium text-indigo-600 underline-offset-4 hover:underline disabled:opacity-50 max-sm:after:absolute max-sm:after:-inset-x-2 max-sm:after:-inset-y-3 max-sm:after:content-[''] dark:text-indigo-400"
        >
          Have a code?
        </button>
      </p>
    );
  }

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
          ref={inputRef}
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
          className="h-10 rounded-none border-0 border-b border-foreground/15 bg-transparent px-0 font-mono text-sm uppercase shadow-none placeholder:font-sans placeholder:normal-case focus-visible:border-indigo-600 focus-visible:ring-0 max-sm:h-11 max-sm:text-base dark:border-white/15 dark:bg-transparent"
        />
        {showingApplied ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 rounded-full px-4 max-sm:h-11"
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
            className="h-9 shrink-0 rounded-full px-4 max-sm:h-11"
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

/**
 * The plans on the payment step, always on show: every plan in the live
 * catalogue, with the one being bought ticked. Picking another mints a new intent for it
 * (the provider's `changePlan`; the server cancels the old incomplete
 * subscription, so two can never be live). Names, bands and prices come from
 * the catalogue the pricing cards were rendered from, never from copy here.
 */
export function PlanPicker({
  plans,
  currentId,
  busy,
  blackFriday = false,
  onPick,
}: {
  plans: readonly SignupPlan[];
  currentId: SignupPlanId;
  busy: boolean;
  /** Black Friday: the 30% price for the first 3 months, the plan price struck through. */
  blackFriday?: boolean;
  onPick(id: SignupPlanId): void;
}) {
  return (
    <div
      id="signup-plan-picker"
      role="radiogroup"
      aria-labelledby="signup-plan-label"
      className="grid gap-1"
    >
      {plans.map((p) => {
        const selected = p.id === currentId;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={busy}
            onClick={() => onPick(p.id)}
            className={cn(
              // The questions' answer rows: the chosen one on a light wash.
              "flex items-center justify-between gap-3 rounded-full py-2 pr-4 pl-4 text-left transition-colors duration-200 ease-out disabled:opacity-60 motion-reduce:transition-none",
              selected
                ? "bg-indigo-600/[0.08] ring-1 ring-indigo-600/25 dark:bg-indigo-400/[0.12] dark:ring-indigo-400/30"
                : "hover:bg-foreground/[0.03]",
            )}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">{p.name}</span>
              <span className="block text-xs text-muted-foreground">{p.fleetBand}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-sm font-semibold tabular-nums">
              {blackFriday && (
                <span className="text-xs font-normal text-muted-foreground line-through">
                  <span className="sr-only">Was </span>
                  {formatPlanPriceUsd(p)}
                </span>
              )}
              {blackFriday ? formatUsdCents(blackFridayCents(p.amountCents)) : formatPlanPriceUsd(p)}
              <span className="-ml-1.5 text-xs font-normal text-muted-foreground">/month</span>
              <span
                aria-hidden
                className={cn(
                  "flex size-[18px] items-center justify-center rounded-full border",
                  selected
                    ? "border-indigo-600 bg-indigo-600 text-white dark:border-indigo-400 dark:bg-indigo-400 dark:text-[#0e0e14]"
                    : "border-zinc-300 text-transparent dark:border-white/20",
                )}
              >
                <Check className="size-3" strokeWidth={3} />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
