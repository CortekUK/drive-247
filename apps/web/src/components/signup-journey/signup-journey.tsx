"use client";

/**
 * The signup journey hosted at `/signup-preview`.
 *
 * SHAPE
 * -----
 * The page is the REAL pricing grid — `<PricingSection>`, the same component
 * the marketing page renders — handed an `onSelectPlan` callback. There is no
 * second pricing page to keep in step with the first.
 *
 * Pressing Subscribe opens ONE dialog, and every remaining step (account,
 * confirmation code, payment, handoff) happens inside it. The dialog does not
 * close and reopen between steps: only its body swaps, so the operator never
 * loses the thread and the pricing page stays behind the scrim as context.
 *
 * The dialog is composed from the Radix primitive directly rather than from
 * `components/ui/dialog`. That wrapper renders its own overlay with no way to
 * reach it, and this design needs a blurred scrim, a full-height sheet on
 * mobile, its own close affordance and a hairline progress rail across the top
 * edge. Radix gives the behaviour that matters for free — focus into the dialog
 * on open, a focus trap while it is open, focus back on the Subscribe button
 * that opened it, Escape to dismiss, `role="dialog"` + `aria-modal`, body scroll
 * lock.
 *
 * WHAT SURVIVES A DISMISSAL
 * -------------------------
 * Everything the operator typed. The account fields, the tenant draft and the
 * chosen plan all live HERE, in the shell, not inside the steps — so Escape
 * followed by Subscribe again lands back on the same step with the same values.
 * The one thing not carried is the confirmation code, which is four digits and
 * cheaper to retype than to preserve. Finishing the journey is the exception:
 * closing from the last step resets everything, because that journey is over.
 *
 * NOTHING IN THIS TREE TALKS TO A SERVER except Stripe's test API in the card
 * step. There is no Supabase client, no edge-function call and no write of any
 * kind. See `lib/signup-journey.ts` for what stands in for what.
 */

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";

import { PricingSection } from "@/components/sections/pricing";
import {
  JourneyAccountStep,
  type JourneyCredentials,
} from "@/components/signup-journey/steps/journey-account-step";
import {
  JourneyPaymentStep,
  type JourneyPaymentOutcome,
} from "@/components/signup-journey/steps/journey-payment-step";
import { JourneyHandoffStep } from "@/components/signup-journey/steps/journey-handoff-step";
import { JourneyVerifyStep } from "@/components/signup-journey/steps/journey-verify-step";
import {
  EMPTY_BUSINESS_DRAFT,
  type BusinessDraft,
} from "@/components/onboarding/onboarding-types";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import {
  FIRST_JOURNEY_STEP,
  JOURNEY_STEPS,
  journeyStepIndex,
  type JourneyStep,
} from "@/lib/signup-journey";
import {
  formatPlanPriceUsd,
  getSignupPlan,
  SIGNUP_PLANS,
  type SignupPlan,
  type SignupPlanId,
} from "@/lib/plans";
import { cn } from "@/lib/utils";

const EMPTY_CREDENTIALS: JourneyCredentials = {
  fullName: "",
  email: "",
  password: "",
};

/**
 * Stripe injects a floating tab into OUR document when the key is test-mode —
 * an iframe titled "Stripe developer tools frame", rendered as a black pill
 * pinned to the right edge of the viewport, offering to autofill card numbers.
 *
 * It is a convenience for whoever is building the integration and it has no
 * part in the screen an operator is meant to see, so it is hidden. Nothing in
 * the payment path goes through it: the element, the tokenisation and every
 * error state behave identically with it on screen or not.
 *
 * Rendered by the SHELL, not by the card step. Stripe appends that iframe to
 * `<body>` and leaves it there — it outlives the step that caused it, so a rule
 * scoped to the card step stops applying the moment the flow reaches the
 * handoff and the tab reappears on the last screen.
 *
 * NOT `display:none`. Stripe writes `display: block !important` INLINE on that
 * iframe, and an inline `!important` beats an author `!important` — the rule
 * parses, matches, and does nothing. The properties below are the ones Stripe
 * sets without `!important` (size, offsets, z-index) plus `opacity` and
 * `pointer-events`, which it does not set at all, so each of these wins.
 */
