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
 * It is also not a step in the provider's reducer, because a reset is a DETOUR,
 * not a step. The signup state machine's `ALLOWED_TRANSITIONS` describes a
 * linear purchase funnel, and threading a side-quest through it would let a user
 * land on "payment" with no account.
 *
 * What it does NOT own is the state that has to outlive it. `view` and the
 * resend cooldown are props, held by the Account step: the panel unmounts every
 * time the user presses "Back to sign in", and a cooldown that dies with it lets
 * the user re-request inside the server's 60 s window — where the server sends
 * NOTHING, still answers `ok`, and this panel would cheerfully report that a
 * code is on its way. `busy` is reported upwards for a related reason: the shell
 * decides whether the dialog can be closed, and it cannot refuse to close over a
 * write it does not know about.
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
  Check,
  CheckCircle2,
  Circle,
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
import type { SignupErrorCode } from "@/components/onboarding/onboarding-types";
import {
  PasswordToggle,
  STRENGTH_BAR_CLASS,
} from "@/components/onboarding/password-toggle";
import {
  isPasswordAcceptable,
  passwordRuleState,
  passwordStrength,
} from "@/lib/signup-validation";

/**
 * Any thrown value -> the server's code plus a sentence to show.
 *
 * The code is carried, not just the message, because it is the ONLY way to tell
 * a failure that spent the user's code from one that did not — see `submit`.
 *
 * The message is deliberately the server's own string rather than
 * `SIGNUP_ERROR_COPY[code]`: the reset function reuses RESET_PASSWORD_WEAK for
 * both "too short" and "longer than 72 characters", and the shared copy only
 * describes the first. `toOnboardingError` already falls back to the shared copy
 * when the server sent no message of its own, and turns an abort or a network
 * failure into something human rather than "[object Object]".
 */
function toResetError(e: unknown): { code: SignupErrorCode; message: string } {
  const err = toOnboardingError(e);
  return { code: err.code, message: err.message };
}

/** Must match REQUEST_COOLDOWN_MS in the edge function, or the UI lies. */
const RESEND_COOLDOWN_MS = 60_000;

/**
 * bcrypt truncates past 72 bytes, so `signup-password-reset` refuses anything
 * longer outright rather than silently storing a password that is not the one
 * the user typed. Mirrored here because the submit button was otherwise live for
 * a password the server was always going to reject.
 */
const PASSWORD_MAX_LENGTH = 72;

export type PasswordResetView = "request" | "verify";

interface PasswordResetPanelProps {
  /** The address the sign-in branch was already showing. Never editable here. */
  email: string;
  /** Which half of the detour to show. Owned by the parent so it survives a cancel. */
  view: PasswordResetView;
  onViewChange(view: PasswordResetView): void;
  /**
   * `Date.now()` after which a resend is allowed; 0 when there is none. A
   * DEADLINE rather than a seconds counter, so the countdown cannot drift when
   * the tab is backgrounded and the interval stops being serviced.
   */
  cooldownUntil: number;
  onCooldownUntilChange(until: number): void;
  /** Mirrors this panel's in-flight state to the shell, which gates closing. */
  onBusyChange(busy: boolean): void;
  /** Return to the sign-in form without changing anything. */
  onCancel: () => void;
  /**
   * Password successfully changed. The parent puts the user back on the sign-in
   * form with a success note; we deliberately do NOT auto-sign-in, because the
   * server has just revoked sessions and a silent re-auth would race that.
   */
  onDone: () => void;
}

