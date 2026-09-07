"use client";

/**
 * Step 1 of the dialog — the account.
 *
 * Everything on this screen is the real thing except the network:
 *
 * - `validateAccount` is the exact function the live form calls, so the rules,
 *   the wording and the field order are identical.
 * - `<TenantIdentityFields>` is the live component, imported unmodified. That is
 *   what gives genuine live availability checking on the web address, with the
 *   real debounce, the real stale-response guard and the real suggestion chips —
 *   the only substitution is `checkSlugAvailability` in place of the
 *   `signup-slug-check` edge function, because that function refuses any caller
 *   who is not already a real auth user with a signup in flight.
 * - The password rules and strength meter are the live ones.
 *
 * What is NOT real: pressing Continue creates nothing. `signup-begin` is never
 * called, so no `auth.users` row, no signup metadata and no Stripe customer come
 * into existence.
 *
 * THE THREE CREDENTIAL FIELDS ARE CONTROLLED FROM THE SHELL, not held here.
 * The dialog can be dismissed at any moment, which unmounts this component —
 * local state would mean someone who pressed Escape to re-read a plan came back
 * to an empty form. The tenant draft was already lifted for the same reason.
 *
 * THE SOCIAL BUTTONS lead the screen because that is the order operators expect
 * — Google, Apple, then "or", then the form. They are presentational: neither
 * starts an OAuth round trip (`signup-begin-oauth` is never called), and neither
 * dead-ends. Pressing one says where it is up to and moves focus into the form,
 * which is the graceful behaviour and the honest one.
 */

import * as React from "react";
import { ArrowRight, Check, Circle } from "lucide-react";

import {
  PasswordToggle,
  STRENGTH_BAR_CLASS,
} from "@/components/onboarding/password-toggle";
import type { BusinessDraft } from "@/components/onboarding/onboarding-types";
import {
  TenantIdentityFields,
  type SlugState,
} from "@/components/onboarding/tenant-identity-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { checkSlugAvailability } from "@/lib/signup-journey";
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
import { cn } from "@/lib/utils";

export interface JourneyCredentials {
  fullName: string;
  email: string;
  password: string;
}

interface JourneyAccountStepProps {
  values: JourneyCredentials;
  onValuesChange(values: JourneyCredentials): void;
  tenant: BusinessDraft;
  onTenantChange(patch: Partial<BusinessDraft>): void;
  onSubmit(): void;
}

