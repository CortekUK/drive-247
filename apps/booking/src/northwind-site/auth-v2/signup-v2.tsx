'use client';

/**
 * Customer sign-up v2 — login-v2's split screen, with the current sign-up's
 * behaviour unchanged: the same `signUp` from the customer auth store (one
 * call to `customer-signup` creates the auth user, the customer and the link,
 * and signs the customer in), the same field rules from v1's validation.ts,
 * the same sanitised `?next=` carried across the login hop. On success the
 * customer goes straight on to `next` (the portal, when there is none).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useState } from 'react';
import type { FormEvent } from 'react';

import { useCustomerAuth } from '@nw/contexts/CustomerAuthContext';
import { useTenant } from '@nw/contexts/TenantContext';
import type { AuthFailure } from '@nw/lib/stores/customer-auth-store';
import { useNextPath, withNext } from '@/app/(northwind)/northwind-site/(auth)/_components/next-path';
import {
  MIN_PASSWORD_LENGTH,
  isClean,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
  validatePhone,
} from '@/app/(northwind)/northwind-site/(auth)/_components/validation';

import {
  AuthHeading,
  AuthNoticeV2,
  AuthPasswordFieldV2,
  AuthSubmitV2,
  AuthTextFieldV2,
} from './auth-fields-v2';
import { AuthSplitShell, authLinkInk } from './auth-split-shell';
import { ContinueWithGoogle } from './google-sign-in';
import { PolicyConsentLine } from './policy-consent-line';

interface FieldErrors {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirm?: string;
}

export function SignupV2() {
  const router = useRouter();
  const prefix = useId();
  const { signUp } = useCustomerAuth();
  const { tenant, isLoading: tenantLoading } = useTenant();
  const next = useNextPath();
  // Where a Google sign-up goes once it lands: where the form would go.
  const goNext = useCallback(() => router.replace(next), [router, next]);
  const [googleBusy, setGoogleBusy] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [pending, setPending] = useState(false);

  const company = tenant?.company_name ?? tenant?.app_name ?? null;
  const ink = authLinkInk(tenant);

  const clearError = (field: keyof FieldErrors) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const nextErrors: FieldErrors = {
      name: validateName(name),
      email: validateEmail(email),
      phone: validatePhone(phone),
      password: validateNewPassword(password),
      confirm: validatePasswordConfirmation(password, confirm),
    };
    setErrors(nextErrors);
    if (!isClean(nextErrors)) return;

    setFailure(null);
    setPending(true);

    const result = await signUp({ name, email, password, phone });

    if (!result.ok) {
      setFailure(result.failure);
      setPending(false);
      return;
    }

    // Signed in by the same call: straight on. Stays pending across the
    // navigation so the button cannot create a second account.
    router.replace(next);
  };

  const signInLink = (
    <Link
      href={withNext('/login', next)}
      className="font-medium underline-offset-4 hover:underline"
      style={{ color: ink }}
    >
      Sign in
    </Link>
  );

  return (
    <AuthSplitShell>
      <AuthHeading
        title="Create your account"
        description={
          company ? `One account for every booking you make with ${company}.` : 'One account for every booking you make.'
        }
      />

      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {failure ? (
          <AuthNoticeV2 tone="danger">
            {failure.message}
            {failure.kind === 'email-taken' ? <> {signInLink}</> : null}
          </AuthNoticeV2>
        ) : null}

        <AuthTextFieldV2
          id={`${prefix}-name`}
          label="Full name"
          autoComplete="name"
          placeholder="Enter your full name"
          value={name}
          autoFocus
          disabled={pending}
          error={errors.name}
          onChange={(value) => {
            setName(value);
            clearError('name');
          }}
          onBlur={() => setErrors((prev) => ({ ...prev, name: validateName(name) }))}
        />

        <AuthTextFieldV2
          id={`${prefix}-email`}
          label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Enter your email"
          hint="Your booking confirmations and rental agreements go here."
          value={email}
          disabled={pending}
          error={errors.email}
          onChange={(value) => {
            setEmail(value);
            clearError('email');
          }}
          onBlur={() => setErrors((prev) => ({ ...prev, email: validateEmail(email) }))}
        />

        <AuthTextFieldV2
          id={`${prefix}-phone`}
          label="Phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+1 555 010 0100"
          optional
          hint="Only used if we need to reach you about a live rental."
          value={phone}
          disabled={pending}
          error={errors.phone}
          onChange={(value) => {
            setPhone(value);
            clearError('phone');
          }}
          onBlur={() => setErrors((prev) => ({ ...prev, phone: validatePhone(phone) }))}
        />

        <AuthPasswordFieldV2
          id={`${prefix}-password`}
          label="Password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          value={password}
          disabled={pending}
          error={errors.password}
          onChange={(value) => {
            setPassword(value);
            clearError('password');
            // Re-check the confirmation against the new password, so a fixed
            // mismatch does not keep its stale message.
            if (errors.confirm && confirm !== '') {
              setErrors((prev) => ({ ...prev, confirm: validatePasswordConfirmation(value, confirm) }));
            }
          }}
          onBlur={() => setErrors((prev) => ({ ...prev, password: validateNewPassword(password) }))}
        />

        <AuthPasswordFieldV2
          id={`${prefix}-confirm`}
          label="Confirm password"
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

        {/* Held until the tenant resolves: the account belongs to ONE operator. */}
        <div className="pt-2">
          <AuthSubmitV2 pending={pending} pendingLabel="Creating your account…" disabled={tenantLoading || googleBusy}>
            Create account
          </AuthSubmitV2>
        </div>
      </form>

      {/* CONTINUE WITH GOOGLE, as on the operator portal's login: under the
          form's own button. For a Google account signing up and signing in
          are the same thing, so both pages carry it. */}
      <div className="mt-4">
        <ContinueWithGoogle disabled={pending} onSignedIn={goNext} onBusyChange={setGoogleBusy} />
      </div>

      <PolicyConsentLine ink={ink} />

      <p className="mt-6 text-center text-sm text-pv-muted-fg">Already have an account? {signInLink}</p>
    </AuthSplitShell>
  );
}
