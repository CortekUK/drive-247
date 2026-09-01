"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { useCustomerAuth } from "@/contexts/CustomerAuthContext";
import type { AuthFailure } from "@/lib/stores/customer-auth-store";

import { AuthCard, AuthLink } from "./auth-card";
import {
  AuthCodeField,
  AuthPasswordField,
  AuthTextField,
  FormNotice,
  SubmitButton,
  useFieldIds,
} from "./auth-fields";
import {
  MIN_PASSWORD_LENGTH,
  VERIFICATION_CODE_LENGTH,
  isClean,
  validateEmail,
  validateNewPassword,
  validatePasswordConfirmation,
  validateVerificationCode,
} from "./validation";

/**
 * Reset a forgotten password, in two steps on one page.
 *
 *   1. Ask for the address. `send-verification-otp` mails a six-digit code
 *      through Resend — NOT through Supabase's own mailer, which this project
 *      rate-limits to a couple of messages an hour.
 *   2. Take the code and the new password. `verify-otp` checks the code and
 *      confirms the email; `reset-password-with-otp` sets the password with the
 *      admin API.
 *
 * ── WHY STEP 1 ALWAYS "SUCCEEDS" ────────────────────────────────────────────
 * The edge function reports success whether or not the address exists, and this
 * form repeats that: "If that address has an account, the code is on its way."
 * Saying "no account with that email" would turn the page into a way to
 * discover which of a list of addresses rent cars from this operator. The
 * customer who genuinely mistyped finds out at step 2, where a wrong address
 * simply has no code to give.
 *
 * ── WHY THE STEPS SHARE A PAGE ──────────────────────────────────────────────
 * The code arrives by email, so the customer switches app and comes back. A
 * second ROUTE would lose the email address on the way (and a refresh would
 * strand them on a form with nothing to submit); one component holding both
 * steps survives the round trip.
 */

const RESEND_COOLDOWN_SECONDS = 30;

type Step = "request" | "verify" | "done";

interface FieldErrors {
  email?: string;
  code?: string;
  password?: string;
  confirm?: string;
}

const FIELDS = ["email", "code", "password", "confirm"] as const;

