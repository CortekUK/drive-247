import type { SignupPlan, SignupPlanId } from "@/lib/plans";

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
export type SignupStep =
  | "plan"
  | "account"
  | "payment"
  | "business"
  | "provisioning"
  | "done";

// ---------------------------------------------------------------------------
// Errors. `code` is the contract; `message` is a server-supplied fallback.
// The UI ALWAYS prefers SIGNUP_ERROR_COPY[code] and only falls back to
// `message` for codes it does not know (forward compatibility).
// ---------------------------------------------------------------------------
export type SignupErrorCode =
  // --- validation (400)
  | "INVALID_BODY"
  | "VALIDATION_FAILED"
  | "WEAK_PASSWORD"
  | "EMAIL_INVALID"
  | "EMAIL_DISPOSABLE"
  | "PLAN_UNKNOWN"
  | "TERMS_NOT_ACCEPTED"
  | "SLUG_INVALID"
  // --- identity / conflict (409)
  | "SLUG_RESERVED"
  | "SLUG_TAKEN"
  // `signup-begin` no longer emits these two: telling an unauthenticated caller
  // whether an arbitrary address belongs to Drive247 staff or to a renter on
  // some tenant's booking site is a disclosure the UI never needed — all three
  // "already taken" cases now come back as EMAIL_EXISTS_SIGN_IN, whose next
  // action ("sign in instead") is identical. Kept in the union, and handled by
  // the account step, because the code list is a server-owned contract and an
  // older deployment may still send them.
  | "EMAIL_IS_STAFF"
  | "EMAIL_IS_CUSTOMER"
  | "EMAIL_IN_SIGNUP"
  | "EMAIL_EXISTS_SIGN_IN"
  | "ALREADY_PROVISIONED"
  | "PROVISION_IN_PROGRESS"
  // --- auth (401/404)
  | "UNAUTHENTICATED"
  | "SIGNUP_NOT_FOUND"
  | "SIGN_IN_FAILED"
  // --- money (402)
  | "PAYMENT_REQUIRED"
  | "PAYMENT_INCOMPLETE"
  | "PAYMENT_EXPIRED"
  | "CARD_DECLINED"
  | "CARD_AUTH_FAILED"
  // --- password recovery (400/500)
  // `signup-password-reset` deliberately collapses "no such account", "wrong
  // code", "expired code", "already used" and "not an account we may reset"
  // into RESET_CODE_INVALID. Distinguishing them would hand an unauthenticated
  // caller an existence oracle, which the request step is careful to close.
  | "RESET_CODE_INVALID"
  | "RESET_PASSWORD_WEAK"
  | "RESET_FAILED"
  // --- infrastructure
  | "STRIPE_UNAVAILABLE"
  | "STRIPE_JS_UNAVAILABLE"
  | "CONFIG_MISSING"
  | "RATE_LIMITED"
  | "NETWORK"
  | "SESSION_LOST"
  | "INTERNAL";

export interface OnboardingError {
  code: SignupErrorCode;
  /** Server message. Used only when `code` is unknown to the copy map. */
  message: string;
  /** Code-specific payload, e.g. { field: "slug" } or { suggestions: string[] } or { env: "..." }. */
  detail?: Record<string, unknown>;
}

/**
 * User-facing copy. Every string must be true of the system as built — do not
 * promise emails, refunds or plan changes the code does not perform.
 */
