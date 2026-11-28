"use client";

/**
 * Step 1 of the self-serve signup dialog — create the operator account.
 *
 * This step is the ONE irreversible boundary in the flow that the UI cannot
 * undo: a successful submit creates a row in `auth.users` and there is no
 * client-side delete. Everything below is shaped by that fact —
 *
 * - it validates hard before it will make a request (a failed `signup-begin`
 *   still burns a throttle slot against the user's IP);
 * - it never double-submits;
 * - and when the email already exists it does NOT retry or reset anything, it
 *   hands the user to the branch that matches WHO that email already belongs
 *   to. A booking-site renter, an existing operator and a half-finished signup
 *   are three different people with three different next actions, and lumping
 *   them into one "email taken" message is how you tell a paying customer to
 *   go away.
 *
 * The password page asks for the password twice. The confirm field is checked
 * here only (the server never sees it): the password page will not submit until
 * the two match, and the checklist under the fields shows "Passwords match"
 * live. The reset panel next door carries the same pair.
 *
 * Page order (Ghulam, 2026-11-23): who you are, then the business, then the
 * password. The password page is the one that creates the account.
 */

import * as React from "react";
import { Roboto } from "next/font/google";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type {
  AccountStepProps,
  OauthProvider,
  TenantFormValues,
} from "@/components/onboarding/onboarding-types";
import { SIGNUP_ERROR_COPY } from "@/components/onboarding/onboarding-types";
import {
  TenantIdentityFields,
  type SlugState,
} from "@/components/onboarding/tenant-identity-fields";
import {
  PasswordToggle,
  STRENGTH_BAR_CLASS,
} from "@/components/onboarding/password-toggle";
import { HeardAboutFields } from "@/components/onboarding/heard-about-fields";
import {
  captureStepCompleted,
  captureStepViewed,
  captureValidationErrors,
  registerSignupLead,
  type SignupStep,
} from "@/lib/analytics";
import { readLead, saveLead } from "@/lib/signup-lead";
import { isMockSignup } from "@/components/onboarding/mock-signup";
import {
  attributionFromDraft,
  EMPTY_ATTRIBUTION,
  validateAttribution,
  type AttributionDraft,
  type AttributionField,
} from "@/lib/signup-attribution";
import {
  ACCOUNT_FIELD_ORDER,
  FIELD_MAX,
  firstErrorField,
  isPasswordAcceptable,
  normalizeCityState,
  normalizeEmail,
  normalizeSlugClient,
  passwordRuleState,
  passwordStrength,
  repairSlug,
  suggestEmailCorrection,
  TENANT_FIELD_ORDER,
  validateAccount,
  validateCityState,
  validateTenant,
  type AccountField,
  type FieldErrors,
} from "@/lib/signup-validation";
import {
  PasswordResetPanel,
  PasswordResetSuccessNote,
  type PasswordResetView,
} from "@/components/onboarding/steps/password-reset-panel";
import {
  FieldError,
  ColumnActions,
  ColumnButton,
  ColumnLinks,
  ONE_COLUMN,
  ONE_COLUMN_WIDTH,
  RequiredMark,
  ScreenHead,
  UNDER_HEAD,
  SIGNUP_ENTER,
  SIGNUP_FIELDS,
  SIGNUP_HIT,
  SIGNUP_INPUT,
  SIGNUP_LABEL,
  SIGNUP_QUIET,
} from "@/components/onboarding/signup-ui";

/** Google's sign-in button is set in Roboto (Google's branding guidelines). */
const roboto = Roboto({ subsets: ["latin"], weight: ["500"], display: "swap" });

/**
 * Server error codes that belong under a specific input rather than in the
 * dialog's shared error banner. Anything not listed here is left to the banner
 * B2's shell renders, so a code we do not know about is still shown somewhere.
 */
const SERVER_FIELD_ERRORS: Partial<Record<string, AccountField>> = {
  EMAIL_INVALID: "email",
  EMAIL_DISPOSABLE: "email",
  EMAIL_IS_CUSTOMER: "email",
  WEAK_PASSWORD: "password",
  // The three slug verdicts land on the field that caused them again, now that
  // the operator picks the address instead of having it derived for them.
  SLUG_INVALID: "slug",
  SLUG_RESERVED: "slug",
  SLUG_TAKEN: "slug",
  TERMS_NOT_ACCEPTED: "acceptedTerms",
};

/** What the shell needs to know about the password-reset detour. */
export interface ResetShellState {
  /** True while the reset panel has replaced the sign-in form. */
  open: boolean;
  /** True while the panel has a request in flight. */
  busy: boolean;
}

/**
 * `AccountStepProps` is the cross-builder contract in onboarding-types.ts and
 * stays byte-identical — for the same reason `OnboardingShellValue` was never
 * folded into `OnboardingContextValue`. The reset detour needs two channels back
 * to the shell that no other step has, so they are added here as OPTIONAL
 * extras: this component still satisfies the shared contract, and a caller that
 * knows nothing about the detour keeps working (it simply gets the old, broken
 * footer behaviour, which is why the shell does pass them).
 */
export interface AccountStepShellProps extends AccountStepProps {
  /**
   * Lets the shell hide its footer primary (which would otherwise target a form
   * id that is not in the DOM) and refuse to close the dialog over a password
   * write it cannot see.
   */
  onResetStateChange?(next: ResetShellState): void;
  /**
   * Clears the PROVIDER's step error. The detour has its own error surface, and
   * a stale "That password doesn't match" from the sign-in attempt that sent the
   * user here would otherwise still be on screen next to the green "Password
   * updated" note when they come back.
   */
  onClearError?(): void;
  /**
   * Which page of the create-account form is on screen (0 who you are,
   * 1 business, 2 password). Held by the shell, which draws the progress and
   * the Back button for it; the step falls back to its own state when it is
   * rendered without one.
   */
  page?: number;
  onPageChange?(page: number): void;
  /**
   * Whether the card has run. `tenant` mode is also reached BEFORE paying (the
   * Google return, a reload on the code screen), and must not say the plan is
   * active then.
   */
  paid?: boolean;
  /**
   * `password` mode's submit: the password they chose, after the email code.
   * The provider swaps it in for the stand-in the account was created with.
   */
  onSubmitPassword?(password: string): void;
}

/**
 * The create-account form's pages, and which page owns each field. Two since
 * 2026-11-23: who you are, then the business, which creates the account and
 * sends the code. The password is its own screen after the code (`password`
 * mode), because the agreed order is about you → business → code → password.
 */
