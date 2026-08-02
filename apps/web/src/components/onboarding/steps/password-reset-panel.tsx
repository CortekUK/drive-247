"use client";

/**
 * Password recovery, rendered INSIDE the onboarding dialog's Account step.
 *
 * It is deliberately not a second <Dialog>. The onboarding shell already owns an
 * open Radix dialog with its own focus trap and its own close-confirmation;
 * stacking another one inside it produces two competing traps and an Escape key
 * that closes the wrong layer. This is a plain panel that swaps out the sign-in
 * form and hands control back when it is finished.
 *
 * It is also self-contained: it holds its own state rather than adding steps to
 * the provider's reducer, because a reset is a DETOUR, not a step. The signup
 * state machine's `ALLOWED_TRANSITIONS` describes a linear purchase funnel, and
 * threading a side-quest through it would let a user land on "payment" with no
 * account.
 *
 * The security posture it has to cooperate with (enforced server-side in
 * supabase/functions/signup-password-reset):
 *   - the request step ALWAYS reports the same thing, so this UI must never
 *     claim an email "was sent" to a real account, only that one is on its way
 *     if the address qualifies;
 *   - verification and the password write are ONE call, so there is no
 *     intermediate "code accepted" screen to render.
 */

import * as React from "react";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  MailCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  signupResetComplete,
  signupResetRequest,
  toOnboardingError,
} from "@/components/onboarding/onboarding-api";
import {
  isPasswordAcceptable,
  passwordRuleState,
  passwordStrength,
} from "@/lib/signup-validation";

/**
 * Any thrown value -> a sentence to show. Routes through `toOnboardingError` so
 * a server `code` picks up the shared copy map, and an abort/network failure
 * still yields something human rather than "[object Object]".
 */
function toOnboardingErrorMessage(e: unknown): string {
  return toOnboardingError(e).message;
}

/** Must match REQUEST_COOLDOWN_MS in the edge function, or the UI lies. */
const RESEND_COOLDOWN_SECONDS = 60;

interface PasswordResetPanelProps {
  /** The address the sign-in branch was already showing. Never editable here. */
  email: string;
  /** Return to the sign-in form without changing anything. */
  onCancel: () => void;
  /**
   * Password successfully changed. The parent puts the user back on the sign-in
   * form with a success note; we deliberately do NOT auto-sign-in, because the
   * server has just revoked sessions and a silent re-auth would race that.
   */
  onDone: () => void;
}

type View = "request" | "verify";