export const SIGNUP_ERROR_COPY: Record<SignupErrorCode, string> = {
  INVALID_BODY: "Something went wrong sending that. Please try again.",
  VALIDATION_FAILED: "Please check the highlighted fields and try again.",
  WEAK_PASSWORD:
    "Choose a password with at least 10 characters, including a letter and a number.",
  EMAIL_INVALID: "That doesn't look like a valid email address.",
  EMAIL_DISPOSABLE:
    "Please use a permanent business email address — this is the login for your portal.",
  PLAN_UNKNOWN: "That plan is no longer available. Please pick a plan again.",
  TERMS_NOT_ACCEPTED: "Please accept the Terms and Privacy Policy to continue.",
  SLUG_INVALID:
    "Your web address must start with a letter and use only lowercase letters, numbers and hyphens.",
  SLUG_RESERVED: "That web address is reserved. Please choose another one.",
  SLUG_TAKEN: "That web address is already taken. Try one of the suggestions below.",
  EMAIL_IS_STAFF:
    "This email already has a Drive247 portal account. Sign in at your portal instead, or use a different email address.",
  EMAIL_IS_CUSTOMER:
    "This email is already registered as a renter on a Drive247 booking site. Please use a different email address for your operator account.",
  EMAIL_IN_SIGNUP:
    "You already started signing up with this email. Enter your password to pick up where you left off.",
  EMAIL_EXISTS_SIGN_IN:
    "An account already exists for this email. Enter your password to continue, or use a different email address.",
  ALREADY_PROVISIONED: "Your portal is already set up.",
  PROVISION_IN_PROGRESS:
    "We're already building your portal. Give it a moment — this page will update on its own.",
  UNAUTHENTICATED: "Your session expired. Please sign in again to continue.",
  SIGNUP_NOT_FOUND: "We couldn't find a signup in progress for this account.",
  SIGN_IN_FAILED: "That password doesn't match. Please try again.",
  PAYMENT_REQUIRED: "We couldn't confirm your payment. Please complete the payment step.",
  PAYMENT_INCOMPLETE:
    "Your payment hasn't finished going through yet. Please complete it to continue.",
  PAYMENT_EXPIRED:
    "That payment attempt expired before it completed. You have not been charged — let's start a fresh one.",
  CARD_DECLINED:
    "Your card was declined. Try a different card, or check with your bank and try again.",
  CARD_AUTH_FAILED:
    "Your bank didn't approve that verification. Please try again, or use a different card.",
  // Never says whether the address exists — see the union comment.
  RESET_CODE_INVALID: "That code isn't right or has expired. Request a new one.",
  // Must state the SAME rule the client checklist and `signup-begin` enforce
  // (10+, a letter, a number). It previously said 8, which contradicted the
  // checklist rendered directly above it in the same panel.
  RESET_PASSWORD_WEAK:
    "Use at least 10 characters, including a letter and a number.",
  RESET_FAILED:
    "We couldn't set your new password. Request a new code and try again.",
  STRIPE_UNAVAILABLE:
    "We couldn't reach our payment provider. No charge was made. Please try again in a moment.",
  STRIPE_JS_UNAVAILABLE:
    "The secure payment form couldn't load. Check your connection or any ad blocker, then try again.",
  CONFIG_MISSING:
    "Signup is temporarily unavailable — our team has been alerted. Please book a strategy call and we'll set you up directly.",
  RATE_LIMITED: "Too many attempts. Please wait a few minutes and try again.",
  NETWORK: "We couldn't reach our servers. Check your connection and try again.",
  SESSION_LOST: "Your session expired. Please sign in again to continue.",
  INTERNAL: "Something went wrong on our end. Please try again.",
};

/** Codes that mean "go back to the business form and change something". */
export const RECOVERABLE_PROVISION_CODES: readonly SignupErrorCode[] = [
  "SLUG_TAKEN",
  "SLUG_RESERVED",
  "SLUG_INVALID",
  "VALIDATION_FAILED",
  "TERMS_NOT_ACCEPTED",
] as const;

// ---------------------------------------------------------------------------
// Provisioning milestones. Ordered; length is exactly 8 and drives the boot
// progress bar. These strings are ALSO written by signup-provision — do not
// rename one side only.
// ---------------------------------------------------------------------------
export type ProvisionMilestone =
  | "validated"
  | "payment_verified"
  | "brand_ready"
  | "workspace_created"
  | "account_linked"
  | "billing_ready"
  | "subscription_linked"
  | "site_published";

export const PROVISION_MILESTONES: readonly ProvisionMilestone[] = [
  "validated",
  "payment_verified",
  "brand_ready",
  "workspace_created",
  "account_linked",
  "billing_ready",
  "subscription_linked",
  "site_published",
] as const;

/** Boot-screen line copy. Present tense while running, past tense when done. */
export const MILESTONE_COPY: Record<
  ProvisionMilestone,
  { running: string; done: string }
> = {
  validated: { running: "Checking your details", done: "Details checked" },
  payment_verified: { running: "Confirming your payment", done: "Payment confirmed" },
  brand_ready: { running: "Building your colour palette", done: "Brand palette ready" },
  workspace_created: { running: "Creating your workspace", done: "Workspace created" },
  account_linked: { running: "Setting up your owner account", done: "Owner account ready" },
  billing_ready: { running: "Setting up your billing", done: "Billing ready" },
  subscription_linked: { running: "Activating your subscription", done: "Subscription active" },
  site_published: { running: "Publishing your booking site", done: "Booking site published" },
};

