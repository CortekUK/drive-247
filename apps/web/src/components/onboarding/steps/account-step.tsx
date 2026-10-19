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
 * There is deliberately no "confirm password" field on THIS form. Confirm fields
 * exist to compensate for masked input; the show/hide toggle removes the masking
 * instead, so the user can simply read what they typed, which deletes the
 * mismatch failure mode rather than adding a second field to catch it. The reset
 * panel next door does carry one, and that is not an inconsistency: a reset is a
 * blind change to a credential the user cannot currently sign in with, so a typo
 * there locks them out of a portal they are already paying for, with no wrong
 * password on file to fall back to.
 */

import * as React from "react";
import { Check, Circle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type {
  AccountStepProps,
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
import {
  ACCOUNT_FIELD_ORDER,
  FIELD_MAX,
  firstErrorField,
  normalizeEmail,
  normalizeSlugClient,
  passwordRuleState,
  passwordStrength,
  suggestEmailCorrection,
  TENANT_FIELD_ORDER,
  validateAccount,
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
  KeyArt,
  PasswordArt,
  SiteArt,
  WelcomeArt,
} from "@/components/onboarding/signup-art";
import {
  FieldError,
  ScreenHead,
  SIGNUP_ENTER,
  SIGNUP_INPUT,
  SIGNUP_LABEL,
  SIGNUP_PRIMARY,
  SIGNUP_QUIET,
} from "@/components/onboarding/signup-ui";

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
   * 1 password, 2 business). Held by the shell, which draws the progress and
   * the Back button for it; the step falls back to its own state when it is
   * rendered without one.
   */
  page?: number;
  onPageChange?(page: number): void;
}

