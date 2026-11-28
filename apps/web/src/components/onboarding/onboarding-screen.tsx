"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Info, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

import { useOnboarding, useOnboardingShell } from "./onboarding-provider";
import { prewarmStripeJs } from "./stripe-prewarm";
import {
  SIGNUP_ERROR_COPY,
  type SignupErrorCode,
  type SignupStep,
} from "./onboarding-types";
import { AccountStep, type ResetShellState } from "./steps/account-step";
import { EXIT_OFFER_CODE, isExitIntent, isPhoneLike, shouldShowExitOffer } from "./exit-offer";
import { ExitOfferPanel, type FinishLaterState } from "./exit-offer-panel";
import { isBlackFridayInBrowser } from "@/lib/black-friday";
import { PaymentStep } from "./steps/payment-step";
import { OpenInBrowserPanel } from "./open-in-browser-panel";
import { VerifyStep } from "./steps/verify-step";
import {
  FooterSlotProvider,
  SignupWash,
  StepLines,
  SIGNUP_ENTER,
} from "./signup-ui";

/**
 * The self-serve signup, full screen.
 *
 * It takes over the page the moment a plan is picked and stays until the
 * provisioning overlay takes over from it. Since 2026-11-23 it wears the look
 * of the portal's onboarding questions (see signup-ui.tsx): no card, a
 * display-size heading on the page wash, the fields as underlines, and the
 * chrome in the bottom corner (progress lines on the left, the two angle
 * brackets, back and forward, on the right). The order is the one agreed on
 * 2026-11-23: who you are → the business (which creates the account and sends
 * the code) → the email code → a password → the card.
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
 * The progress lines, one per screen in the order they come (Ghulam,
 * 2026-11-23): the two account pages, the email code, the password, then the
 * card. The Google return's business-only screen sits on the business line;
 * Google skips the code and the password.
 */
