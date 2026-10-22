'use client';

/**
 * The operator's sign-in flows (profile-sheet-v2.tsx), for customers — the
 * same system, step for step:
 *
 *   PASSWORD. The new password, then a six-digit code to the account's
 *   address (`signInWithOtp`, `shouldCreateUser: false`), checked with
 *   `verifyOtp({ type: 'email' })`, and only then `updateUser({ password })`.
 *   The operator's rules: 12 characters or more, with an upper-case letter, a
 *   lower-case letter and a number. Works for an account with no password yet
 *   (one made with Google).
 *
 *   The form (owner, Oct 21 2026: "build a proper, well-designed UI for it",
 *   in both portals): two steps under a small stepper — the password with a
 *   show/hide eye, a four-step strength bar and the rules ticking off as they
 *   are met, then the confirmation field telling you as soon as the two
 *   match; and the code, in six boxes that check themselves the moment the
 *   last digit lands, with a resend that waits 30 seconds.
 *
 *   EMAIL. `updateUser({ email }, { emailRedirectTo })` sends a code to the
 *   NEW address; nothing changes until `verifyOtp({ type: 'email_change' })`
 *   checks it. Then the customer row's copy of the address follows, for this
 *   customer and this tenant only.
 *
 * `?otp=1` on the redirect asks the auth email hook (custom-auth-email) for a
 * six-digit code instead of a link.
 */

import { useCallback, useEffect, useState } from 'react';
import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from 'input-otp';
import { Check, Eye, EyeOff, Loader2 } from 'lucide-react-nw';

import { Input } from '@nw/components/ui/input';
import { useCustomerAuth } from '@nw/contexts/CustomerAuthContext';
import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { supabase } from '@nw/integrations/supabase/client';
import { cn } from '@nw/lib/utils';

import { PV_BUTTON_OUTLINE_SM, PV_BUTTON_SM, PV_INPUT } from './pv-kit';
import { RowHint } from './settings-ui';

/**
 * `?otp=1` asks custom-auth-email for a code instead of a link. Built on the
 * tenant's drive-247.com address, which is on the auth allow-list: Supabase
 * swaps a redirect it does not allow (a custom domain, localhost) for the site
 * URL, and the marker would be lost with it.
 */
export const codeRedirect = (slug: string | null | undefined) =>
  slug ? `https://${slug}.drive-247.com/?otp=1` : `${window.location.origin}/?otp=1`;

/** The operator's password rules, one per line of the checklist. */
export const PASSWORD_RULES: ReadonlyArray<{ label: string; test: (password: string) => boolean }> = [
  { label: '12 characters or more', test: (p) => p.length >= 12 },
  { label: 'An uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'A lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'A number', test: (p) => /\d/.test(p) },
];

/** The operator's password rule, word for word. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password !== confirm) return 'Passwords do not match.';
  if (password.length < 12) return 'Password must be at least 12 characters long.';
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain an uppercase letter, a lowercase letter and a number.';
  }
  return null;
}

/** 0–4: the rules met, with a bonus step for length and symbols once they all are. */
function strengthOf(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: '' };
  const met = PASSWORD_RULES.filter((rule) => rule.test(password)).length;
  if (met < 4) return { score: met <= 1 ? 1 : 2, label: met <= 1 ? 'Weak' : 'Fair' };
  const extra = password.length >= 16 || /[^A-Za-z0-9]/.test(password);
  return extra ? { score: 4, label: 'Strong' } : { score: 3, label: 'Good' };
}

const message = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);

/* ─────────────────────────────── the code ──────────────────────────────── */

/**
 * A six-digit code, one box per digit — the operator's ui-v2 CodeInput on the
 * customer palette. `input-otp` keeps one real <input> underneath, so paste,
 * the "from Messages / Mail" suggestion, backspace and arrows behave natively.
 */
export function CodeInput({
  id,
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <OTPInput
      id={id}
      maxLength={6}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      autoFocus={autoFocus}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      containerClassName="flex items-center gap-2 has-[:disabled]:opacity-50"
      render={({ slots }) => (
        <>
          {slots.map((slot, index) => (
            <CodeSlot key={index} {...slot} />
          ))}
        </>
      )}
    />
  );
}

function CodeSlot({ char, isActive, hasFakeCaret }: SlotProps) {
  return (
    <div
      className={cn(
        'relative flex h-12 w-11 items-center justify-center rounded-2xl border border-transparent bg-pv-muted text-lg font-medium tabular-nums text-pv-fg',
        '[transition:border-color_200ms_ease-out,box-shadow_200ms_ease-out] motion-reduce:transition-none',
        isActive && 'border-pv-primary/40 ring-3 ring-pv-primary/20',
      )}
    >
      {char}
      {hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-pulse bg-pv-fg" />
        </div>
      ) : null}
    </div>
  );
}

/** Seconds left before "Send a new code" works again. */
function useCooldown(): [number, () => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return [left, useCallback(() => setLeft(30), [])];
}

const LABEL = 'text-[13px] font-medium text-pv-fg';
const PANEL = 'rounded-2xl border border-pv-border bg-pv-card p-5';