export function PasswordResetPanel({
  email,
  view,
  onViewChange,
  cooldownUntil,
  onCooldownUntilChange,
  onBusyChange,
  onCancel,
  onDone,
}: PasswordResetPanelProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);

  /**
   * A field is only "wrong" once the user has left it or pressed the button.
   * Marking `aria-invalid` and firing a `role="alert"` mismatch from the first
   * keystroke of the confirm field tells someone they have made a mistake while
   * they are still halfway through typing the thing correctly.
   */
  const [touched, setTouched] = React.useState({ password: false, confirm: false });

  /** Visible after a resend, so a silently-cleared code box is explained. */
  const [resent, setResent] = React.useState(false);

  /**
   * The panel's own polite announcement channel. The shell's live region reads
   * the PROVIDER's `busy`, which this detour never sets, so without this every
   * send, resend and failure here is completely silent.
   */
  const [status, setStatus] = React.useState("");

  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const codeRef = React.useRef<HTMLInputElement | null>(null);

  /**
   * Unmount token.
   *
   * `signupResetComplete` owns its own timeout controller and takes no external
   * signal, so this cannot cancel the request itself — it is what tells every
   * continuation below "this panel is gone": do not touch its state, and above
   * all do not call `onDone`, which would drive a step that no longer exists.
   * The write is protected separately — while `busy` is true the shell refuses
   * to close the dialog at all, so a password change can no longer land silently
   * behind a user who has already closed the window.
   *
   * Created in an effect rather than in a ref initialiser so that React's
   * double-invoked development mount does not leave a permanently aborted
   * controller behind.
   */
  const abortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return () => controller.abort();
  }, []);
  // Stable identity, so the callbacks below can read it without listing it.
  const gone = React.useCallback(
    () => abortRef.current?.signal.aborted ?? false,
    [],
  );

  // The shell gates the close button, Escape, outside-click and the footer
  // Cancel on this. The unmount report is separate and unconditional: whatever
  // ends this panel, the dialog must not be left believing a write is running.
  React.useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  React.useEffect(() => () => onBusyChange(false), [onBusyChange]);

  /**
   * Countdown derived from the deadline, recomputed from the clock on every
   * tick. The old version rebuilt its interval on every tick (each second's
   * setState re-ran the effect) and counted intervals rather than time, so it
   * drifted and could not survive the panel being closed and reopened.
   */
  const [remaining, setRemaining] = React.useState(0);
  React.useEffect(() => {
    if (cooldownUntil <= 0) {
      setRemaining(0);
      return;
    }
    let timer = 0;
    const tick = () => {
      const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setRemaining(left);
      // Re-armed from the clock rather than run on a free interval: twice a
      // second so the number is never a full second stale, and it stops itself
      // at zero instead of leaving a timer running for the panel's whole life.
      if (left > 0) timer = window.setTimeout(tick, 500);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [cooldownUntil]);

  const cooling = remaining > 0;

  /**
   * Focus follows the view. The code input, NOT the heading: `autoFocus` on it
   * never fired, because a heading-focus effect ran after mount and took focus
   * straight back off it. The heading is still the target for the request view,
   * which is where the panel is entered from a button that is about to unmount —
   * without it focus would drop to <body>.
   */
  React.useEffect(() => {
    if (view === "verify") {
      codeRef.current?.focus();
    } else {
      headingRef.current?.focus();
    }
  }, [view]);

  const requestCode = React.useCallback(
    async (isResend: boolean) => {
      if (busy || cooling) return;
      setBusy(true);
      setError(null);
      setResent(false);
      setStatus(isResend ? "Requesting a new code." : "Requesting your reset code.");
      try {
        await signupResetRequest(email);
        if (gone()) return;
        onCooldownUntilChange(Date.now() + RESEND_COOLDOWN_MS);
        onViewChange("verify");
        if (isResend) {
          // The server deletes the previous code before minting the new one, so
          // anything already typed is now dead. Cleared — and, unlike before,
          // said out loud in both channels.
          setCode("");
          setResent(true);
          setStatus(
            "A new code is on its way if this address can be reset. The code box has been cleared — enter the most recent code.",
          );
        } else {
          setStatus(
            "Enter the 6-digit code we emailed, then choose your new password.",
          );
        }
      } catch (e) {
        if (gone()) return;
        const { message } = toResetError(e);
        setError(message);
        setStatus(message);
      } finally {
        if (!gone()) setBusy(false);
      }
    },
    [busy, cooling, email, gone, onCooldownUntilChange, onViewChange],
  );

  const rules = passwordRuleState(password);
  const strength = passwordStrength(password);
  const tooLong = password.length > PASSWORD_MAX_LENGTH;
  const passwordOk = isPasswordAcceptable(password) && !tooLong;
  const confirmOk = confirm.length > 0 && confirm === password;
  const showMismatch = touched.confirm && confirm.length > 0 && !confirmOk;
  const canSubmit = !busy && code.length === 6 && passwordOk && confirmOk;

  const submit = React.useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      // Submitting is the other way to "leave" a field, so anything still
      // unvalidated becomes fair game to complain about from here on.
      setTouched({ password: true, confirm: true });
      if (!canSubmit) return;
      setBusy(true);
      setError(null);
      setResent(false);
      setStatus("Updating your password.");
      try {
        await signupResetComplete({ email, code, newPassword: password });
        if (gone()) return;
        onDone();
      } catch (err) {
        if (gone()) return;
        const { code: failure, message } = toResetError(err);
        setError(message);
        setStatus(message);
        /**
         * ONLY these two mean the code is spent. The server rejects a malformed
         * code length, a password under 10 or over 72 characters, and every rate
         * limit BEFORE it consumes anything — and a transport failure or timeout
         * may never have reached it at all. Clearing the box for those threw
         * away a code that still worked and sent the user back for a new one
         * they did not need (which, inside the 60 s window, the server would not
         * have sent).
         */
        if (failure === "RESET_CODE_INVALID" || failure === "RESET_FAILED") {
          setCode("");
        }
      } finally {
        if (!gone()) setBusy(false);
      }
    },
    [canSubmit, code, email, gone, onDone, password],
  );

  const errorBanner = error ? (
    <p
      role="alert"
      className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400"
    >
      {error}
    </p>
  ) : null;

  return (
    <div>
      {/*
        Mounted for the panel's whole life, empty to begin with. A live region
        that is created at the same moment its content appears is never
        announced — the browser has nothing to diff it against.
      */}
      <p className="sr-only" role="status">
        {status}
      </p>

      {view === "request" ? (
        // ---------------------------------------------------------------------
        // View 1 — confirm the address and ask for a code.
        // ---------------------------------------------------------------------
        <div
          key="request"
          className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
        >
          <div className="flex size-10 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/40">
            <KeyRound className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3
            ref={headingRef}
            tabIndex={-1}
            // No `outline-none`: this heading is focused programmatically, and
            // suppressing the indicator on the one element focus lands on leaves
            // a keyboard user with no idea where they are.
            className="mt-4 rounded-sm text-lg font-semibold tracking-tight focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Reset your password
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            We&apos;ll email a 6-digit code to{" "}
            {/* break-all: a long address must not push the dialog sideways at 375px. */}
            <span className="font-medium break-all text-foreground">{email}</span>.
            It expires in 15 minutes.
          </p>

          {errorBanner}

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
            {/*
              Without this, a user holding a code from an email they already have
              is forced to request another one to reach the box they need — and
              inside the server's 60 s window that request sends nothing at all.
            */}
            <Button
              type="button"
              variant="link"
              disabled={busy}
              onClick={() => {
                setStatus("Enter the code you already have, then choose your new password.");
                onViewChange("verify");
              }}
              className="text-indigo-600 dark:text-indigo-400"
            >
              I already have a code
            </Button>
            <Button
              type="button"
              variant="link"
              disabled={busy}
              onClick={onCancel}
              className="text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Button>
          </div>
        </div>
      ) : (
        // ---------------------------------------------------------------------
        // View 2 — code + new password + confirm, submitted as ONE request.
        //
        // No `id` on this form, on purpose: the shell's footer submit button
        // targets the account step's form by id, and lending it this one would
        // put a second, differently-labelled primary in charge of the reset.
        // The shell hides that button while this panel is open instead.
        // ---------------------------------------------------------------------
        <form
          key="verify"
          onSubmit={submit}
          noValidate
          className="animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
        >
          <div className="flex size-10 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-950/40">
            <MailCheck className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="mt-4 text-lg font-semibold tracking-tight">
            Check your email
          </h3>
          {/*
            Carefully worded. The server responds identically for an unknown or
            ineligible address, so promising "we sent you a code" would be a lie in
            those branches — and a lie that doubles as an account-existence oracle.
          */}
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            If{" "}
            <span className="font-medium break-all text-foreground">{email}</span>{" "}
            can be reset from here, a 6-digit code is on its way. Enter it below
            with your new password.
          </p>

          {resent && !error && (
            <p className="mt-4 flex items-start gap-2 rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              <MailCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              New code sent, if this address can be reset. We cleared the box —
              enter the most recent code, as earlier ones stop working.
            </p>
          )}

          <div className="mt-5 space-y-4">
            {/*
              A username field the password manager can attach the new password
              to. `readOnly`, not `disabled`: a disabled input is skipped by
              autofill, which is exactly the association we are here to make.
            */}
            <div>
              <Label htmlFor="signup-reset-email">Email</Label>
              <Input
                id="signup-reset-email"
                name="username"
                type="email"
                autoComplete="username"
                value={email}
                readOnly
                className="mt-1.5 h-10 bg-muted/40"
              />
            </div>

            <div>
              <Label htmlFor="signup-reset-code">6-digit code</Label>
              <Input
                ref={codeRef}
                id="signup-reset-code"
                name="one-time-code"
                inputMode="numeric"
                autoComplete="one-time-code"
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
              <div className="relative mt-1.5">
                <Input
                  id="signup-reset-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  disabled={busy}
                  aria-invalid={touched.password && !passwordOk}
                  aria-describedby={
                    tooLong
                      ? "signup-reset-password-rules signup-reset-password-error"
                      : "signup-reset-password-rules"
                  }
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  className="h-10 pr-10"
                />
                <PasswordToggle
                  shown={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
                  fieldLabel="new password"
                />
              </div>

              {/*
                Requirement checklist + strength meter, in one polite live region
                that is mounted unconditionally — only the meter is conditional.
                Identical treatment to the create-account form's list, down to
                the icons and the sr-only met/not-met suffix, because they are
                the same two rules rendered twice.
              */}
              <div
                id="signup-reset-password-rules"
                aria-live="polite"
                className="mt-2.5 space-y-1.5"
              >
                {rules.map(({ rule, met }) => (
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

              {/*
                Shown the moment the cap is passed rather than on blur: this is
                the only thing explaining a submit button that has just gone
                dead, and there is no "still typing towards it" state for a
                maximum.
              */}
              {tooLong && (
                <p
                  id="signup-reset-password-error"
                  role="alert"
                  className="mt-1.5 text-sm text-red-600 dark:text-red-400"
                >
                  Use {PASSWORD_MAX_LENGTH} characters or fewer.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="signup-reset-confirm">Confirm new password</Label>
              <div className="relative mt-1.5">
                <Input
                  id="signup-reset-confirm"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  disabled={busy}
                  aria-invalid={showMismatch}
                  aria-describedby={
                    showMismatch ? "signup-reset-confirm-error" : undefined
                  }
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    setError(null);
                  }}
                  onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
                  className="h-10 pr-10"
                />
                <PasswordToggle
                  shown={showConfirm}
                  onToggle={() => setShowConfirm((v) => !v)}
                  fieldLabel="password confirmation"
                />
              </div>
              {showMismatch && (
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

          {errorBanner}

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
            {/*
              `aria-disabled` + an early return, never `disabled`. A disabled
              button leaves the tab order, so the countdown that was its only
              explanation could not be reached — and when it disabled itself
              under the user's own click, focus fell to <body>. This one stays
              focusable, keeps its name, and explains itself through the hint
              below, which the button is described by.
            */}
            <Button
              type="button"
              variant="link"
              aria-disabled={busy || cooling}
              aria-describedby="signup-reset-resend-hint"
              onClick={() => {
                if (busy || cooling) {
                  setStatus(
                    `You can ask for another code in ${remaining} seconds.`,
                  );
                  return;
                }
                void requestCode(true);
              }}
              className={cn(
                "text-indigo-600 dark:text-indigo-400",
                (busy || cooling) && "opacity-60 hover:no-underline",
              )}
            >
              Resend code
            </Button>
            <Button
              type="button"
              variant="link"
              disabled={busy}
              onClick={onCancel}
              className="text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Button>
          </div>

          <p
            id="signup-reset-resend-hint"
            className="mt-2 text-xs text-muted-foreground"
          >
            {cooling
              ? `You can ask for another code in ${remaining}s. Codes take a moment to arrive — check your spam folder first.`
              : "Didn't get it? Check your spam folder, then ask for a new code."}
          </p>
        </form>
      )}
    </div>
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