export function JourneyAccountStep({
  values,
  onValuesChange,
  tenant,
  onTenantChange,
  onSubmit,
}: JourneyAccountStepProps) {
  const { fullName, email, password } = values;

  const [showPassword, setShowPassword] = React.useState(false);
  const [emailSuggestion, setEmailSuggestion] = React.useState<string | null>(
    null,
  );
  const [errors, setErrors] = React.useState<FieldErrors<AccountField>>({});
  const [socialNote, setSocialNote] = React.useState<string | null>(null);

  /**
   * Reported up from `<TenantIdentityFields>` so submit can refuse an address
   * the field has already shown as taken — otherwise this would sail past the
   * one check it just spent 400 ms performing.
   *
   * `setSlugState` is passed raw: the child calls it from an effect keyed on its
   * own identity, so anything less stable than a `useState` setter would loop.
   */
  const [slugState, setSlugState] = React.useState<SlugState>({ kind: "idle" });

  const fullNameRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const companyNameRef = React.useRef<HTMLInputElement>(null);
  const slugRef = React.useRef<HTMLInputElement>(null);
  const termsRef = React.useRef<HTMLButtonElement>(null);

  const ruleState = passwordRuleState(password);
  const strength = passwordStrength(password);

  const patch = (next: Partial<JourneyCredentials>) => {
    onValuesChange({ ...values, ...next });
  };

  const clearFieldError = React.useCallback((field: AccountField) => {
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }, []);

  /**
   * Focus the field a validation failure named.
   *
   * Written as a switch over the *dereferenced* element rather than a
   * `Record<AccountField, RefObject<HTMLElement | null>>` lookup: `RefObject<T>`
   * is invariant, so a map typed that loosely refuses every one of these refs.
   */
  const focusField = (field: AccountField | null) => {
    if (!field) return;
    const element: HTMLElement | null =
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
    element?.focus();
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const found = validateAccount({
      fullName,
      email,
      password,
      companyName: tenant.companyName,
      slug: tenant.slug,
      acceptedTerms: tenant.acceptedTerms,
    });

    // The live availability verdict is not something `validateAccount` can see,
    // so it is folded in here — exactly as the real step does.
    if (!found.slug && slugState.kind === "unavailable") {
      found.slug =
        slugState.reason === "taken"
          ? "That web address is already taken. Try one of the suggestions."
          : slugState.reason === "reserved"
            ? "That web address is reserved. Please choose another one."
            : "Use lowercase letters, numbers and hyphens, starting with a letter.";
    }

    if (Object.keys(found).length > 0) {
      setErrors(found);
      focusField(firstErrorField(found, ACCOUNT_FIELD_ORDER));
      return;
    }

    // Tidied on the way out, so the next screens quote back what will actually
    // be used rather than whatever spacing was typed.
    onValuesChange({
      fullName: fullName.trim(),
      email: normalizeEmail(email),
      password,
    });
    onSubmit();
  };

  /**
   * What a social button does today. It never leaves the page, never calls
   * `signup-begin-oauth`, and never lands the operator on an error — it says
   * where that provider is up to and puts the cursor where they can carry on.
   */
  const handleSocial = (provider: "Google" | "Apple") => {
    setSocialNote(
      `${provider} sign-up is coming shortly. Use your email address below and I'll take it from there.`,
    );
    fullNameRef.current?.focus();
  };

  const nameError = errors.fullName;
  const emailError = errors.email;
  const passwordError = errors.password;

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* ── social first ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => handleSocial("Google")}
          className="h-12 w-full justify-center gap-3 text-[15px] font-medium"
        >
          <GoogleMark />
          Sign up with Google
        </Button>

        <Button
          type="button"
          size="lg"
          onClick={() => handleSocial("Apple")}
          className={cn(
            "h-12 w-full justify-center gap-3 text-[15px] font-medium",
            "bg-black text-white hover:bg-black/85",
            "dark:bg-white dark:text-black dark:hover:bg-white/90",
          )}
        >
          <AppleMark />
          Sign up with Apple
        </Button>
      </div>

      <div aria-live="polite">
        {socialNote && (
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            {socialNote}
          </p>
        )}
      </div>

      <div className="mt-7 flex items-center gap-4">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      {/* ── email and password ───────────────────────────────────────────── */}
      <div className="mt-7 space-y-5">
        <div>
          <Label htmlFor="journey-full-name">
            Full name
            <span className="text-indigo-600 dark:text-indigo-400">*</span>
          </Label>
          <Input
            ref={fullNameRef}
            id="journey-full-name"
            name="fullName"
            type="text"
            autoComplete="name"
            placeholder="Jordan Miller"
            value={fullName}
            maxLength={FIELD_MAX.fullName}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? "journey-full-name-error" : undefined}
            onChange={(e) => {
              patch({ fullName: e.target.value });
              clearFieldError("fullName");
            }}
            className="mt-2 h-11"
          />
          {nameError && (
            <p
              id="journey-full-name-error"
              role="alert"
              className="mt-2 text-sm text-red-600 dark:text-red-400"
            >
              {nameError}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="journey-email">
            Work email
            <span className="text-indigo-600 dark:text-indigo-400">*</span>
          </Label>
          <Input
            ref={emailRef}
            id="journey-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="you@yourcompany.com"
            value={email}
            aria-invalid={Boolean(emailError)}
            aria-describedby={
              emailError
                ? "journey-email-error"
                : emailSuggestion
                  ? "journey-email-suggestion"
                  : "journey-email-help"
            }
            onChange={(e) => {
              patch({ email: e.target.value });
              clearFieldError("email");
              setEmailSuggestion(null);
            }}
            // On blur, not on every keystroke: "did you mean gmail.com" while
            // someone is still typing "gm" is noise.
            onBlur={() => setEmailSuggestion(suggestEmailCorrection(email))}
            className="mt-2 h-11"
          />
          {emailError ? (
            <p
              id="journey-email-error"
              role="alert"
              className="mt-2 text-sm text-red-600 dark:text-red-400"
            >
              {emailError}
            </p>
          ) : emailSuggestion ? (
            <p
              id="journey-email-suggestion"
              aria-live="polite"
              className="mt-2 text-sm text-muted-foreground"
            >
              Did you mean{" "}
              <button
                type="button"
                onClick={() => {
                  patch({ email: emailSuggestion });
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
              id="journey-email-help"
              className="mt-2 text-xs text-muted-foreground"
            >
              I&apos;ll send your confirmation code here, and this becomes the
              owner login for your portal.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="journey-password">
            Password
            <span className="text-indigo-600 dark:text-indigo-400">*</span>
          </Label>
          <div className="relative mt-2">
            <Input
              ref={passwordRef}
              id="journey-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              aria-invalid={Boolean(passwordError)}
              aria-describedby="journey-password-rules"
              onChange={(e) => {
                patch({ password: e.target.value });
                clearFieldError("password");
              }}
              className="h-11 pr-10"
            />
            <PasswordToggle
              shown={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
            />
          </div>

          {/* The live checklist is the gate; the meter is advisory. Both sit in
              one polite region so a screen reader is not told about every
              keystroke twice. */}
          <div
            id="journey-password-rules"
            aria-live="polite"
            className="mt-3 space-y-1.5"
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
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <Circle
                    className="h-3.5 w-3.5 shrink-0 opacity-50"
                    aria-hidden="true"
                  />
                )}
                {rule.label}
                <span className="sr-only">{met ? " — met" : " — not met"}</span>
              </p>
            ))}

            {password.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
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
            <p
              role="alert"
              className="mt-2 text-sm text-red-600 dark:text-red-400"
            >
              {passwordError}
            </p>
          )}
        </div>
      </div>

      <Separator className="!my-8" />

      {/* The live component. Business name, web address with availability,
          terms — the three things `signup-provision` actually requires. */}
      <div className="space-y-5">
        <TenantIdentityFields
          value={tenant}
          busy={false}
          errors={{
            companyName: errors.companyName,
            slug: errors.slug,
            acceptedTerms: errors.acceptedTerms,
          }}
          onChange={onTenantChange}
          onClearError={clearFieldError}
          onCheckSlug={checkSlugAvailability}
          onSlugStateChange={setSlugState}
          companyNameRef={companyNameRef}
          slugRef={slugRef}
          termsRef={termsRef}
        />
      </div>

      {/* One primary action. Leaving is the close button in the corner, which is
          where a dialog's exit belongs — a second "Back to plans" here would
          compete with it. */}
      <Button
        type="submit"
        size="lg"
        className="mt-9 h-12 w-full bg-indigo-600 text-[15px] text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        Create my account
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </form>
  );
}