export function ForgotPasswordForm() {
  const ids = useFieldIds(FIELDS);
  const { resetPassword, confirmPasswordReset } = useCustomerAuth();

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  /*
    Ticks the resend cooldown down.

    A self-rescheduling `setTimeout` keyed on the value, not a `setInterval`:
    the effect exists only while there is something to count, and each tick
    replaces its own timer — so a second press cannot leave two of them running
    and burn the countdown at double speed.
  */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const clearError = (field: keyof FieldErrors) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const sendCode = async (): Promise<boolean> => {
    setFailure(null);
    setPending(true);
    const result = await resetPassword(email);
    setPending(false);

    if (!result.ok) {
      setFailure(result.failure);
      return false;
    }

    setCooldown(RESEND_COOLDOWN_SECONDS);
    return true;
  };

  const handleRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const nextErrors: FieldErrors = { email: validateEmail(email) };
    setErrors(nextErrors);
    if (!isClean(nextErrors)) return;

    if (await sendCode()) setStep("verify");
  };

  const handleVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const nextErrors: FieldErrors = {
      code: validateVerificationCode(code),
      password: validateNewPassword(password),
      confirm: validatePasswordConfirmation(password, confirm),
    };
    setErrors(nextErrors);
    if (!isClean(nextErrors)) return;

    setFailure(null);
    setPending(true);

    const result = await confirmPasswordReset(email, code, password);
    setPending(false);

    if (!result.ok) {
      setFailure(result.failure);
      // A rejected code is the field's problem, not the form's — put the
      // message where the cursor needs to go back to.
      if (result.failure.kind === "invalid-code") setCode("");
      return;
    }

    setStep("done");
  };

  /* ── step 3: done ─────────────────────────────────────────────────────── */

  if (step === "done") {
    return (
      <AuthCard
        title="Password updated"
        description="You can sign in with your new password now."
      >
        <FormNotice tone="success">
          Your password has been changed. For safety, any other device still
          signed in as you will need it again next time it asks.
        </FormNotice>
        <div className="mt-5">
          <Button asChild variant="brand" size="xl" className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  /* ── step 2: verify ───────────────────────────────────────────────────── */

  if (step === "verify") {
    return (
      <AuthCard
        title="Check your email"
        description={
          <>
            We sent a {VERIFICATION_CODE_LENGTH}-digit code to{" "}
            <span className="font-medium text-brand-text">{email}</span> if that
            address has an account. Enter it below with your new password.
          </>
        }
        footer={
          <>
            {/*
              A local reset, not a `<Link>` back to this same route: Next would
              not remount the component, so the "link" would look broken — the
              old address and a spent code would still be sitting there.
            */}
            Wrong address?{" "}
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setStep("request");
                setCode("");
                setPassword("");
                setConfirm("");
                setErrors({});
                setFailure(null);
              }}
              className="-my-3 inline-flex min-h-11 items-center align-baseline font-medium text-brand-forest underline underline-offset-4 transition-colors hover:text-brand-forest-deep focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25 disabled:opacity-50"
            >
              Start again
            </button>
          </>
        }
      >
        <form noValidate onSubmit={handleVerify} className="space-y-4">
          {failure ? <FormNotice tone="danger">{failure.message}</FormNotice> : null}

          <AuthCodeField
            id={ids.code}
            label="Verification code"
            length={VERIFICATION_CODE_LENGTH}
            hint="The code expires 15 minutes after it is sent."
            value={code}
            disabled={pending}
            error={errors.code}
            onChange={(value) => {
              setCode(value);
              clearError("code");
            }}
            onBlur={() =>
              setErrors((prev) => ({
                ...prev,
                code: validateVerificationCode(code),
              }))
            }
          />

          <AuthPasswordField
            id={ids.password}
            label="New password"
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            value={password}
            disabled={pending}
            error={errors.password}
            onChange={(value) => {
              setPassword(value);
              clearError("password");
              if (errors.confirm && confirm !== "") {
                setErrors((prev) => ({
                  ...prev,
                  confirm: validatePasswordConfirmation(value, confirm),
                }));
              }
            }}
            onBlur={() =>
              setErrors((prev) => ({
                ...prev,
                password: validateNewPassword(password),
              }))
            }
          />

          <AuthPasswordField
            id={ids.confirm}
            label="Confirm new password"
            autoComplete="new-password"
            value={confirm}
            disabled={pending}
            error={errors.confirm}
            onChange={(value) => {
              setConfirm(value);
              clearError("confirm");
            }}
            onBlur={() =>
              setErrors((prev) => ({
                ...prev,
                confirm: validatePasswordConfirmation(password, confirm),
              }))
            }
          />

          <SubmitButton pending={pending} pendingLabel="Updating your password…">
            Update password
          </SubmitButton>

          {/*
            The resend is a real second email, so it carries a cooldown — both
            to keep an impatient double-press from generating two codes (the
            newer one invalidates the older, which is exactly how somebody ends
            up typing a code that has just stopped working) and to keep the
            operator's mail reputation intact.
          */}
          <div className="text-center text-xs text-brand-text-subtle">
            {cooldown > 0 ? (
              <span aria-live="polite">
                You can ask for another code in {cooldown}s.
              </span>
            ) : (
              <Button
                type="button"
                variant="brand-ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setCode("");
                  void sendCode();
                }}
                className="h-11 text-xs"
              >
                Send another code
              </Button>
            )}
          </div>
        </form>
      </AuthCard>
    );
  }

  /* ── step 1: request ──────────────────────────────────────────────────── */

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email address and we will send you a code to set a new password."
      footer={
        <>
          Remembered it? <AuthLink href="/login">Back to sign in</AuthLink>
        </>
      }
    >
      <form noValidate onSubmit={handleRequest} className="space-y-4">
        {failure ? <FormNotice tone="danger">{failure.message}</FormNotice> : null}

        <AuthTextField
          id={ids.email}
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          autoFocus
          disabled={pending}
          error={errors.email}
          onChange={(value) => {
            setEmail(value);
            clearError("email");
          }}
          onBlur={() =>
            setErrors((prev) => ({ ...prev, email: validateEmail(email) }))
          }
        />

        <SubmitButton pending={pending} pendingLabel="Sending your code…">
          Send code
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
