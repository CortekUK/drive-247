'use client';

/**
 * The operator's sign-in flows (profile-sheet-v2.tsx), for customers — the
 * same system, step for step (owner, Oct 21 2026: "use exactly the same
 * system already built in the admin portal"):
 *
 *   PASSWORD. Type the new password twice; a six-digit code goes to the
 *   account's address (`signInWithOtp`, `shouldCreateUser: false`); the code
 *   is checked (`verifyOtp({ type: 'email' })`) and only then is the password
 *   set (`updateUser`). The operator's rules: 12 characters or more, with an
 *   upper-case letter, a lower-case letter and a number. It replaced a bare
 *   `updateUser({ password })` that asked for nothing at all. It also works
 *   for an account that has no password yet (one made with Google).
 *
 *   EMAIL. `updateUser({ email }, { emailRedirectTo })` sends a code to the
 *   NEW address; nothing changes until `verifyOtp({ type: 'email_change' })`
 *   checks it. Then the customer row's copy of the address follows, for this
 *   customer and this tenant only. It replaced a link that landed on a legacy
 *   callback page.
 *
 * `?otp=1` on the redirect asks the auth email hook (custom-auth-email) for a
 * six-digit code instead of a link.
 */

import { useCallback, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react-nw';

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

/** The operator's password rule, word for word. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password !== confirm) return 'Passwords do not match.';
  if (password.length < 12) return 'Password must be at least 12 characters long.';
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain an uppercase letter, a lowercase letter and a number.';
  }
  return null;
}

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

/** A six-digit code: digits only, one-time-code autofill. */
export function CodeInput({
  id,
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
      placeholder="123456"
      className={cn(PV_INPUT, 'max-w-[180px] text-center font-mono text-[16px] tracking-[0.4em]')}
    />
  );
}

const LABEL = 'text-[13px] font-medium text-pv-fg';
const PANEL = 'space-y-3 rounded-2xl border border-pv-border bg-pv-card p-4';

/* ─────────────────────────────── password ──────────────────────────────── */

/** The password form, open. `onDone` runs once the password is set. */
export function PasswordChangeForm({
  onCancel,
  onDone,
  submitLabel = 'Confirm and update',
}: {
  onCancel: () => void;
  onDone: () => void | Promise<void>;
  submitLabel?: string;
}) {
  const { user } = useAccountUser();
  const { tenant } = useTenant();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = user?.email ?? '';

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
      setCodeSent(true);
    } catch (cause) {
      setError(message(cause, 'We could not send the code. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      const { error: codeError } = await supabase.auth.verifyOtp({ type: 'email', email: address, token: code.trim() });
      if (codeError) throw new Error(`That code didn't work. ${codeError.message}`);
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await onDone();
    } catch (cause) {
      setError(message(cause, 'We could not update your password. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={PANEL}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="new-password" className={LABEL}>
            New password
          </label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 12 characters"
            className={PV_INPUT}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirm-password" className={LABEL}>
            Confirm password
          </label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="Type it again"
            className={PV_INPUT}
          />
        </div>
      </div>

      {codeSent ? (
        <div className="space-y-1.5">
          <label htmlFor="password-code" className={LABEL}>
            Six-digit code
          </label>
          <CodeInput id="password-code" value={code} onChange={setCode} disabled={busy} autoFocus />
          <p className="text-[12px] text-pv-muted-fg">
            We emailed this to {address} to confirm it&apos;s you.{' '}
            <button
              type="button"
              className="font-medium text-pv-fg underline-offset-2 hover:underline"
              onClick={() => void sendCode()}
              disabled={busy}
            >
              Send a new code
            </button>
          </p>
        </div>
      ) : null}

      <p className="text-[12px] text-pv-muted-fg">
        At least 12 characters, with an uppercase letter, a lowercase letter and a number.
      </p>
      {error ? <RowHint tone="danger">{error}</RowHint> : null}

      <div className="flex justify-end gap-2">
        <button type="button" className={PV_BUTTON_OUTLINE_SM} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={PV_BUTTON_SM}
          onClick={() => void (codeSent ? save() : sendCode())}
          disabled={!password || !confirm || busy || (codeSent && code.trim().length < 6)}
        >
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {busy ? (codeSent ? 'Updating…' : 'Sending code…') : codeSent ? submitLabel : 'Send code'}
        </button>
      </div>
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

  const verify = async () => {
    if (!sentTo) return;
    setError(null);
    setBusy(true);
    try {
      const { error: codeError } = await supabase.auth.verifyOtp({ type: 'email_change', email: sentTo, token: code.trim() });
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
    <div className={PANEL}>
      {sentTo ? (
        <div className="space-y-1.5">
          <label htmlFor="email-code" className={LABEL}>
            Code sent to {sentTo}
          </label>
          <CodeInput id="email-code" value={code} onChange={setCode} disabled={busy} autoFocus />
          <p className="text-[12px] text-pv-muted-fg">
            <ShieldCheck aria-hidden className="mr-1 inline size-3.5" />
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
          <p className="text-[12px] text-pv-muted-fg">
            We send a six-digit code to the new address. Your email only changes once you enter it.
          </p>
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
