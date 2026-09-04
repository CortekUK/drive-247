"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleCheck,
  CreditCard,
  Info,
  Loader2,
  RotateCcw,
  TriangleAlert,
  UserRound,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import { useOnboarding, useOnboardingShell } from "./onboarding-provider";
import { prewarmStripeJs } from "./stripe-prewarm";
import {
  SIGNUP_ERROR_COPY,
  type SignupErrorCode,
  type SignupStep,
} from "./onboarding-types";
import { AccountStep, type ResetShellState } from "./steps/account-step";
import { PaymentStep } from "./steps/payment-step";

/**
 * One form id per step. The footer holds the single primary action for both
 * steps and submits the active step's form by id, which is the only way to keep
 * `useStripe()`/`useElements()` inside `<Elements>` while the button that
 * triggers them lives outside it.
 */
const FORM_IDS: Record<"account" | "payment", string> = {
  account: "signup-account-form",
  payment: "signup-payment-form",
};

/**
 * Two steps, not three.
 *
 * The "Business" step is gone: the business name, the web address and the terms
 * are collected on Account, before the card, and everything else it used to ask
 * for is collected by the portal's first-run wizard afterwards. What the visitor
 * sees is now "details, pay, done" — and `provisioning` and `done` are not in
 * this list because they are owned by the full-screen boot overlay, not by the
 * dialog.
 */
const STEP_META = [
  { key: "account", label: "Account", Icon: UserRound },
  { key: "payment", label: "Payment", Icon: CreditCard },
] as const;

type DialogStep = (typeof STEP_META)[number]["key"];

function isDialogStep(step: SignupStep): step is DialogStep {
  return step === "account" || step === "payment";
}

/**
 * Codes the step components render inline, next to the field that caused them.
 * The shell must not also paint them into the banner — one error, one place.
 */
const INLINE_ONLY_CODES: ReadonlySet<SignupErrorCode> = new Set<SignupErrorCode>([
  "WEAK_PASSWORD",
  "EMAIL_INVALID",
  "EMAIL_DISPOSABLE",
  "EMAIL_IS_CUSTOMER",
  "EMAIL_IS_STAFF",
  "EMAIL_IN_SIGNUP",
  "EMAIL_EXISTS_SIGN_IN",
  "SIGN_IN_FAILED",
  "TERMS_NOT_ACCEPTED",
  "SLUG_INVALID",
  "SLUG_RESERVED",
  "SLUG_TAKEN",
  "CARD_DECLINED",
  "CARD_AUTH_FAILED",
]);