/**
 * The only milestone with a genuinely variable duration (it makes an OpenAI
 * call). After this many ms on this milestone we show an honest "still working"
 * hint rather than inventing sub-progress. All other milestones show a plain
 * spinner because they have NO observable sub-progress.
 */
export const SLOW_MILESTONE: ProvisionMilestone = "brand_ready";
export const SLOW_MILESTONE_HINT_MS = 6000;

// ---------------------------------------------------------------------------
// Business form
// ---------------------------------------------------------------------------
export interface OperatingScheduleDraft {
  alwaysOpen: boolean;
  /** Lowercase day names: "monday" … "sunday". */
  days: string[];
  /** "HH:MM", 24-hour. */
  opensAt: string;
  closesAt: string;
}

export interface BusinessDraft {
  companyName: string;
  /**
   * DERIVED, never typed by the operator.
   *
   * The business step no longer asks for a web address — the subdomain is
   * derived from the business name and communicated after provisioning. The
   * field stays on the draft because `onboarding-provider.tsx` still posts it
   * as `ProvisionRequest.slug` and guards on its shape before it will hand the
   * dialog over to the boot screen; an empty string there would kill every
   * signup. The step keeps it in sync with `companyName`, and the server
   * derives its own copy authoritatively.
   */
  slug: string;
  /**
   * Vestigial. It used to mean "the user hand-edited the slug, stop
   * auto-deriving it" — there is no slug field to hand-edit any more, so
   * nothing reads it. Optional (rather than deleted) purely so the resume path
   * in `onboarding-provider.tsx` can keep setting it without a type error.
   */
  slugTouched?: boolean;
  location: string;
  businessPhone: string;
  /**
   * How many vehicles the operator runs, as a plain integer in text form
   * ("8"). Empty string means "not answered yet" — it is kept as a string so
   * the input stays controlled and an in-progress entry is never coerced to 0.
   * Validated against the selected plan's `maxVehicles`.
   */
  fleetSize: string;
  /** One of VEHICLE_TYPE_OPTIONS. */
  vehicleType: string;
  businessColours: string;
  logoUrl: string;
  schedule: OperatingScheduleDraft;
  acceptedTerms: boolean;
}

export const EMPTY_BUSINESS_DRAFT: BusinessDraft = {
  companyName: "",
  slug: "",
  location: "",
  businessPhone: "",
  fleetSize: "",
  vehicleType: "",
  businessColours: "",
  logoUrl: "",
  schedule: {
    alwaysOpen: false,
    days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    opensAt: "09:00",
    closesAt: "18:00",
  },
  acceptedTerms: false,
};

// FLEET_SIZE_OPTIONS used to live here. It is gone because its bands
// (1–4 / 5–10 / 11–25 / 25+) did not line up with the plan bands
// (1–4 / 5–15 / 16–40), so "5–10" matched no plan boundary and "11–25"
// straddled two — the fleet answer could not be checked against the plan the
// operator had just paid for. The step now asks for a number. The lead forms
// (consultation-form, strategy-call) keep their own local band lists; they feed
// a CRM, not a plan check.

export const VEHICLE_TYPE_OPTIONS: readonly string[] = [
  "Economy",
  "SUV & crossover",
  "Luxury & performance",
  "Vans & commercial",
  "Mixed fleet",
] as const;

export const DAY_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" },
] as const;

/** "HH:MM" in 30-minute increments, 00:00 … 23:30. Built once at module scope. */
export const TIME_OPTIONS: readonly string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

// ---------------------------------------------------------------------------
// Slug availability
// ---------------------------------------------------------------------------
export interface SlugCheckResult {
  /** The NORMALISED slug the server evaluated (may differ from what was sent). */
  slug: string;
  available: boolean;
  reason: "ok" | "reserved" | "invalid" | "taken";
  suggestions: string[];
}

// ---------------------------------------------------------------------------
// Provisioning + result
// ---------------------------------------------------------------------------
export interface ProvisionResult {
  tenantId: string;
  slug: string;
  companyName: string;
  portalUrl: string;
  bookingUrl: string;
  /** Non-null only when SIGNUP_PORTAL_MAGICLINK is on server-side AND the link minted. */
  portalSignInUrl: string | null;
  /** false ⇒ the booking site is live but some pages still show Drive247 default copy. */
  contentSeeded: boolean;
}

