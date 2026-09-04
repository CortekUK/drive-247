"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  getSignupPlan,
  isSignupPlanId,
  SIGNUP_PLANS,
  type SignupPlan,
  type SignupPlanId,
} from "@/lib/plans";
import { checkSlugShape, normalizeSlugClient } from "@/lib/signup-validation";
import { getBrowserSupabase } from "@/lib/supabase/browser";

import {
  fetchSignupMeta,
  signupBegin,
  signupBeginOauth,
  signupPaymentIntent,
  signupProvision,
  signupResume,
  signupSlugCheck,
  slugAvailabilityAnon,
  toOnboardingError,
  type ClientSignupMeta,
  type ProvisionRequest,
  type ResumeSignupDTO,
} from "./onboarding-api";
import {
  clearPendingOauth,
  clearTenantDraft,
  draftToBusiness,
  readPendingOauth,
  resolveTenantDraft,
  saveTenantDraft,
  writePendingOauth,
} from "./tenant-draft";
import { OnboardingDialog } from "./onboarding-dialog";
import { ProvisioningScreen } from "./provisioning-screen";
import {
  EMPTY_BUSINESS_DRAFT,
  PROVISION_MILESTONES,
  SIGNUP_ERROR_COPY,
  type AccountFormValues,
  type AccountStepMode,
  type BusinessDraft,
  type OnboardingContextValue,
  type OnboardingError,
  type OnboardingState,
  type ProvisionMilestone,
  type ProvisioningState,
  type ProvisionResult,
  type SignupStep,
  type SlugCheckResult,
  type TenantFormValues,
} from "./onboarding-types";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** How often the boot screen asks GoTrue what the server has actually finished. */
const POLL_INTERVAL_MS = 1500;

/**
 * No new milestone for this long, with the provision still unsettled, means
 * something is genuinely wrong (edge case 42). Deliberately generous: the
 * brand-palette step calls OpenAI and CMS seeding writes ~10 pages, so a 30 s
 * gap between two milestones is normal on a cold function.
 */
const STALL_MS = 90_000;

/**
 * After the stall panel appears we keep polling for another minute — a late
 * success still wins and replaces the panel, because the server request is
 * completely independent of our fetch.
 */
const STALL_GRACE_MS = 60_000;

const STALL_MESSAGE = "This is taking longer than it should.";

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/**
 * Every legal edge of §2.1, plus the recovery edges the error taxonomy needs.
 * Anything not listed here is refused with a console.warn, which is what makes
 * it impossible to drive the flow into an incoherent state from the UI.
 *
 * `plan` is the closed/idle state, so it is reachable from everywhere (closing)
 * and leads everywhere (opening / resuming).
 *
 * Three edges are NOT in the spec's table and are here on purpose:
 *  - `payment|provisioning -> account` is the SESSION_LOST / UNAUTHENTICATED
 *    recovery. It undoes nothing — the auth user still exists and the card is
 *    still charged; it only puts the sign-in panel back on screen so the user
 *    can re-attach a session and resume forwards.
 *  - `provisioning -> payment` is extended from PAYMENT_EXPIRED to
 *    PAYMENT_REQUIRED, because the remedy is identical.
 *  - `account -> provisioning` is the account step in `tenant` mode: a paid
 *    signup whose tenant details had to be re-asked. There is nothing to pay,
 *    so payment is not on the way.
 */
const ALLOWED_TRANSITIONS: Record<SignupStep, readonly SignupStep[]> = {
  plan: ["plan", "account", "payment", "provisioning", "done"],
  account: ["account", "payment", "provisioning", "plan"],
  // `payment -> done` is the second-tab recovery: signup-payment-intent answers
  // ALREADY_PROVISIONED when another tab has already finished the whole signup,
  // and the only coherent destination from there is the success panel.
  payment: ["payment", "provisioning", "account", "done", "plan"],
  provisioning: ["provisioning", "done", "payment", "account", "plan"],
  done: ["done", "plan"],
};

type Action =
  | { type: "goto"; step: SignupStep }
  | { type: "resumeTo"; step: SignupStep }
  | { type: "busy"; busy: boolean }
  | { type: "error"; error: OnboardingError | null }
  | { type: "setPlan"; planId: SignupPlanId }
  | { type: "setAccount"; account: { fullName: string; email: string } | null }
  | { type: "signInPrompt"; prompt: OnboardingState["signInPrompt"] }
  | { type: "payment"; patch: Partial<OnboardingState["payment"]> }
  | { type: "business"; patch: Partial<BusinessDraft> }
  | { type: "provisioning"; patch: Partial<ProvisioningState> }
  | { type: "milestones"; completed: ProvisionMilestone[] }
  | { type: "result"; result: ProvisionResult | null }
  | { type: "resumed"; resumed: boolean };

/** `EMPTY_BUSINESS_DRAFT` is a shared module constant; state must never alias it. */
function freshBusinessDraft(): BusinessDraft {
  return { ...EMPTY_BUSINESS_DRAFT };
}

const INITIAL_STATE: OnboardingState = {
  step: "plan",
  planId: null,
  account: null,
  payment: {
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    clientSecret: null,
    publishableKey: null,
    mode: null,
    paid: false,
  },
  business: freshBusinessDraft(),
  provisioning: { completed: [], phase: "idle", failure: null, activeSince: null },
  result: null,
  error: null,
  busy: false,
  signInPrompt: null,
  resumed: false,
};

function reducer(state: OnboardingState, action: Action): OnboardingState {
  switch (action.type) {
    case "goto": {
      if (state.step === action.step) return state;
      if (!ALLOWED_TRANSITIONS[state.step].includes(action.step)) {
        console.warn(
          `[onboarding] refused illegal transition ${state.step} -> ${action.step}`,
        );
        return state;
      }
      // Entering a step always clears the step-level banner and any stale busy
      // flag. Handlers that carry an error ACROSS a transition (e.g. going back
      // to payment with PAYMENT_EXPIRED) dispatch the error after the goto.
      return { ...state, step: action.step, error: null, busy: false };
    }
    /**
     * Server-authoritative jump, exempt from ALLOWED_TRANSITIONS.
     *
     * That table governs USER navigation — it is what stops someone reaching
     * the business form without paying. Resume is not navigation: the server has
     * just told us, having re-verified the money against Stripe, which step this
     * account is actually on. Routing it through `goto` meant a tenant who had
     * already paid and come back was refused `account -> business` and left
     * staring at "Create account" with no way forward, because `resolveResume`
     * pre-emptively parks the machine on `account` before it knows the answer.
     */
    case "resumeTo": {
      if (state.step === action.step) return state;
      return { ...state, step: action.step, error: null, busy: false };
    }
    case "busy":
      return state.busy === action.busy ? state : { ...state, busy: action.busy };
    case "error":
      return { ...state, error: action.error };
    case "setPlan":
      return state.planId === action.planId ? state : { ...state, planId: action.planId };
    case "setAccount":
      return { ...state, account: action.account };
    case "signInPrompt":
      return { ...state, signInPrompt: action.prompt };
    case "payment":
      return { ...state, payment: { ...state.payment, ...action.patch } };
    case "business":
      return { ...state, business: { ...state.business, ...action.patch } };
    case "provisioning":
      return { ...state, provisioning: { ...state.provisioning, ...action.patch } };
    case "milestones":
      return {
        ...state,
        provisioning: {
          ...state.provisioning,
          completed: action.completed,
          // "activeSince" is when the CURRENT milestone became the active one,
          // i.e. the moment the previous one landed. It is the only input to the
          // slow-milestone hint, and it must never be a render timestamp.
          activeSince: Date.now(),
        },
      };
    case "result":
      return { ...state, result: action.result };
    case "resumed":
      return { ...state, resumed: action.resumed };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

/**
 * Shell-only extras. Kept out of `OnboardingContextValue` because that interface
 * is the cross-builder contract (spec §3.2) and must stay byte-identical; these
 * two flags are private to the dialog and the boot screen.
 */
interface OnboardingShellValue {
  /** True while `signup-resume` is deciding which step this user belongs on. */
  resolving: boolean;
  /** Set when the user clicked a plan we refused to switch them to (edge case 27). */
  planSwitchBlocked: SignupPlanId | null;
  /**
   * The catalogue the cards were rendered from — the live `signup_plans` rows
   * when the page fetched them, the hardcoded three otherwise.
   *
   * Exposed because the business step's fleet check answers "which plan do you
   * need instead?", and that answer has to come from the same list the operator
   * was quoted from. It lives on the shell context rather than
   * `OnboardingContextValue` for the reason above: that interface is the
   * cross-builder contract and stays byte-identical.
   */
  plans: readonly SignupPlan[];
  /**
   * Which face the account step is wearing.
   *
   * `create` everywhere except one recovery: a signup that is already PAID but
   * whose tenant details cannot be found in either draft store. Rendering the
   * create-account form there would ask a paying customer to sign up again, so
   * the step drops to the three tenant fields instead.
   */
  accountMode: AccountStepMode;
  /**
   * Whether "Continue with Google" is offered.
   *
   * Read from `NEXT_PUBLIC_SIGNUP_GOOGLE_ENABLED` at module scope and OFF unless
   * it is exactly "true". Two things have to be true on the server before the
   * button can work — a Google provider configured on the Supabase project, and
   * `signup-begin-oauth` deployed — and neither is visible from the browser, so
   * the switch is explicit rather than inferred. A sign-in button that answers
   * with a Supabase 400 is worse than no button.
   */
  googleEnabled: boolean;
}

/**
 * `"true"` and nothing else. Read once, at module scope: `NEXT_PUBLIC_` values
 * are inlined at build time, so there is nothing to re-read per render.
 */
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_SIGNUP_GOOGLE_ENABLED === "true";

const OnboardingShellContext = createContext<OnboardingShellValue>({
  resolving: false,
  planSwitchBlocked: null,
  plans: SIGNUP_PLANS,
  accountMode: "create",
  googleEnabled: GOOGLE_ENABLED,
});

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used inside <OnboardingProvider>");
  }
  return ctx;
}