export function PasswordResetPanel({
  email,
  onCancel,
  onDone,
}: PasswordResetPanelProps) {
  const [view, setView] = React.useState<View>("request");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [cooldown, setCooldown] = React.useState(0);

  // Focus lands on the heading of whichever view is showing. Without this the
  // panel swaps under a screen reader with no announcement and focus stranded
  // on a button that no longer exists.
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  React.useEffect(() => {
    headingRef.current?.focus();
  }, [view]);

  // Cooldown ticker. Cleared on unmount so a user who closes the dialog
  // mid-countdown does not leave an interval running against a dead component.
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const requestCode = React.useCallback(
    async (isResend: boolean) => {
      if (busy || cooldown > 0) return;
      setBusy(true);
      setError(null);
      try {
        await signupResetRequest(email);
        setCooldown(RESEND_COOLDOWN_SECONDS);
        setView("verify");
        if (isResend) {
          // Any code already typed belongs to the superseded email.
          setCode("");
        }
      } catch (e) {
        setError(toOnboardingErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, cooldown, email],
  );

  const rules = passwordRuleState(password);
  const strength = passwordStrength(password);
  const passwordOk = isPasswordAcceptable(password);
  const confirmOk = confirm.length > 0 && confirm === password;
  const canSubmit =
    !busy && code.length === 6 && passwordOk && confirmOk;

  const submit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      setBusy(true);
      setError(null);
      try {
        await signupResetComplete({ email, code, newPassword: password });
        onDone();
      } catch (err) {
        setError(toOnboardingErrorMessage(err));
        // The code is spent on the server whether or not the password write
        // succeeded, so never leave a stale one in the box inviting a retry
        // that cannot work.
        setCode("");
      } finally {
        setBusy(false);
      }
    },
    [canSubmit, code, email, onDone, password],
  );

  // -------------------------------------------------------------------------
  // View 1 — confirm the address and ask for a code.
  // -------------------------------------------------------------------------
  if (view === "request") {
    return (
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
        <div className="flex size-10 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/40">
          <KeyRound className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="mt-4 text-lg font-semibold tracking-tight outline-none"
        >
          Reset your password
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          We&apos;ll email a 6-digit code to{" "}
          <span className="font-medium text-foreground">{email}</span>. It expires
          in 15 minutes.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            disabled={busy}
            onClick={() => void requestCode(false)}
            className="bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Send reset code"
            )}
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={busy}
            onClick={onCancel}
            className="text-indigo-600 dark:text-indigo-400"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // View 2 — code + new password + confirm, submitted as ONE request.
  // -------------------------------------------------------------------------
  return (
    <form
      onSubmit={submit}
      noValidate
      className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/40">
        <MailCheck className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
      </div>
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 text-lg font-semibold tracking-tight outline-none"
      >
        Check your email
      </h3>
      {/*
        Carefully worded. The server responds identically for an unknown or
        ineligible address, so promising "we sent you a code" would be a lie in
        those branches — and a lie that doubles as an account-existence oracle.
      */}
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        If <span className="font-medium text-foreground">{email}</span> can be
        reset from here, a 6-digit code is on its way. Enter it below with your
        new password.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <Label htmlFor="signup-reset-code">6-digit code</Label>
          <Input
            id="signup-reset-code"
            name="one-time-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={code}
            disabled={busy}
            aria-describedby="signup-reset-code-hint"
            onChange={(e) => {
              // Strip non-digits so a pasted "123 456" or "code: 123456" still
              // lands as six usable characters instead of silently failing.
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError(null);
            }}
            className="mt-1.5 h-10 font-mono text-lg tracking-[0.4em]"
          />
          <p
            id="signup-reset-code-hint"
            className="mt-1.5 text-xs text-muted-foreground"
          >
            Expires 15 minutes after it was sent.
          </p>
        </div>

        <div>
          <Label htmlFor="signup-reset-password">New password</Label>
          <Input
            id="signup-reset-password"
            type="password"
            autoComplete="new-password"
            value={password}
            disabled={busy}
            aria-invalid={password.length > 0 && !passwordOk}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            className="mt-1.5 h-10"
          />
          {password.length > 0 && (
            <div className="mt-2" aria-live="polite">
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full transition-all",
                    strength.score <= 1
                      ? "bg-red-500"
                      : strength.score === 2
                        ? "bg-amber-500"
                        : "bg-green-600",
                  )}
                  style={{ width: `${strength.percent}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {strength.label}
              </p>
              <ul className="mt-2 space-y-1">
                {rules.map(({ rule, met }) => (
                  <li
                    key={rule.label}
                    className={cn(
                      "text-xs",
                      met
                        ? "text-green-600 dark:text-green-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {met ? "✓" : "•"} {rule.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="signup-reset-confirm">Confirm new password</Label>
          <Input
            id="signup-reset-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            disabled={busy}
            aria-invalid={confirm.length > 0 && !confirmOk}
            aria-describedby={
              confirm.length > 0 && !confirmOk
                ? "signup-reset-confirm-error"
                : undefined
            }
            onChange={(e) => {
              setConfirm(e.target.value);
              setError(null);
            }}
            className="mt-1.5 h-10"
          />
          {confirm.length > 0 && !confirmOk && (
            <p
              id="signup-reset-confirm-error"
              role="alert"
              className="mt-1.5 text-sm text-red-600 dark:text-red-400"
            >
              Both passwords must match.
            </p>
          )}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="submit"
          disabled={!canSubmit}
          className="bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Updating…
            </>
          ) : (
            "Set new password"
          )}
        </Button>
        <Button
          type="button"
          variant="link"
          disabled={busy || cooldown > 0}
          onClick={() => void requestCode(true)}
          className="text-indigo-600 dark:text-indigo-400"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </Button>
        <Button
          type="button"
          variant="link"
          disabled={busy}
          onClick={onCancel}
          className="text-muted-foreground"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Small success note the Account step shows after a completed reset. */
export function PasswordResetSuccessNote() {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-400">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      Password updated. Sign in with your new password to carry on.
    </p>
  );
}
