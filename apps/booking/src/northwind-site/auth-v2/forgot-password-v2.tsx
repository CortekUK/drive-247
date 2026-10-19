'use client';

/**
 * Forgotten password v2 — login-v2's split screen, with the current reset's
 * behaviour unchanged (see v1's forgot-password-form.tsx for the why of each
 * rule): the same two store calls (`resetPassword` mails a six-digit code via
 * `send-verification-otp`; `confirmPasswordReset` verifies it and sets the
 * password), step 1 always reading as sent so the page cannot be used to test
 * which addresses have accounts, both steps on one page so the address
 * survives the trip to the inbox, and a 30s resend cooldown.
 */

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';

import { useCustomerAuth } from '@nw/contexts/CustomerAuthContext';
import { useTenant } from '@nw/contexts/TenantContext';
import type { AuthFailure } from '@nw/lib/stores/customer-auth-store';
import {
  MIN_PASSWORD_LENGTH,
  VERIFICATION_CODE_LENGTH,
  isClean,
  validateEmail,
  validateNewPassword,
  validatePasswordConfirmation,
  validateVerificationCode,
} from '@/app/(northwind)/northwind-site/(auth)/_components/validation';

import {
  AUTH_PRIMARY_BUTTON,
  AuthCodeFieldV2,
  AuthHeading,
  AuthNoticeV2,
  AuthPasswordFieldV2,
  AuthSubmitV2,
  AuthTextFieldV2,
} from './auth-fields-v2';
import { AuthSplitShell, authLinkInk } from './auth-split-shell';

const RESEND_COOLDOWN_SECONDS = 30;

type Step = 'request' | 'verify' | 'done';

interface FieldErrors {
  email?: string;
  code?: string;
  password?: string;
  confirm?: string;
}

const LINK_CLASS =
  'font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pv-primary/25 disabled:opacity-50';

export function ForgotPasswordV2() {
  const prefix = useId();
  const { resetPassword, confirmPasswordReset } = useCustomerAuth();
  const { tenant } = useTenant();
  const ink = authLinkInk(tenant);

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // One self-rescheduling timer keyed on the value, so a second press cannot
  // leave two running.
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

    if (await sendCode()) setStep('verify');
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
      // A rejected code goes back to its field.
      if (result.failure.kind === 'invalid-code') setCode('');
      return;
    }

    setStep('done');
  };

  /* ── step 3: done ─────────────────────────────────────────────────────── */

  if (step === 'done') {
    return (
      <AuthSplitShell>
        <AuthHeading title="Password updated" description="You can sign in with your new password now." />
        <AuthNoticeV2 tone="success">
          Your password has been changed. For safety, any other device still signed in as you will need it again
          next time it asks.
        </AuthNoticeV2>
        <Link href="/login" className={`${AUTH_PRIMARY_BUTTON} mt-5`}>
          Sign in
        </Link>
      </AuthSplitShell>
    );
  }

  /* ── step 2: verify ───────────────────────────────────────────────────── */

  if (step === 'verify') {
    return (
      <AuthSplitShell>
        <AuthHeading
          title="Check your email"
          description={
            <>
              We sent a {VERIFICATION_CODE_LENGTH}-digit code to{' '}
              <span className="font-medium text-pv-fg">{email}</span> if that address has an account. Enter it below
              with your new password.
            </>
          }
        />

        <form noValidate onSubmit={handleVerify} className="space-y-4">
          {failure ? <AuthNoticeV2 tone="danger">{failure.message}</AuthNoticeV2> : null}

          <AuthCodeFieldV2
            id={`${prefix}-code`}
            label="Verification code"
            length={VERIFICATION_CODE_LENGTH}
            hint="The code expires 15 minutes after it is sent."
            value={code}
            disabled={pending}
            error={errors.code}
            onChange={(value) => {
              setCode(value);
              clearError('code');
            }}
            onBlur={() => setErrors((prev) => ({ ...prev, code: validateVerificationCode(code) }))}
          />

          <AuthPasswordFieldV2
            id={`${prefix}-password`}
            label="New password"
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            value={password}
            disabled={pending}
            error={errors.password}
            onChange={(value) => {
              setPassword(value);
              clearError('password');
              if (errors.confirm && confirm !== '') {
                setErrors((prev) => ({ ...prev, confirm: validatePasswordConfirmation(value, confirm) }));
              }
            }}
            onBlur={() => setErrors((prev) => ({ ...prev, password: validateNewPassword(password) }))}
          />

          <AuthPasswordFieldV2
            id={`${prefix}-confirm`}
            label="Confirm new password"
            autoComplete="new-password"
            value={confirm}
            disabled={pending}
            error={errors.confirm}
            onChange={(value) => {
              setConfirm(value);
              clearError('confirm');
            }}
            onBlur={() => setErrors((prev) => ({ ...prev, confirm: validatePasswordConfirmation(password, confirm) }))}
          />

          <div className="pt-2">
            <AuthSubmitV2 pending={pending} pendingLabel="Updating your password…">
              Update password
            </AuthSubmitV2>
          </div>

          {/* A resend is a real second email (and invalidates the first code), so it waits. */}
          <div className="flex min-h-11 items-center justify-center text-center text-sm text-pv-muted-fg">
            {cooldown > 0 ? (
              <span aria-live="polite">You can ask for another code in {cooldown}s.</span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setCode('');
                  void sendCode();
                }}
                className={`${LINK_CLASS} inline-flex min-h-11 cursor-pointer items-center`}
                style={{ color: ink }}
              >
                Send another code
              </button>
            )}
          </div>
        </form>

        <p className="mt-4 text-center text-sm text-pv-muted-fg">
          {/* A local reset, not a link to this same route: Next would not remount it. */}
          Wrong address?{' '}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setStep('request');
              setCode('');
              setPassword('');
              setConfirm('');
              setErrors({});
              setFailure(null);
            }}
            className={`${LINK_CLASS} -my-3 inline-flex min-h-11 cursor-pointer items-center align-baseline`}
            style={{ color: ink }}
          >
            Start again
          </button>
        </p>
      </AuthSplitShell>
    );
  }

  /* ── step 1: request ──────────────────────────────────────────────────── */

  return (
    <AuthSplitShell>
      <AuthHeading
        title="Reset your password"
        description="Enter your email address and we will send you a code to set a new password."
      />

      <form noValidate onSubmit={handleRequest} className="space-y-4">
        {failure ? <AuthNoticeV2 tone="danger">{failure.message}</AuthNoticeV2> : null}

        <AuthTextFieldV2
          id={`${prefix}-email`}
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Enter your email"
          value={email}
          autoFocus
          disabled={pending}
          error={errors.email}
          onChange={(value) => {
            setEmail(value);
            clearError('email');
          }}
          onBlur={() => setErrors((prev) => ({ ...prev, email: validateEmail(email) }))}
        />

        <div className="pt-2">
          <AuthSubmitV2 pending={pending} pendingLabel="Sending your code…">
            Send code
          </AuthSubmitV2>
        </div>
      </form>

      <p className="mt-6 text-center text-sm text-pv-muted-fg">
        Remembered it?{' '}
        <Link href="/login" className={LINK_CLASS} style={{ color: ink }}>
          Back to sign in
        </Link>
      </p>
    </AuthSplitShell>
  );
}