export const ACCOUNT_PAGE_COUNT = 2;
/** The last page: it creates the account. */
export const BUSINESS_PAGE = 1;
const LAST_ACCOUNT_PAGE = BUSINESS_PAGE;
const PAGE_FIELDS: readonly (readonly AccountField[])[] = [
  ["fullName", "email", "heardAbout", "heardAboutOther", "phone"],
  ["companyName", "cityState", "slug", "acceptedTerms"],
];
/**
 * The funnel step each page reports as (lib/analytics.ts SIGNUP_STEP_NAMES).
 * Tied to what the page asks, not where it sits, so `step_name` keeps meaning
 * the same thing in PostHog whatever the order. The password screen reports 4.
 */
const PAGE_STEP: readonly SignupStep[] = [1, 2];
/** The account check minus its password rule: the create pages ask no password. */
function withoutPassword(found: FieldErrors<AccountField>): FieldErrors<AccountField> {
  const rest = { ...found };
  delete rest.password;
  return rest;
}

/** The honeypot's value, or "" when it only repeats a field the person filled. */
function honeypotValue(raw: string | undefined, typed: readonly (string | undefined)[]): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "";
  return typed.some((t) => (t ?? "").trim().toLowerCase() === v) ? "" : v;
}

function pageOf(field: AccountField): number {
  const index = PAGE_FIELDS.findIndex((fields) => fields.includes(field));
  return index === -1 ? LAST_ACCOUNT_PAGE : index;
}

