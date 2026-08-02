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
 * There is deliberately no "confirm password" field — see the show/hide toggle
 * below.
 */

import * as React from "react";
import {
  Check,
  Circle,
  Eye,
  EyeOff,
  Loader2,
  UserRound,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AccountStepProps } from "@/components/onboarding/onboarding-types";
import { SIGNUP_ERROR_COPY } from "@/components/onboarding/onboarding-types";
import {
  ACCOUNT_FIELD_ORDER,
  FIELD_MAX,
  firstErrorField,
  normalizeEmail,
  passwordRuleState,
  passwordStrength,
  suggestEmailCorrection,
  validateAccount,
  type AccountField,
  type FieldErrors,
} from "@/lib/signup-validation";
import {
  PasswordResetPanel,
  PasswordResetSuccessNote,
} from "@/components/onboarding/steps/password-reset-panel";

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
};

export function AccountStep({
  plan,
  initialValues,
  signInPrompt,
  busy,
  error,
  onSubmit,
  onSignIn,
  onUseDifferentEmail,
}: AccountStepProps) {
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
  const [resetDone, setResetDone] = React.useState(false);

  const honeypotRef = React.useRef<HTMLInputElement>(null);
  const fullNameRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const signInPasswordRef = React.useRef<HTMLInputElement>(null);

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

    const values = { fullName, email, password };
    const nextErrors = validateAccount(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      const first = firstErrorField(nextErrors, ACCOUNT_FIELD_ORDER);
      const target =
        first === "fullName"
          ? fullNameRef.current
          : first === "email"
            ? emailRef.current
            : passwordRef.current;
      target?.focus();
      return;
    }

    onSubmit({
      fullName: fullName.trim(),
      email: normalizeEmail(email),
      password,
      // Read from the DOM rather than from state: the whole point of the
      // honeypot is that only an automated filler touches it, and a bot that
      // sets `.value` directly never fires React's onChange.
      companyWebsite: honeypotRef.current?.value ?? "",
      // 0 only if the mount effect somehow has not run; falling back to "now"
      // is the safe direction (a zero would read as an implausibly old form).
      formStartedAt: formStartedAtRef.current || Date.now(),
    });
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
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
        <div className="flex size-10 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/40">
          <UserRound className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h3 className="mt-4 text-lg font-semibold tracking-tight">
          You already have a Drive247 portal
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This email is already set up as an operator account. Sign in at your
          portal, or use a different email address to start a new one.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            onClick={onUseDifferentEmail}
            className="bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            Use a different email
          </Button>
          <Button asChild variant="ghost">
            <a href="/strategy-call">Talk to us</a>
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Branch: sign in to continue (§5 rows 3, 4, 5 and 57).
  // -------------------------------------------------------------------------
  if (signInPrompt) {
    // The reset detour replaces the sign-in form entirely rather than rendering
    // beneath it: leaving a live password field behind a reset panel invites the
    // browser's autofill to repopulate the credential the user is here to change.
    if (resetOpen) {
      return (
        <PasswordResetPanel
          email={normalizeEmail(signInPrompt.email)}
          onCancel={() => setResetOpen(false)}
          onDone={() => {
            setResetOpen(false);
            setResetDone(true);
            // Clear any password typed before the reset — it is now wrong, and
            // submitting it would spend a sign-in attempt to be told so.
            setSignInPassword("");
            setSignInError(null);
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
      <form
        id="signup-account-form"
        onSubmit={handleSignIn}
        noValidate
        className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
      >
        <div className="flex size-10 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/40">
          <UserRound className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h3 className="mt-4 text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>

        {resetDone && <PasswordResetSuccessNote />}

        <div className="mt-5 space-y-4">
          <div>
            <Label htmlFor="signup-signin-email">Email</Label>
            <Input
              id="signup-signin-email"
              name="email"
              type="email"
              autoComplete="username"
              value={signInPrompt.email}
              readOnly
              disabled
              className="mt-1.5 h-10"
            />
          </div>

          <div>
            <Label htmlFor="signup-signin-password">Password</Label>
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
                className="h-10 pr-10"
              />
              <PasswordToggle
                shown={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
              />
            </div>
            {inlineSignInError && (
              <p
                id="signup-signin-password-error"
                role="alert"
                className="mt-1.5 text-sm text-red-600 dark:text-red-400"
              >
                {inlineSignInError}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="submit"
            disabled={busy}
            className="bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Continue"
            )}
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={busy}
            onClick={onUseDifferentEmail}
            className="text-indigo-600 dark:text-indigo-400"
          >
            Use a different email
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={busy}
            onClick={() => setResetOpen(true)}
            className="text-muted-foreground"
          >
            Forgot password?
          </Button>
        </div>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  // Default: create the account.
  // -------------------------------------------------------------------------
  const nameError = fieldError("fullName");
  const emailError = fieldError("email");
  const passwordError = fieldError("password");

  return (
    <form
      id="signup-account-form"
      onSubmit={handleCreateAccount}
      noValidate
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
    >
      {/* Plan reminder — the user picked a card several scroll-lengths ago. */}
      <div className="flex items-center gap-2.5 rounded-lg border border-indigo-200/60 bg-indigo-50/30 p-3 dark:border-indigo-800/30 dark:bg-indigo-950/20">
        <Zap className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
        <p className="text-sm">
          <span className="font-medium">{plan.name}</span>
          <span className="text-muted-foreground">
            {" · "}${plan.priceUsd}/month · {plan.fleetBand}
          </span>
        </p>
      </div>

      {/*
        Honeypot. Positioned off-screen rather than `display: none` — a fair
        number of crawlers skip inputs that are display:none or hidden, which
        defeats the entire trap. `tabIndex={-1}` and `aria-hidden` keep it away
        from keyboard and screen-reader users.
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

      <div className="mt-5 space-y-4">
        <div>
          <Label htmlFor="signup-full-name">
            Full name
            <span className="text-indigo-600 dark:text-indigo-400">*</span>
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
            className="mt-1.5 h-10"
          />
          {nameError && (
            <p
              id="signup-full-name-error"
              role="alert"
              className="mt-1.5 text-sm text-red-600 dark:text-red-400"
            >
              {nameError}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="signup-email">
            Work email
            <span className="text-indigo-600 dark:text-indigo-400">*</span>
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
            className="mt-1.5 h-10"
          />
          {emailError ? (
            <p
              id="signup-email-error"
              role="alert"
              className="mt-1.5 text-sm text-red-600 dark:text-red-400"
            >
              {emailError}
            </p>
          ) : emailSuggestion ? (
            <p
              id="signup-email-suggestion"
              aria-live="polite"
              className="mt-1.5 text-sm text-muted-foreground"
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
            <p
              id="signup-email-help"
              className="mt-1.5 text-xs text-muted-foreground"
            >
              This becomes the owner login for your portal.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="signup-password">
            Password
            <span className="text-indigo-600 dark:text-indigo-400">*</span>
          </Label>
          <div className="relative mt-1.5">
            <Input
              ref={passwordRef}
              id="signup-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              disabled={busy}
              aria-invalid={Boolean(passwordError)}
              aria-describedby="signup-password-rules signup-password-help"
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((prev) => ({ ...prev, password: undefined }));
                markDirty();
              }}
              className="h-10 pr-10"
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
          <div
            id="signup-password-rules"
            aria-live="polite"
            className="mt-2.5 space-y-1.5"
          >
            {ruleState.map(({ rule, met }) => (
              <p
                key={rule.id}
                className={cn(
                  "flex items-center gap-2 text-xs",
                  met
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-muted-foreground",
                )}
              >
                {met ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Circle className="h-3.5 w-3.5 shrink-0 opacity-50" />
                )}
                {rule.label}
                <span className="sr-only">{met ? " — met" : " — not met"}</span>
              </p>
            ))}

            {password.length > 0 && (
              <div className="flex items-center gap-2 pt-0.5">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      STRENGTH_BAR_CLASS[strength.score],
                    )}
                    style={{ width: `${strength.percent}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {strength.label}
                </span>
              </div>
            )}
          </div>

          {passwordError && (
            <p role="alert" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
              {passwordError}
            </p>
          )}

          <p
            id="signup-password-help"
            className="mt-1.5 text-xs text-muted-foreground"
          >
            You&apos;ll use this to sign in to your portal.
          </p>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

/**
 * There is no "confirm password" field anywhere in this flow, and that is a
 * decision rather than an omission. Confirm fields exist to compensate for
 * masked input; a show/hide toggle removes the masking instead, so the user can
 * simply read what they typed. That deletes the entire mismatch failure mode
 * rather than adding a second field to catch it.
 */
function PasswordToggle({
  shown,
  onToggle,
}: {
  shown: boolean;
  onToggle(): void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={shown ? "Hide password" : "Show password"}
      className="absolute right-1 top-1 text-muted-foreground hover:text-foreground"
    >
      {shown ? (
        <EyeOff className="h-4 w-4" />
      ) : (
        <Eye className="h-4 w-4" />
      )}
    </Button>
  );
}

const STRENGTH_BAR_CLASS: Record<number, string> = {
  0: "bg-red-500",
  1: "bg-red-500",
  2: "bg-amber-500",
  3: "bg-indigo-500",
  4: "bg-indigo-600 dark:bg-indigo-400",
};

/**
 * Four different situations put the user on the sign-in panel, and the honest
 * copy for each is different. Notably NONE of them offers a password-reset
 * link: `custom-auth-email` skips recovery mail, so a "reset it" link would
 * promise an email this platform does not send.
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