// feat-001: three steps. The email code and the password moved into the portal.
const PROGRESS_LABELS = ["You", "Your business", "Card"] as const;

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
    requestClose,
    submitAccount,
    signInExisting,
    useDifferentEmail,
    signInInstead,
    startPayment,
    markPaid,
    applyPromoCode,
    submitTenantDetails,
    submitAttribution,
    submitPassword,
    startGoogleSignup,
    verifyEmailCode,
    resendEmailCode,
    verifyError,
    clearVerifyError,
    updateBusiness,
    checkSlug,
    setError,
  } = useOnboarding();
  const {
    resolving,
    planSwitchBlocked,
    accountMode,
    googleEnabled,
    plans,
    verifySentAt,
    changePlan,
    exitOfferSeen,
    noteExitOfferShown,
    trackExitOffer,
    sendFinishLaterLink,
  } = useOnboardingShell();

  const contentRef = useRef<HTMLDivElement>(null);

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

  /** Which page of the create-account form is showing (0 you, 1 business, 2 password). */
  const [accountPage, setAccountPage] = useState(0);
  /**
   * The footer's action slot (see FooterAction in signup-ui.tsx). State, not a
   * ref, so the screens that portal into it re-render once it exists.
   */
  const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null);

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
  // "Use a different email" on the code screen returns to the first page,
  // where the address is, not to the business page the form was sent from.
  useEffect(() => {
    if (state.step === "verify") setAccountPage(0);
  }, [state.step]);

  // -------------------------------------------------------------------------
  // "Not ready just yet?" — the card step's one-time offer (exit-offer.ts)
  // -------------------------------------------------------------------------

  /** Which way they were leaving when it opened. Null = not on screen. */
  const [exitOffer, setExitOffer] = useState<"exit_intent" | "close" | "back" | null>(null);
  const [offerApplying, setOfferApplying] = useState(false);
  const [finishLater, setFinishLater] = useState<FinishLaterState>("idle");
  /** A quiet line on the card step when the code could not be applied. */
  const [offerNotice, setOfferNotice] = useState<string | null>(null);
  const offerPrimaryRef = useRef<HTMLButtonElement>(null);

  /** Phones and tablets: X / back trigger, and the "Email me a link" button. */
  const [phoneLike, setPhoneLike] = useState(false);
  useEffect(() => {
    const read = () => setPhoneLike(isPhoneLike(window));
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  /**
   * The payment step's "Change plan" list. Held here, not in the step, because
   * while it is open the person is choosing a plan, not leaving: the top-right
   * X, Escape and a phone's back button close the list, and the one-time
   * discount offer cannot show (2026-11-24: a new signup tapped "Change plan",
   * then the X to close the list, got the offer and took 20% off).
   */
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  const planPickerOpenRef = useRef(planPickerOpen);
  useEffect(() => {
    planPickerOpenRef.current = planPickerOpen;
  });
  useEffect(() => {
    if (state.step !== "payment" || !isOpen) setPlanPickerOpen(false);
  }, [state.step, isOpen]);

  // Black Friday (lib/black-friday.ts): BF30 is on every signup, so the popup
  // offers no code at all. It says the price is saved and offers the link.
  const [blackFriday] = useState(() => isBlackFridayInBrowser());

  const offerAllowed = shouldShowExitOffer({
    step: state.step,
    paid: state.payment.paid,
    // During the offer the applied code IS the offer, so it does not hide the popup.
    promoApplied: Boolean(state.payment.promo) && !blackFriday,
    busy: state.busy,
    seenLocally: exitOfferSeen,
    seenOnAccount: false,
    covered: exitOffer !== null || !isOpen || planPickerOpen,
  });
  const offerAllowedRef = useRef(offerAllowed);
  useEffect(() => {
    offerAllowedRef.current = offerAllowed;
  });

  const showExitOffer = useCallback(
    (trigger: "exit_intent" | "close" | "back") => {
      setFinishLater("idle");
      setOfferNotice(null);
      setExitOffer(trigger);
      noteExitOfferShown(trigger);
    },
    [noteExitOfferShown],
  );

  useEffect(() => {
    if (exitOffer) offerPrimaryRef.current?.focus();
  }, [exitOffer]);

  // Leaving the card step (paid, closed) takes the offer and its note with it.
  useEffect(() => {
    if (state.step !== "payment" || !isOpen) {
      setExitOffer(null);
      setOfferNotice(null);
    }
  }, [state.step, isOpen]);

  /**
   * Desktop: the mouse leaving through the top of the window. Armed a moment
   * after the card step appears, so the pointer passing the tab strip on the
   * way in does not count.
   */
  useEffect(() => {
    if (!offerAllowed || phoneLike) return;
    let armed = false;
    const arm = window.setTimeout(() => {
      armed = true;
    }, 1500);
    const onOut = (e: MouseEvent) => {
      if (armed && isExitIntent(e)) showExitOffer("exit_intent");
    };
    document.addEventListener("mouseout", onOut);
    return () => {
      window.clearTimeout(arm);
      document.removeEventListener("mouseout", onOut);
    };
  }, [offerAllowed, phoneLike, showExitOffer]);

  /**
   * Phones: the back button. One history entry is added while the offer is
   * still to be shown; pressing back pops it, which opens the offer instead of
   * leaving the page. Only the first press is caught: if the offer cannot be
   * shown by then (busy, a code was applied), that press closes the signup
   * instead, and the next one leaves as normal.
   */
  const backGuardRef = useRef(false);
  const guardWanted =
    phoneLike && isOpen && state.step === "payment" && !state.payment.paid && !exitOfferSeen && !state.payment.promo;
  useEffect(() => {
    if (!guardWanted || backGuardRef.current) return;
    try {
      // Next.js keeps its router state in history.state, so it is carried over.
      window.history.pushState({ ...(window.history.state ?? {}), d247ExitGuard: true }, "");
      backGuardRef.current = true;
    } catch {
      /* history locked down: the X still shows the offer */
    }
  }, [guardWanted]);
  useEffect(() => {
    if (state.step !== "payment") return;
    const onPop = () => {
      if (!backGuardRef.current) return;
      if (planPickerOpenRef.current) {
        // Back with the plan list open closes the list, like the X. The guard
        // entry it used up is put back, so the next back still reaches here.
        setPlanPickerOpen(false);
        try {
          window.history.pushState({ ...(window.history.state ?? {}), d247ExitGuard: true }, "");
        } catch {
          backGuardRef.current = false;
        }
        return;
      }
      backGuardRef.current = false;
      if (offerAllowedRef.current) showExitOffer("back");
      else requestClose();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [state.step, showExitOffer, requestClose]);

  /**
   * The top-right X (and Escape). On the card step the one-time offer comes
   * first, on every device; once it has been seen, or when it cannot show, the
   * signup simply closes. There is no second "Leave for now?" box any more:
   * after "No thanks" a second box read as a trap (owner, 2026-11-20).
   */
  const onCloseButton = useCallback(() => {
    if (planPickerOpenRef.current) {
      // The X / Escape with "Change plan" open closes the list. Nobody is
      // leaving, so no offer and no close.
      setPlanPickerOpen(false);
      return;
    }
    if (exitOffer) {
      // Closing over the offer is a "no thanks" on the way out.
      trackExitOffer("exit_offer_dismissed");
      setExitOffer(null);
      requestClose();
      return;
    }
    if (offerAllowedRef.current) {
      showExitOffer("close");
      return;
    }
    requestClose();
  }, [exitOffer, requestClose, showExitOffer, trackExitOffer]);

  const acceptExitOffer = useCallback(async () => {
    trackExitOffer("exit_offer_accepted");
    setOfferApplying(true);
    let problem: string | null = null;
    try {
      problem = await applyPromoCode(EXIT_OFFER_CODE);
    } catch {
      problem = "unavailable";
    }
    setOfferApplying(false);
    setExitOffer(null);
    // The code is the owner's to create. Until it exists (or if it is
    // switched off) they stay on the card step at the full price, told quietly.
    setOfferNotice(problem ? "The 20% off couldn't be applied just now. You can still start your free trial." : null);
  }, [applyPromoCode, trackExitOffer]);

  const dismissExitOffer = useCallback(() => {
    const trigger = exitOffer;
    if (finishLater !== "sent") trackExitOffer("exit_offer_dismissed");
    setExitOffer(null);
    // They were closing the signup when it opened: carry on with that.
    if (trigger === "close") requestClose();
  }, [exitOffer, finishLater, requestClose, trackExitOffer]);

  const requestFinishLater = useCallback(async () => {
    trackExitOffer("finish_later_requested");
    setFinishLater("sending");
    setFinishLater((await sendFinishLaterLink()) ? "sent" : "failed");
  }, [sendFinishLaterLink, trackExitOffer]);

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
    !resolving;

  const bannerError =
    state.error && !INLINE_ONLY_CODES.has(state.error.code)
      ? // CONFIG_MISSING on the payment step is rendered by PaymentStep as a
        // full replacement for the card form, with its own support link.
        state.error.code === "CONFIG_MISSING" && step === "payment"
        ? null
        : state.error
      : null;

  const notices = useMemo(() => {
    const out: { key: string; text: string; icon: "resume" | "info" }[] = [];
    // No "Welcome back" note on resume: landing on the right screen with their
    // answers in place says it already.
    if (planSwitchBlocked && plan) {
      out.push({
        key: "plan-locked",
        text: `You've already paid for the ${plan.name} plan. Let's finish your portal first — I can move you to a different plan from there.`,
        icon: "info",
      });
    }
    // There was a "Your payment is going through" notice here for `tenant` mode,
    // gated on `!paid`. `tenant` mode is also reached BEFORE paying (after the
    // email code, after Google), so it told unpaid operators their payment was
    // in flight. State has no way to tell `processing` from `succeeded`, so the
    // notice is gone rather than guessed at.
    return out;
  }, [planSwitchBlocked, plan]);

  if (!plan || !dialogStep) return null;

  const paging = dialogStep === "account" && step !== "verify" && !state.signInPrompt && accountMode === "create";
  const onPasswordScreen =
    dialogStep === "account" && step !== "verify" && !state.signInPrompt && accountMode === "password";

  // The code and password screens only appear for a signup started before the
  // 3-step change; they sit between the business and the card (index 1).
  const progressIndex =
    dialogStep === "payment"
      ? 2
      : onPasswordScreen || step === "verify" || accountMode === "tenant"
        ? 1
        : paging
          ? Math.min(accountPage, 1)
          : 0;

  /*
   * No button in the footer any more (Ghulam, 2026-11-23). Every screen draws
   * its own under its fields (signup-ui.tsx ColumnActions), and the card step
   * its trial / pay button under the card (payment-step.tsx). The footer is
   * the progress, plus any text action a screen hands it (FooterAction).
   */

  // Keyed per STEP only. The account pages animate inside AccountStep: keying
  // this wrapper by page would remount the step and throw away everything
  // typed on the pages before.
  const screenKey = exitOffer ? "offer" : step;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCloseButton();
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
            // The questions' screen: the whole viewport, scrolling as one page
            // when a screen is taller than the window (a phone, the card form).
            "fixed inset-0 z-[200] overflow-y-auto overscroll-contain bg-white text-foreground outline-none dark:bg-[#0e0e14]",
            // A dropdown (Radix Select) locks scrolling while open; without these the
            // layer lost its scrollbar and the centred screen jumped right (Hamza,
            // 28 Nov). Keep the scrollbar space and the library's fixed-layer class.
            "right-scroll-bar-position [scrollbar-gutter:stable]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in",
            "motion-reduce:animate-none!",
            // Tailwind 4 dropped the pointer on buttons; every action here gets it back.
            "[&_button:not(:disabled)]:cursor-pointer [&_a[href]]:cursor-pointer [&_[role=checkbox]:not(:disabled)]:cursor-pointer",
          )}
        >
          {/* The portal's page wash: the one under the onboarding questions. */}
          <SignupWash />

          {/* The title a screen reader announces for the whole takeover. */}
          <DialogPrimitive.Title className="sr-only">Set up your Drive247 portal</DialogPrimitive.Title>
          <p className="sr-only" aria-live="polite">
            {exitOffer
                ? "Not ready just yet? Start your free trial today and get 20% off your first 3 months."
              : resolving
                ? "Checking your setup."
                : `${PROGRESS_LABELS[progressIndex]}.${state.busy ? " Working, please wait." : ""}`}
          </p>

          <button
            type="button"
            onClick={onCloseButton}
            disabled={state.busy || resolving || accountReset.busy || offerApplying}
            aria-label={dialogStep === "account" ? "Close" : "Finish later"}
            className="absolute top-4 right-4 z-10 flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out max-sm:top-2 max-sm:right-2 max-sm:size-11 hover:bg-foreground/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none sm:top-6 sm:right-8"
          >
            <X className="h-[18px] w-[18px]" />
          </button>

          {/* ── the screen ────────────────────────────────────────────────── */}
          {/* The questions' frame: the same width, gutters and top air, the
              content ranged left, and the footer row at the bottom. */}
          <div className="relative flex min-h-full w-full flex-col px-6 pt-14 sm:px-10 sm:pt-16 lg:px-12 [@media(min-height:701px)_and_(max-height:880px)]:pt-10 [@media(max-height:700px)]:pt-6">
            {/* Centred (Ghulam, 2026-11-23): each screen sits in the middle of
                the window, both ways. */}
            <div ref={contentRef} className="flex flex-1 flex-col justify-center pb-6 [@media(max-height:880px)]:pb-3">
              <FooterSlotProvider value={footerSlot}>
                {exitOffer ? (
                  <div key="offer">
                    <ExitOfferPanel
                      ref={offerPrimaryRef}
                      applying={offerApplying}
                      blackFriday={blackFriday}
                      showFinishLater={phoneLike || blackFriday}
                      finishLater={finishLater}
                      onAccept={() => void acceptExitOffer()}
                      onFinishLater={() => void requestFinishLater()}
                      onDismiss={dismissExitOffer}
                    />
                  </div>
                ) : null}

                {/*
                  Kept mounted (merely hidden) behind the offer. The payment
                  step owns a Stripe iframe; unmounting it would throw away a
                  half-typed card number the moment someone clicks close.
                */}
                <div hidden={exitOffer !== null}>
                  {resolving ? (
                    <div className="flex items-center justify-center gap-3 py-24" aria-live="polite">
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
                      <p className="text-sm text-muted-foreground">Checking your setup…</p>
                    </div>
                  ) : (
                    // Keyed per screen so each one rises in on entry (its heading
                    // and fields carry the rise). Within a screen the key is
                    // stable, so nothing remounts while typing.
                    <div key={screenKey}>
                      {dialogStep === "account" && step !== "verify" ? (
                        <AccountStep
                          plan={plan}
                          mode={accountMode}
                          paid={state.payment.paid}
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
                          onSubmitAttribution={(values) => void submitAttribution(values)}
                          onSubmitPassword={(password) => void submitPassword(password)}
                          onGoogle={(values, provider, attribution) => void startGoogleSignup(values, provider, attribution)}
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
                          sentAt={verifySentAt}
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
                          bill={state.payment.bill}
                          onApplyPromo={blackFriday ? undefined : applyPromoCode}
                          ownerName={state.account?.fullName ?? ""}
                          companyName={state.business.companyName}
                          portalSlug={state.business.slug}
                          plans={plans}
                          onChangePlan={changePlan}
                          planPickerOpen={planPickerOpen}
                          onPlanPickerOpenChange={setPlanPickerOpen}
                          topSlot={state.payment.paid ? null : <OpenInBrowserPanel />}
                        />
                      ) : null}
                    </div>
                  )}

                  <div className="mx-auto w-full max-w-[46rem]">
                    {notices.map((n) => (
                      <Alert key={n.key} variant="info" className={cn("mt-6 rounded-2xl text-left", SIGNUP_ENTER)}>
                        {n.icon === "resume" ? <RotateCcw /> : <Info />}
                        <AlertDescription className="text-foreground">{n.text}</AlertDescription>
                      </Alert>
                    ))}

                    {offerNotice && dialogStep === "payment" ? (
                      <p role="status" className={cn("mt-4 text-[13px] text-muted-foreground", SIGNUP_ENTER)}>
                        {offerNotice}
                      </p>
                    ) : null}

                    {bannerError ? (
                      <Alert variant="destructive" className={cn("mt-6 rounded-2xl text-left", SIGNUP_ENTER)}>
                        <TriangleAlert />
                        <AlertTitle>I couldn&apos;t continue</AlertTitle>
                        <AlertDescription className="text-red-600 dark:text-red-400">
                          <span>{SIGNUP_ERROR_COPY[bannerError.code]}</span>
                          {bannerError.code === "CONFIG_MISSING" ? (
                            <a href="mailto:support@drive-247.com" className="font-semibold underline underline-offset-4">
                              Email support
                            </a>
                          ) : null}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                </div>
              </FooterSlotProvider>
            </div>

            {/*
              The footer row: just the progress since 2026-11-23, the buttons
              having moved under each screen's fields. Pinned to the bottom of
              the window; a fade keeps a long screen (a phone, Stripe's card
              form) readable as it scrolls under it.
            */}
            <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 pt-8 sm:grid sm:grid-cols-[1fr_auto_1fr] pb-[max(20px,env(safe-area-inset-bottom))] sm:pb-7 [@media(max-height:880px)]:pt-3 [@media(max-height:880px)]:pb-[max(12px,env(safe-area-inset-bottom))]">
              {/* The fade, the full width of the window whatever the frame's padding. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 bg-linear-to-t from-white/90 from-50% to-transparent dark:from-[#0e0e14]/90"
              />
              {/* Centred: the progress in the middle, the arrows still in the corner. */}
              <div aria-hidden className="max-sm:hidden" />
              <div className="flex flex-col gap-2 sm:items-center">
                <StepLines
                  total={PROGRESS_LABELS.length}
                  current={progressIndex}
                  label={`Step ${progressIndex + 1} of ${PROGRESS_LABELS.length}: ${PROGRESS_LABELS[progressIndex]}`}
                />
                {/* No "Payments are processed by Stripe" line here any more
                    (Ghulam, 2026-11-23). */}
              </div>

              <div className="ml-auto flex flex-wrap items-center justify-end gap-x-6 gap-y-3 sm:justify-self-end">
                {/* Screens that own a text action put it here (FooterAction). */}
                <div ref={setFooterSlot} className="contents" />
              </div>
            </footer>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