/* ─────────────────────────────── password ──────────────────────────────── */

function Stepper({ step }: { step: 1 | 2 }) {
  const items = ['New password', "Confirm it's you"];
  return (
    <ol className="flex items-center gap-2 text-[12px]" aria-label="Steps">
      {items.map((label, index) => {
        const number = (index + 1) as 1 | 2;
        const done = number < step;
        const current = number === step;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
            {index > 0 ? <span aria-hidden className={cn('h-px w-6', done || current ? 'bg-pv-primary/50' : 'bg-pv-border')} /> : null}
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                done ? 'bg-pv-primary text-pv-primary-fg' : current ? 'bg-pv-primary/15 text-pv-primary' : 'bg-pv-muted text-pv-muted-fg',
              )}
            >
              {done ? <Check aria-hidden className="size-3" strokeWidth={3} /> : number}
            </span>
            <span className={cn('font-medium', current ? 'text-pv-fg' : 'text-pv-muted-fg')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  describedBy,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(PV_INPUT, 'pr-12')}
        />
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-pv-muted-fg transition-colors hover:bg-pv-primary/10 hover:text-pv-fg focus-visible:ring-3 focus-visible:ring-pv-primary/25 focus-visible:outline-none"
        >
          {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
      </div>
    </div>
  );
}

/** The password form, open. `onDone` runs once the password is set. */
export function PasswordChangeForm({
  onCancel,
  onDone,
  submitLabel = 'Update password',
}: {
  onCancel: () => void;
  onDone: () => void | Promise<void>;
  submitLabel?: string;
}) {
  const { user } = useAccountUser();
  const { tenant } = useTenant();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();
  const address = user?.email ?? '';

  const strength = strengthOf(password);
  const rulesMet = PASSWORD_RULES.every((rule) => rule.test(password));
  const matches = confirm.length > 0 && confirm === password;
  const mismatch = confirm.length > 0 && !password.startsWith(confirm) && confirm !== password;

  const sendCode = async () => {
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: false, emailRedirectTo: codeRedirect(tenant?.slug) },
      });
      if (sendError) throw sendError;
      setCode('');
      setStep(2);
      startCooldown();
    } catch (cause) {
      setError(message(cause, 'We could not send the code. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const save = async (token = code) => {
    if (token.trim().length < 6 || busy) return;
    setError(null);
    setBusy(true);
    try {
      const { error: codeError } = await supabase.auth.verifyOtp({ type: 'email', email: address, token: token.trim() });
      if (codeError) throw new Error("That code didn't work. Check it, or send a new one.");
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await onDone();
    } catch (cause) {
      setError(message(cause, 'We could not update your password. Please try again.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const STRENGTH_TONE = ['', 'bg-pv-danger', 'bg-pv-warning', 'bg-pv-success', 'bg-pv-success'];

  return (
    <div className={cn(PANEL, 'space-y-5')}>
      <Stepper step={step} />

      {step === 1 ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void sendCode();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2.5">
              <PasswordField
                id="new-password"
                label="New password"
                value={password}
                onChange={setPassword}
                placeholder="At least 12 characters"
                autoFocus
                describedBy="password-rules"
              />
              <div className="flex items-center gap-2" aria-live="polite">
                <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
                  {[1, 2, 3, 4].map((segment) => (
                    <span
                      key={segment}
                      className={cn(
                        'h-1 rounded-full transition-colors duration-200 motion-reduce:transition-none',
                        strength.score >= segment ? STRENGTH_TONE[strength.score] : 'bg-pv-muted',
                      )}
                    />
                  ))}
                </div>
                <span className="w-12 text-right text-[11px] font-medium text-pv-muted-fg">{strength.label}</span>
              </div>
            </div>
            <div className="space-y-2.5">
              <PasswordField
                id="confirm-password"
                label="Confirm password"
                value={confirm}
                onChange={setConfirm}
                placeholder="Type it again"
                invalid={mismatch}
              />
              <p className={cn('text-[12px]', matches ? 'text-pv-success' : mismatch ? 'text-pv-danger' : 'text-pv-muted-fg')} aria-live="polite">
                {matches ? 'Passwords match' : mismatch ? 'Passwords do not match yet' : 'Type the same password again'}
              </p>
            </div>
          </div>

          <ul id="password-rules" className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(password);
              return (
                <li key={rule.label} className={cn('flex items-center gap-2 text-[12.5px]', ok ? 'text-pv-fg' : 'text-pv-muted-fg')}>
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-4 items-center justify-center rounded-full transition-colors duration-200 motion-reduce:transition-none',
                      ok ? 'bg-pv-success text-white' : 'border border-pv-border',
                    )}
                  >
                    {ok ? <Check className="size-2.5" strokeWidth={3.5} /> : null}
                  </span>
                  {rule.label}
                  <span className="sr-only">{ok ? '(met)' : '(not met yet)'}</span>
                </li>
              );
            })}
          </ul>

          {error ? <RowHint tone="danger">{error}</RowHint> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-pv-border pt-4">
            <p className="text-[12px] text-pv-muted-fg">Next, we email a code to {address || 'your address'} to confirm it&apos;s you.</p>
            <div className="ml-auto flex gap-2">
              <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className={PV_BUTTON_SM} disabled={!rulesMet || !matches || busy}>
                {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
                {busy ? 'Sending code…' : 'Continue'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-[15px] font-semibold text-pv-fg">Enter the code we emailed you</p>
            <p className="text-[13px] text-pv-muted-fg">
              Sent to <span className="font-medium text-pv-fg">{address}</span>. Your password changes once it checks out.
            </p>
          </div>
          <CodeInput
            id="password-code"
            value={code}
            onChange={setCode}
            onComplete={(value) => void save(value)}
            disabled={busy}
            autoFocus
          />
          <p className="text-[12px] text-pv-muted-fg">
            Didn&apos;t get it?{' '}
            <button
              type="button"
              className="font-medium text-pv-link underline-offset-2 hover:underline disabled:cursor-default disabled:text-pv-muted-fg disabled:no-underline"
              onClick={() => void sendCode()}
              disabled={busy || cooldown > 0}
            >
              {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
            </button>
          </p>

          {error ? <RowHint tone="danger">{error}</RowHint> : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-pv-border pt-4">
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setError(null);
              }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-pv-muted-fg hover:text-pv-fg"
            >
              Change the password
            </button>
            <div className="ml-auto flex gap-2">
              <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={onCancel} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={PV_BUTTON_SM} onClick={() => void save()} disabled={busy || code.trim().length < 6}>
                {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
                {busy ? 'Updating…' : submitLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────── email ────────────────────────────────── */

export function EmailChangeForm({ onCancel, onDone }: { onCancel: () => void; onDone: (email: string) => void }) {
  const { tenant } = useTenant();
  const { customerId, refresh } = useCustomer();
  const { user } = useAccountUser();
  const current = user?.email ?? '';
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const next = email.trim();
    if (!next || next.toLowerCase() === current.toLowerCase()) return setError('Enter a different email address.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return setError("That doesn't look like an email address.");
    setError(null);
    setBusy(true);
    try {
      const { error: sendError } = await supabase.auth.updateUser({ email: next }, { emailRedirectTo: codeRedirect(tenant?.slug) });
      if (sendError) throw sendError;
      setCode('');
      setSentTo(next);
    } catch (cause) {
      setError(message(cause, 'We could not change your email. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (token = code) => {
    if (!sentTo || token.trim().length < 6 || busy) return;
    setError(null);
    setBusy(true);
    try {
      const { error: codeError } = await supabase.auth.verifyOtp({ type: 'email_change', email: sentTo, token: token.trim() });
      if (codeError) throw new Error(`That code didn't work. ${codeError.message}`);
      const { data } = await supabase.auth.getUser();
      const confirmed = data?.user?.email ?? sentTo;
      // The customer row keeps a copy of the address; bring it along, for this
      // customer on this site only. A failure here does not undo the change.
      if (customerId && tenant?.id) {
        await supabase.from('customers').update({ email: confirmed }).eq('id', customerId).eq('tenant_id', tenant.id);
        await refresh();
      }
      onDone(confirmed);
    } catch (cause) {
      setError(message(cause, 'We could not confirm your email. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(PANEL, 'space-y-3')}>
      {sentTo ? (
        <div className="space-y-2">
          <label htmlFor="email-code" className={LABEL}>
            Code sent to {sentTo}
          </label>
          <CodeInput id="email-code" value={code} onChange={setCode} onComplete={(value) => void verify(value)} disabled={busy} autoFocus />
          <p className="text-[12px] text-pv-muted-fg">
            Until you enter it, you sign in with {current}.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="new-email" className={LABEL}>
            New email address
          </label>
          <Input
            id="new-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className={PV_INPUT}
          />
          <p className="text-[12px] text-pv-muted-fg">We send a six-digit code to the new address. Your email only changes once you enter it.</p>
        </div>
      )}
      {error ? <RowHint tone="danger">{error}</RowHint> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={PV_BUTTON_SM}
          onClick={() => void (sentTo ? verify() : send())}
          disabled={busy || (sentTo ? code.trim().length < 6 : !email.trim())}
        >
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {busy ? (sentTo ? 'Checking…' : 'Sending…') : sentTo ? 'Confirm email' : 'Send code'}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────── the user ──────────────────────────────── */

/** The signed-in auth user. */
export function useAccountUser() {
  const { user } = useCustomerAuth();
  return { user };
}

/** The account's sign-in identities (email, google), re-read on demand. */
export function useIdentities() {
  const [identities, setIdentities] = useState<{ id: string; provider: string; email: string | null; raw: unknown }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: readError } = await supabase.auth.getUserIdentities();
    if (readError) {
      setError(readError.message);
      setIdentities([]);
      return;
    }
    setError(null);
    setIdentities(
      (data?.identities ?? []).map((identity) => ({
        id: identity.identity_id,
        provider: identity.provider,
        email: (identity.identity_data?.email as string | undefined) ?? null,
        raw: identity,
      })),
    );
  }, []);

  return { identities, error, reload };
}