/**
 * Google's mark, inline.
 *
 * A copy of the one in `components/onboarding/steps/account-step.tsx`, which is
 * a module-private function there. Duplicated rather than exported, because
 * changing a live signup file to serve this route is a worse trade than sixteen
 * lines of path data — and Google's brand guidelines fix this artwork, so it is
 * not a shape that drifts.
 */
function GoogleMark() {
  return (
    <svg
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="h-[18px] w-[18px] shrink-0"
    >
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
 * Apple's mark, inline and monochrome.
 *
 * `fill="currentColor"` on purpose: Apple's guidelines require the logo to be a
 * single flat colour matching the button's text, which is white on the black
 * button and black on its dark-mode inverse.
 */
function AppleMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      className="h-5 w-5 shrink-0"
    >
      <path d="M17.05 12.04c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.13.94-3.94.94-.82 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.47 7.83 1.3 10.39.87 1.25 1.9 2.66 3.26 2.61 1.31-.05 1.8-.85 3.39-.85 1.58 0 2.03.85 3.41.82 1.41-.02 2.3-1.28 3.16-2.53.99-1.45 1.4-2.86 1.42-2.93-.03-.02-2.73-1.05-2.76-4.15zM14.6 4.42c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.29.69-3.03 1.56-.66.77-1.25 2.01-1.09 3.19 1.15.09 2.32-.59 3.05-1.46z" />
    </svg>
  );
}
