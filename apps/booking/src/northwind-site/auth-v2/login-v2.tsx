'use client';

/**
 * Customer sign-in v2 — the operator portal v2's login screen
 * (apps/portal/src/components/auth-v2/login-v2.tsx), for customers: the
 * tenant's brand wash dissolving across the page, a typed hero on the left
 * telling the customer what the portal is for, and the form on the right with
 * no card behind it.
 *
 * The behaviour is the current customer sign-in's, unchanged: the same
 * `signIn` from the customer auth store, the same field validation, the same
 * two failures told apart (wrong pair vs. right password, wrong operator), the
 * same sanitised `?next=` (no `next` lands on the customer portal). The frame
 * is `AuthSplitShell`, shared with sign-up and forgot password v2; it also
 * sends a customer who is already signed in straight on.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react-nw';

import { useCustomerAuth } from '@nw/contexts/CustomerAuthContext';
import { useTenant } from '@nw/contexts/TenantContext';
import type { AuthFailure } from '@nw/lib/stores/customer-auth-store';
import { useNextPath, withNext } from '@/app/(northwind)/northwind-site/(auth)/_components/next-path';
import { isClean, validateEmail, validateExistingPassword } from '@/app/(northwind)/northwind-site/(auth)/_components/validation';

import { AUTH_FIELD_CLASS as FIELD_CLASS, AUTH_FIELD_ERROR_CLASS as FIELD_ERROR_CLASS } from './auth-fields-v2';
import { AuthSplitShell, authLinkInk } from './auth-split-shell';
import { ContinueWithGoogle } from './google-sign-in';
import { PolicyConsentLine } from './policy-consent-line';

interface FieldErrors {
  email?: string;
  password?: string;
}

export function LoginV2() {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const { signIn } = useCustomerAuth();
  const { tenant, isLoading: tenantLoading } = useTenant();
  const next = useNextPath();
  // Where a Google sign-in goes once it lands: where the form would go.
  const goNext = useCallback(() => router.replace(next), [router, next]);
  const [googleBusy, setGoogleBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [pending, setPending] = useState(false);

  const appName = tenant?.company_name || tenant?.app_name || 'your rental company';
  const ink = authLinkInk(tenant);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const nextErrors: FieldErrors = {
      email: validateEmail(email),
      password: validateExistingPassword(password),
    };
    setErrors(nextErrors);
    if (!isClean(nextErrors)) return;

    setFailure(null);
    setPending(true);

    const result = await signIn(email, password);

    if (!result.ok) {
      setFailure(result.failure);
      setPending(false);
      return;
    }

    // Stay pending through the navigation, so the button cannot be pressed twice.
    router.replace(next);
  };

  return (
    <AuthSplitShell>
      <div className="mb-6 space-y-1.5">
        <h1 className="text-3xl font-semibold tracking-tight text-pv-fg">Sign in</h1>
        <p className="text-sm text-pv-muted-fg">
          Enter your email and password to access your {appName} account.
        </p>
      </div>

      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {failure ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-pv-danger/30 bg-pv-danger-light px-4 py-3 text-sm text-pv-danger"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <p>
              {failure.message}
              {failure.kind === 'no-account-for-tenant' ? (
                <>
                  {' '}
                  <Link href={withNext('/signup', next)} className="font-medium underline underline-offset-4">
                    Create an account
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <label htmlFor={emailId} className="block text-sm font-medium text-pv-fg">
            Email address
          </label>
          <input
            id={emailId}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Enter your email"
            autoFocus
            value={email}
            disabled={pending}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? `${emailId}-error` : undefined}
            className={`${FIELD_CLASS} ${errors.email ? FIELD_ERROR_CLASS : ''}`}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
            }}
            onBlur={() => setErrors((prev) => ({ ...prev, email: validateEmail(email) }))}
          />
          {errors.email ? (
            <p id={`${emailId}-error`} className="text-sm text-pv-danger">
              {errors.email}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label htmlFor={passwordId} className="block text-sm font-medium text-pv-fg">
            Password
          </label>
          <div className="relative">
            <input
              id={passwordId}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              disabled={pending}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? `${passwordId}-error` : undefined}
              className={`${FIELD_CLASS} pr-12 ${errors.password ? FIELD_ERROR_CLASS : ''}`}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
              }}
              onBlur={() => setErrors((prev) => ({ ...prev, password: validateExistingPassword(password) }))}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-1 my-auto inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-pv-tint hover:text-pv-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pv-primary/25"
            >
              {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            </button>
          </div>
          {errors.password ? (
            <p id={`${passwordId}-error`} className="text-sm text-pv-danger">
              {errors.password}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="-my-2 inline-block py-3 text-sm font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pv-primary/25"
            style={{ color: ink }}
          >
            Forgot password?
          </Link>
        </div>

        {/* Held until the tenant resolves: sign-in is scoped to one operator. */}
        <button
          type="submit"
          disabled={pending || tenantLoading || googleBusy}
          className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-pv-primary text-base font-medium text-pv-primary-fg transition-colors hover:bg-pv-primary-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pv-primary/30 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Signing you in…
            </>
          ) : (
            'Sign in'
          )}
        </button>
      </form>

      {/* CONTINUE WITH GOOGLE, as on the operator portal's login: under the
          form's own button. For a Google account signing in and signing up
          are the same thing, so both pages carry it. */}
      <div className="mt-4">
        <ContinueWithGoogle disabled={pending} onSignedIn={goNext} onBusyChange={setGoogleBusy} />
      </div>

      <PolicyConsentLine ink={ink} />

      <p className="mt-6 text-center text-sm text-pv-muted-fg">
        New here?{' '}
        <Link
          href={withNext('/signup', next)}
          className="font-medium underline-offset-4 hover:underline"
          style={{ color: ink }}
        >
          Create an account
        </Link>
      </p>
    </AuthSplitShell>
  );
}