export function AccountStep({
  plan,
  mode,
  initialValues,
  tenant,
  onTenantChange,
  signInPrompt,
  busy,
  error,
  googleEnabled,
  onSubmit,
  onSubmitTenant,
  onSubmitAttribution,
  onGoogle,
  onCheckSlug,
  onSignIn,
  onUseDifferentEmail,
  onSignInInstead,
  onResetStateChange,
  onClearError,
  page: pageProp,
  onPageChange,
  paid = true,
  onSubmitPassword,
}: AccountStepShellProps) {
  const [ownPage, setOwnPage] = React.useState(0);
  const page = pageProp ?? ownPage;
  const setPage = onPageChange ?? setOwnPage;
  const [fullName, setFullName] = React.useState(initialValues.fullName);
  const [email, setEmail] = React.useState(initialValues.email);
  const [attribution, setAttribution] = React.useState<AttributionDraft>(EMPTY_ATTRIBUTION);

  // `signup_step_viewed` as each screen opens (Neema, 2026-11-25), numbered
  // like `signup_step_completed` so the two line up in PostHog.
  React.useEffect(() => {
    if (isMockSignup()) return;
    const step: SignupStep | null =
      mode === "password" ? 4 : mode === "tenant" ? 2 : mode === "attribution" ? 1 : mode === "create" ? PAGE_STEP[page] ?? null : null;
    if (step) captureStepViewed(step, mode === "create" ? {} : { screen: mode });
  }, [mode, page]);
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const confirmRef = React.useRef<HTMLInputElement>(null);
  const [errors, setErrors] = React.useState<FieldErrors<AccountField>>({});
  const [emailSuggestion, setEmailSuggestion] = React.useState<string | null>(
    null,
  );

  // Password for the "you already started / already exist" sign-in panel. Kept
  // separate from `password` so switching panels never leaks one into the other.
  const [signInPassword, setSignInPassword] = React.useState("");
  const [signInError, setSignInError] = React.useState<string | null>(null);

  // Password-recovery detour. Local to this step on purpose — a reset is not a
  // signup step, and adding it to the provider's reducer would put a state in
  // `ALLOWED_TRANSITIONS` that the purchase funnel has no meaning for.
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetBusy, setResetBusy] = React.useState(false);
  /**
   * The panel's view and resend deadline live HERE, one level above the panel,
   * because the panel unmounts on every "Back to sign in". Held inside it, both
   * reset on the way back: the user could re-request immediately, the server's
   * own 60 s cooldown would silently send NOTHING while still answering `ok`,
   * and the panel would report that a code was on its way. A deadline rather
   * than a countdown so it keeps running while the panel is closed.
   */
  const [resetView, setResetView] = React.useState<PasswordResetView>("request");
  const [resetCooldownUntil, setResetCooldownUntil] = React.useState(0);
  /**
   * The address a completed reset applies to — not a bare boolean. "Use a
   * different email" swaps the account under this panel, and a boolean left the
   * green "Password updated" note sitting under an address that was never
   * touched.
   */
  const [resetDoneFor, setResetDoneFor] = React.useState<string | null>(null);

  /**
   * The shell owns the footer button and the close affordances, so it has to be
   * told about the detour: it hides its primary (which targets a form id this
   * panel does not render) and refuses to close the dialog mid-write.
   *
   * Reported from whether the panel is actually ON SCREEN, not from `resetOpen`
   * alone. The provider can clear `signInPrompt` from under us, and a stale
   * "open" would then hide the footer primary above a create-account form that
   * has nothing else to submit it.
   */
  const resetPanelOpen = resetOpen && Boolean(signInPrompt);
  React.useEffect(() => {
    onResetStateChange?.({ open: resetPanelOpen, busy: resetBusy });
  }, [resetPanelOpen, resetBusy, onResetStateChange]);
  // Unconditional on unmount: whatever tears this step down — a step change, a
  // close — the shell must not be left believing a reset is still running.
  React.useEffect(
    () => () => onResetStateChange?.({ open: false, busy: false }),
    [onResetStateChange],
  );

  /**
   * Enter and leave the detour. Both ends clear the provider's error: on the way
   * IN because a SIGN_IN_FAILED banner is about a form that is no longer on
   * screen, and on the way OUT because that same banner would otherwise be
   * rendered next to the success note, telling the user in one breath that their
   * password was updated and that it does not work.
   */
  const openReset = () => {
    onClearError?.();
    setSignInError(null);
    setResetDoneFor(null);
    setResetOpen(true);
  };

  const leaveReset = () => {
    setResetOpen(false);
    setResetBusy(false);
    setSignInError(null);
    onClearError?.();
  };

  const honeypotRef = React.useRef<HTMLInputElement>(null);
  /** The trap was written by something that fired an input event: autofill. */
  const honeypotAutofilledRef = React.useRef(false);
  const fullNameRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const heardAboutRef = React.useRef<HTMLSelectElement | HTMLButtonElement>(null);
  const heardAboutOtherRef = React.useRef<HTMLInputElement>(null);
  const phoneRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const signInPasswordRef = React.useRef<HTMLInputElement>(null);
  const companyNameRef = React.useRef<HTMLInputElement>(null);
  const cityStateRef = React.useRef<HTMLInputElement>(null);
  const slugRef = React.useRef<HTMLInputElement>(null);
  const termsRef = React.useRef<HTMLButtonElement>(null);

  /**
   * The live verdict from the address field, mirrored up so submit can act on
   * it. Submitting a slug we have ALREADY been told is taken would create the
   * auth user and charge the card before the collision surfaced — at which point
   * the operator is paying to be told something the form knew a minute ago.
   */
  const [slugState, setSlugState] = React.useState<SlugState>({ kind: "idle" });

  /**
   * The tenant answers, normalised the way the provider will send them.
   * `slug` overrides the box: an address `repairSlug` rebuilt this submit,
   * which the provider's draft only receives on the next render.
   */
  const tenantValues = (slug?: string): TenantFormValues => ({
    companyName: tenant.companyName.trim(),
    slug: normalizeSlugClient(slug ?? tenant.slug),
    acceptedTerms: tenant.acceptedTerms,
    cityState: normalizeCityState(tenant.cityState),
    // The look picked on the business page (lib/signup-look.ts).
    brandColor: tenant.brandColor,
    siteTheme: tenant.siteTheme,
  });

  /**
   * "Convert, don't reject": an address autofill spoiled, or one left empty,
   * is rebuilt from the business name before anything is checked (see
   * `repairSlug`). The box shows the rebuilt address from the next render.
   * Returns the address to check and send, or undefined to use the box.
   */
  const repairAddress = (): string | undefined => {
    const repaired = repairSlug(tenant);
    if (!repaired) return undefined;
    onTenantChange({ slug: repaired, slugTouched: false });
    clearFieldError("slug");
    return repaired;
  };

  /**
   * Validate the tenant half and, if it passes, refuse a slug the field has
   * already reported unavailable. Returns the errors to render, or null when it
   * is safe to submit.
   */
  const tenantErrors = (repairedSlug?: string): FieldErrors<AccountField> | null => {
    const found = validateTenant(tenantValues(repairedSlug));
    // Required wherever the business is asked: the page before the card, and
    // the business-only screen after a Google sign-in.
    const cityError = validateCityState(tenant.cityState);
    if (cityError) found.cityState = cityError;
    // The field's verdict is about the address in the box; a rebuilt one has
    // not been looked at yet (the build re-checks it either way).
    if (repairedSlug === undefined && slugState.kind === "unavailable" && !found.slug) {
      found.slug =
        slugState.reason === "reserved"
          ? SIGNUP_ERROR_COPY.SLUG_RESERVED
          : slugState.reason === "invalid"
            ? SIGNUP_ERROR_COPY.SLUG_INVALID
            : SIGNUP_ERROR_COPY.SLUG_TAKEN;
    }
    return Object.keys(found).length > 0 ? found : null;
  };

  const refFor = (field: AccountField) =>
    field === "fullName"
      ? fullNameRef.current
      : field === "email"
        ? emailRef.current
        : field === "heardAbout"
          ? heardAboutRef.current
          : field === "heardAboutOther"
            ? heardAboutOtherRef.current
            : field === "phone"
              ? phoneRef.current
              : field === "password"
                ? passwordRef.current
                : field === "companyName"
                  ? companyNameRef.current
                  : field === "cityState"
                    ? cityStateRef.current
                  : field === "slug"
                    ? slugRef.current
                    : termsRef.current;

  /**
   * A field to focus once its page has rendered. Set when an error belongs to a
   * page that is not on screen: the page changes first, then this effect finds
   * the field that now exists and puts the caret in it.
   */
  const pendingFocusRef = React.useRef<AccountField | null>(null);
  React.useEffect(() => {
    const field = pendingFocusRef.current;
    if (!field) return;
    pendingFocusRef.current = null;
    focusAndReveal(refFor(field));
    // refFor reads refs only; the page is what makes the target exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  /**
   * Put the caret in a field and bring it to the middle of the screen, so the
   * error under it is not left behind the phone keyboard (Neema, 2026-11-22).
   */
  function focusAndReveal(el: HTMLElement | null) {
    if (!el) return;
    el.focus();
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }

  /** Focus whichever field the first error belongs to, changing page if needed. */
  const focusFirst = (
    found: FieldErrors<AccountField>,
    order: readonly AccountField[],
  ) => {
    const first = firstErrorField(found, order);
    if (!first) return;
    if (mode === "create" && !signInPrompt && pageOf(first) !== page) {
      pendingFocusRef.current = first;
      setPage(pageOf(first));
      return;
    }
    focusAndReveal(refFor(first));
  };

  /**
   * Every error the visitor is shown, to PostHog, each under the step its
   * field lives on (the last page can report a page-1 field the server
   * refused). Field names and our own copy only, never a typed value.
   */
  const reportErrors = (found: FieldErrors<AccountField>) => {
    const byStep = new Map<SignupStep, Record<string, string | undefined>>();
    for (const [field, message] of Object.entries(found)) {
      if (!message) continue;
      const step = PAGE_STEP[pageOf(field as AccountField)];
      byStep.set(step, { ...(byStep.get(step) ?? {}), [field]: message });
    }
    byStep.forEach((errs, step) => captureValidationErrors(step, errs));
  };

  const clearFieldError = React.useCallback((field: AccountField) => {
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }, []);

  /**
   * Captured once, on mount. `signup-begin` compares it against the server
   * clock as a soft bot signal (a form submitted 200 ms after it rendered was
   * not filled in by a human). Soft: the server logs and continues rather than
   * blocking, because clock skew is real.
   *
   * Stamped in an effect rather than in a `useRef` initialiser — `Date.now()`
   * is impure and must not be called during render.
   */
  const formStartedAtRef = React.useRef<number>(0);
  React.useEffect(() => {
    formStartedAtRef.current = Date.now();
  }, []);

  // Resume can arrive after mount (the provider reads app_metadata
  // asynchronously), so seed from props whenever the incoming values actually
  // change. These are plain strings, so this cannot fight the user's typing on
  // an unrelated re-render.
  React.useEffect(() => {
    setFullName(initialValues.fullName);
  }, [initialValues.fullName]);
  React.useEffect(() => {
    setEmail(initialValues.email);
  }, [initialValues.email]);

  /*
   * Back where they left off (Neema, 2026-11-25). Inside Instagram or Facebook,
   * leaving to fetch the email code often reloads the page and empties the
   * form. The first page's answers were saved as a lead (lib/signup-lead.ts),
   * so an empty first page is filled from it. Only ever fills empty fields.
   */
  React.useEffect(() => {
    if (mode !== "create" || isMockSignup()) return;
    if (initialValues.fullName.trim() || initialValues.email.trim()) return;
    let cancelled = false;
    void readLead().then((lead) => {
      if (cancelled || !lead) return;
      setFullName((v) => v || lead.fullName || "");
      setEmail((v) => v || lead.email || "");
      setAttribution((a) => ({
        ...a,
        heardAbout: a.heardAbout || (lead.heardAbout as AttributionDraft["heardAbout"]) || "",
        heardAboutOther: a.heardAboutOther || lead.heardAboutOther || "",
        phone: a.phone || lead.phone || "",
      }));
    });
    return () => {
      cancelled = true;
    };
    // Once, when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A server error is about the values that produced it. The moment the user
   * edits anything, that error is stale and must stop being shown under a field
   * they have already changed.
   */
  const [staleServerError, setStaleServerError] = React.useState(false);
  React.useEffect(() => {
    setStaleServerError(false);
  }, [error]);

  const serverFieldError = React.useMemo<FieldErrors<AccountField>>(() => {
    if (!error || staleServerError) return {};
    const field = SERVER_FIELD_ERRORS[error.code];
    if (!field) return {};
    // Prefer our own copy for codes we know; fall back to the server message
    // for forward compatibility.
    const copy = SIGNUP_ERROR_COPY[error.code] ?? error.message;
    return { [field]: copy } as FieldErrors<AccountField>;
  }, [error, staleServerError]);

  /**
   * `VALIDATION_FAILED` carries `detail.field`. It is handled separately from
   * the map above because the field is only known at runtime.
   */
  const validationField = React.useMemo<AccountField | null>(() => {
    if (!error || staleServerError || error.code !== "VALIDATION_FAILED") {
      return null;
    }
    const field = error.detail?.field;
    return typeof field === "string" &&
      (ACCOUNT_FIELD_ORDER as readonly string[]).includes(field)
      ? (field as AccountField)
      : null;
  }, [error, staleServerError]);

  /**
   * The server answers only after page 2 is submitted, but its verdict can be
   * about page 0 ("that email is disposable") or page 1 ("weak password").
   * Take the operator to the page the error is about, with the caret in it.
   */
  React.useEffect(() => {
    if (mode !== "create" || signInPrompt) return;
    const field =
      (Object.keys(serverFieldError)[0] as AccountField | undefined) ?? validationField;
    if (field && pageOf(field) !== page) {
      pendingFocusRef.current = field;
      setPage(pageOf(field));
    }
    // Only a NEW server verdict should move the page, never the page itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFieldError, validationField]);

  const fieldError = (field: AccountField): string | undefined =>
    errors[field] ??
    serverFieldError[field] ??
    (validationField === field ? error?.message : undefined);

  const markDirty = () => {
    if (!staleServerError) setStaleServerError(true);
  };

  const ruleState = passwordRuleState(password);
  const strength = passwordStrength(password);

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const handleCreateAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // `busy` is set synchronously by the provider before it awaits, so this
    // guard plus the disabled footer button makes a double-submit impossible
    // even on a fast double-click or an Enter key held down.
    if (busy) return;

    // Only the business page sends the address, so only it repairs it.
    const repairedSlug = page === BUSINESS_PAGE ? repairAddress() : undefined;
    const tenantValue = tenantValues(repairedSlug);

    // Every page checks its own fields first. Nothing is sent before the last.
    // No password is asked here any more (it comes after the code), so its
    // rule is left out of the check.
    const all: FieldErrors<AccountField> = {
      ...withoutPassword(validateAccount({ fullName, email, password: "", ...tenantValue })),
      ...validateAttribution(attribution),
      ...(page === BUSINESS_PAGE ? (tenantErrors(repairedSlug) ?? {}) : {}),
    };
    const pageErrors: FieldErrors<AccountField> = {};
    for (const field of PAGE_FIELDS[page]) {
      if (all[field]) pageErrors[field] = all[field];
    }
    setErrors(pageErrors);
    if (Object.keys(pageErrors).length > 0) {
      reportErrors(pageErrors);
      focusFirst(pageErrors, ACCOUNT_FIELD_ORDER);
      return;
    }

    if (page < LAST_ACCOUNT_PAGE) {
      // A rebuilt address has not been looked at yet; the verdict the field
      // reported was about the old one, so it must not block the last page.
      if (repairedSlug !== undefined) setSlugState({ kind: "idle" });
      captureStepCompleted(PAGE_STEP[page]);
      // The lead: saved the moment the first page is done, before any account
      // exists, so Bryan can call someone who stops here (lib/signup-lead.ts).
      if (page === 0 && !isMockSignup()) {
        void saveLead("details", {
          fullName: fullName.trim(),
          email: normalizeEmail(email),
          phone: attribution.phone.trim(),
          heardAbout: attribution.heardAbout || undefined,
          heardAboutOther: attribution.heardAboutOther.trim() || undefined,
          fleetSize: attribution.fleetSize || null,
          planId: plan.id,
        }).then((leadId) => {
          if (leadId) registerSignupLead(leadId);
        });
      }
      setPage(page + 1);
      return;
    }

    // The whole form once more before anything is sent: an earlier page can
    // hold an error the visitor never saw (an answer changed by Back).
    const nextErrors: FieldErrors<AccountField> = {
      ...withoutPassword(validateAccount({ fullName, email, password: "", ...tenantValue })),
      ...validateAttribution(attribution),
      ...(tenantErrors(repairedSlug) ?? {}),
    };
    setErrors(nextErrors);

    // Optional (Ghulam, 2026-11-23): null when nothing was answered.
    const answered = attributionFromDraft(attribution);
    if (Object.keys(nextErrors).length > 0) {
      reportErrors(nextErrors);
      focusFirst(nextErrors, ACCOUNT_FIELD_ORDER);
      return;
    }

    captureStepCompleted(PAGE_STEP[page]);

    onSubmit({
      fullName: fullName.trim(),
      email: normalizeEmail(email),
      // Empty on purpose: the provider creates the account with a random
      // stand-in, and the password screen after the code replaces it.
      password: "",
      ...tenantValue,
      attribution: answered ?? {},
      // Read from the DOM rather than from state: the whole point of the
      // honeypot is that only an automated filler touches it, and a bot that
      // sets `.value` directly never fires React's onChange.
      // A browser autofill that slipped past the attributes copies what the
      // person typed; a bot writes its own value. Only the latter is a trip.
      // Autofill fires an input event when it writes the trap (Fresno's phone
      // did, 21 Nov); a bot writing `.value` fires none. Only the bot counts:
      // the server answers a filled trap with a silent fake success, which a
      // real person would read as an email code that never arrives.
      companyWebsite: honeypotAutofilledRef.current
        ? ""
        : honeypotValue(honeypotRef.current?.value, [fullName, email, attribution.phone, tenantValue.companyName, tenantValue.cityState]),
      // 0 only if the mount effect somehow has not run; falling back to "now"
      // is the safe direction (a zero would read as an implausibly old form).
      formStartedAt: formStartedAtRef.current || Date.now(),
    });
  };

  /**
   * `tenant` mode's submit. No credentials to check — the account exists and is
   * already paid for — so only the three tenant answers are validated.
   */
  const handleTenantSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const repairedSlug = repairAddress();
    const found = tenantErrors(repairedSlug);
    setErrors(found ?? {});
    if (found) {
      captureValidationErrors(2, found);
      focusFirst(found, TENANT_FIELD_ORDER);
      return;
    }
    captureStepCompleted(2, { screen: "business_only" });
    onSubmitTenant(tenantValues(repairedSlug));
  };

  /**
   * `password` mode's submit. The checklist is the gate (it is exactly what
   * `signup-begin` enforces), then the second copy must match.
   */
  const handlePasswordSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!isPasswordAcceptable(password)) {
      const message = SIGNUP_ERROR_COPY.WEAK_PASSWORD;
      setErrors({ password: message });
      captureValidationErrors(4, { password: message });
      focusAndReveal(passwordRef.current);
      return;
    }
    if (confirmPassword !== password) {
      const message = confirmPassword ? "These passwords don't match." : "Type your password again to confirm it.";
      setConfirmError(message);
      captureValidationErrors(4, { passwordConfirm: message });
      focusAndReveal(confirmRef.current);
      return;
    }
    setErrors({});
    captureStepCompleted(4);
    onSubmitPassword?.(password);
  };

  /** `attribution` mode's submit: the question on its own. */
  const handleAttributionSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const found = validateAttribution(attribution);
    setErrors(found);
    const answered = attributionFromDraft(attribution);
    if (Object.keys(found).length > 0 || !answered) {
      focusFirst(found, ACCOUNT_FIELD_ORDER);
      return;
    }
    onSubmitAttribution(answered);
  };

  const attributionFields = (autoFocus: boolean) => (
    <HeardAboutFields
      value={attribution}
      errors={{
        heardAbout: fieldError("heardAbout"),
        heardAboutOther: fieldError("heardAboutOther"),
        phone: fieldError("phone"),
      }}
      busy={busy}
      autoFocus={autoFocus}
      onChange={(patch) => {
        setAttribution((prev) => ({ ...prev, ...patch }));
        markDirty();
      }}
      onClearError={(field: AttributionField) => clearFieldError(field)}
      heardAboutRef={heardAboutRef}
      otherRef={heardAboutOtherRef}
      phoneRef={phoneRef}
    />
  );

  /**
   * "Continue with Google" — nothing asked before the redirect.
   *
   * This validated the business name and web address first, because the far
   * side had nowhere to ask: the handoff stash rejected an empty draft, and the
   * return path bailed silently when it got one — signed in, stranded, with
   * only a console warning. That was a real constraint, and removing the check
   * without removing the constraint is exactly how this broke on 1 Oct.
   *
   * Both halves are now answered. The stash keeps a handoff that carries only
   * the plan, and `completeGoogleReturn` puts the dialog into `tenant` mode
   * when it comes back without a company name — the two fields and the terms,
   * asked once, after the identity exists and before the card.
   *
   * Whatever was typed first is still carried across: `tenantValues()` is sent
   * either way, so someone who filled the fields in before noticing the button
   * skips the second screen entirely.
   */
  const handleOauth = (provider: OauthProvider) => {
    if (busy) return;
    setErrors({});
    // An answer given before pressing the button crosses the redirect, so they
    // are not asked twice. Without one, the question comes straight after sign-in.
    onGoogle(tenantValues(), provider, attributionFromDraft(attribution));
  };

  const handleSignIn = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!signInPassword) {
      setSignInError("Please enter your password.");
      signInPasswordRef.current?.focus();
      return;
    }
    setSignInError(null);
    onSignIn({
      email: normalizeEmail(signInPrompt?.email ?? email),
      password: signInPassword,
    });
  };

  // -------------------------------------------------------------------------
  // Branch: this email already belongs to an operator (§5 row 1).
  //
  // Detected from either channel: the provider may surface it as a
  // `signInPrompt` or leave it as a step error, and the panel is the same
  // either way. There is nothing to sign in to HERE — their account lives on a
  // different host — so this panel offers no password field.
  // -------------------------------------------------------------------------
  const isStaffEmail =
    signInPrompt?.reason === "EMAIL_IS_STAFF" || error?.code === "EMAIL_IS_STAFF";

  if (isStaffEmail) {
    return (
      <div>
        <ScreenHead
          title="You already have a portal"
          lead="That email already runs a Drive247 portal. Sign in there, or give me a different email and I'll start a new one."
        />
        <ColumnActions>
          <ColumnButton type="button" onClick={onUseDifferentEmail}>
            Use a different email
          </ColumnButton>
          <ColumnLinks>
            <a href="mailto:support@drive-247.com" className={cn(SIGNUP_QUIET, SIGNUP_HIT)}>
              Email support
            </a>
          </ColumnLinks>
        </ColumnActions>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Branch: sign in to continue (§5 rows 3, 4, 5 and 57).
  // -------------------------------------------------------------------------
  if (signInPrompt) {
    const promptEmail = normalizeEmail(signInPrompt.email);

    // The reset detour replaces the sign-in form entirely rather than rendering
    // beneath it: leaving a live password field behind a reset panel invites the
    // browser's autofill to repopulate the credential the user is here to change.
    if (resetPanelOpen) {
      return (
        <PasswordResetPanel
          email={promptEmail}
          view={resetView}
          onViewChange={setResetView}
          cooldownUntil={resetCooldownUntil}
          onCooldownUntilChange={setResetCooldownUntil}
          onBusyChange={setResetBusy}
          onCancel={leaveReset}
          onDone={() => {
            leaveReset();
            // Keyed to the address it applies to, so switching accounts cannot
            // inherit someone else's success note.
            setResetDoneFor(promptEmail);
            // Clear any password typed before the reset — it is now wrong, and
            // submitting it would spend a sign-in attempt to be told so.
            setSignInPassword("");
          }}
        />
      );
    }

    const { title, body } = signInPanelCopy(signInPrompt.reason);
    const inlineSignInError =
      signInError ??
      (!staleServerError && error?.code === "SIGN_IN_FAILED"
        ? SIGNUP_ERROR_COPY.SIGN_IN_FAILED
        : null);

    return (
      <form id="signup-account-form" onSubmit={handleSignIn} noValidate>
        <ScreenHead title={title} lead={body} />

        {resetDoneFor === promptEmail && <PasswordResetSuccessNote />}

        <div className={cn(SIGNUP_FIELDS, ONE_COLUMN, UNDER_HEAD)}>
          <div>
            <Label htmlFor="signup-signin-email" className={SIGNUP_LABEL}>
              Email
            </Label>
            <Input
              id="signup-signin-email"
              name="email"
              type="email"
              autoComplete="username"
              value={signInPrompt.email}
              readOnly
              disabled
              className={cn(SIGNUP_INPUT, "mt-1")}
            />
          </div>

          <div>
            <Label htmlFor="signup-signin-password" className={SIGNUP_LABEL}>
              Password
            </Label>
            <div className="relative mt-1">
              <Input
                ref={signInPasswordRef}
                id="signup-signin-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                autoFocus
                value={signInPassword}
                disabled={busy}
                aria-invalid={Boolean(inlineSignInError)}
                aria-describedby={
                  inlineSignInError ? "signup-signin-password-error" : undefined
                }
                onChange={(e) => {
                  setSignInPassword(e.target.value);
                  setSignInError(null);
                  markDirty();
                }}
                className={cn(SIGNUP_INPUT, "pr-12")}
              />
              <PasswordToggle
                shown={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
              />
            </div>
            {inlineSignInError && (
              <FieldError id="signup-signin-password-error">{inlineSignInError}</FieldError>
            )}
          </div>
        </div>

        <ColumnActions>
          <ColumnButton busy={busy}>{busy ? "Signing in…" : "Sign in"}</ColumnButton>
          <ColumnLinks>
            <button type="button" disabled={busy} onClick={openReset} className={cn(SIGNUP_QUIET, SIGNUP_HIT, "max-sm:whitespace-nowrap")}>
              Forgot password?
            </button>
            <button type="button" disabled={busy} onClick={onUseDifferentEmail} className={cn(SIGNUP_QUIET, SIGNUP_HIT, "max-sm:whitespace-nowrap")}>
              Use a different email
            </button>
          </ColumnLinks>
        </ColumnActions>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  // Branch: `attribution` mode — signed in with Google, so they never
  // saw the question on the create-account form.
  // -------------------------------------------------------------------------
  if (mode === "attribution") {
    return (
      <form id="signup-account-form" onSubmit={handleAttributionSubmit} noValidate>
        <ScreenHead title="Two quick questions" />
        <div className={cn(SIGNUP_FIELDS, ONE_COLUMN, UNDER_HEAD)}>{attributionFields(true)}</div>
        <ColumnActions>
          <ColumnButton busy={busy}>Continue</ColumnButton>
        </ColumnActions>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  // Branch: `tenant` mode — the account exists and only the tenant details are
  // missing. Usually after payment; before it on the Google return or a reload
  // on the code screen, which is what `paid` tells apart.
  // -------------------------------------------------------------------------
  if (mode === "tenant") {
    return (
      <form id="signup-account-form" onSubmit={handleTenantSubmit} noValidate>
        <ScreenHead
          leadClassName="[@media(max-height:619px)]:hidden"
          title={paid ? "One last thing" : "Name your business"}
          lead={
            paid
              ? `Your ${plan.name} plan is active. Tell me what to call your business and I'll build your portal now.`
              : "Tell me what to call your business, then we'll set up payment."
          }
        />

        <div className={cn(SIGNUP_FIELDS, ONE_COLUMN, UNDER_HEAD)}>
          <TenantIdentityFields
            value={tenant}
            busy={busy}
            errors={{
              companyName: fieldError("companyName"),
              cityState: fieldError("cityState"),
              slug: fieldError("slug"),
              acceptedTerms: fieldError("acceptedTerms"),
            }}
            onChange={onTenantChange}
            onClearError={clearFieldError}
            onCheckSlug={onCheckSlug}
            onSlugStateChange={setSlugState}
            companyNameRef={companyNameRef}
            slugRef={slugRef}
            termsRef={termsRef}
            autoFocusCompanyName
            askCityState
            cityStateRef={cityStateRef}
          />
        </div>

        <ColumnActions>
          <ColumnButton busy={busy} disabled={!tenant.acceptedTerms}>
            {busy ? (paid ? "Setting up…" : "Saving…") : paid ? "Build my portal" : "Continue to payment"}
          </ColumnButton>
        </ColumnActions>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  // Branch: `password` mode — after the email code (Ghulam, 2026-11-23). The
  // account exists and is signed in; this replaces the random stand-in it was
  // created with by the password they will sign in to the portal with.
  // -------------------------------------------------------------------------
  if (mode === "password") {
    const passwordError = fieldError("password");
    const first = initialValues.fullName.trim().split(/\s+/)[0] ?? "";
    const login = normalizeEmail(initialValues.email);
    return (
      <form id="signup-account-form" onSubmit={handlePasswordSubmit} noValidate>
        {/* The username for the password manager, which otherwise goes
            looking for one and picks the wrong field (see the honeypot). */}
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={login}
          readOnly
          hidden
        />
        <ScreenHead
          title={first ? `Pick a password, ${first}` : "Choose a password"}
          lead={
            <>
              You&apos;ll use it with{" "}
              <span className="font-medium text-foreground">{login}</span> to sign in to your portal.
            </>
          }
        />

        <div className={cn(SIGNUP_FIELDS, ONE_COLUMN, UNDER_HEAD)}>
          <div>
            <Label htmlFor="signup-password" className={SIGNUP_LABEL}>
              Password
              <RequiredMark />
            </Label>
            <div className="relative mt-1">
              <Input
                ref={passwordRef}
                id="signup-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                autoFocus
                value={password}
                disabled={busy}
                aria-invalid={Boolean(passwordError)}
                aria-describedby="signup-password-rules"
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors((prev) => ({ ...prev, password: undefined }));
                  markDirty();
                }}
                className={cn(SIGNUP_INPUT, "pr-12")}
              />
              <PasswordToggle
                shown={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
              />
            </div>

            {/*
              Strength, right under the field it measures: four segments and a
              word. Advisory only — it never blocks; the checklist below is the
              gate (it is exactly what signup-begin enforces).
            */}
            <div className="mt-2.5 flex h-4 items-center gap-3" aria-hidden>
              <div className="flex flex-1 gap-1">
                {[0, 1, 2, 3].map((i) => {
                  const filled = password.length > 0 && i < Math.max(1, strength.score);
                  return (
                    <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                      <span
                        className={cn(
                          "block h-full origin-left rounded-full transition-transform duration-200 ease-out motion-reduce:transition-none",
                          STRENGTH_BAR_CLASS[strength.score],
                          filled ? "scale-x-100" : "scale-x-0",
                        )}
                      />
                    </span>
                  );
                })}
              </div>
              <span className="w-16 text-right text-xs font-medium text-muted-foreground">
                {password.length > 0 ? strength.label : ""}
              </span>
            </div>
            {passwordError && <FieldError>{passwordError}</FieldError>}
          </div>

          <div>
            <Label htmlFor="signup-password-confirm" className={SIGNUP_LABEL}>
              Confirm password
              <RequiredMark />
            </Label>
            <div className="relative mt-1">
              <Input
                ref={confirmRef}
                id="signup-password-confirm"
                name="passwordConfirm"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                disabled={busy}
                aria-invalid={Boolean(confirmError)}
                aria-describedby={confirmError ? "signup-password-confirm-error" : "signup-password-rules"}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setConfirmError(null);
                }}
                className={cn(SIGNUP_INPUT, "pr-12")}
              />
              <PasswordToggle shown={showPassword} onToggle={() => setShowPassword((v) => !v)} />
            </div>
            {confirmError && <FieldError id="signup-password-confirm-error">{confirmError}</FieldError>}
          </div>

          {/*
            The checklist: what the password needs, plus the match, drawn as
            the questions draw their answers (a small mark in the gutter, the
            label beside it). One polite live region, so a screen reader hears
            a change without an announcement per keystroke. One column: three
            in two columns left "Passwords match" alone on its own row
            (Ghulam, 2026-11-23).
          */}
          <ul
            id="signup-password-rules"
            aria-live="polite"
            className="col-span-full grid gap-2.5 [@media(max-height:700px)]:gap-2"
          >
            {[
              ...ruleState.map(({ rule, met }) => ({ id: rule.id, label: rule.label, met })),
              { id: "match", label: "Passwords match", met: confirmPassword.length > 0 && confirmPassword === password },
            ].map(({ id, label, met }) => (
              <li key={id} className="flex items-center gap-3 text-[14px]">
                <span
                  className={cn(
                    "flex size-[18px] shrink-0 items-center justify-center rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none",
                    met
                      ? "bg-indigo-600 text-white dark:bg-indigo-400 dark:text-[#0e0e14]"
                      : "text-transparent ring-1 ring-foreground/25",
                  )}
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span className={cn("transition-colors duration-200 ease-out motion-reduce:transition-none", met ? "text-foreground" : "text-muted-foreground")}>
                  {label}
                </span>
                <span className="sr-only">{met ? " — done" : " — not yet"}</span>
              </li>
            ))}
          </ul>
        </div>

        <ColumnActions>
          <ColumnButton busy={busy}>{busy ? "Saving…" : "Save password"}</ColumnButton>
        </ColumnActions>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  // Default: create the account — two pages of one form.
  //
  //   0  who you are   (one column: Google, "or", then name, email, the
  //                     optional question and phone, then Sign up)
  //   1  the business  (name, city and state, web address, terms; creates the
  //                     account and sends the code)
  //
  // Only page 1 submits to the server; page 0 checks its own fields and moves
  // on. The values live in this component, so going Back loses nothing, and an
  // error the server sends back for a field on page 0 takes the operator
  // straight to it (see the effect above). The password comes after the code.
  // -------------------------------------------------------------------------
  const nameError = fieldError("fullName");
  const emailError = fieldError("email");

  return (
    <form id="signup-account-form" onSubmit={handleCreateAccount} noValidate>
      {page === 0 && (
        <div key="page-0">
          <ScreenHead title="Let's get you on the road" />

          {/*
            Google first (Ghulam, 2026-11-23): one click and they are in, so
            it leads, and "or" separates it from the form below.
          */}
          {googleEnabled && (
            <div className={cn("signup-rise signup-rise-2 mt-12 [@media(min-height:701px)_and_(max-height:880px)]:mt-10 [@media(min-height:620px)_and_(max-height:700px)]:mt-10 [@media(max-height:619px)]:mt-5", ONE_COLUMN_WIDTH)}>
              {/*
                Google's sign-in branding: white with a #747775 hairline and
                #1F1F1F Roboto Medium in light, #131314 / #8E918F / #E3E3E3
                in dark, the full-colour "G" at 18px. The pill is one of
                Google's own button shapes.
              */}
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => handleOauth("google")}
                className={cn(
                  roboto.className,
                  "h-11 [@media(max-height:700px)]:h-10 w-full gap-2.5 rounded-full border-[#747775] bg-white px-6 text-[15px] font-medium text-[#1F1F1F] shadow-none transition-colors duration-200 ease-out hover:bg-[#f2f2f2] hover:text-[#1F1F1F] motion-reduce:transition-none dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:bg-[#2a2a2c] dark:hover:text-[#E3E3E3]",
                )}
              >
                <GoogleMark />
                Continue with Google
              </Button>
              {/* "OR", clear of the button and easy to see (Ghulam, 2026-11-23). */}
              <div role="separator" aria-label="or" className="mt-8 [@media(min-height:701px)_and_(max-height:880px)]:mt-6 [@media(min-height:620px)_and_(max-height:700px)]:mt-6 [@media(max-height:619px)]:mt-4 flex items-center gap-4 text-sm leading-none font-semibold tracking-[0.12em] text-foreground/70 uppercase dark:text-white/70">
                <span aria-hidden className="h-px flex-1 bg-foreground/20 dark:bg-white/20" />
                <span aria-hidden>or</span>
                <span aria-hidden className="h-px flex-1 bg-foreground/20 dark:bg-white/20" />
              </div>
            </div>
          )}

          {/* One column (Ghulam, 2026-11-23), with its own Sign up under it. */}
          <div className={cn(SIGNUP_FIELDS, ONE_COLUMN, googleEnabled ? "mt-8 [@media(min-height:701px)_and_(max-height:880px)]:mt-6 [@media(min-height:620px)_and_(max-height:700px)]:mt-6 [@media(max-height:619px)]:mt-4" : "mt-10 [@media(max-height:880px)]:mt-6")}>
            <div>
              <Label htmlFor="signup-full-name" className={SIGNUP_LABEL}>
                Your name
                <RequiredMark />
              </Label>
              <Input
                ref={fullNameRef}
                id="signup-full-name"
                name="fullName"
                type="text"
                autoComplete="name"
                autoFocus
                placeholder="Jordan Miller"
                value={fullName}
                disabled={busy}
                maxLength={FIELD_MAX.fullName}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? "signup-full-name-error" : undefined}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setErrors((prev) => ({ ...prev, fullName: undefined }));
                  markDirty();
                }}
                className={cn(SIGNUP_INPUT, "mt-1")}
              />
              {nameError && <FieldError id="signup-full-name-error">{nameError}</FieldError>}
            </div>

            <div>
              <Label htmlFor="signup-email" className={SIGNUP_LABEL}>
                Email
                <RequiredMark />
              </Label>
              <Input
                ref={emailRef}
                id="signup-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="you@yourcompany.com"
                value={email}
                disabled={busy}
                aria-invalid={Boolean(emailError)}
                aria-describedby={
                  emailError
                    ? "signup-email-error"
                    : emailSuggestion
                      ? "signup-email-suggestion"
                      : undefined
                }
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrors((prev) => ({ ...prev, email: undefined }));
                  setEmailSuggestion(null);
                  markDirty();
                }}
                // Suggest on blur, not on every keystroke: "did you mean gmail.com"
                // while someone is still typing "gm" is noise.
                onBlur={() => setEmailSuggestion(suggestEmailCorrection(email))}
                className={cn(SIGNUP_INPUT, "mt-1")}
              />
              {emailError ? (
                <FieldError id="signup-email-error">{emailError}</FieldError>
              ) : emailSuggestion ? (
                <p
                  id="signup-email-suggestion"
                  aria-live="polite"
                  className={cn("mt-1.5 text-[13px] text-muted-foreground", SIGNUP_ENTER)}
                >
                  Did you mean{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(emailSuggestion);
                      setEmailSuggestion(null);
                      emailRef.current?.focus();
                    }}
                    className="font-semibold text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-400"
                  >
                    {emailSuggestion}
                  </button>
                  ?
                </p>
              ) : null}
            </div>

            {attributionFields(false)}
          </div>

          {/*
            Sign up sits under the fields, in the same column, so this page
            does not also show the footer's arrow (onboarding-screen.tsx). It
            submits the form like the arrow did: the page checks its fields
            and moves on to the business. The way back in for someone who has
            already started comes after it.
          */}
          <ColumnActions>
            <ColumnButton busy={false} disabled={busy}>Sign up</ColumnButton>

            {/*
              A deliberate way back in for someone who has already started.

              Without this the sign-in panel was reachable only by ACCIDENT: fill in
              the whole form, submit, and have the server answer "that email already
              exists". A returning operator whose session had expired had no way to
              say "that's me, I have a password" — so the honest-looking action was
              the wrong one, and taking it burned a throttle slot to be told something
              they already knew.
            */}
            <p className="mt-2 text-center text-[13px] text-muted-foreground [@media(max-height:880px)]:mt-0.5">
              Already started?{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const typed = normalizeEmail(email);
                  if (!typed) {
                    // Nothing to sign in AS. Point at the field rather than opening
                    // a panel with an empty, read-only address.
                    setErrors((prev) => ({
                      ...prev,
                      email: "Enter your email address to sign in.",
                    }));
                    emailRef.current?.focus();
                    return;
                  }
                  onSignInInstead(typed);
                }}
                className="font-semibold text-indigo-600 underline-offset-4 hover:underline disabled:opacity-50 dark:text-indigo-400"
              >
                Sign in
              </button>
            </p>
          </ColumnActions>
        </div>
      )}

      {page === BUSINESS_PAGE && (
        <div key="page-business">
          {/*
            The tenant half. It sits BEFORE payment because a web address that
            turns out to be taken has to be fixable while changing it is still
            free — the previous design asked for it after the card was charged,
            which made a collision a dead end.
          */}
          <ScreenHead
            title="What's your business called?"
            // Short (Ghulam, 2026-11-23). "Can't be changed later" is said under
            // the web address itself.
            lead="I'll build your booking site with this name."
            leadClassName="[@media(max-height:619px)]:hidden"
          />

          {/* One column, its own Continue under it, like the first page. */}
          <div className={cn(SIGNUP_FIELDS, ONE_COLUMN, UNDER_HEAD)}>
            <TenantIdentityFields
              value={tenant}
              busy={busy}
              errors={{
                companyName: fieldError("companyName"),
                cityState: fieldError("cityState"),
                slug: fieldError("slug"),
                acceptedTerms: fieldError("acceptedTerms"),
              }}
              onChange={onTenantChange}
              onClearError={clearFieldError}
              onCheckSlug={onCheckSlug}
              onSlugStateChange={setSlugState}
              companyNameRef={companyNameRef}
              slugRef={slugRef}
              termsRef={termsRef}
              autoFocusCompanyName
              askCityState
              cityStateRef={cityStateRef}
            />
          </div>

          <ColumnActions>
            {/* Greyed out until the Terms are ticked, as the arrow was. */}
            <ColumnButton busy={busy} disabled={!tenant.acceptedTerms}>
              {/* Review 1 (V8): no code is sent at signup any more. */}
              {busy ? "Saving…" : "Continue"}
            </ColumnButton>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPage(page - 1)}
              className={cn(SIGNUP_QUIET, SIGNUP_HIT, "mx-auto mt-2 px-2 [@media(max-height:880px)]:mt-0.5")}
            >
              Back
            </button>
          </ColumnActions>
        </div>
      )}

      {/*
        Honeypot. LAST in the form on purpose: Chrome's password manager
        treats the text field just before a password field as the username
        and fills it. On the password page this was that field, so every
        saved-login visitor tripped the trap and was silently refused.
        Positioned off-screen rather than `display: none` — a fair
        number of crawlers skip inputs that are display:none or hidden, which
        defeats the entire trap. `tabIndex={-1}` and `aria-hidden` keep it away
        from keyboard and screen-reader users. Rendered on every page so the
        value read at submit is the one a bot filled in on page 0.
      */}
      {/*
        The name means nothing ON PURPOSE. It was `companyWebsite`, and Chrome's
        address autofill files any field with "company" in its name as the
        business name and fills it alongside name and email, so real people
        tripped the trap. Password managers are told to skip it too. Only the
        request body key (`companyWebsite`) is part of the server contract.
      */}
      <input
        ref={honeypotRef}
        type="text"
        name="hp_x7"
        onInput={() => {
          honeypotAutofilledRef.current = true;
        }}
        tabIndex={-1}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore=""
        data-bwignore=""
        data-form-type="other"
        aria-hidden="true"
        className="pointer-events-none absolute left-[-9999px] h-0 w-0 opacity-0"
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

