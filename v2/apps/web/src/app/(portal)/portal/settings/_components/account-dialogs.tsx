'use client';

/**
 * The two changes that touch `auth.users` rather than `customers`: the password
 * and the sign-in email.
 *
 * Both go through `supabase.auth.updateUser()`, and both therefore unmount the
 * page that opened them — see the header of `sticky-notice.ts`. That is why
 * neither dialog reports its own success: it parks the message and closes, and
 * the settings page shows it when it comes back. A failure is reported IN the
 * dialog, because a failure emits no auth event and nothing is torn down.
 *
 * The controls are the auth forms' own (`AuthPasswordField`,
 * `AuthTextField`) rather than a second set: the 44px sizing, the reveal
 * toggle and the error markup are already settled there, and a copy would drift
 * the first time one of them is adjusted.
 */

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  AuthPasswordField,
  AuthTextField,
  FormNotice,
  useFieldIds,
} from '@/app/(auth)/_components/auth-fields';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';

import { parkNotice } from './sticky-notice';

/**
 * Supabase's own floor is 6 characters; this asks for 8.
 *
 * Checked here as well as by the server so the customer is told before a
 * round-trip, but the server's answer still wins — if the project is later
 * configured to demand more, its message is surfaced verbatim rather than
 * being masked by a client rule that has gone stale.
 */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Deliberately permissive: one `@`, something either side, a dot in the domain.
 * A stricter regex rejects real addresses, and the address is proven by the
 * confirmation link anyway — this is only here to catch a typo before we send
 * mail into a void.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ───────────────────────────── password ────────────────────────────────── */

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ids = useFieldIds(['password', 'confirm'] as const);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    password?: string;
    confirm?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Clear on every open, not on close: closing mid-request would otherwise wipe
  // the fields under a submit that is still in flight, and a half-typed
  // password must never survive into the next time the dialog is opened.
  useEffect(() => {
    if (!open) return;
    setPassword('');
    setConfirm('');
    setFieldErrors({});
    setFormError(null);
    setPending(false);
  }, [open]);

  const submit = async () => {
    const errors: { password?: string; confirm?: string } = {};

    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (confirm === '') {
      errors.confirm = 'Type your new password again.';
    } else if (confirm !== password) {
      errors.confirm = 'These do not match.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setFormError(null);
    setPending(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setPending(false);
      setFormError(error.message || 'We could not change your password.');
      return;
    }

    // Do not setState past this point and assume it renders — the auth event
    // this call emits unmounts the page under us. Park the message instead.
    parkNotice({
      tone: 'success',
      message:
        'Your password has been changed. You will use the new one next time you sign in.',
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change your password</DialogTitle>
          <DialogDescription>
            You are signed in, so we do not need your old password. Choose one
            of at least {MIN_PASSWORD_LENGTH} characters.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          // See the note on the email form below — same reason, kept identical
          // so the two dialogs cannot report a bad value in two different ways.
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {formError ? <FormNotice tone="danger">{formError}</FormNotice> : null}

          <AuthPasswordField
            id={ids.password}
            label="New password"
            value={password}
            autoComplete="new-password"
            disabled={pending}
            error={fieldErrors.password}
            onChange={(value) => {
              setPassword(value);
              setFieldErrors((previous) => ({ ...previous, password: undefined }));
            }}
          />

          <AuthPasswordField
            id={ids.confirm}
            label="Confirm new password"
            value={confirm}
            autoComplete="new-password"
            disabled={pending}
            error={fieldErrors.confirm}
            onChange={(value) => {
              setConfirm(value);
              setFieldErrors((previous) => ({ ...previous, confirm: undefined }));
            }}
          />

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="brand-outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
              className="h-11 w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="brand"
              disabled={pending}
              aria-busy={pending}
              className="h-11 w-full sm:w-auto"
            >
              {pending ? (
                <>
                  <Loader2 aria-hidden className="animate-spin" />
                  Changing…
                </>
              ) : (
                'Change password'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────── email ──────────────────────────────────── */

export function ChangeEmailDialog({
  open,
  onOpenChange,
  currentEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentEmail: string;
}) {
  const ids = useFieldIds(['email'] as const);

  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setFieldError(undefined);
    setFormError(null);
    setPending(false);
  }, [open]);

  const submit = async () => {
    const trimmed = email.trim();

    if (trimmed === '') {
      setFieldError('Enter the address you want to use.');
      return;
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      setFieldError('That does not look like an email address.');
      return;
    }
    // Case-insensitive: addresses are matched that way, and "Ada@…" vs "ada@…"
    // would otherwise send a confirmation mail for a change to the same inbox.
    if (trimmed.toLowerCase() === currentEmail.trim().toLowerCase()) {
      setFieldError('That is already your email address.');
      return;
    }

    setFieldError(undefined);
    setFormError(null);
    setPending(true);

    const { error } = await supabase.auth.updateUser({ email: trimmed });

    if (error) {
      setPending(false);
      setFormError(error.message || 'We could not start the email change.');
      return;
    }

    parkNotice({
      tone: 'info',
      message: `Check ${trimmed} for a confirmation link. Your sign-in address changes once you have opened it — until then, keep using ${currentEmail}.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change your email address</DialogTitle>
          <DialogDescription>
            We will send a confirmation link to the new address. Nothing changes
            until you open it.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          /*
            `noValidate` is load-bearing, not tidiness.

            The field is `<input type="email">`, so the BROWSER refuses to submit
            a malformed value and pops its own native bubble — `onSubmit` never
            fires and the checks below never run. Verified in Chrome: typing
            "not-an-email" produced no message from this component at all.

            Turning the native pass off puts every message back in one place and
            in the app's own styling, and lets the stricter rule above actually
            apply — Chrome accepts "a@b", which has no deliverable domain.
          */
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {formError ? <FormNotice tone="danger">{formError}</FormNotice> : null}

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-brand-text-soft">
              Current address
            </p>
            <p className="min-h-11 rounded-md border border-brand-border-soft bg-brand-stone/50 px-3 py-2.5 text-sm break-all text-brand-text">
              {currentEmail}
            </p>
          </div>

          <AuthTextField
            id={ids.email}
            label="New email address"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            disabled={pending}
            error={fieldError}
            onChange={(value) => {
              setEmail(value);
              setFieldError(undefined);
            }}
          />

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="brand-outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
              className="h-11 w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="brand"
              disabled={pending}
              aria-busy={pending}
              className="h-11 w-full sm:w-auto"
            >
              {pending ? (
                <>
                  <Loader2 aria-hidden className="animate-spin" />
                  Sending…
                </>
              ) : (
                'Send confirmation link'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
