"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowLeft, Info, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useOnboarding, useOnboardingShell } from "./onboarding-provider";
import { prewarmStripeJs } from "./stripe-prewarm";
import {
  SIGNUP_ERROR_COPY,
  type SignupErrorCode,
  type SignupStep,
} from "./onboarding-types";
import { ACCOUNT_PAGE_COUNT, AccountStep, type ResetShellState } from "./steps/account-step";
import { PaymentStep } from "./steps/payment-step";
import { VerifyStep } from "./steps/verify-step";
import { PauseArt } from "./signup-art";
import { ScreenHead, SignupWash, SIGNUP_CARD, SIGNUP_ENTER, SIGNUP_PRIMARY, SIGNUP_QUIET } from "./signup-ui";

/**
 * The self-serve signup, full screen.
 *
 * It takes over the page the moment a plan is picked and stays until the
 * provisioning overlay takes over from it. One idea per screen, stacked and
 * centred: a picture, a headline, one line from Trax, the fields, and one
 * button. The account form is three short pages (who you are → a password →
 * the business) instead of one long scroll, then payment.
 *
 * Only the LOOK changed when this replaced the old dialog. Every decision —
 * which step is showing, when closing needs confirming, what the primary
 * button submits, what blocks it — is the provider's or is carried over
 * unchanged from the dialog, so the purchase logic underneath is the same.
 *
 * It is still a Radix dialog underneath, for the same reason the provisioning
 * overlay is: something has to trap focus and hide the landing page from
 * assistive tech, and a hand-rolled `role="dialog"` div only promises that.
 */

/**
 * One form id per step. The single primary button sits below the step and
 * submits the active step's form by id, which is the only way to keep
 * `useStripe()`/`useElements()` inside `<Elements>` while the button that
 * triggers them lives outside it.
 */
const FORM_IDS: Record<"account" | "payment", string> = {
  account: "signup-account-form",
  payment: "signup-payment-form",
};

/**
 * The progress dots: the three account pages, then payment. The code screen
 * and the Google return's "one last thing" both sit on the business dot —
 * they are gates between stages, not stages of their own.
 */
const PROGRESS_LABELS = ["You", "Password", "Your business", "Payment"] as const;

type DialogStep = "account" | "payment";

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

