"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Building2,
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
import {
  SIGNUP_ERROR_COPY,
  type SignupErrorCode,
  type SignupStep,
} from "./onboarding-types";
import { AccountStep } from "./steps/account-step";
import { BusinessStep } from "./steps/business-step";
import { PaymentStep } from "./steps/payment-step";

/**
 * One form id per step. The footer holds the single primary action for all
 * three steps and submits the active step's form by id, which is the only way
 * to keep `useStripe()`/`useElements()` inside `<Elements>` while the button
 * that triggers them lives outside it.
 */
const FORM_IDS: Record<"account" | "payment" | "business", string> = {
  account: "signup-account-form",
  payment: "signup-payment-form",
  business: "signup-business-form",
};

const STEP_META = [
  { key: "account", label: "Account", Icon: UserRound },
  { key: "payment", label: "Payment", Icon: CreditCard },
  { key: "business", label: "Business", Icon: Building2 },
] as const;

type DialogStep = (typeof STEP_META)[number]["key"];

function isDialogStep(step: SignupStep): step is DialogStep {
  return step === "account" || step === "payment" || step === "business";
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
    startPayment,
    markPaid,
    updateBusiness,
    checkSlug,
    submitBusiness,
    setError,
  } = useOnboarding();
  const { resolving, planSwitchBlocked } = useOnboardingShell();

  const keepGoingRef = useRef<HTMLButtonElement>(null);

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
   * Dismissible only on step 1, and only when nothing is in flight. After the
   * account exists, closing goes through the confirmation panel; while a
   * payment or a provisioning request is running it is refused outright.
   */
  const dismissible = step === "account" && !state.busy && !closeConfirmOpen && !resolving;

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
    if (step === "business" && plan) {
      out.push(
        state.payment.paid
          ? {
              key: "paid",
              text: `Your ${plan.name} subscription is active. Finish setting up your portal below.`,
              icon: "info",
            }
          : {
              // Reached only when the PaymentIntent came back `processing` — an
              // async method that Stripe has accepted but not yet settled.
              key: "processing",
              text: "Your payment is going through. You can carry on setting up.",
              icon: "info",
            },
      );
    }
    return out;
  }, [state.resumed, state.payment.paid, planSwitchBlocked, plan, step]);

  if (!plan || !dialogStep) return null;

  const primary =
    dialogStep === "account"
      ? state.signInPrompt
        ? { label: "Continue", busyLabel: "Signing in…" }
        : { label: "Create account", busyLabel: "Creating account…" }
      : dialogStep === "payment"
        ? { label: `Pay $${plan.priceUsd} and continue`, busyLabel: "Processing payment…" }
        : { label: "Complete setup", busyLabel: "Setting up…" };

  // Steps that hand the user a different set of buttons inside the body own the
  // whole decision — a footer "Create account" next to "Use a different email"
  // would be an invitation to re-run the thing that just failed.
  const primaryHidden =
    (dialogStep === "account" && state.error?.code === "EMAIL_IS_STAFF") ||
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
                  {step === "payment"
                    ? "Your account is saved. You can come back to drive-247.com and pick up right here — nothing has been charged yet."
                    : "Your payment is complete and your account is saved. Come back to drive-247.com any time to finish setting up your portal."}
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
                      initialValues={{
                        fullName: state.account?.fullName ?? "",
                        email: state.account?.email ?? state.signInPrompt?.email ?? "",
                      }}
                      signInPrompt={state.signInPrompt}
                      busy={state.busy}
                      error={state.error}
                      onSubmit={(values) => void submitAccount(values)}
                      onSignIn={(values) => void signInExisting(values)}
                      onUseDifferentEmail={useDifferentEmail}
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

                  {dialogStep === "business" ? (
                    <BusinessStep
                      plan={plan}
                      value={state.business}
                      busy={state.busy}
                      error={state.error}
                      onChange={updateBusiness}
                      onCheckSlug={checkSlug}
                      onSubmit={() => void submitBusiness()}
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
                    disabled={state.busy || resolving}
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