/**
 * Google's mark, inline.
 *
 * Inline rather than a remote asset because Google's brand guidelines require
 * the four-colour mark to be shown unaltered on the button, and an <img> to
 * fonts.gstatic/ssl.gstatic would be a third-party request on the highest-intent
 * form on the site — one that fails silently behind a content blocker and leaves
 * an unlabelled button.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="size-[18px] shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * Four different situations put the user on the sign-in panel, and the honest
 * copy for each is different. All four offer the same "Forgot password?" link:
 * recovery is handled out-of-band by the `signup-password-reset` edge function,
 * which mints and emails its own 6-digit code, so the link promises nothing that
 * depends on `custom-auth-email` (which does skip GoTrue's recovery mail).
 */
function signInPanelCopy(reason: string): { title: string; body: string } {
  switch (reason) {
    case "EMAIL_IN_SIGNUP":
      return {
        title: "Welcome back",
        body: SIGNUP_ERROR_COPY.EMAIL_IN_SIGNUP,
      };
    case "EMAIL_EXISTS_SIGN_IN":
      return {
        title: "Welcome back",
        body: SIGNUP_ERROR_COPY.EMAIL_EXISTS_SIGN_IN,
      };
    case "SESSION_LOST":
    case "UNAUTHENTICATED":
      return {
        title: "Please sign in again",
        body: SIGNUP_ERROR_COPY.SESSION_LOST,
      };
    default:
      return {
        title: "Sign in to continue",
        body: SIGNUP_ERROR_COPY.EMAIL_EXISTS_SIGN_IN,
      };
  }
}
