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

import { getSignupPlan, type SignupPlan, type SignupPlanId } from "@/lib/plans";
import { getBrowserSupabase } from "@/lib/supabase/browser";

import {
  fetchSignupMeta,
  signupBegin,
  signupPaymentIntent,
  signupProvision,
  signupResume,
  signupSlugCheck,
  toOnboardingError,
  type ClientSignupMeta,
  type ProvisionRequest,
  type ResumeSignupDTO,
} from "./onboarding-api";
import { OnboardingDialog } from "./onboarding-dialog";
import { ProvisioningScreen } from "./provisioning-screen";
import {
  EMPTY_BUSINESS_DRAFT,
  PROVISION_MILESTONES,
  SIGNUP_ERROR_COPY,
  type AccountFormValues,
  type BusinessDraft,
  type OnboardingContextValue,
  type OnboardingError,
  type OnboardingState,
  type ProvisionMilestone,
  type ProvisioningState,
  type ProvisionResult,
  type SignupStep,
  type SlugCheckResult,
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
 * Two edges are NOT in the spec's table and are here on purpose:
 *  - `payment|business|provisioning -> account` is the SESSION_LOST /
 *    UNAUTHENTICATED recovery. It undoes nothing — the auth user still exists
 *    and the card is still charged; it only puts the sign-in panel back on
 *    screen so the user can re-attach a session and resume forwards.
 *  - `provisioning -> payment` is extended from PAYMENT_EXPIRED to
 *    PAYMENT_REQUIRED, because the remedy is identical.
 */
const ALLOWED_TRANSITIONS: Record<SignupStep, readonly SignupStep[]> = {
  plan: ["plan", "account", "payment", "business", "provisioning", "done"],
  account: ["account", "payment", "plan"],
  payment: ["payment", "business", "account", "plan"],
  business: ["business", "provisioning", "account", "plan"],
  provisioning: ["provisioning", "done", "business", "payment", "account", "plan"],
  done: ["done", "plan"],
};

type Action =
  | { type: "goto"; step: SignupStep }
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

/** `EMPTY_BUSINESS_DRAFT` is a shared module constant; its nested schedule must not be aliased into state. */
function freshBusinessDraft(): BusinessDraft {
  return {
    ...EMPTY_BUSINESS_DRAFT,
    schedule: {
      ...EMPTY_BUSINESS_DRAFT.schedule,
      days: [...EMPTY_BUSINESS_DRAFT.schedule.days],
    },
  };
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
      return {
        ...state,
        business: {
          ...state.business,
          ...action.patch,
          // Schedule is patched field-by-field so a caller can send
          // { schedule: { alwaysOpen: true } } without wiping the day list.
          schedule: action.patch.schedule
            ? { ...state.business.schedule, ...action.patch.schedule }
            : state.business.schedule,
        },
      };
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
}

const OnboardingShellContext = createContext<OnboardingShellValue>({
  resolving: false,
  planSwitchBlocked: null,
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

/** Map the server's business snapshot back onto the form draft so a resumed user re-reads their own answers. */
function draftFromSnapshot(b: NonNullable<ResumeSignupDTO["business"]>): BusinessDraft {
  const base = freshBusinessDraft();
  return {
    ...base,
    companyName: b.companyName ?? "",
    slug: b.slug ?? "",
    // The slug came back from the server, so it is already the value we want —
    // re-deriving it from the company name would silently overwrite a hand-edit.
    slugTouched: Boolean(b.slug),
    location: b.location ?? "",
    businessPhone: b.businessPhone ?? "",
    fleetSize: b.fleetSize ?? "",
    vehicleType: b.vehicleType ?? "",
    businessColours: b.businessColours ?? "",
    logoUrl: b.logoUrl ?? "",
    schedule: {
      alwaysOpen: b.operatingSchedule?.alwaysOpen ?? base.schedule.alwaysOpen,
      days: b.operatingSchedule?.days ?? base.schedule.days,
      opensAt: b.operatingSchedule?.opensAt ?? base.schedule.opensAt,
      closesAt: b.operatingSchedule?.closesAt ?? base.schedule.closesAt,
    },
    // A snapshot only exists because a submit carrying acceptedTerms === true
    // reached the server. Making them re-tick it would be theatre.
    acceptedTerms: true,
  };
}

function buildProvisionRequest(d: BusinessDraft): ProvisionRequest {
  const trimmedOrUndefined = (v: string) => {
    const t = v.trim();
    return t ? t : undefined;
  };
  return {
    companyName: d.companyName.trim(),
    slug: d.slug.trim().toLowerCase(),
    location: trimmedOrUndefined(d.location),
    businessPhone: trimmedOrUndefined(d.businessPhone),
    fleetSize: trimmedOrUndefined(d.fleetSize),
    vehicleType: trimmedOrUndefined(d.vehicleType),
    businessColours: trimmedOrUndefined(d.businessColours),
    logoUrl: trimmedOrUndefined(d.logoUrl),
    operatingSchedule: {
      alwaysOpen: d.schedule.alwaysOpen,
      days: d.schedule.alwaysOpen ? [] : d.schedule.days,
      opensAt: d.schedule.opensAt,
      closesAt: d.schedule.closesAt,
    },
    acceptedTerms: d.acceptedTerms,
  };
}

const SLUG_SHAPE = /^[a-z][a-z0-9-]*$/;

/**
 * A last line of defence before we tear the dialog down and mount the boot
 * screen. B3 validates the same rules inline and the server validates them
 * again authoritatively — this exists so a malformed draft can never reach the
 * point where the UI is showing a provisioning animation for a request that was
 * always going to 400.
 */
function validateBusinessLocally(d: BusinessDraft): OnboardingError | null {
  if (d.companyName.trim().length < 2) {
    return err("VALIDATION_FAILED", { field: "companyName" });
  }
  const slug = d.slug.trim().toLowerCase();
  if (slug.length < 3 || slug.length > 50 || !SLUG_SHAPE.test(slug)) {
    return err("SLUG_INVALID", { field: "slug" });
  }
  if (!d.schedule.alwaysOpen && d.schedule.days.length === 0) {
    return err("VALIDATION_FAILED", { field: "operatingSchedule" });
  }
  if (!d.acceptedTerms) {
    return err("TERMS_NOT_ACCEPTED", { field: "acceptedTerms" });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [isOpen, setIsOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [hasResumableSignup, setHasResumableSignup] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [planSwitchBlocked, setPlanSwitchBlocked] = useState<SignupPlanId | null>(null);

  // Async work reads state through this ref, never through the closure it was
  // created in: a poller created once must see the newest state on every tick.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  /** The passive hint read from app_metadata on mount. A hint — never proof of payment. */
  const resumeHintRef = useRef<ClientSignupMeta | null>(null);

  const pollTimerRef = useRef<number | null>(null);
  const pollBusyRef = useRef(false);
  const provisionSettledRef = useRef(false);
  const lastMilestoneCountRef = useRef(0);
  const lastMilestoneAtRef = useRef(0);
  const watchdogFiredAtRef = useRef<number | null>(null);
  const paymentIntentInFlightRef = useRef(false);
  const markPaidInFlightRef = useRef(false);

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
    async (planId: SignupPlanId | null) => {
      if (!planId) {
        dispatch({ type: "error", error: err("PLAN_UNKNOWN") });
        return;
      }
      if (paymentIntentInFlightRef.current) return;
      paymentIntentInFlightRef.current = true;
      dispatch({ type: "busy", busy: true });
      dispatch({ type: "error", error: null });
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
          dispatch({ type: "goto", step: "business" });
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
        } else {
          dispatch({ type: "error", error });
        }
      } finally {
        paymentIntentInFlightRef.current = false;
        dispatch({ type: "busy", busy: false });
      }
    },
    [handleSessionLoss],
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
          void startPaymentInternal(stateRef.current.planId);
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

  // -------------------------------------------------------------------------
  // Resume
  // -------------------------------------------------------------------------

  const hydrateFromResume = useCallback(
    (dto: ResumeSignupDTO, requestedPlanId: SignupPlanId) => {
      // Once money has moved the plan is fixed. Before that, the user is free to
      // click a different card and we re-mint the intent for it (edge case 28).
      const planLocked =
        dto.paid ||
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

      switch (dto.resumeStep) {
        case "payment":
          dispatch({ type: "goto", step: "payment" });
          void startPaymentInternal(planId);
          break;
        case "business":
          dispatch({ type: "goto", step: "business" });
          break;
        case "provisioning":
          // The server believes a provision is under way. Watch, do not write.
          dispatch({ type: "goto", step: "provisioning" });
          void runProvision(null);
          break;
        case "done":
          dispatch({ type: "goto", step: "done" });
          dispatch({ type: "provisioning", patch: { phase: "succeeded" } });
          break;
        case "account":
        default:
          dispatch({ type: "goto", step: "account" });
          break;
      }
    },
    [runProvision, startPaymentInternal],
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
    void (async () => {
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
      }
    })();
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

      if (resumeHintRef.current) {
        void resolveResume(planId);
        return;
      }
      dispatch({ type: "goto", step: "account" });
    },
    [resolveResume, startPaymentInternal],
  );

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
    if (s.step === "payment" || s.step === "business") {
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

      dispatch({ type: "busy", busy: true });
      dispatch({ type: "error", error: null });
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
      // on a card form they have already completed is worse than letting them
      // fill in the business form while Stripe settles. `signup-provision`
      // re-verifies before writing anything, so nothing can be provisioned on an
      // unpaid subscription.
      dispatch({ type: "goto", step: "business" });
    } finally {
      markPaidInFlightRef.current = false;
      dispatch({ type: "busy", busy: false });
    }
  }, [handleSessionLoss]);

  const updateBusiness = useCallback((patch: Partial<BusinessDraft>) => {
    dispatch({ type: "business", patch });
  }, []);

  const checkSlug = useCallback(async (slug: string): Promise<SlugCheckResult> => {
    const companyName = stateRef.current.business.companyName.trim();
    try {
      const res = await signupSlugCheck({
        slug,
        companyName: companyName || undefined,
      });
      return {
        slug: res.slug ?? slug,
        available: Boolean(res.available),
        reason: res.reason ?? (res.available ? "ok" : "taken"),
        suggestions: Array.isArray(res.suggestions) ? res.suggestions : [],
      };
    } catch (e) {
      const error = toOnboardingError(e);
      // The three slug verdicts can also arrive as error codes (that is how
      // signup-provision reports them). Fold them back into a result so the
      // field renders one consistent UI wherever the verdict came from.
      if (error.code === "SLUG_TAKEN") {
        return { slug, available: false, reason: "taken", suggestions: suggestionsFrom(error) };
      }
      if (error.code === "SLUG_RESERVED") {
        return { slug, available: false, reason: "reserved", suggestions: suggestionsFrom(error) };
      }
      if (error.code === "SLUG_INVALID") {
        const normalised = error.detail?.slug;
        return {
          slug: typeof normalised === "string" ? normalised : slug,
          available: false,
          reason: "invalid",
          suggestions: [],
        };
      }
      if (isSessionLoss(error)) {
        handleSessionLoss(error);
      } else {
        dispatch({ type: "error", error });
      }
      // We could not perform the check. Reporting "taken" would block a
      // legitimate address over a network blip; the banner above the form
      // explains what happened, and signup-provision re-checks the slug and
      // returns a recoverable SLUG_TAKEN if we were wrong.
      return { slug, available: true, reason: "ok", suggestions: [] };
    }
  }, [handleSessionLoss]);

  const submitBusiness = useCallback(async () => {
    const s = stateRef.current;
    if (s.busy) return;
    if (s.step !== "business") {
      console.warn("[onboarding] submitBusiness ignored outside the business step");
      return;
    }
    const invalid = validateBusinessLocally(s.business);
    if (invalid) {
      dispatch({ type: "error", error: invalid });
      return;
    }
    const body = buildProvisionRequest(s.business);
    dispatch({ type: "goto", step: "provisioning" });
    await runProvision(body);
  }, [runProvision]);

  const retryProvision = useCallback(async () => {
    const s = stateRef.current;
    if (s.step !== "provisioning") {
      console.warn("[onboarding] retryProvision ignored outside provisioning");
      return;
    }
    if (s.provisioning.phase === "running") return;
    // Safe to press: the server returns the existing tenant when one exists and
    // never re-charges the card.
    await runProvision(buildProvisionRequest(s.business));
  }, [runProvision]);

  const editBusinessAfterFailure = useCallback(() => {
    stopPoller();
    provisionSettledRef.current = true;
    dispatch({ type: "provisioning", patch: { phase: "idle", failure: null } });
    dispatch({ type: "goto", step: "business" });
    setIsOpen(true);
  }, [stopPoller]);

  const setError = useCallback((e: OnboardingError | null) => {
    dispatch({ type: "error", error: e });
  }, []);

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

  const plan: SignupPlan | null = useMemo(
    () => (state.planId ? getSignupPlan(state.planId) ?? null : null),
    [state.planId],
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
      signInExisting,
      useDifferentEmail,
      startPayment,
      markPaid,
      updateBusiness,
      checkSlug,
      submitBusiness,
      retryProvision,
      editBusinessAfterFailure,
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
      signInExisting,
      useDifferentEmail,
      startPayment,
      markPaid,
      updateBusiness,
      checkSlug,
      submitBusiness,
      retryProvision,
      editBusinessAfterFailure,
      setError,
    ],
  );

  const shellValue = useMemo<OnboardingShellValue>(
    () => ({ resolving, planSwitchBlocked }),
    [resolving, planSwitchBlocked],
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