const HIDE_STRIPE_DEV_TOOLS = `iframe[title="Stripe developer tools frame"]{opacity:0!important;pointer-events:none!important;width:1px!important;height:1px!important;bottom:0!important;right:0!important;z-index:-1!important}`;

interface SignupJourneyProps {
  /** Defaulted so the page renders even if a caller forgets the prop. */
  plans?: readonly SignupPlan[];
}

export function SignupJourney({ plans = SIGNUP_PLANS }: SignupJourneyProps) {
  const catalogue = plans.length > 0 ? plans : SIGNUP_PLANS;

  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<JourneyStep>(FIRST_JOURNEY_STEP);
  const [planId, setPlanId] = React.useState<SignupPlanId | null>(null);
  const [credentials, setCredentials] =
    React.useState<JourneyCredentials>(EMPTY_CREDENTIALS);
  const [tenant, setTenant] =
    React.useState<BusinessDraft>(EMPTY_BUSINESS_DRAFT);
  const [payment, setPayment] = React.useState<JourneyPaymentOutcome | null>(
    null,
  );
  /**
   * Reported up by the handoff step when its milestones finish, because the
   * headline for that step changes halfway through it and the headline lives
   * out here in the dialog chrome.
   */
  const [provisioned, setProvisioned] = React.useState(false);

  /** The Subscribe button the dialog was opened from; focus goes back to it. */
  const triggerRef = React.useRef<HTMLElement | null>(null);

  const plan = planId ? (getSignupPlan(planId, catalogue) ?? null) : null;

  const reset = React.useCallback(() => {
    setStep(FIRST_JOURNEY_STEP);
    setPlanId(null);
    setCredentials(EMPTY_CREDENTIALS);
    setTenant(EMPTY_BUSINESS_DRAFT);
    setPayment(null);
    setProvisioned(false);
  }, []);

  const updateTenant = React.useCallback((patch: Partial<BusinessDraft>) => {
    setTenant((prev) => ({ ...prev, ...patch }));
  }, []);

  // Stable, so the handoff step's "we finished" effect is keyed on `done` alone
  // rather than re-running on every render of this shell.
  const markProvisioned = React.useCallback(() => setProvisioned(true), []);

  const goTo = React.useCallback((next: JourneyStep) => {
    // The handoff replays its milestones on every entry, so the headline has to
    // go back to "setting up" with it.
    if (next === "portal") setProvisioned(false);
    setStep(next);
  }, []);

  /**
   * Subscribe, from a card in the grid behind the dialog.
   *
   * Choosing a DIFFERENT plan mid-journey rewinds to the first step and drops
   * any card outcome: the amount on the payment screen and the plan the handoff
   * congratulates them on would otherwise belong to the tier they just walked
   * away from. What they typed is kept — the account and the workspace are the
   * same whichever tier they land on.
   */
  const selectPlan = React.useCallback(
    (id: SignupPlanId) => {
      // The Subscribe button that opened the dialog, so focus can be handed
      // straight back to it on close. Radix restores the previously-focused
      // element on its own, but it lands on `<body>` here — the grid re-renders
      // underneath the dialog while it is open — and dropping someone at the top
      // of the document after Escape is exactly the disorientation the focus
      // rules exist to prevent.
      triggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      if (id !== planId) {
        setPlanId(id);
        setPayment(null);
        setProvisioned(false);
        setStep(FIRST_JOURNEY_STEP);
      }
      setOpen(true);
    },
    [planId],
  );

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next);
      // Closing from the last step ends the journey rather than parking it:
      // there is nothing left to come back to, and reopening onto a finished
      // success screen would be a dead end.
      if (!next && step === "portal") reset();
    },
    [reset, step],
  );

  /**
   * Scroll lock, ours rather than Radix's.
   *
   * The dialog runs `modal={false}` — see `<JourneyDialog>` for why — which
   * switches off everything Radix does to the document outside it, the scroll
   * lock included. A page that scrolls behind an open dialog is the one part of
   * that worth having back, so it is done here: the pricing grid is long, and a
   * scroll wheel over the scrim moving the page underneath reads as a bug.
   *
   * The scrollbar's width is paid back as padding, or removing it shifts the
   * whole page sideways at the moment the dialog opens.
   */
  React.useEffect(() => {
    if (!open) return;
    const { overflow, paddingRight } = document.body.style;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gutter > 0) document.body.style.paddingRight = `${gutter}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [open]);

  return (
    <div
      className="min-h-dvh bg-background"
      /*
        Background isolation, ours rather than Radix's, and deliberately narrow.
        Radix's modal mode hides EVERY child of `<body>` from assistive tech —
        which sweeps up Stripe's iframes and breaks the card step (again, see
        `<JourneyDialog>`). Hiding this one element hides the whole page and
        nothing else: the dialog is portalled to `<body>`, so it stays readable.
      */
      aria-hidden={open ? true : undefined}
    >
      <style>{HIDE_STRIPE_DEV_TOOLS}</style>

      {/*
        A slim header of its own rather than the marketing <Header>: that one
        carries `#pricing`, `#faq` and the other in-page anchors, none of which
        exist here, so every link in it would be dead.
      */}
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/logo-light.png"
              alt="Drive247"
              width={855}
              height={195}
              className="h-6 w-auto dark:hidden"
              priority
            />
            <Image
              src="/logo-dark.png"
              alt="Drive247"
              width={855}
              height={195}
              className="hidden h-6 w-auto dark:block"
              priority
            />
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main id="main">
        <div className="mx-auto max-w-3xl px-4 pt-14 text-center sm:px-6 sm:pt-20">
          <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl lg:text-[44px] lg:leading-tight">
            Let&apos;s get your fleet{" "}
            <span className="text-indigo-600 dark:text-indigo-400">
              booking direct
            </span>
            .
          </h1>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-muted-foreground">
            I&apos;m Trax. Pick the plan that fits the fleet you run today and
            I&apos;ll take you through the rest — your account, your web
            address, your first payment, and then straight into your portal.
          </p>
        </div>

        {/* The real grid, not a copy of it. */}
        <PricingSection plans={catalogue} onSelectPlan={selectPlan} />
      </main>

      <JourneyDialog
        open={open && Boolean(plan)}
        onOpenChange={handleOpenChange}
        step={step}
        plan={plan}
        email={credentials.email}
        companyName={tenant.companyName}
        provisioned={provisioned}
        returnFocusTo={triggerRef}
      >
        {plan && step === "account" && (
          <JourneyAccountStep
            values={credentials}
            onValuesChange={setCredentials}
            tenant={tenant}
            onTenantChange={updateTenant}
            onSubmit={() => goTo("verify")}
          />
        )}

        {plan && step === "verify" && (
          <JourneyVerifyStep
            onBack={() => goTo("account")}
            onVerified={() => goTo("payment")}
          />
        )}

        {plan && step === "payment" && (
          <JourneyPaymentStep
            plan={plan}
            email={credentials.email}
            onBack={() => goTo("verify")}
            onPaid={(outcome) => {
              setPayment(outcome);
              goTo("portal");
            }}
          />
        )}

        {plan && step === "portal" && (
          <JourneyHandoffStep
            slug={tenant.slug}
            payment={payment}
            onReady={markProvisioned}
            onFinish={() => handleOpenChange(false)}
          />
        )}
      </JourneyDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