/** The create-account form's pages, and which page owns each field. */
export const ACCOUNT_PAGE_COUNT = 3;
const LAST_ACCOUNT_PAGE = ACCOUNT_PAGE_COUNT - 1;
const PAGE_FIELDS: readonly (readonly AccountField[])[] = [
  ["fullName", "email"],
  ["password"],
  ["companyName", "slug", "acceptedTerms"],
];
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
  onGoogle,
  onCheckSlug,
  onSignIn,
  onUseDifferentEmail,
  onSignInInstead,
  onResetStateChange,
  onClearError,
  page: pageProp,
  onPageChange,
}: AccountStepShellProps) {
  const [ownPage, setOwnPage] = React.useState(0);
  const page = pageProp ?? ownPage;
  const setPage = onPageChange ?? setOwnPage;
  const [fullName, setFullName] = React.useState(initialValues.fullName);
  const [email, setEmail] = React.useState(initialValues.email);
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
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
  const fullNameRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const signInPasswordRef = React.useRef<HTMLInputElement>(null);
  const companyNameRef = React.useRef<HTMLInputElement>(null);
  const slugRef = React.useRef<HTMLInputElement>(null);
  const termsRef = React.useRef<HTMLButtonElement>(null);

  /**
   * The live verdict from the address field, mirrored up so submit can act on
   * it. Submitting a slug we have ALREADY been told is taken would create the
   * auth user and charge the card before the collision surfaced — at which point
   * the operator is paying to be told something the form knew a minute ago.
   */
  const [slugState, setSlugState] = React.useState<SlugState>({ kind: "idle" });

  /** The three tenant answers, normalised the way the provider will send them. */
  const tenantValues = (): TenantFormValues => ({
    companyName: tenant.companyName.trim(),
    slug: normalizeSlugClient(tenant.slug),
    acceptedTerms: tenant.acceptedTerms,
  });

  /**
   * Validate the tenant half and, if it passes, refuse a slug the field has
   * already reported unavailable. Returns the errors to render, or null when it
   * is safe to submit.
   */
  const tenantErrors = (): FieldErrors<AccountField> | null => {
    const found = validateTenant(tenantValues());
    if (slugState.kind === "unavailable" && !found.slug) {
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
        : field === "password"
          ? passwordRef.current
          : field === "companyName"
            ? companyNameRef.current
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
    refFor(field)?.focus();
    // refFor reads refs only; the page is what makes the target exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  /** Focus whichever field the first error belongs to, changing page if needed. */
  const focusFirst = (
    found: FieldErrors<AccountField>,
    order: readonly AccountField[],
  ) => {
    const first = firstErrorField(found, order);
    if (!first) return;
    if (mode !== "tenant" && !signInPrompt && pageOf(first) !== page) {
      pendingFocusRef.current = first;
      setPage(pageOf(first));
      return;
    }
    refFor(first)?.focus();
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
    if (mode === "tenant" || signInPrompt) return;
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

    const tenantValue = tenantValues();

    // Pages 0 and 1 check only their own fields, then move on. Nothing is sent.
    if (page < LAST_ACCOUNT_PAGE) {
      const all = validateAccount({ fullName, email, password, ...tenantValue });
      const pageErrors: FieldErrors<AccountField> = {};
      for (const field of PAGE_FIELDS[page]) {
        if (all[field]) pageErrors[field] = all[field];
      }
      setErrors(pageErrors);
      if (Object.keys(pageErrors).length > 0) {
        focusFirst(pageErrors, ACCOUNT_FIELD_ORDER);
        return;
      }
      setPage(page + 1);
      return;
    }

    const nextErrors: FieldErrors<AccountField> = {
      ...validateAccount({ fullName, email, password, ...tenantValue }),
      ...(tenantErrors() ?? {}),
    };
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      focusFirst(nextErrors, ACCOUNT_FIELD_ORDER);
      return;
    }

    onSubmit({
      fullName: fullName.trim(),
      email: normalizeEmail(email),
      password,
      ...tenantValue,
      // Read from the DOM rather than from state: the whole point of the
      // honeypot is that only an automated filler touches it, and a bot that
      // sets `.value` directly never fires React's onChange.
      companyWebsite: honeypotRef.current?.value ?? "",
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
    const found = tenantErrors();
    setErrors(found ?? {});
    if (found) {
      focusFirst(found, TENANT_FIELD_ORDER);
      return;
    }
    onSubmitTenant(tenantValues());
  };

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
  const handleGoogle = () => {
    if (busy) return;
    setErrors({});
    onGoogle(tenantValues());
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
      <div className={SIGNUP_ENTER}>
        <ScreenHead
          art={<KeyArt />}
          title="You already have a portal"
          lead="That email already runs a Drive247 portal. Sign in there, or give me a different email and I'll start a new one."
        />
        <div className="mt-6 space-y-3">
          <Button type="button" onClick={onUseDifferentEmail} className={SIGNUP_PRIMARY}>
            Use a different email
          </Button>
          <a href="/strategy-call" className={cn(SIGNUP_QUIET, "block text-center")}>
            Talk to us
          </a>
        </div>
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
      <form id="signup-account-form" onSubmit={handleSignIn} noValidate className={SIGNUP_ENTER}>
        <ScreenHead art={<KeyArt />} title={title} lead={body} />

        {resetDoneFor === promptEmail && <PasswordResetSuccessNote />}

        <div className="mt-6 space-y-3.5">
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
              className={cn(SIGNUP_INPUT, "mt-1.5")}
            />
          </div>

          <div>
            <Label htmlFor="signup-signin-password" className={SIGNUP_LABEL}>
              Password
            </Label>
            <div className="relative mt-1.5">
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

        <div className="mt-6 space-y-3.5">
          <Button type="submit" disabled={busy} className={SIGNUP_PRIMARY}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Continue"
            )}
          </Button>
          <div className="flex items-center justify-between gap-3">
            <button type="button" disabled={busy} onClick={onUseDifferentEmail} className={SIGNUP_QUIET}>
              Use a different email
            </button>
            <button type="button" disabled={busy} onClick={openReset} className={SIGNUP_QUIET}>
              Forgot password?
            </button>
          </div>
        </div>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  // Branch: `tenant` mode — the account exists and is paid for, and only the
  // tenant details are missing. See `AccountStepMode`.
  // -------------------------------------------------------------------------
  if (mode === "tenant") {
    return (
      <form id="signup-account-form" onSubmit={handleTenantSubmit} noValidate className={SIGNUP_ENTER}>
        <ScreenHead
          art={<SiteArt company={tenant.companyName} slug={tenant.slug} />}
          title="One last thing"
          lead={`Your ${plan.name} plan is active. Tell me what to call your business and I'll build your portal now.`}
        />

        <div className="mt-6 space-y-4">
          <TenantIdentityFields
            value={tenant}
            busy={busy}
            errors={{
              companyName: fieldError("companyName"),
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
          />
        </div>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  // Default: create the account — three pages of one form.
  //
  //   0  who you are   (Google, or name + email)
  //   1  a password
  //   2  the business  (name, web address, terms)
  //
  // Only page 2 submits to the server; pages 0 and 1 check their own fields
  // and move on. The values live in this component, so going Back loses
  // nothing, and an error the server sends back for a field on an earlier page
  // takes the operator straight to that page (see the effect above).
  // -------------------------------------------------------------------------
  const nameError = fieldError("fullName");
  const emailError = fieldError("email");
  const passwordError = fieldError("password");
  const firstName = fullName.trim().split(/\s+/)[0] ?? "";

  return (
    <form id="signup-account-form" onSubmit={handleCreateAccount} noValidate>
      {/*
        Honeypot. Positioned off-screen rather than `display: none` — a fair
        number of crawlers skip inputs that are display:none or hidden, which
        defeats the entire trap. `tabIndex={-1}` and `aria-hidden` keep it away
        from keyboard and screen-reader users. Rendered on every page so the
        value read at submit is the one a bot filled in on page 0.
      */}
      <input
        ref={honeypotRef}
        type="text"
        name="companyWebsite"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="pointer-events-none absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      {page === 0 && (
        <div key="page-0" className={SIGNUP_ENTER}>
          <ScreenHead
            art={<WelcomeArt />}
            title="Let's get you on the road"
            lead="I'm Trax. Tell me who you are and I'll have your portal and booking site ready in a few minutes."
          />

          {googleEnabled && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={handleGoogle}
                className="mt-6 h-11 w-full rounded-xl border-zinc-200 text-[15px] font-medium shadow-none transition-colors duration-200 dark:border-white/10"
              >
                <GoogleMark />
                Continue with Google
              </Button>

              <div className="mt-5 flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">or with email</span>
                <Separator className="flex-1" />
              </div>
            </>
          )}

          <div className={cn("space-y-3.5", googleEnabled ? "mt-5" : "mt-6")}>
            <div>
              <Label htmlFor="signup-full-name" className={SIGNUP_LABEL}>
                Your name
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
                className={cn(SIGNUP_INPUT, "mt-1.5")}
              />
              {nameError && <FieldError id="signup-full-name-error">{nameError}</FieldError>}
            </div>

            <div>
              <Label htmlFor="signup-email" className={SIGNUP_LABEL}>
                Work email
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
                      : "signup-email-help"
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
                className={cn(SIGNUP_INPUT, "mt-1.5")}
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
              ) : (
                <p id="signup-email-help" className="mt-1.5 text-[13px] text-muted-foreground">
                  This becomes the owner login for your portal.
                </p>
              )}
            </div>
          </div>

          {/*
            A deliberate way back in for someone who has already started.

            Without this the sign-in panel was reachable only by ACCIDENT: fill in
            the whole form, submit, and have the server answer "that email already
            exists". A returning operator whose session had expired had no way to
            say "that's me, I have a password" — so the honest-looking action was
            the wrong one, and taking it burned a throttle slot to be told something
            they already knew.
          */}
          <p className="mt-4 text-center text-[13px] text-muted-foreground">
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
        </div>
      )}

      {page === 1 && (
        <div key="page-1" className={SIGNUP_ENTER}>
          <ScreenHead
            art={<PasswordArt length={password.length} ready={ruleState.every((r) => r.met)} name={fullName} />}
            title={firstName ? `Nice to meet you, ${firstName}` : "Choose a password"}
            lead={
              <>
                Pick a password. You&apos;ll use it with{" "}
                <span className="font-medium text-foreground">{normalizeEmail(email)}</span> to sign in to your portal.
              </>
            }
          />

          <div className="mt-6">
            <Label htmlFor="signup-password" className={SIGNUP_LABEL}>
              Password
            </Label>
            <div className="relative mt-1.5">
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
              Live requirement checklist + strength meter. The checklist is the
              gate (it is exactly what signup-begin enforces); the meter is
              advisory and never blocks. Both are inside one polite live region so
              a screen reader hears the state change without a separate
              announcement per keystroke.
            */}
            <div id="signup-password-rules" aria-live="polite" className="mt-3">
              <div className="flex flex-wrap gap-2">
                {ruleState.map(({ rule, met }) => (
                  <span
                    key={rule.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-200 ease-out motion-reduce:transition-none",
                      met
                        ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300"
                        : "border-zinc-200 text-muted-foreground dark:border-white/10",
                    )}
                  >
                    {met ? <Check className="h-3 w-3 shrink-0" /> : <Circle className="h-3 w-3 shrink-0 opacity-50" />}
                    {rule.label}
                    <span className="sr-only">{met ? " — met" : " — not met"}</span>
                  </span>
                ))}
              </div>

              <div className="mt-3 flex h-4 items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10">
                  <div
                    className={cn(
                      "h-full origin-left rounded-full transition-[width,background-color] duration-200 ease-out motion-reduce:transition-none",
                      STRENGTH_BAR_CLASS[strength.score],
                    )}
                    style={{ width: password.length > 0 ? `${strength.percent}%` : "0%" }}
                  />
                </div>
                <span className="w-14 text-right text-xs text-muted-foreground">
                  {password.length > 0 ? strength.label : ""}
                </span>
              </div>
            </div>

            {passwordError && <FieldError>{passwordError}</FieldError>}
          </div>
        </div>
      )}

      {page === 2 && (
        <div key="page-2" className={SIGNUP_ENTER}>
          {/*
            The tenant half. It sits BEFORE payment because a web address that
            turns out to be taken has to be fixable while changing it is still
            free — the previous design asked for it after the card was charged,
            which made a collision a dead end.
          */}
          <ScreenHead
            art={<SiteArt company={tenant.companyName} slug={tenant.slug} />}
            title="What's your business called?"
            lead="I'll build your booking site under this name. The web address is yours for good."
          />

          <div className="mt-6 space-y-4">
            <TenantIdentityFields
              value={tenant}
              busy={busy}
              errors={{
                companyName: fieldError("companyName"),
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
            />
          </div>
        </div>
      )}
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
    <svg viewBox="0 0 18 18" aria-hidden="true" className="h-4 w-4 shrink-0">
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