export function useOnboardingShell(): OnboardingShellValue {
  return useContext(OnboardingShellContext);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function err(code: OnboardingError["code"], detail?: Record<string, unknown>): OnboardingError {
  return { code, message: SIGNUP_ERROR_COPY[code], detail };
}

/** Keep only known milestones, in the canonical order, so "first incomplete" is always meaningful. */
function sanitiseMilestones(raw: unknown): ProvisionMilestone[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(raw.filter((m): m is string => typeof m === "string"));
  return PROVISION_MILESTONES.filter((m) => seen.has(m));
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Everything the success panel needs, rebuilt from the metadata blob alone (edge cases 40 + 41). */
function resultFromMeta(meta: ClientSignupMeta | null): ProvisionResult | null {
  if (!meta?.tenantId || !meta.slug || !meta.portalUrl || !meta.bookingUrl) return null;
  return {
    tenantId: meta.tenantId,
    slug: meta.slug,
    companyName: meta.business?.companyName ?? "",
    portalUrl: stripTrailingSlash(meta.portalUrl),
    bookingUrl: stripTrailingSlash(meta.bookingUrl),
    portalSignInUrl: meta.portalSignInUrl ?? null,
    // Absent means "no partial-seed warning was recorded", which is the good case.
    contentSeeded: meta.contentSeeded !== false,
  };
}

/** ALREADY_PROVISIONED may carry the finished result inline; use it before falling back to a metadata read. */
function resultFromDetail(detail: Record<string, unknown> | undefined): ProvisionResult | null {
  if (!detail) return null;
  const { tenantId, slug, portalUrl, bookingUrl } = detail as Record<string, unknown>;
  if (
    typeof tenantId !== "string" ||
    typeof slug !== "string" ||
    typeof portalUrl !== "string" ||
    typeof bookingUrl !== "string"
  ) {
    return null;
  }
  return {
    tenantId,
    slug,
    companyName: typeof detail.companyName === "string" ? detail.companyName : "",
    portalUrl: stripTrailingSlash(portalUrl),
    bookingUrl: stripTrailingSlash(bookingUrl),
    portalSignInUrl:
      typeof detail.portalSignInUrl === "string" ? detail.portalSignInUrl : null,
    contentSeeded: detail.contentSeeded !== false,
  };
}

/** The two codes that mean "the browser's session is gone", not "the signup is gone". */
function isSessionLoss(e: OnboardingError): boolean {
  return e.code === "UNAUTHENTICATED" || e.code === "SESSION_LOST";
}

function suggestionsFrom(e: OnboardingError): string[] {
  const raw = e.detail?.suggestions;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}

/**
 * Map the server's business snapshot back onto the form draft.
 *
 * Only reached when `signup-provision` has already run at least once (it is the
 * only writer of that snapshot), so it is a fallback behind the operator's own
 * draft rather than the primary source.
 */
function draftFromSnapshot(b: NonNullable<ResumeSignupDTO["business"]>): BusinessDraft {
  return {
    companyName: b.companyName ?? "",
    slug: b.slug ?? "",
    // The slug came back from the server, so it is already the value we want —
    // re-deriving it from the company name would silently overwrite a choice.
    slugTouched: Boolean(b.slug),
    // A snapshot only exists because a submit carrying acceptedTerms === true
    // reached the server. Making them re-tick it would be theatre.
    acceptedTerms: true,
  };
}

/**
 * The draft as something safe to provision with, or null when it is not
 * complete enough to try.
 *
 * Null is not an error here — it is the signal that the tenant details have to
 * be recovered from a store or asked for again, which is exactly what
 * `continueToProvisioning` does with it.
 */
function tenantValuesFrom(d: BusinessDraft): TenantFormValues | null {
  const companyName = d.companyName.trim();
  const slug = normalizeSlugClient(d.slug);
  if (companyName.length < 2) return null;
  if (!checkSlugShape(slug).ok) return null;
  if (!d.acceptedTerms) return null;
  return { companyName, slug, acceptedTerms: true };
}

/**
 * The provision body.
 *
 * `slug` IS sent, unlike the previous design. The operator picked it on the
 * account step and watched it come back available, so letting the server derive
 * its own from the company name would hand them a different address than the one
 * they chose. `signup-provision` validates and claims it, and answers SLUG_TAKEN
 * with suggestions if it lost a race — which the boot screen can now fix inline.
 */
function buildProvisionRequest(v: TenantFormValues): ProvisionRequest {
  return {
    companyName: v.companyName,
    slug: v.slug,
    acceptedTerms: v.acceptedTerms,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface OnboardingProviderProps {
  children: React.ReactNode;
  /**
   * The live catalogue, handed down from the server-rendered pricing section.
   *
   * Defaulted to the hardcoded three so the provider still works anywhere it is
   * mounted without one. When it IS supplied, every price, name and fleet band
   * the dialog shows comes from here — the card the visitor clicked and the
   * dialog they land in are then reading the same row, which is the whole point
   * of passing it rather than letting the dialog resolve its own.
   */
  plans?: readonly SignupPlan[];
}

export function OnboardingProvider({
  children,
  plans = SIGNUP_PLANS,
}: OnboardingProviderProps) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [isOpen, setIsOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [hasResumableSignup, setHasResumableSignup] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [planSwitchBlocked, setPlanSwitchBlocked] = useState<SignupPlanId | null>(null);
  const [accountMode, setAccountMode] = useState<AccountStepMode>("create");

  // Async work reads state through this ref, never through the closure it was
  // created in: a poller created once must see the newest state on every tick.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  /** The passive hint read from app_metadata on mount. A hint — never proof of payment. */
  const resumeHintRef = useRef<ClientSignupMeta | null>(null);

  /**
   * The passive mount read itself, so `open()` can wait for it instead of
   * racing it. A returning user who presses Subscribe in the first few hundred
   * milliseconds would otherwise be treated as brand new.
   */
  const resumeProbeRef = useRef<Promise<void> | null>(null);
  const resumeProbeSettledRef = useRef(false);

  const pollTimerRef = useRef<number | null>(null);
  const pollBusyRef = useRef(false);
  const provisionSettledRef = useRef(false);
  const lastMilestoneCountRef = useRef(0);
  const lastMilestoneAtRef = useRef(0);
  const watchdogFiredAtRef = useRef<number | null>(null);
  const paymentIntentInFlightRef = useRef(false);
  const markPaidInFlightRef = useRef(false);

  /**
   * `continueToProvisioning`, reachable from code defined above it.
   *
   * The callbacks form a genuine cycle — `startPaymentInternal` needs to hand
   * off to provisioning when Stripe reports the plan is already paid for, and
   * `handleProvisionFailure` needs to hand back to `startPaymentInternal` on a
   * PAYMENT_REQUIRED — so one of the two edges has to go through a ref. This is
   * the one that does, because it is the rarer path and keeps the dependency
   * arrays of the common ones honest.
   */
  const continueToProvisioningRef = useRef<(() => Promise<void>) | null>(null);

  // -------------------------------------------------------------------------
  // Poller
  // -------------------------------------------------------------------------

  const stopPoller = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const settleSuccess = useCallback(
    (result: ProvisionResult) => {
      if (provisionSettledRef.current) return;
      provisionSettledRef.current = true;
      stopPoller();
      // The tenant exists; the local draft has no job left. The `user_metadata`
      // copy is left in place — clearing it would cost a GoTrue round trip on
      // the success screen to delete three values the operator typed about their
      // own business, and `signup-provision` is idempotent, so a stale copy can
      // only ever re-describe the tenant it already built.
      clearTenantDraft();
      dispatch({ type: "result", result });
      dispatch({
        type: "provisioning",
        patch: {
          // Success means all eight landed; the poller may simply have missed the
          // last tick, and showing 7/8 next to "You're live." would be a lie.
          completed: [...PROVISION_MILESTONES],
          phase: "succeeded",
          failure: null,
        },
      });
      dispatch({ type: "goto", step: "done" });
    },
    [stopPoller],
  );

  const pollOnce = useCallback(async () => {
    // Never stack reads: on a slow connection a 1.5 s interval would otherwise
    // queue requests faster than they resolve.
    if (pollBusyRef.current) return;
    pollBusyRef.current = true;
    try {
      const meta = await fetchSignupMeta();
      if (meta) {
        const completed = sanitiseMilestones(meta.milestones);
        if (completed.length !== lastMilestoneCountRef.current) {
          lastMilestoneCountRef.current = completed.length;
          lastMilestoneAtRef.current = Date.now();
          dispatch({ type: "milestones", completed });
        }

        // The poller is authoritative for SUCCESS only. It deliberately does not
        // act on `status === "failed"`: after a retry the blob still says
        // "failed" until the server rewrites it, and a stale read would kill a
        // run that is going fine. Failures come from the fetch, or the watchdog.
        if (meta.status === "provisioned") {
          const result = resultFromMeta(meta);
          if (result) {
            settleSuccess(result);
            return;
          }
        }
      }

      if (
        !provisionSettledRef.current &&
        lastMilestoneAtRef.current > 0 &&
        Date.now() - lastMilestoneAtRef.current > STALL_MS
      ) {
        if (watchdogFiredAtRef.current === null) {
          watchdogFiredAtRef.current = Date.now();
          dispatch({
            type: "provisioning",
            patch: {
              phase: "failed",
              failure: {
                code: "INTERNAL",
                message: STALL_MESSAGE,
                // The boot screen uses this to show the stall copy instead of
                // the generic "something went wrong on our end".
                detail: { watchdog: true },
              },
            },
          });
        } else if (Date.now() - watchdogFiredAtRef.current > STALL_GRACE_MS) {
          stopPoller();
        }
      }
    } catch (e) {
      // One failed poll is not a failed provision. The watchdog covers a poller
      // that can never read again.
      console.warn("[onboarding] milestone poll failed", e);
    } finally {
      pollBusyRef.current = false;
    }
  }, [settleSuccess, stopPoller]);

  const startPoller = useCallback(() => {
    stopPoller();
    // Read immediately — waiting a full interval for the first frame makes the
    // boot screen look stuck before it has even started.
    void pollOnce();
    pollTimerRef.current = window.setInterval(() => {
      void pollOnce();
    }, POLL_INTERVAL_MS);
  }, [pollOnce, stopPoller]);

  useEffect(() => stopPoller, [stopPoller]);

  // -------------------------------------------------------------------------
  // Session-loss recovery, shared by every authenticated call
  // -------------------------------------------------------------------------

  const handleSessionLoss = useCallback((e: OnboardingError) => {
    const email = stateRef.current.account?.email ?? resumeHintRef.current?.email ?? "";
    stopPoller();
    dispatch({ type: "provisioning", patch: { phase: "idle" } });
    dispatch({ type: "goto", step: "account" });
    if (email) {
      dispatch({ type: "signInPrompt", prompt: { email, reason: "SESSION_LOST" } });
    }
    dispatch({ type: "error", error: e });
    setIsOpen(true);
  }, [stopPoller]);

  // -------------------------------------------------------------------------
  // Payment intent
  // -------------------------------------------------------------------------

  const startPaymentInternal = useCallback(
    /**
     * `carryError` is the banner the user must still be able to read once the
     * new intent has landed.
     *
     * Minting an intent normally clears the step's error, and it has to: the
     * previous attempt's decline is not about the card form we are about to
     * render. But two callers arrive here BECAUSE something went wrong with the
     * money — an expired PaymentIntent, or a provision refused for
     * PAYMENT_REQUIRED — and both need the explanation to survive. Dispatching
     * the error before calling this does not work: the clear below runs in the
     * same React batch and wins, so the user is silently dropped onto a fresh
     * card form having been told nothing.
     */
    async (planId: SignupPlanId | null, carryError: OnboardingError | null = null) => {
      if (!planId) {
        dispatch({ type: "error", error: err("PLAN_UNKNOWN") });
        return;
      }
      // Safe to return silently: the in-flight call owns `busy` and always
      // clears it in its own `finally`, so a hand-off from `submitAccount`
      // (which deliberately leaves `busy` set) is still resolved by the runner
      // that is already going. There is no reachable state where this ref is
      // true with nothing running.
      if (paymentIntentInFlightRef.current) return;
      paymentIntentInFlightRef.current = true;
      dispatch({ type: "busy", busy: true });
      dispatch({ type: "error", error: carryError });
      // Drop any stale secret first: Elements must never be mounted against an
      // intent we are about to replace.
      dispatch({ type: "payment", patch: { clientSecret: null } });
      try {
        const res = await signupPaymentIntent({ planId });
        if (res.alreadyPaid) {
          // They already hold a live subscription for this plan (a resume, or a
          // second tab that paid). Skip the card form entirely.
          dispatch({
            type: "payment",
            patch: {
              stripeCustomerId: res.stripeCustomerId,
              stripeSubscriptionId: res.stripeSubscriptionId,
              publishableKey: res.publishableKey,
              clientSecret: null,
              mode: res.mode,
              paid: true,
            },
          });
          // Nothing left to collect and nothing left to charge — go straight to
          // building. `continueToProvisioning` finds the tenant details (state,
          // localStorage, or user_metadata) and asks for them again only if all
          // three are empty.
          void continueToProvisioningRef.current?.();
          return;
        }
        dispatch({
          type: "payment",
          patch: {
            stripeCustomerId: res.stripeCustomerId,
            stripeSubscriptionId: res.stripeSubscriptionId,
            clientSecret: res.clientSecret,
            publishableKey: res.publishableKey,
            mode: res.mode,
            paid: false,
          },
        });
      } catch (e) {
        const error = toOnboardingError(e);
        if (isSessionLoss(error)) {
          handleSessionLoss(error);
        } else if (error.code === "ALREADY_PROVISIONED") {
          // Another tab — or an earlier session on another device — finished the
          // whole signup while this one was sitting on the card form. There is
          // nothing left to pay for, and the banner alone would strand the user
          // on a payment step with no forward action, so read the finished
          // result out of app_metadata and show the success panel instead.
          const finished = resultFromMeta(await fetchSignupMeta());
          if (finished) {
            settleSuccess(finished);
          } else {
            // Metadata says provisioned but is missing the URLs we would need to
            // hand them over. The banner is then the honest answer.
            dispatch({ type: "error", error });
          }
        } else {
          dispatch({ type: "error", error });
        }
      } finally {
        paymentIntentInFlightRef.current = false;
        dispatch({ type: "busy", busy: false });
      }
    },
    [handleSessionLoss, settleSuccess],
  );

  // -------------------------------------------------------------------------
  // Provisioning
  // -------------------------------------------------------------------------

  const handleProvisionFailure = useCallback(
    (error: OnboardingError) => {
      // A poller success already won the race — the server finished, our fetch
      // just died on the way back. Say nothing.
      if (provisionSettledRef.current) return;

      switch (error.code) {
        case "ALREADY_PROVISIONED": {
          const inline = resultFromDetail(error.detail);
          if (inline) {
            settleSuccess(inline);
            return;
          }
          // The server says it is done but did not hand us the result inline.
          // The metadata blob has everything; the poller will pick it up on its
          // next tick, so simply keep going rather than showing a failure.
          return;
        }
        case "PROVISION_IN_PROGRESS":
          // Edge case 19: another tab owns the write. Show NOTHING — the poller
          // converges both tabs onto the same success panel. Left unsettled on
          // purpose so the watchdog still protects us if that tab dies.
          return;
        case "PAYMENT_EXPIRED":
        case "PAYMENT_REQUIRED": {
          // Their money state cannot support provisioning. The only useful place
          // to be is the payment step, with a fresh (idempotent) intent.
          provisionSettledRef.current = true;
          stopPoller();
          dispatch({ type: "provisioning", patch: { phase: "idle", failure: null } });
          dispatch({ type: "goto", step: "payment" });
          dispatch({ type: "error", error });
          setIsOpen(true);
          // The banner ALSO travels with the request. Dispatching it here is not
          // enough on its own: `startPaymentInternal` clears the step error
          // before its first await, in this same React batch, so the user would
          // be dropped onto a fresh card form having been told nothing about
          // why. (The dispatch above still matters for the one path that never
          // reaches that clear — a request already in flight.)
          void startPaymentInternal(stateRef.current.planId, error);
          return;
        }
        case "UNAUTHENTICATED":
        case "SESSION_LOST": {
          provisionSettledRef.current = true;
          handleSessionLoss(error);
          return;
        }
        default: {
          // PAYMENT_INCOMPLETE lands here deliberately: a `processing` payment
          // may simply need a few more seconds, and "Try again" re-runs a
          // provision that re-checks Stripe and never re-charges.
          provisionSettledRef.current = true;
          stopPoller();
          dispatch({ type: "provisioning", patch: { phase: "failed", failure: error } });
        }
      }
    },
    [handleSessionLoss, settleSuccess, startPaymentInternal, stopPoller],
  );

  /**
   * One provisioning attempt. `body === null` means "watch only": we know a
   * provision is under way (a second tab, or a session resumed straight into the
   * provisioning state) and must not issue a competing write.
   *
   * Safe to call repeatedly. `signup-provision` is idempotent — it returns the
   * existing tenant when one exists and never touches Stripe money — so the
   * retry button can be pressed as often as the user likes.
   */
  const runProvision = useCallback(
    async (body: ProvisionRequest | null) => {
      provisionSettledRef.current = false;
      watchdogFiredAtRef.current = null;
      // A watch-only run is joining a provision already in progress, so the
      // milestones we already know about stay on screen; a real (re)submit
      // restarts the list from the top, which is what edge case 17 describes.
      const keep = body === null ? stateRef.current.provisioning.completed : [];
      lastMilestoneCountRef.current = keep.length;
      lastMilestoneAtRef.current = Date.now();
      dispatch({
        type: "provisioning",
        patch: { phase: "running", failure: null, completed: keep, activeSince: Date.now() },
      });
      startPoller();

      if (!body) return;

      try {
        const res = await signupProvision(body);
        settleSuccess({
          tenantId: res.tenantId,
          slug: res.slug,
          companyName: res.companyName,
          portalUrl: stripTrailingSlash(res.portalUrl),
          bookingUrl: stripTrailingSlash(res.bookingUrl),
          portalSignInUrl: res.portalSignInUrl,
          contentSeeded: res.contentSeeded,
        });
      } catch (e) {
        handleProvisionFailure(toOnboardingError(e));
      }
    },
    [handleProvisionFailure, settleSuccess, startPoller],
  );

  /**
   * The single door from "paid" to "building".
   *
   * There is no business step to pass through any more, so every caller that
   * used to send the operator to one — the payment step finishing, and a resume
   * that lands on the server's `business` step — comes here instead. It has one
   * job: find the tenant details, then start the provision.
   *
   * Three places are tried, in order of trustworthiness:
   *   1. React state, which is where they are on the happy path (the operator
   *      typed them on the account step minutes ago and never left the tab);
   *   2. `localStorage`, which survives a refresh and the Stripe redirect;
   *   3. the operator's own `user_metadata`, which survives a device switch.
   *
   * If all three come back empty — which needs a mid-payment device switch AND a
   * failed metadata write — the account step is dropped into `tenant` mode and
   * asks for the three fields again. That is the honest answer: the alternative
   * is inventing a business name for someone who has already been charged.
   */
  const continueToProvisioning = useCallback(async () => {
    const inState = tenantValuesFrom(stateRef.current.business);
    const values = inState ?? (await resolveTenantDraft());

    if (!values) {
      console.warn("[onboarding] paid signup with no tenant draft — asking again");
      setAccountMode("tenant");
      // `resumeTo`, not `goto`: this is not user navigation and must not be
      // policed by ALLOWED_TRANSITIONS, which cannot express "backwards, but
      // only to re-collect something we lost".
      dispatch({ type: "resumeTo", step: "account" });
      setIsOpen(true);
      return;
    }

    if (!inState) dispatch({ type: "business", patch: draftToBusiness(values) });
    dispatch({ type: "resumeTo", step: "provisioning" });
    await runProvision(buildProvisionRequest(values));
  }, [runProvision]);

  /**
   * Kept in an effect rather than assigned during render: writing a ref while
   * rendering is exactly what React asks you not to do, and there is no need to
   * here. Every caller that reads this ref is either a click handler or an async
   * continuation of one, so it cannot run before mount effects have flushed.
   */
  useEffect(() => {
    continueToProvisioningRef.current = continueToProvisioning;
  }, [continueToProvisioning]);

  // -------------------------------------------------------------------------
  // Resume
  // -------------------------------------------------------------------------

  const hydrateFromResume = useCallback(
    (dto: ResumeSignupDTO, requestedPlanId: SignupPlanId) => {
      // Once money has moved the plan is fixed. Before that, the user is free to
      // click a different card and we re-mint the intent for it (edge case 28).
      const planLocked =
        dto.paid ||
        // The server still calls the paid-but-unbuilt state "business" — that
        // is its own step name, not ours, and renaming it would mean redeploying
        // `signup-resume`. It maps onto `provisioning` here.
        dto.resumeStep === "business" ||
        dto.resumeStep === "provisioning" ||
        dto.resumeStep === "done";
      const planId = planLocked ? dto.planId : requestedPlanId;
      if (planLocked && dto.planId !== requestedPlanId) {
        setPlanSwitchBlocked(requestedPlanId);
      }

      dispatch({ type: "setPlan", planId });
      dispatch({ type: "setAccount", account: { fullName: dto.fullName, email: dto.email } });
      dispatch({ type: "signInPrompt", prompt: null });
      dispatch({
        type: "payment",
        patch: {
          stripeCustomerId: dto.stripeCustomerId,
          stripeSubscriptionId: dto.stripeSubscriptionId,
          mode: dto.mode,
          paid: dto.paid,
          clientSecret: null,
          publishableKey: null,
        },
      });
      if (dto.business) {
        dispatch({ type: "business", patch: draftFromSnapshot(dto.business) });
      }
      const milestones = sanitiseMilestones(dto.milestones);
      if (milestones.length) {
        dispatch({ type: "milestones", completed: milestones });
      }
      if (dto.result) {
        dispatch({
          type: "result",
          result: {
            tenantId: dto.result.tenantId,
            slug: dto.result.slug,
            companyName: dto.result.companyName,
            portalUrl: stripTrailingSlash(dto.result.portalUrl),
            bookingUrl: stripTrailingSlash(dto.result.bookingUrl),
            portalSignInUrl: dto.result.portalSignInUrl,
            contentSeeded: dto.result.contentSeeded,
          },
        });
      }
      dispatch({ type: "resumed", resumed: true });

      // `resumeTo`, not `goto` — the server has re-verified this against Stripe
      // and is authoritative. `goto` is policed by ALLOWED_TRANSITIONS, which
      // does not permit account -> business/provisioning/done, so every one of
      // these except "payment" was silently refused and left a returning tenant
      // on the create-account form.
      switch (dto.resumeStep) {
        case "payment":
          dispatch({ type: "resumeTo", step: "payment" });
          void startPaymentInternal(planId);
          break;
        case "business":
          // Paid, and no provision currently in flight. There is nothing left to
          // ask, so this goes straight to building — or, if the tenant details
          // are genuinely unrecoverable, to the `tenant` recovery form.
          void continueToProvisioning();
          break;
        case "provisioning":
          // The server believes a provision is under way. Watch, do not write.
          dispatch({ type: "resumeTo", step: "provisioning" });
          void runProvision(null);
          break;
        case "done":
          dispatch({ type: "resumeTo", step: "done" });
          dispatch({ type: "provisioning", patch: { phase: "succeeded" } });
          break;
        case "account":
        default:
          dispatch({ type: "resumeTo", step: "account" });
          break;
      }
    },
    [continueToProvisioning, runProvision, startPaymentInternal],
  );

  const resolveResume = useCallback(
    async (requestedPlanId: SignupPlanId) => {
      setResolving(true);
      dispatch({ type: "goto", step: "account" });
      try {
        const { signup } = await signupResume();
        if (!signup) {
          // A session exists but carries no signup blob — a stray auth user who
          // signed in (edge case 4). There is no server-side path to start a
          // signup on an account that already exists, so free the session and
          // put them back on the create-account form with an explanation.
          await getBrowserSupabase().auth.signOut();
          resumeHintRef.current = null;
          setHasResumableSignup(false);
          dispatch({ type: "goto", step: "account" });
          dispatch({ type: "error", error: err("SIGNUP_NOT_FOUND") });
          return;
        }
        hydrateFromResume(signup, requestedPlanId);
      } catch (e) {
        const error = toOnboardingError(e);
        if (isSessionLoss(error)) {
          handleSessionLoss(error);
        } else {
          dispatch({ type: "goto", step: "account" });
          dispatch({ type: "error", error });
        }
      } finally {
        setResolving(false);
      }
    },
    [handleSessionLoss, hydrateFromResume],
  );

  /**
   * Passive resume detection — §1.9. Runs once per mount, makes exactly one
   * GoTrue read, opens nothing and shows nothing. Everything it learns is a hint
   * that `open()` turns into an authoritative answer via `signup-resume`.
   */
  useEffect(() => {
    let cancelled = false;
    const probe = (async () => {
      try {
        const meta = await fetchSignupMeta();
        if (cancelled || !meta) return;
        resumeHintRef.current = meta;
        if (meta.status === "provisioned") {
          const result = resultFromMeta(meta);
          if (result) {
            dispatch({ type: "result", result });
            dispatch({
              type: "provisioning",
              patch: { phase: "succeeded", completed: [...PROVISION_MILESTONES] },
            });
          }
          if (meta.fullName && meta.email) {
            dispatch({
              type: "setAccount",
              account: { fullName: meta.fullName, email: meta.email },
            });
          }
        }
        setHasResumableSignup(meta.status !== "provisioned");
      } catch (e) {
        // Edge case 38: a missing NEXT_PUBLIC_SUPABASE_* pair throws here. The
        // pricing section is static and must still render — only pressing
        // Subscribe is allowed to fail, and it fails with a banner.
        console.warn("[onboarding] resume detection unavailable", e);
      } finally {
        // Settled either way — a failed probe is an answer ("we could not
        // find a signup"), and `open()` must not wait on it forever.
        resumeProbeSettledRef.current = true;
      }
    })();
    resumeProbeRef.current = probe;
    void probe;
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Public actions
  // -------------------------------------------------------------------------

  const open = useCallback(
    (planId: SignupPlanId) => {
      setCloseConfirmOpen(false);
      setPlanSwitchBlocked(null);
      setIsOpen(true);

      const current = stateRef.current;

      // Finished earlier in this page session: straight back to the success panel.
      if (current.result) {
        dispatch({ type: "setPlan", planId: current.planId ?? planId });
        dispatch({ type: "goto", step: "done" });
        return;
      }

      // Mid-flow in this page session: reopen exactly where they were. No network.
      if (current.step !== "plan") {
        if (current.payment.paid && current.planId && current.planId !== planId) {
          setPlanSwitchBlocked(planId);
        } else if (
          current.planId !== planId &&
          current.step === "payment" &&
          !current.payment.paid
        ) {
          // Edge case 28 — plan change before paying. The server cancels the old
          // incomplete subscription so two live subscriptions are impossible.
          dispatch({ type: "setPlan", planId });
          void startPaymentInternal(planId);
        }
        return;
      }

      dispatch({ type: "setPlan", planId });

      /**
       * Resume, or start fresh?
       *
       * The mount hint alone is the wrong test. It is null in two cases that
       * both MUST resume: someone who created their account earlier in this
       * same page session (the hint is only ever written at mount and by a
       * manual sign-in), and a returning user who pressed Subscribe before the
       * mount read resolved. Both were being dropped onto "Create account" —
       * which, for the first, means a customer whose card is already charged is
       * asked to sign up again, burns one of their three `signup-begin`
       * attempts per hour and gets a 409 for their trouble.
       *
       * So: any local evidence that a signup exists routes through
       * `signup-resume`, which is the only authority on which step they belong
       * on and will put them back on the account form itself if it disagrees.
       */
      const decide = () => {
        const s = stateRef.current;
        if (resumeHintRef.current || s.account || s.payment.stripeSubscriptionId) {
          void resolveResume(planId);
          return;
        }
        dispatch({ type: "goto", step: "account" });
      };

      if (!resumeProbeSettledRef.current && resumeProbeRef.current) {
        // Show the dialog's "Checking your setup" state rather than guessing.
        setResolving(true);
        dispatch({ type: "goto", step: "account" });
        void resumeProbeRef.current.finally(() => {
          setResolving(false);
          decide();
        });
        return;
      }
      decide();
    },
    [resolveResume, startPaymentInternal],
  );

  /**
   * The other end of the `return_url` the payment step hands Stripe
   * (`/?signup=resume`).
   *
   * That redirect is not expected to happen — the subscription is created
   * card-only and confirmed with `redirect: "if_required"`, so 3-D Secure runs
   * inside Stripe's iframe. But `confirmParams.return_url` is mandatory, and if
   * Stripe ever does use it the user comes back to a marketing page with a paid
   * subscription, a live session and no dialog on screen. Without this they would
   * have to guess that pressing Subscribe again is what resumes them.
   *
   * Runs after the passive detection above has had a chance to populate
   * `resumeHintRef`, which is what supplies the plan. The parameter is stripped
   * with `replaceState` so a refresh does not re-open the dialog, and nothing
   * happens at all when there is no resumable signup.
   */
  useEffect(() => {
    if (!hasResumableSignup) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("signup") !== "resume") return;

    params.delete("signup");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );

    const hinted = resumeHintRef.current?.planId;
    // `signup-resume` is authoritative about the plan; this only decides which
    // card the user is treated as having pressed, so an unrecognised id falls
    // back to the highlighted tier rather than blocking the recovery.
    //
    // `isSignupPlanId` rather than a cast: the hint comes from app_metadata,
    // which is server-written but still just JSON, and `open()` types its
    // argument as the literal union.
    const planId = isSignupPlanId(hinted)
      ? hinted
      : (plans.find((p) => p.highlighted)?.id ??
        plans[0]?.id ??
        SIGNUP_PLANS[0].id);
    open(planId);
  }, [hasResumableSignup, open, plans]);

  /**
   * The other end of "Continue with Google".
   *
   * Google sends the browser back to `?signup=google&code=…` — a completely
   * fresh page load, no React state, and (deliberately) a Supabase client with
   * `detectSessionInUrl: false`, so nothing has consumed that code yet. This is
   * the only place that does, and only for a URL carrying our own marker.
   *
   * Then the piece that has no equivalent on the password path:
   * `signup-begin-oauth`. Google created the `auth.users` row, so nothing has
   * written `app_metadata.d247_signup` — and every later endpoint keys off that
   * blob and would answer SIGNUP_NOT_FOUND without it. That call stamps it.
   *
   * `signup-begin` cannot do this job. It CREATES the user and hard-requires a
   * password; a user who already exists is refused with EMAIL_EXISTS_SIGN_IN by
   * its "auth user with no profile" probe.
   */
  const completeGoogleReturn = useCallback(
    async (code: string | null, oauthError: string | null) => {
      const pending = readPendingOauth();
      if (!pending && !code && !oauthError) return;

      setIsOpen(true);
      setResolving(true);
      try {
        if (oauthError) {
          clearPendingOauth();
          console.error("[onboarding] Google returned an error:", oauthError);
          dispatch({ type: "goto", step: "account" });
          dispatch({ type: "error", error: err("SIGN_IN_FAILED") });
          return;
        }

        if (code) {
          const { error: exchangeError } =
            await getBrowserSupabase().auth.exchangeCodeForSession(code);
          if (exchangeError) {
            clearPendingOauth();
            console.error("[onboarding] code exchange failed", exchangeError);
            dispatch({ type: "goto", step: "account" });
            dispatch({ type: "error", error: err("SESSION_LOST") });
            return;
          }
        }

        if (!pending) {
          // A session may well exist now, but we do not know which plan they
          // chose or what they called their business. Falling back to the plain
          // resume path is the only honest move — it asks the server.
          console.warn("[onboarding] Google return with no stashed handoff");
          return;
        }

        dispatch({ type: "setPlan", planId: pending.planId });
        dispatch({ type: "business", patch: draftToBusiness(pending.values) });

        await signupBeginOauth({ planId: pending.planId });
        // Only now — the draft is worth keeping only against a signup that
        // actually exists.
        await saveTenantDraft(pending.values);
        clearPendingOauth();

        resumeHintRef.current = await fetchSignupMeta();
        setHasResumableSignup(true);
        // The server decides the step, exactly as it does for a password resume.
        // For a signup that has just been stamped that is always `payment`.
        await resolveResume(pending.planId);
      } catch (e) {
        const error = toOnboardingError(e);
        console.error("[onboarding] Google signup could not be started", error);
        dispatch({ type: "goto", step: "account" });
        dispatch({ type: "error", error });
      } finally {
        setResolving(false);
      }
    },
    [resolveResume],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signup") !== "google") return;

    const code = params.get("code");
    const oauthError = params.get("error_description") ?? params.get("error");

    // Strip every OAuth parameter before doing anything with them: a refresh
    // must not re-run the exchange (the code is single-use and the second
    // attempt would fail), and a single-use code has no business sitting in the
    // address bar or in the Referer of the next request the page makes.
    params.delete("signup");
    params.delete("code");
    params.delete("error");
    params.delete("error_code");
    params.delete("error_description");
    params.delete("state");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );

    void completeGoogleReturn(code, oauthError);
  }, [completeGoogleReturn]);

  const closeNow = useCallback(() => {
    setCloseConfirmOpen(false);
    setIsOpen(false);
    setPlanSwitchBlocked(null);
    const step = stateRef.current.step;
    // A terminal or abandoned overlay returns to the idle state; a half-finished
    // dialog keeps its step so re-opening in the same page session is instant.
    if (step === "done" || step === "provisioning") {
      stopPoller();
      dispatch({ type: "goto", step: "plan" });
    }
    dispatch({ type: "busy", busy: false });
  }, [stopPoller]);

  const requestClose = useCallback(() => {
    const s = stateRef.current;
    // Writes are in flight. Abandoning here is what creates orphans, so the
    // request is ignored outright rather than confirmed away.
    if (s.step === "provisioning" && s.provisioning.phase === "running") return;
    if (s.step === "payment") {
      setCloseConfirmOpen(true);
      return;
    }
    closeNow();
  }, [closeNow]);

  const confirmClose = useCallback(() => {
    closeNow();
  }, [closeNow]);

  const cancelClose = useCallback(() => {
    setCloseConfirmOpen(false);
  }, []);

  const submitAccount = useCallback(
    async (values: AccountFormValues) => {
      const s = stateRef.current;
      if (s.busy) return;
      if (s.step !== "account") {
        console.warn("[onboarding] submitAccount ignored outside the account step");
        return;
      }
      const planId = s.planId;
      if (!planId) {
        dispatch({ type: "error", error: err("PLAN_UNKNOWN") });
        return;
      }

      const tenant: TenantFormValues = {
        companyName: values.companyName.trim(),
        slug: normalizeSlugClient(values.slug),
        acceptedTerms: values.acceptedTerms,
      };

      dispatch({ type: "busy", busy: true });
      dispatch({ type: "error", error: null });
      // Held in state from here so a failed `signup-begin` (a taken email, a
      // rate limit) does not also throw away the business name and address the
      // operator just typed — the step re-renders from this.
      dispatch({ type: "business", patch: draftToBusiness(tenant) });
      let handedOff = false;
      try {
        await signupBegin({
          fullName: values.fullName.trim(),
          email: values.email.trim().toLowerCase(),
          password: values.password,
          planId,
          companyWebsite: values.companyWebsite,
          formStartedAt: values.formStartedAt,
        });

        // The password exists only inside this closure: it goes straight to
        // GoTrue and is never written to React state, so it cannot resurface in
        // a devtools snapshot or a serialised error report.
        const { error: signInError } = await getBrowserSupabase().auth.signInWithPassword({
          email: values.email.trim().toLowerCase(),
          password: values.password,
        });
        if (signInError) {
          // The account exists (or, for a honeypot hit, deliberately does not).
          // Either way the recovery is the same: ask for the password again.
          dispatch({
            type: "signInPrompt",
            prompt: { email: values.email.trim().toLowerCase(), reason: "SIGN_IN_FAILED" },
          });
          dispatch({ type: "error", error: err("SIGN_IN_FAILED") });
          return;
        }

        // Irreversible from here: an auth.users row exists and nothing in this
        // UI can delete it.
        dispatch({
          type: "setAccount",
          account: { fullName: values.fullName.trim(), email: values.email.trim().toLowerCase() },
        });
        dispatch({ type: "signInPrompt", prompt: null });

        // Persist the tenant details NOW, in the one window where a session
        // exists and nothing has been charged yet. `signup-begin` does not take
        // them and no other endpoint stores them before `signup-provision`, so
        // between here and the end of the card form they live only in these two
        // stores. Awaited rather than fired and forgotten: the `user_metadata`
        // copy is what survives a device switch, and this is the last moment we
        // are certain to be able to write it.
        await saveTenantDraft(tenant);

        // From here there is something to come back to, in this page session or
        // a later one — which is what makes the `?signup=resume` return path and
        // the reopen-after-close path work for a first-time visitor.
        setHasResumableSignup(true);
        dispatch({ type: "goto", step: "payment" });
        handedOff = true;
        void startPaymentInternal(planId);
      } catch (e) {
        const error = toOnboardingError(e);
        if (error.code === "EMAIL_IN_SIGNUP" || error.code === "EMAIL_EXISTS_SIGN_IN") {
          // Not an error the user caused — swap the form for the sign-in panel,
          // which carries its own copy.
          dispatch({
            type: "signInPrompt",
            prompt: { email: values.email.trim().toLowerCase(), reason: error.code },
          });
          dispatch({ type: "error", error: null });
        } else {
          dispatch({ type: "error", error });
        }
      } finally {
        // startPaymentInternal owns `busy` once we have handed off to it.
        if (!handedOff) dispatch({ type: "busy", busy: false });
      }
    },
    [startPaymentInternal],
  );

  /**
   * `tenant` mode's submit. Reached only from the recovery form described on
   * `continueToProvisioning`: the account exists, the card has been charged, and
   * the only thing missing is the three fields this collects.
   */
  const submitTenantDetails = useCallback(
    async (values: TenantFormValues) => {
      const s = stateRef.current;
      if (s.busy) return;
      const tenant: TenantFormValues = {
        companyName: values.companyName.trim(),
        slug: normalizeSlugClient(values.slug),
        acceptedTerms: values.acceptedTerms,
      };
      dispatch({ type: "busy", busy: true });
      dispatch({ type: "error", error: null });
      try {
        dispatch({ type: "business", patch: draftToBusiness(tenant) });
        await saveTenantDraft(tenant);
        setAccountMode("create");
        dispatch({ type: "goto", step: "provisioning" });
        await runProvision(buildProvisionRequest(tenant));
      } catch (e) {
        dispatch({ type: "error", error: toOnboardingError(e) });
      } finally {
        dispatch({ type: "busy", busy: false });
      }
    },
    [runProvision],
  );

  /**
   * "Continue with Google" — the point of no return for this page load.
   *
   * The redirect throws away every byte of React state, so everything needed on
   * the other side is written down first: the plan, and the three tenant fields.
   * `redirectTo` is the CURRENT path, so the operator lands back on the same
   * route (`/signup-preview` today, the marketing page if self-serve is ever
   * switched on) with the provider mounted and ready to pick the return up.
   *
   * `prompt: "select_account"` because an operator signing up for a business
   * account very often has two Google identities in the browser, and silently
   * reusing the last one used means creating the portal under the wrong address
   * — which nothing in this flow can undo afterwards.
   */
  const startGoogleSignup = useCallback(async (values: TenantFormValues) => {
    const s = stateRef.current;
    const planId = s.planId;
    if (!planId) {
      dispatch({ type: "error", error: err("PLAN_UNKNOWN") });
      return;
    }
    const tenant: TenantFormValues = {
      companyName: values.companyName.trim(),
      slug: normalizeSlugClient(values.slug),
      acceptedTerms: values.acceptedTerms,
    };
    dispatch({ type: "busy", busy: true });
    dispatch({ type: "error", error: null });
    dispatch({ type: "business", patch: draftToBusiness(tenant) });
    try {
      writePendingOauth(planId, tenant);
      const redirectTo = `${window.location.origin}${window.location.pathname}?signup=google`;
      const { error: oauthError } = await getBrowserSupabase().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, queryParams: { prompt: "select_account" } },
      });
      if (oauthError) {
        // The commonest cause by far is that no Google provider is configured on
        // the Supabase project, which answers 400. Nothing was created, so the
        // stashed handoff would only confuse a later attempt.
        clearPendingOauth();
        console.error("[onboarding] Google sign-in could not start", oauthError);
        dispatch({ type: "error", error: err("CONFIG_MISSING") });
        dispatch({ type: "busy", busy: false });
      }
      // On success the browser is already navigating away. `busy` is left set on
      // purpose: clearing it would re-enable the form for the fraction of a
      // second before the page unloads.
    } catch (e) {
      clearPendingOauth();
      dispatch({ type: "error", error: toOnboardingError(e) });
      dispatch({ type: "busy", busy: false });
    }
  }, []);

  const signInExisting = useCallback(
    async (values: { email: string; password: string }) => {
      const s = stateRef.current;
      if (s.busy) return;
      dispatch({ type: "busy", busy: true });
      dispatch({ type: "error", error: null });
      try {
        // No server call, so a wrong password never burns a signup throttle slot.
        const { error: signInError } = await getBrowserSupabase().auth.signInWithPassword({
          email: values.email.trim().toLowerCase(),
          password: values.password,
        });
        if (signInError) {
          dispatch({ type: "error", error: err("SIGN_IN_FAILED") });
          return;
        }
        // We now hold a session; the server decides where they belong.
        resumeHintRef.current = await fetchSignupMeta();
        dispatch({ type: "signInPrompt", prompt: null });
        const planId = s.planId;
        if (!planId) {
          // Unreachable from the UI — `open()` always sets a plan before the
          // sign-in panel can render — but the alternative to this guard is
          // guessing a plan on someone's behalf.
          dispatch({ type: "error", error: err("PLAN_UNKNOWN") });
          return;
        }
        await resolveResume(planId);
      } catch (e) {
        dispatch({ type: "error", error: toOnboardingError(e) });
      } finally {
        dispatch({ type: "busy", busy: false });
      }
    },
    [resolveResume],
  );

  const useDifferentEmail = useCallback(() => {
    dispatch({ type: "signInPrompt", prompt: null });
    dispatch({ type: "error", error: null });
  }, []);

  /**
   * Deliberate "I already started — let me sign in" entry point.
   *
   * Until now the sign-in panel was only reachable by ACCIDENT: you had to fill
   * in the create-account form, submit it, and have `signup-begin` come back
   * with EMAIL_EXISTS_SIGN_IN. A returning operator whose session had expired
   * was shown a create-account form with their own details pre-filled and no
   * visible way to say "that's me, I have a password" — and submitting it burns
   * a throttle slot to be told something they already knew.
   *
   * `EMAIL_IN_SIGNUP` is the reason code because that is exactly the situation:
   * a signup that exists and is part-finished. It drives copy about picking up
   * where they left off rather than a generic "account exists" message.
   */
  const signInInstead = useCallback((email: string) => {
    const normalised = email.trim().toLowerCase();
    if (!normalised) return;
    dispatch({ type: "error", error: null });
    dispatch({
      type: "signInPrompt",
      prompt: { email: normalised, reason: "EMAIL_IN_SIGNUP" },
    });
  }, []);

  const startPayment = useCallback(async () => {
    await startPaymentInternal(stateRef.current.planId);
  }, [startPaymentInternal]);

  const markPaid = useCallback(async () => {
    const s = stateRef.current;
    if (s.step !== "payment") {
      console.warn("[onboarding] markPaid ignored outside the payment step");
      return;
    }
    if (markPaidInFlightRef.current) return;
    markPaidInFlightRef.current = true;
    dispatch({ type: "busy", busy: true });
    dispatch({ type: "error", error: null });
    try {
      // The client saw the PaymentIntent reach `succeeded` or `processing`. Ask
      // the server to confirm it against Stripe — a card that has just cleared
      // can take a beat to flip the subscription to `active`, so give it three
      // looks before moving on.
      let dto: ResumeSignupDTO | null = null;
      let lastError: OnboardingError | null = null;
      for (const wait of [0, 1200, 2500]) {
        if (wait) await sleep(wait);
        try {
          const { signup } = await signupResume();
          dto = signup;
          if (signup?.paid) break;
        } catch (e) {
          lastError = toOnboardingError(e);
        }
      }

      if (lastError && isSessionLoss(lastError)) {
        handleSessionLoss(lastError);
        return;
      }

      if (dto?.business) {
        dispatch({ type: "business", patch: draftFromSnapshot(dto.business) });
      }
      dispatch({ type: "payment", patch: { paid: Boolean(dto?.paid) } });

      // Advance even when the server could not confirm yet: an async payment
      // method sits in `processing` for minutes, and holding a paying customer
      // on a card form they have already completed is worse than starting the
      // build while Stripe settles. `signup-provision` re-verifies the money
      // before it writes anything, so nothing can be provisioned on an unpaid
      // subscription — the worst case is a PAYMENT_INCOMPLETE the boot screen
      // already knows how to retry.
      //
      // There is nothing left to ask for: the business name, the web address and
      // the terms were all answered on the account step, before the card.
      await continueToProvisioning();
    } finally {
      markPaidInFlightRef.current = false;
      dispatch({ type: "busy", busy: false });
    }
  }, [continueToProvisioning, handleSessionLoss]);

  const updateBusiness = useCallback((patch: Partial<BusinessDraft>) => {
    dispatch({ type: "business", patch });
  }, []);

  /**
   * Live availability for the web-address field.
   *
   * Two backends, because the field moved to a step that runs BEFORE the auth
   * user exists:
   *
   * - **Signed in, with a signup in flight** — `signup-slug-check`. It is the
   *   authoritative endpoint, it rate-limits per user and it returns
   *   server-generated suggestions. Unchanged, and still deployed as it is.
   * - **Not signed in yet** — a direct read of `tenants`. That endpoint refuses
   *   an anonymous caller by design (SIGNUP_NOT_FOUND without a `d247_signup`
   *   blob), and its availability test is the same one-row lookup that
   *   `tenants_public_select` already grants `anon`. See `slugAvailabilityAnon`.
   *
   * A SIGNUP_NOT_FOUND or UNAUTHENTICATED from the endpoint falls through to the
   * anon path rather than surfacing: it means the session is not one that
   * endpoint serves (a Google user before `signup-begin-oauth` has stamped
   * them), which is not something the operator can act on.
   *
   * Shape and the reserved list are answered locally, with no round trip at all.
   */
  const checkSlug = useCallback(async (raw: string): Promise<SlugCheckResult> => {
    const shape = checkSlugShape(raw);
    if (!shape.ok) {
      return {
        slug: shape.slug,
        available: false,
        reason: shape.problem === "reserved" ? "reserved" : "invalid",
        suggestions: [],
      };
    }
    const slug = shape.slug;
    const companyName = stateRef.current.business.companyName.trim();

    const viaEndpoint = async (): Promise<SlugCheckResult | null> => {
      const { data } = await getBrowserSupabase().auth.getSession();
      if (!data.session) return null;
      try {
        const res = await signupSlugCheck({ slug, companyName: companyName || undefined });
        return {
          slug: res.slug ?? slug,
          available: Boolean(res.available),
          reason: res.reason ?? (res.available ? "ok" : "taken"),
          suggestions: Array.isArray(res.suggestions) ? res.suggestions : [],
        };
      } catch (e) {
        const error = toOnboardingError(e);
        // The three slug verdicts also arrive as error codes (that is how the
        // endpoint reports them). Fold them back into a result so the field
        // renders one consistent UI wherever the verdict came from.
        if (error.code === "SLUG_TAKEN") {
          return { slug, available: false, reason: "taken", suggestions: suggestionsFrom(error) };
        }
        if (error.code === "SLUG_RESERVED") {
          return { slug, available: false, reason: "reserved", suggestions: suggestionsFrom(error) };
        }
        if (error.code === "SLUG_INVALID") {
          return { slug, available: false, reason: "invalid", suggestions: [] };
        }
        if (error.code === "SIGNUP_NOT_FOUND" || isSessionLoss(error)) return null;
        throw e;
      }
    };

    try {
      return (await viaEndpoint()) ?? (await slugAvailabilityAnon(slug));
    } catch (e) {
      const error = toOnboardingError(e);
      if (isSessionLoss(error)) {
        handleSessionLoss(error);
      }
      // We could not perform the check. Reporting "taken" would block a
      // legitimate address over a network blip, and reporting "available" would
      // promise something we did not verify — so the field renders an
      // "unchecked" state from `reason: "unknown"` and lets the operator
      // continue. `signup-provision` re-checks the slug authoritatively and
      // answers a recoverable SLUG_TAKEN if we were wrong.
      return { slug, available: true, reason: "unknown", suggestions: [] };
    }
  }, [handleSessionLoss]);

  /**
   * Safe to press as often as the operator likes: `signup-provision` returns the
   * existing tenant when one exists and never re-touches Stripe money.
   *
   * It re-reads the draft rather than closing over one, because the boot
   * screen's inline "pick a different address" panel edits `state.business` and
   * this is the button it hands the operator afterwards.
   */
  const retryProvision = useCallback(async () => {
    const s = stateRef.current;
    if (s.step !== "provisioning") {
      console.warn("[onboarding] retryProvision ignored outside provisioning");
      return;
    }
    if (s.provisioning.phase === "running") return;
    await continueToProvisioning();
  }, [continueToProvisioning]);

  /**
   * The step components' only channel back into the shell.
   *
   * PAYMENT_EXPIRED is intercepted rather than merely displayed. The payment
   * step raises it when Stripe refuses to confirm the PaymentIntent at all —
   * the subscription went `incomplete_expired` (~23 h), or the intent was
   * cancelled, or it is otherwise unconfirmable. Nothing was charged, but the
   * secret in state is dead: painting a banner and leaving it in place would
   * keep `<Elements>` mounted on the dead intent, keep the footer's
   * "Pay $199 and continue" enabled, and re-produce the identical error on
   * every press — with the banner promising a fresh attempt that never came.
   * So the shell does what the copy says and mints a new intent, keeping the
   * explanation on screen across the swap.
   */
  const setError = useCallback(
    (e: OnboardingError | null) => {
      if (e?.code === "PAYMENT_EXPIRED" && stateRef.current.step === "payment") {
        dispatch({ type: "error", error: e });
        // Server-side idempotent: it reuses or replaces the incomplete
        // subscription and never charges twice.
        void startPaymentInternal(stateRef.current.planId, e);
        return;
      }
      dispatch({ type: "error", error: e });
    },
    [startPaymentInternal],
  );

  // -------------------------------------------------------------------------
  // Leave-while-writing guard
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Only while the server is mid-write. A beforeunload on a form the user has
    // not paid for is user-hostile and gets the site penalised.
    if (!(state.step === "provisioning" && state.provisioning.phase === "running")) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.step, state.provisioning.phase]);

  // -------------------------------------------------------------------------

  // Resolved against the live catalogue first, then the hardcoded one. The
  // second lookup inside `getSignupPlan` is what keeps someone moving whose plan
  // an admin has hidden since they started — `signup_plans` only serves visible
  // rows to anon, so their id is simply absent from `plans`.
  const plan: SignupPlan | null = useMemo(
    () => (state.planId ? getSignupPlan(state.planId, plans) ?? null : null),
    [state.planId, plans],
  );

  const value = useMemo<OnboardingContextValue>(
    () => ({
      state,
      plan,
      isOpen,
      closeConfirmOpen,
      hasResumableSignup,
      open,
      requestClose,
      confirmClose,
      cancelClose,
      submitAccount,
      submitTenantDetails,
      startGoogleSignup,
      signInExisting,
      useDifferentEmail,
      signInInstead,
      startPayment,
      markPaid,
      updateBusiness,
      checkSlug,
      retryProvision,
      setError,
    }),
    [
      state,
      plan,
      isOpen,
      closeConfirmOpen,
      hasResumableSignup,
      open,
      requestClose,
      confirmClose,
      cancelClose,
      submitAccount,
      submitTenantDetails,
      startGoogleSignup,
      signInExisting,
      useDifferentEmail,
      signInInstead,
      startPayment,
      markPaid,
      updateBusiness,
      checkSlug,
      retryProvision,
      setError,
    ],
  );

  const shellValue = useMemo<OnboardingShellValue>(
    () => ({
      resolving,
      planSwitchBlocked,
      plans,
      accountMode,
      googleEnabled: GOOGLE_ENABLED,
    }),
    [resolving, planSwitchBlocked, plans, accountMode],
  );

  const overlayMounted = state.step === "provisioning" || state.step === "done";

  return (
    <OnboardingContext.Provider value={value}>
      <OnboardingShellContext.Provider value={shellValue}>
        {children}
        <OnboardingDialog />
        {overlayMounted && <ProvisioningScreen />}
      </OnboardingShellContext.Provider>
    </OnboardingContext.Provider>
  );
}