/**
 * The headline and the sentence under it for each step.
 *
 * They live out here rather than inside the steps so there is exactly ONE
 * headline on screen at any moment, at the dialog's scale, and so the step
 * bodies stay what they are: controls, and nothing else.
 */
function stepCopy(
  step: JourneyStep,
  { email, workspace, provisioned }: {
    email: string;
    workspace: string;
    provisioned: boolean;
  },
): { title: string; description: string } {
  switch (step) {
    case "account":
      return {
        title: "Create your account",
        description:
          "This is the login you'll run your fleet from, and the name your customers will book under.",
      };
    case "verify":
      return {
        title: "Confirm it's you",
        description: `I've sent a code to ${email || "your inbox"}. Enter it below and I'll take you to payment.`,
      };
    case "payment":
      return {
        title: "Confirm and pay",
        description:
          "One last step, and your portal and booking site are yours.",
      };
    case "portal":
      return provisioned
        ? {
            title: "You're live.",
            description: `${workspace} is set up. Your portal and your booking site are both ready.`,
          }
        : {
            title: `Setting up ${workspace}`,
            description:
              "I'm putting your workspace together. This is the one screen you only ever see once.",
          };
  }
}

/** Everything the browser will land on with Tab, in document order. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Keep Tab inside the dialog.
 *
 * Radix's own focus trap comes with modal mode, which the card step cannot
 * survive — so containment is done here instead, and deliberately as a KEYDOWN
 * handler rather than the usual `focusin` guard. A `focusin` guard yanks focus
 * back whenever it lands anywhere unexpected, and "unexpected" includes the
 * inside of Stripe's card iframe; this only ever acts on a Tab press that has
 * actually reached the dialog, so it cannot fight an iframe for focus.
 *
 * When focus is inside the card iframe the key event fires in THAT document and
 * never reaches this handler at all, which is the correct outcome: the browser
 * moves through Stripe's fields and hands focus back to the next control here
 * on its own.
 */