export function OnboardingDialog() {
  const {
    state,
    plan,
    isOpen,
    closeConfirmOpen,
    requestClose,
    confirmClose,
    cancelClose,
    submitAccount,
    signInExisting,
    useDifferentEmail,
    signInInstead,
    startPayment,
    markPaid,
    submitTenantDetails,
    startGoogleSignup,
    updateBusiness,
    checkSlug,
    setError,
  } = useOnboarding();
  const { resolving, planSwitchBlocked, accountMode, googleEnabled } =
    useOnboardingShell();

  const keepGoingRef = useRef<HTMLButtonElement>(null);

  /**
   * The account step's password-reset detour, mirrored up here because the two
   * things it affects are both owned by the shell.
   *
   * `open`: the footer primary submits a form by id, and the reset panel is not
   * that form — an enabled indigo "Continue" sitting next to the panel's own
   * primary did nothing at all when pressed.
   *
   * `busy`: `dismissible` and the footer Cancel read the PROVIDER's busy flag,
   * which the detour never sets. Closing the dialog over a password write does
   * not abort it, so the password changed server-side while the user was told
   * nothing — and their next sign-in used the old one.
   *
   * Reset to false by the step's own unmount effect, so this cannot go stale.
   */
  const [accountReset, setAccountReset] = useState<ResetShellState>({
    open: false,
    busy: false,
  });

  // Memoised so the step receives a stable identity — the same reason
  // `setAccountReset` is passed raw rather than wrapped.
  const clearStepError = useCallback(() => setError(null), [setError]);

  // The confirmation panel replaces the visible body, so focus has to follow it
  // — otherwise the keyboard user is left on a button that is now off-screen.
  useEffect(() => {
    if (closeConfirmOpen) keepGoingRef.current?.focus();
  }, [closeConfirmOpen]);

  const step = state.step;
  const dialogStep = isDialogStep(step) ? step : null;
  const stepIndex = dialogStep ? STEP_META.findIndex((s) => s.key === dialogStep) : -1;

  // The provisioning and done steps are owned by the full-screen boot overlay,
  // so the dialog closes itself the moment the flow reaches them.
  const dialogOpen = isOpen && dialogStep !== null && plan !== null;

  /**
   * Start pulling Stripe.js the moment the dialog opens, not when the payment
   * step asks for it.
   *
   * `loadStripe` cannot run until `signup-payment-intent` returns the
   * publishable key, and that call creates a Stripe Customer and Subscription
   * first — so the ~200KB script download used to begin only AFTER several
   * sequential Stripe round trips, and the user watched a skeleton for the sum
   * of both. Opening the dialog happens a good half-minute before anyone
   * finishes the account form, which is ample time for the fetch to land in the
   * HTTP cache and make the later `loadStripe` resolve immediately.
   */
  useEffect(() => {
    if (dialogOpen) prewarmStripeJs();
  }, [dialogOpen]);

  /**
   * Dismissible only on step 1, and only when nothing is in flight. After the
   * account exists, closing goes through the confirmation panel; while a
   * payment or a provisioning request is running it is refused outright.
   */
  const dismissible =
    step === "account" &&
    !state.busy &&
    !accountReset.busy &&
    !closeConfirmOpen &&
    !resolving;

  const bannerError =
    state.error && !INLINE_ONLY_CODES.has(state.error.code)
      ? // CONFIG_MISSING on the payment step is rendered by PaymentStep as a
        // full replacement for the card form, with its own strategy-call button.
        state.error.code === "CONFIG_MISSING" && step === "payment"
        ? null
        : state.error
      : null;

  const notices = useMemo(() => {
    const out: { key: string; text: string; icon: "resume" | "info" }[] = [];
    if (state.resumed) {
      out.push({ key: "resumed", text: "Picking up where you left off.", icon: "resume" });
    }
    if (planSwitchBlocked && plan) {
      out.push({
        key: "plan-locked",
        text: `You've already paid for the ${plan.name} plan. Finish setting up your portal — we can move you to a different plan from there.`,
        icon: "info",
      });
    }
    // `tenant` mode is only ever reached after payment, so the notice is about
    // reassuring someone who has already been charged that nothing was lost.
    if (step === "account" && accountMode === "tenant" && !state.payment.paid) {
      out.push({
        // Reached when the PaymentIntent came back `processing` — an async
        // method that Stripe has accepted but not yet settled.
        key: "processing",
        text: "Your payment is going through. You can carry on setting up.",
        icon: "info",
      });
    }
    return out;
  }, [state.resumed, state.payment.paid, planSwitchBlocked, plan, step, accountMode]);

  if (!plan || !dialogStep) return null;

  const primary =
    dialogStep === "account"
      ? state.signInPrompt
        ? { label: "Continue", busyLabel: "Signing in…" }
        : accountMode === "tenant"
          ? { label: "Build my portal", busyLabel: "Setting up…" }
          : { label: "Continue to payment", busyLabel: "Creating account…" }
      : { label: `Pay $${plan.priceUsd} and continue`, busyLabel: "Processing payment…" };

  // Steps that hand the user a different set of buttons inside the body own the
  // whole decision — a footer "Create account" next to "Use a different email"
  // would be an invitation to re-run the thing that just failed.
  const primaryHidden =
    (dialogStep === "account" && state.error?.code === "EMAIL_IS_STAFF") ||
    // The reset panel is not `signup-account-form`, so this button had nothing
    // to submit while it was open — an enabled primary that did nothing, beside
    // the panel's own.
    (dialogStep === "account" && accountReset.open) ||
    (dialogStep === "payment" && state.error?.code === "CONFIG_MISSING");

  const primaryDisabled =
    state.busy ||
    resolving ||
    // Nothing to submit until the PaymentElement has an intent to confirm.
    (dialogStep === "payment" && !state.payment.clientSecret);

  const progressValue = ((stepIndex + 1) / STEP_META.length) * 100;

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        showCloseButton={dismissible}
        onEscapeKeyDown={(e) => {
          if (!dismissible) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (!dismissible) e.preventDefault();
        }}
        className="gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        {/* 90dvh, not vh: mobile browser chrome would otherwise clip the footer. */}
        <div className="flex max-h-[90dvh] flex-col">
          {/* ── header band ─────────────────────────────────────────────── */}
          <div className="shrink-0 border-b px-6 pt-6 pb-4">
            <DialogTitle className="text-lg">Set up your Drive247 portal</DialogTitle>
            <DialogDescription>
              {plan.name} · ${plan.priceUsd}/month
            </DialogDescription>

            <Progress value={progressValue} aria-label="Setup progress" className="mt-4 h-1.5" />

            <div
              className="mt-3 flex items-center gap-2 text-xs sm:gap-4"
              aria-hidden="true"
            >
              {STEP_META.map((s, i) => {
                const done = i < stepIndex;
                const active = i === stepIndex;
                const Icon = done ? CircleCheck : s.Icon;
                return (
                  <span
                    key={s.key}
                    className={cn(
                      "flex items-center gap-1.5",
                      done && "text-indigo-600 dark:text-indigo-400",
                      active && "font-medium text-indigo-600 dark:text-indigo-400",
                      !done && !active && "text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    {s.label}
                  </span>
                );
              })}
            </div>

            {/*
              The visible chips are decorative. This is the only thing a screen
              reader is told about progress, and it re-announces on every step
              change and whenever an async action starts or stops.
            */}
            <p className="sr-only" aria-live="polite">
              {closeConfirmOpen
                ? "Leave setup? Confirm or keep going."
                : resolving
                  ? "Checking your setup."
                  : `Step ${stepIndex + 1} of ${STEP_META.length}: ${STEP_META[stepIndex].label}.${
                      state.busy ? " Working, please wait." : ""
                    }`}
            </p>
          </div>

          {/* ── body band ───────────────────────────────────────────────── */}
          <div className="max-h-[min(70dvh,560px)] flex-1 overflow-y-auto px-6 py-5">
            {closeConfirmOpen ? (
              <div className="animate-in fade-in-0 slide-in-from-bottom-2 py-4 text-center duration-300">
                <TriangleAlert className="mx-auto h-5 w-5 text-amber-600 dark:text-amber-400" />
                <h3 className="mt-3 text-base font-semibold tracking-tight">Leave setup?</h3>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Your account is saved. You can come back to drive-247.com and
                  pick up right here — nothing has been charged yet.
                </p>
              </div>
            ) : null}

            {/*
              Kept mounted (merely hidden) behind the confirmation panel. The
              payment step owns a Stripe iframe; unmounting it would throw away
              a half-typed card number the moment someone clicks "Finish later".
            */}
            <div hidden={closeConfirmOpen}>
              {notices.map((n) => (
                <Alert key={n.key} variant="info" className="mb-4">
                  {n.icon === "resume" ? <RotateCcw /> : <Info />}
                  <AlertDescription className="text-foreground">{n.text}</AlertDescription>
                </Alert>
              ))}

              {bannerError ? (
                <Alert variant="destructive" className="mb-4">
                  <TriangleAlert />
                  <AlertTitle>We couldn&apos;t continue</AlertTitle>
                  <AlertDescription className="text-red-600 dark:text-red-400">
                    <span>{SIGNUP_ERROR_COPY[bannerError.code]}</span>
                    {bannerError.code === "CONFIG_MISSING" ? (
                      <a
                        href="/strategy-call"
                        className="font-semibold underline underline-offset-4"
                      >
                        Book a strategy call
                      </a>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}

              {resolving ? (
                <div
                  className="flex flex-col items-center justify-center gap-3 py-12"
                  aria-live="polite"
                >
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
                  <p className="text-sm text-muted-foreground">Checking your setup…</p>
                </div>
              ) : (
                // Keyed by step so each step animates in on entry. Within a step
                // the key is stable, so nothing remounts while the user types.
                <div
                  key={dialogStep}
                  className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
                >
                  {dialogStep === "account" ? (
                    <AccountStep
                      plan={plan}
                      mode={accountMode}
                      initialValues={{
                        fullName: state.account?.fullName ?? "",
                        email: state.account?.email ?? state.signInPrompt?.email ?? "",
                      }}
                      tenant={state.business}
                      onTenantChange={updateBusiness}
                      signInPrompt={state.signInPrompt}
                      busy={state.busy}
                      error={state.error}
                      googleEnabled={googleEnabled}
                      onSubmit={(values) => void submitAccount(values)}
                      onSubmitTenant={(values) => void submitTenantDetails(values)}
                      onGoogle={(values) => void startGoogleSignup(values)}
                      onCheckSlug={checkSlug}
                      onSignIn={(values) => void signInExisting(values)}
                      onUseDifferentEmail={useDifferentEmail}
                      onSignInInstead={signInInstead}
                      onResetStateChange={setAccountReset}
                      onClearError={clearStepError}
                    />
                  ) : null}

                  {dialogStep === "payment" ? (
                    <PaymentStep
                      plan={plan}
                      clientSecret={state.payment.clientSecret}
                      publishableKey={state.payment.publishableKey}
                      mode={state.payment.mode}
                      busy={state.busy}
                      error={state.error}
                      onRetryIntent={() => void startPayment()}
                      onPaid={() => void markPaid()}
                      onError={(e) => setError(e)}
                    />
                  ) : null}

                </div>
              )}
            </div>
          </div>

          {/* ── footer band ─────────────────────────────────────────────── */}
          <div className="shrink-0 border-t px-6 py-4">
            <DialogFooter className="sm:justify-between">
              {closeConfirmOpen ? (
                <>
                  {/*
                    Outline first, primary last: DialogFooter is
                    `flex-col-reverse` below `sm`, so the last child is the one
                    that lands on top on a phone — which must be "Keep going".
                  */}
                  <Button type="button" variant="outline" onClick={confirmClose}>
                    Leave
                  </Button>
                  <Button
                    ref={keepGoingRef}
                    type="button"
                    onClick={cancelClose}
                    className="bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                  >
                    Keep going
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={requestClose}
                    disabled={state.busy || resolving || accountReset.busy}
                  >
                    {dialogStep === "account" ? "Cancel" : "Finish later"}
                  </Button>

                  {primaryHidden ? (
                    <span />
                  ) : (
                    <Button
                      // `form` + `type="submit"` is what lets one footer button
                      // drive three different step forms (spec §6.6).
                      type="submit"
                      form={FORM_IDS[dialogStep]}
                      disabled={primaryDisabled}
                      className="bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                    >
                      {state.busy ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {primary.busyLabel}
                        </>
                      ) : (
                        primary.label
                      )}
                    </Button>
                  )}
                </>
              )}
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
