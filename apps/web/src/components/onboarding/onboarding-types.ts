import type { SignupPlan, SignupPlanId } from "@/lib/plans";

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
/**
 * The flow is `plan -> account -> payment -> provisioning -> done`.
 *
 * There is deliberately no `business` step any more. It used to sit between
 * payment and provisioning and ask for the company name, location, fleet size,
 * opening hours and branding — AFTER the card had been charged, which is the
 * worst possible place to discover a validation problem. Everything the server
 * actually requires to mint a tenant (a company name and an accepted terms box)
 * now lives on the `account` step, alongside the web address the operator picks
 * for themselves; everything else is collected by the portal's own first-run
 * wizard, where it can be edited afterwards.
 */
export type SignupStep =
  | "plan"
  | "account"
  | "payment"
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

/**
 * Codes the operator can fix themselves without leaving the boot screen. All
 * four are about the web address, so the provisioning screen answers them with
 * an inline "pick a different address" panel rather than sending a customer who
 * has already paid back through a form.
 */
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
// Tenant identity
//
// What is LEFT of the old business form. `signup-provision` requires exactly
// two things from the operator — a company name and an accepted terms box — and
// honours a `slug` when one is supplied. Those three now sit on the account
// step, before any money moves, so a name that cannot become a legal hostname
// is caught while the form is still free to fix.
//
// Everything the old step also asked for (location, phone, fleet size, vehicle
// type, brand colours, logo, opening hours) is gone from this flow. All of it is
// optional server-side, all of it is editable in the portal afterwards, and
// asking for it here meant a paid customer sitting in front of a nine-field form
// before they could reach the thing they had just bought.
// ---------------------------------------------------------------------------

export interface BusinessDraft {
  /** Trading name. Written to `tenants.company_name` and used for the brand palette. */
  companyName: string;
  /**
   * The subdomain the operator chose: `{slug}.drive-247.com` and
   * `{slug}.portal.drive-247.com`.
   *
   * Typed by the operator now, not derived behind their back. It is sent to
   * `signup-provision` as `ProvisionRequest.slug`, which validates and claims it
   * — so an address the operator saw confirmed as free is the address they get,
   * and a collision is reported against a field they can actually edit.
   */
  slug: string;
  /**
   * True once the operator edits the web address by hand. While it is false the
   * field tracks the company name; the first keystroke in it stops that for
   * good, so auto-derivation can never overwrite a deliberate choice.
   */
  slugTouched: boolean;
  acceptedTerms: boolean;
}

export const EMPTY_BUSINESS_DRAFT: BusinessDraft = {
  companyName: "",
  slug: "",
  slugTouched: false,
  acceptedTerms: false,
};

// ---------------------------------------------------------------------------
// Slug availability
// ---------------------------------------------------------------------------
export interface SlugCheckResult {
  /** The NORMALISED slug that was evaluated (may differ from what was typed). */
  slug: string;
  available: boolean;
  /**
   * `"unknown"` is a CLIENT-ONLY verdict the server never sends. It means the
   * availability lookup itself failed — offline, a 500, a dead endpoint — and is
   * kept distinct from `"ok"` so the field can say "we couldn't check this"
   * rather than showing a green tick it did not earn. `available` is true
   * alongside it so a network blip does not block a legitimate address;
   * `signup-provision` re-checks authoritatively either way.
   */
  reason: "ok" | "reserved" | "invalid" | "taken" | "unknown";
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
// Step component props
// ---------------------------------------------------------------------------

/** Everything the account step collects when it is creating the account. */
export interface AccountFormValues {
  fullName: string;
  email: string;
  password: string;
  companyName: string;
  /** Already normalised by the step — lowercase, `[a-z0-9-]`, no edge hyphens. */
  slug: string;
  acceptedTerms: boolean;
  /** Honeypot. Always posted; a non-empty value means bot. */
  companyWebsite: string;
  /** Date.now() captured when the step mounted. */
  formStartedAt: number;
}

/**
 * The tenant half on its own.
 *
 * Two callers need it without the credential half: the Google button (the
 * identity comes back from Google, so only these three are ours to collect) and
 * the `tenant` mode below.
 */
export interface TenantFormValues {
  companyName: string;
  slug: string;
  acceptedTerms: boolean;
}

/**
 * `create` — the normal first-visit form: name, email, password, business name,
 * web address, terms.
 *
 * `tenant` — the recovery form. It renders ONLY the business name, web address
 * and terms, and is reached in one situation: a signup that is already paid for
 * but whose tenant details cannot be found (the draft lives in the operator's
 * own `user_metadata` and in `localStorage`, so this needs both to be missing —
 * a mid-payment device switch with a failed metadata write). Without it a paying
 * customer would be resumed onto a create-account form for an account they
 * already have.
 */
export type AccountStepMode = "create" | "tenant";

export interface AccountStepProps {
  plan: SignupPlan;
  mode: AccountStepMode;
  initialValues: { fullName: string; email: string };
  /**
   * The tenant fields are CONTROLLED by the provider, unlike the credential
   * fields which the step owns.
   *
   * They have to outlive this component: they are re-rendered after a failed
   * `signup-begin`, they cross the Google redirect, and they are what the
   * provision is eventually built from. Local state would drop them on any of
   * those.
   */
  tenant: BusinessDraft;
  onTenantChange(patch: Partial<BusinessDraft>): void;
  signInPrompt: { email: string; reason: SignupErrorCode } | null;
  busy: boolean;
  error: OnboardingError | null;
  /**
   * Whether to offer "Continue with Google".
   *
   * Off unless `NEXT_PUBLIC_SIGNUP_GOOGLE_ENABLED` is "true". The button is
   * useless — a Supabase 400 — until a Google provider is configured on the
   * project AND `signup-begin-oauth` is deployed, and a sign-in button that
   * fails is worse than no button at all.
   */
  googleEnabled: boolean;
  onSubmit(values: AccountFormValues): void;
  /** `tenant` mode's submit: the account already exists and is paid for. */
  onSubmitTenant(values: TenantFormValues): void;
  /** Leaves the page for Google, carrying these three values across the redirect. */
  onGoogle(values: TenantFormValues): void;
  /** Live availability for the web address. Debounced by the step. */
  onCheckSlug(slug: string): Promise<SlugCheckResult>;
  onSignIn(values: { email: string; password: string }): void;
  /** Clears signInPrompt and returns to the create-account form. */
  onUseDifferentEmail(): void;
  /**
   * "I already started — sign me in instead." Takes the email currently in the
   * form so the panel opens against the right account.
   */
  onSignInInstead(email: string): void;
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
  /** `tenant`-mode submit: store the details and start provisioning straight away. */
  submitTenantDetails(values: TenantFormValues): Promise<void>;
  /** Stash the tenant details, then hand the browser to Google. Never returns. */
  startGoogleSignup(values: TenantFormValues): Promise<void>;
  signInExisting(values: { email: string; password: string }): Promise<void>;
  useDifferentEmail(): void;
  /** Switch to the sign-in panel for an email the user has already typed. */
  signInInstead(email: string): void;

  startPayment(): Promise<void>;
  markPaid(): Promise<void>;

  updateBusiness(patch: Partial<BusinessDraft>): void;
  checkSlug(slug: string): Promise<SlugCheckResult>;

  retryProvision(): Promise<void>;

  setError(err: OnboardingError | null): void;
}