export function OnboardingScreen() {
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
    applyPromoCode,
    submitTenantDetails,
    startGoogleSignup,
    verifyEmailCode,
    resendEmailCode,
    verifyError,
    clearVerifyError,
    updateBusiness,
    checkSlug,
    setError,
  } = useOnboarding();
  const { resolving, planSwitchBlocked, accountMode, googleEnabled } =
    useOnboardingShell();

  const contentRef = useRef<HTMLDivElement>(null);
  const keepGoingRef = useRef<HTMLButtonElement>(null);

  /**
   * The account step's password-reset detour, mirrored up here because the two
   * things it affects are both owned by the shell: the primary button (which
   * submits a form the reset panel is not) and whether closing is allowed
   * (a password write must not be abandoned silently).
   */
  const [accountReset, setAccountReset] = useState<ResetShellState>({
    open: false,
    busy: false,
  });

  /** Which page of the create-account form is showing (0 you, 1 password, 2 business). */
  const [accountPage, setAccountPage] = useState(0);

  // Memoised so the step receives a stable identity.
  const clearStepError = useCallback(() => setError(null), [setError]);

  const step = state.step;
  const dialogStep: DialogStep | null =
    step === "verify" ? "account" : isDialogStep(step) ? step : null;

  // The provisioning and done steps are owned by the full-screen boot overlay,
  // so this screen closes itself the moment the flow reaches them.
  const open = isOpen && dialogStep !== null && plan !== null;

  // A fresh start is always page one: closing, or a sign-in panel arriving or
  // leaving ("Use a different email" lands back on the first page).
  useEffect(() => {
    if (!open) setAccountPage(0);
  }, [open]);
  useEffect(() => {
    setAccountPage(0);
  }, [state.signInPrompt]);

  // The confirmation panel replaces the visible body, so focus follows it.
  useEffect(() => {
    if (closeConfirmOpen) keepGoingRef.current?.focus();
  }, [closeConfirmOpen]);

  /**
   * Start pulling Stripe.js the moment the screen opens, not when the payment
   * step asks for it — the account pages take far longer than the ~200KB
   * download, so `loadStripe` resolves at once when payment arrives.
   */
  useEffect(() => {
    if (open) prewarmStripeJs();
  }, [open]);

  /**
   * Dismissible only on the account step, and only when nothing is in flight.
   * After the account exists, closing goes through the confirmation panel;
   * while a payment or a provisioning request is running it is refused.
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
      out.push({ key: "resumed", text: "Welcome back. I've picked up where you left off.", icon: "resume" });
    }
    if (planSwitchBlocked && plan) {
      out.push({
        key: "plan-locked",
        text: `You've already paid for the ${plan.name} plan. Let's finish your portal first — I can move you to a different plan from there.`,
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

  /** The create-account pages are only in play on the plain create form. */
  const paging = dialogStep === "account" && step !== "verify" && !state.signInPrompt && accountMode !== "tenant";
  const onBusinessPage = paging && accountPage === ACCOUNT_PAGE_COUNT - 1;

  const progressIndex =
    dialogStep === "payment"
      ? 3
      : step === "verify" || accountMode === "tenant"
        ? 2
        : paging
          ? accountPage
          : 0;

  const primary =
    dialogStep === "account"
      ? accountMode === "tenant"
        ? { label: "Build my portal", busyLabel: "Setting up…" }
        : onBusinessPage
          ? { label: "Continue to payment", busyLabel: "Creating your account…" }
          : { label: "Continue", busyLabel: "Working…" }
      : state.payment.intentType === "setup"
        ? // Free trial: the server said so (it created a trialing subscription),
          // so the button never promises a trial the server did not grant.
          {
            label: `Start my ${state.payment.trialDays}-day free trial`,
            busyLabel: "Saving your card…",
          }
        : { label: `Pay $${plan.priceUsd} and build my portal`, busyLabel: "Processing payment…" };

  // Screens that carry their own buttons own the whole decision: the code
  // screen submits itself, the sign-in panel has its own Continue, and the two
  // dead ends below offer different actions entirely.
  const primaryHidden =
    step === "verify" ||
    (dialogStep === "account" && Boolean(state.signInPrompt)) ||
    (dialogStep === "account" && state.error?.code === "EMAIL_IS_STAFF") ||
    (dialogStep === "account" && accountReset.open) ||
    (dialogStep === "payment" && state.error?.code === "CONFIG_MISSING");

  /**
   * The Terms checkbox gates the primary button rather than failing on press.
   * Accepting the Terms and the Privacy Policy is a legal precondition, so the
   * button only looks pressable once it is ticked. Scoped to the screens that
   * actually SHOW the checkbox: the business page and the Google return's
   * "one last thing".
   */
  const consentPending =
    (onBusinessPage || (dialogStep === "account" && accountMode === "tenant" && !state.signInPrompt)) &&
    !state.business.acceptedTerms;

  const primaryDisabled =
    state.busy ||
    resolving ||
    consentPending ||
    // Nothing to submit until the PaymentElement has an intent to confirm.
    (dialogStep === "payment" && !state.payment.clientSecret);

  const canGoBack = paging && accountPage > 0 && !closeConfirmOpen;
  // Keyed per STEP only. The account pages animate inside AccountStep: keying
  // this wrapper by page would remount the step and throw away everything
  // typed on the pages before.
  const screenKey = closeConfirmOpen ? "leave" : step;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // Land in the first field of the screen, not on the close button
            // in the corner.
            e.preventDefault();
            const field = contentRef.current?.querySelector<HTMLElement>(
              'input:not([type="hidden"]):not([tabindex="-1"]):not([disabled])',
            );
            field?.focus();
          }}
          onEscapeKeyDown={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "fixed inset-0 z-[200] flex flex-col bg-white text-foreground outline-none dark:bg-[#0e0e14]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in",
            "motion-reduce:animate-none!",
          )}
        >
          {/* The portal's page wash — the same one under the onboarding questions. */}
          <SignupWash />

          {/* ── top bar ───────────────────────────────────────────────────── */}
          <header className="relative flex h-14 shrink-0 items-center justify-between gap-4 px-5 sm:h-16 sm:px-8">
            <div className="flex min-w-0 items-center">
              <Image src="/logo-light.png" alt="Drive247" width={855} height={195} className="h-6 w-auto dark:hidden" priority />
              <Image src="/logo-dark.png" alt="Drive247" width={855} height={195} className="hidden h-6 w-auto dark:block" priority />
            </div>


            <div className="flex items-center gap-3">
              <span className="hidden text-[13px] text-muted-foreground md:inline">
                <span className="font-medium text-foreground">{plan.name}</span>
                {" · "}${plan.priceUsd}/month
                {(plan.trialDays ?? 0) > 0 && ` · ${plan.trialDays}-day free trial`}
              </span>
              <button
                type="button"
                onClick={requestClose}
                disabled={state.busy || resolving || accountReset.busy}
                aria-label={dialogStep === "account" ? "Close" : "Finish later"}
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:bg-zinc-100 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none dark:hover:bg-white/10"
              >
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>
          </header>

          {/* The title a screen reader announces for the whole takeover. */}
          <DialogPrimitive.Title className="sr-only">Set up your Drive247 portal</DialogPrimitive.Title>
          <p className="sr-only" aria-live="polite">
            {closeConfirmOpen
              ? "Leave setup? Confirm or keep going."
              : resolving
                ? "Checking your setup."
                : `${PROGRESS_LABELS[progressIndex]}.${state.busy ? " Working, please wait." : ""}`}
          </p>

          {/* ── the screen ────────────────────────────────────────────────── */}
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-3 pb-4 sm:px-6 sm:pb-8">
            {/* Progress sits above the card, not on it. */}
            <ol
              className="mb-5 flex shrink-0 items-center justify-center gap-1.5"
              aria-label={`Step ${progressIndex + 1} of ${PROGRESS_LABELS.length}: ${PROGRESS_LABELS[progressIndex]}`}
            >
              {PROGRESS_LABELS.map((label, i) => (
                <li key={label} aria-hidden className="relative h-1 w-7 overflow-hidden rounded-full bg-indigo-900/10 sm:w-10 dark:bg-white/15">
                  <span
                    className={cn(
                      "absolute inset-0 origin-left rounded-full bg-indigo-600 transition-transform duration-200 ease-out motion-reduce:transition-none dark:bg-indigo-400",
                      i <= progressIndex ? "scale-x-100" : "scale-x-0",
                    )}
                  />
                </li>
              ))}
            </ol>
            <div className={cn("relative flex min-h-0 w-full max-w-[480px] flex-col overflow-hidden", SIGNUP_CARD)}>
              {/* Sized to fit: the picture shrinks, then steps aside, on short
                  screens (see ScreenHead), so the page itself never scrolls.
                  The overflow here is a last resort for a phone held sideways. */}
              <div className="min-h-0 overflow-y-auto px-6 py-7 [scrollbar-width:none] sm:px-10 sm:py-8 [&::-webkit-scrollbar]:hidden">
                <div ref={contentRef} className="w-full">
                {closeConfirmOpen ? (
                  <div key="leave" className={SIGNUP_ENTER}>
                    <ScreenHead
                      art={<PauseArt />}
                      title="Leave for now?"
                      lead="Your account is saved. Come back to drive-247.com and I'll pick up right here. Nothing has been charged yet."
                    />
                    <div className="mt-6 space-y-3">
                      <Button ref={keepGoingRef} type="button" onClick={cancelClose} className={SIGNUP_PRIMARY}>
                        Keep going
                      </Button>
                      <button type="button" onClick={confirmClose} className={cn(SIGNUP_QUIET, "block w-full text-center")}>
                        Leave
                      </button>
                    </div>
                  </div>
                ) : null}

                {/*
                  Kept mounted (merely hidden) behind the confirmation panel. The
                  payment step owns a Stripe iframe; unmounting it would throw
                  away a half-typed card number the moment someone clicks close.
                */}
                <div hidden={closeConfirmOpen}>
                  {resolving ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-24" aria-live="polite">
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
                      <p className="text-sm text-muted-foreground">Checking your setup…</p>
                    </div>
                  ) : (
                    // Keyed per screen so each one rises in on entry. Within a
                    // screen the key is stable, so nothing remounts while typing.
                    <div key={screenKey} className={SIGNUP_ENTER}>
                      {dialogStep === "account" && step !== "verify" ? (
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
                          page={accountPage}
                          onPageChange={setAccountPage}
                        />
                      ) : null}

                      {step === "verify" ? (
                        <VerifyStep
                          email={state.account?.email ?? ""}
                          busy={state.busy}
                          onVerify={(code) => verifyEmailCode(code)}
                          onResend={() => resendEmailCode()}
                          onUseDifferentEmail={useDifferentEmail}
                          error={verifyError}
                          onClearError={clearVerifyError}
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
                          amountDueCents={state.payment.amountDueCents}
                          promo={state.payment.promo}
                          promoNotice={state.payment.promoNotice}
                          intentType={state.payment.intentType}
                          trialDays={state.payment.trialDays}
                          trialEndsAt={state.payment.trialEndsAt}
                          onApplyPromo={applyPromoCode}
                          ownerName={state.account?.fullName ?? ""}
                          companyName={state.business.companyName}
                        />
                      ) : null}
                    </div>
                  )}

                  {notices.map((n) => (
                    <Alert key={n.key} variant="info" className={cn("mt-5 rounded-xl text-left", SIGNUP_ENTER)}>
                      {n.icon === "resume" ? <RotateCcw /> : <Info />}
                      <AlertDescription className="text-foreground">{n.text}</AlertDescription>
                    </Alert>
                  ))}

                  {bannerError ? (
                    <Alert variant="destructive" className={cn("mt-5 rounded-xl text-left", SIGNUP_ENTER)}>
                      <TriangleAlert />
                      <AlertTitle>I couldn&apos;t continue</AlertTitle>
                      <AlertDescription className="text-red-600 dark:text-red-400">
                        <span>{SIGNUP_ERROR_COPY[bannerError.code]}</span>
                        {bannerError.code === "CONFIG_MISSING" ? (
                          <a href="/strategy-call" className="font-semibold underline underline-offset-4">
                            Book a strategy call
                          </a>
                        ) : null}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  {!resolving && (!primaryHidden || canGoBack) ? (
                    <div className="mt-6 space-y-3">
                      {!primaryHidden ? (
                        <Button
                          // `form` + `type="submit"` lets one button drive every
                          // step's form; Enter in any field submits it too.
                          type="submit"
                          form={FORM_IDS[dialogStep]}
                          disabled={primaryDisabled}
                          className={SIGNUP_PRIMARY}
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
                      ) : null}

                      {canGoBack ? (
                        <button
                          type="button"
                          disabled={state.busy}
                          onClick={() => setAccountPage((p) => Math.max(0, p - 1))}
                          className={cn(SIGNUP_QUIET, "mx-auto flex items-center gap-1.5")}
                        >
                          <ArrowLeft className="h-3.5 w-3.5" />
                          Back
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