export interface ProvisioningState {
  /** Milestones the SERVER confirmed. Never predicted, never advanced by a timer. */
  completed: ProvisionMilestone[];
  phase: "idle" | "running" | "succeeded" | "failed";
  failure: OnboardingError | null;
  /** Date.now() when the currently-active milestone was first observed. */
  activeSince: number | null;
}

export const EMPTY_PROVISIONING_STATE: ProvisioningState = {
  completed: [],
  phase: "idle",
  failure: null,
  activeSince: null,
};

// ---------------------------------------------------------------------------
// Canonical dialog state
// ---------------------------------------------------------------------------
export interface OnboardingState {
  step: SignupStep;
  planId: SignupPlanId | null;
  account: { fullName: string; email: string } | null;
  payment: {
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    clientSecret: string | null;
    publishableKey: string | null;
    mode: "test" | "live" | null;
    paid: boolean;
  };
  business: BusinessDraft;
  provisioning: ProvisioningState;
  result: ProvisionResult | null;
  /** Step-level banner. Cleared on entering any step. */
  error: OnboardingError | null;
  /** True while a network call owned by the current step is in flight. */
  busy: boolean;
  /** Non-null ⇒ render the "sign in to continue" panel instead of the create-account form. */
  signInPrompt: { email: string; reason: SignupErrorCode } | null;
  /** True when this session was resumed rather than started fresh (drives a banner). */
  resumed: boolean;
}

// ---------------------------------------------------------------------------
// Step component props — B3 implements exactly these signatures.
// ---------------------------------------------------------------------------
export interface AccountFormValues {
  fullName: string;
  email: string;
  password: string;
  /** Honeypot. Always posted; a non-empty value means bot. */
  companyWebsite: string;
  /** Date.now() captured when the step mounted. */
  formStartedAt: number;
}

export interface AccountStepProps {
  plan: SignupPlan;
  initialValues: { fullName: string; email: string };
  signInPrompt: { email: string; reason: SignupErrorCode } | null;
  busy: boolean;
  error: OnboardingError | null;
  onSubmit(values: AccountFormValues): void;
  onSignIn(values: { email: string; password: string }): void;
  /** Clears signInPrompt and returns to the create-account form. */
  onUseDifferentEmail(): void;
}

export interface PaymentStepProps {
  plan: SignupPlan;
  clientSecret: string | null;
  publishableKey: string | null;
  mode: "test" | "live" | null;
  busy: boolean;
  error: OnboardingError | null;
  /** Re-runs signup-payment-intent (expired PI, missing client secret, hard retry). */
  onRetryIntent(): void;
  /** PaymentIntent reached `succeeded` or `processing`. */
  onPaid(): void;
  /** Surfaces a Stripe-side failure to the shell. */
  onError(err: OnboardingError): void;
}

export interface BusinessStepProps {
  plan: SignupPlan;
  value: BusinessDraft;
  busy: boolean;
  error: OnboardingError | null;
  onChange(patch: Partial<BusinessDraft>): void;
  /**
   * OPTIONAL and unused by the step. The web-address field is gone, so nothing
   * checks slug availability while typing any more. The prop is kept so
   * `onboarding-dialog.tsx` can keep passing the provider's `checkSlug`
   * harmlessly, and so the live `signup-slug-check` endpoint keeps a caller
   * shape to come back to.
   */
  onCheckSlug?(slug: string): Promise<SlugCheckResult>;
  onSubmit(): void;
}

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------
export interface OnboardingContextValue {
  state: OnboardingState;
  plan: SignupPlan | null;
  isOpen: boolean;
  closeConfirmOpen: boolean;
  /** True when app_metadata showed an unfinished signup on mount. */
  hasResumableSignup: boolean;

  open(planId: SignupPlanId): void;
  requestClose(): void;
  confirmClose(): void;
  cancelClose(): void;

  submitAccount(values: AccountFormValues): Promise<void>;
  signInExisting(values: { email: string; password: string }): Promise<void>;
  useDifferentEmail(): void;

  startPayment(): Promise<void>;
  markPaid(): Promise<void>;

  updateBusiness(patch: Partial<BusinessDraft>): void;
  checkSlug(slug: string): Promise<SlugCheckResult>;
  submitBusiness(): Promise<void>;

  retryProvision(): Promise<void>;
  editBusinessAfterFailure(): void;

  setError(err: OnboardingError | null): void;
}