function containTab(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;

  const root = event.currentTarget;
  const focusable = Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    // `offsetParent === null` catches `display: none`; a zero-size box catches
    // the visually-hidden ones that are still technically laid out.
    (el) => el.offsetParent !== null || el.getClientRects().length > 0,
  );
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey ? active === first : active === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

interface JourneyDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  step: JourneyStep;
  plan: SignupPlan | null;
  email: string;
  companyName: string;
  provisioned: boolean;
  /** Where focus goes when the dialog closes — the button that opened it. */
  returnFocusTo: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

function JourneyDialog({
  open,
  onOpenChange,
  step,
  plan,
  email,
  companyName,
  provisioned,
  returnFocusTo,
  children,
}: JourneyDialogProps) {
  const index = journeyStepIndex(step);
  const workspace = companyName.trim() || "your workspace";
  const { title, description } = stepCopy(step, {
    email,
    workspace,
    provisioned,
  });

  return (
    /*
      `modal={false}`, and it is not a shortcut — it is here for the card step.
      ────────────────────────────────────────────────────────────────────────
      Radix's modal mode does two things to everything outside the dialog:
      `pointer-events: none` on `<body>`, and `aria-hidden="true"` on every one
      of its children. Stripe.js appends its controller, its metrics frame and
      an invisible hCaptcha frame directly to `<body>`, and
      `createPaymentMethod()` runs a bot check through them BEFORE it posts to
      `/v1/payment_methods`. Under those two attributes the check never
      completes: the promise never settles, the request is never made, and the
      button sits on "Confirming…" for ever. A network trace during the hang
      shows nothing but telemetry to `r.stripe.com`.

      That was measured in the browser, three ways: lifting `pointer-events`
      alone left it stuck, lifting `aria-hidden` alone left it stuck, lifting
      both sent the POST and finished the flow in four seconds. Exempting only
      the frames that LOOK like Stripe's is not enough either — it parks an
      unmarked wrapper `<div>` on `<body>` as well — so there is nothing clean to
      whitelist.

      Honesty about that evidence: `js.stripe.com` later degraded badly on this
      machine (a 20-second stall on the script itself), which makes any single
      timing measurement from that window less than proof. The configuration
      stands regardless, because it is the known-safe one for a third party that
      appends working iframes to `<body>` — Stripe, hCaptcha and reCAPTCHA all
      do — and because nothing it gives up has been given up: every piece is
      rebuilt below and each one is verified.

      What modal mode was giving us is therefore rebuilt explicitly, and each
      piece is written where it belongs:
        - scroll lock            -> an effect in <SignupJourney>
        - background hidden      -> `aria-hidden` on the page wrapper, which
                                    hides the page WITHOUT touching Stripe
        - Escape, outside-click  -> still Radix's, unchanged in this mode
        - focus in, focus back   -> still Radix's, unchanged in this mode
        - Tab containment        -> `containTab` below
    */
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        {/*
          A plain div, not `<DialogPrimitive.Overlay>`.

          Radix's Overlay renders `null` outright when `modal` is false — the
          component body is `context.modal ? <OverlayImpl/> : null` — so using it
          here would leave the pricing page undimmed and the dialog floating on
          nothing. This is the same element with the same job: it dims and blurs
          the page, and because it sits outside <Content> a press on it is an
          "interact outside", which is what dismisses the dialog.
        */}
        <div
          data-slot="journey-overlay"
          className={cn(
            "fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm dark:bg-slate-950/70",
            "animate-in fade-in-0 duration-200",
          )}
        />

        <DialogPrimitive.Content
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={containTab}
          // Focus the panel itself rather than whatever happens to be first in
          // it — which is the close button, and opening a dialog with your
          // cursor on "dismiss" is a strange greeting. Landing on the panel also
          // means the headline is the first thing a screen reader reads.
          onOpenAutoFocus={(event) => {
            const panel = event.currentTarget;
            if (!(panel instanceof HTMLElement)) return;
            event.preventDefault();
            panel.focus();
          }}
          onCloseAutoFocus={(event) => {
            const trigger = returnFocusTo.current;
            if (!trigger?.isConnected) return;
            event.preventDefault();
            trigger.focus();
          }}
          className={cn(
            // Full-height sheet on a phone, centred panel from `sm` up.
            "fixed inset-0 z-50 flex flex-col bg-background outline-none",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[min(88dvh,54rem)] sm:w-[calc(100%-3rem)] sm:max-w-[42rem]",
            "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-2xl",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 sm:data-[state=closed]:zoom-out-95",
            "duration-200",
          )}
        >
          {/*
            The step indicator, and deliberately the quietest thing on screen:
            a 2px rail along the very top edge. It answers "how far in am I"
            without competing with the headline for attention.
          */}
          <div
            aria-hidden="true"
            className="h-0.5 w-full shrink-0 bg-muted sm:rounded-t-2xl"
          >
            <div
              className="h-full bg-indigo-600 transition-[width] duration-500 ease-out dark:bg-indigo-400"
              style={{
                width: `${((index + 1) / JOURNEY_STEPS.length) * 100}%`,
              }}
            />
          </div>

          {/* Plan, position, and the way out. */}
          <div className="flex shrink-0 items-center gap-4 px-6 pt-6 sm:px-10 sm:pt-8">
            <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
              {plan && (
                <>
                  <span className="font-medium text-foreground">
                    {plan.name}
                  </span>
                  {` · ${formatPlanPriceUsd(plan)}/month`}
                </>
              )}
            </p>

            <p className="shrink-0 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase tabular-nums">
              {`Step ${index + 1} of ${JOURNEY_STEPS.length}`}
            </p>

            <DialogPrimitive.Close
              className={cn(
                "-mr-2 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
                "hover:bg-muted hover:text-foreground",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              )}
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>

          {/*
            The body scrolls, the chrome above it does not — so the plan, the
            step count and the way out are always reachable on a tall step.
          */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-7 pb-10 sm:px-10 sm:pt-9 sm:pb-12">
            <DialogPrimitive.Title className="text-[27px] leading-[1.12] font-bold tracking-tighter text-balance sm:text-[32px]">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              {description}
            </DialogPrimitive.Description>

            {/* Keyed by step so each one fades in. Within a step the key is
                stable, so nothing remounts while someone is typing. */}
            <div
              key={step}
              className="mt-8 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 sm:mt-9"
            >
              {children}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
