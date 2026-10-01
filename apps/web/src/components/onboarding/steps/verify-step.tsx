"use client";

/**
 * The emailed code, between the account form and anything that costs money.
 *
 * Only ever reached when `signup-begin` answered `requiresVerification: true`.
 * The server decides that, not the browser — see the note on that field.
 *
 * ── WHAT THIS SCREEN IS CAREFUL ABOUT ──────────────────────────────────────
 *
 * It is the first wall between someone and a portal, and the two ways to get it
 * wrong pull in opposite directions. Too strict and a real operator with a slow
 * mail server is stuck on it; too loose and the address is not proven at all.
 * So: the code is six digits with a capped number of attempts, and the ONLY way
 * past is a correct one — but Resend is always one click away, and the server
 * tells us how many attempts are left rather than failing silently.
 *
 * It does not offer "skip for now". A verification step that can be skipped is
 * a verification step that does not exist.
 */

import * as React from "react";
import { Loader2, MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Mirrors OTP_RESEND_COOLDOWN_MS in supabase/functions/_shared/signup-otp.ts. */
const RESEND_COOLDOWN_SECONDS = 60;

export interface VerifyStepProps {
  email: string;
  busy: boolean;
  /** Resolves true once the address is confirmed. */
  onVerify(code: string): Promise<boolean>;
  onResend(): Promise<void>;
  /** Back to the account form, e.g. the address was typed wrong. */
  onUseDifferentEmail(): void;
  error: string | null;
  onClearError(): void;
}

export function VerifyStep({
  email,
  busy,
  onVerify,
  onResend,
  onUseDifferentEmail,
  error,
  onClearError,
}: VerifyStepProps) {
  const [code, setCode] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(RESEND_COOLDOWN_SECONDS);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* The cooldown starts immediately: a code was sent to get here. */
  React.useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const submit = React.useCallback(
    async (value: string) => {
      if (submitting || value.length !== 6) return;
      setSubmitting(true);
      try {
        const ok = await onVerify(value);
        // Wrong code: clear it so the next attempt starts from an empty box
        // rather than making them select six characters to delete.
        if (!ok) {
          setCode("");
          inputRef.current?.focus();
        }
      } finally {
        setSubmitting(false);
      }
    },
    [onVerify, submitting],
  );

  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (error) onClearError();
    // Submit on the sixth digit. Typing a code and then hunting for a button is
    // the one interaction everybody expects to be automatic.
    if (digits.length === 6) void submit(digits);
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    onClearError();
    setCode("");
    await onResend();
    setCooldown(RESEND_COOLDOWN_SECONDS);
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <MailCheck className="size-4 text-primary" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-otp">Verification code</Label>
        <Input
          ref={inputRef}
          id="signup-otp"
          /* `inputMode` and `autoComplete` together are what make a phone offer
             the code from the notification instead of making them retype it. */
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="000000"
          value={code}
          disabled={busy || submitting}
          onChange={(e) => onChange(e.target.value)}
          className="text-center text-xl tracking-[0.5em]"
          aria-describedby={error ? "signup-otp-error" : undefined}
          aria-invalid={!!error}
        />
        {error ? (
          <p id="signup-otp-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <Button
        type="button"
        className="w-full"
        disabled={code.length !== 6 || busy || submitting}
        onClick={() => void submit(code)}
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Checking…
          </>
        ) : (
          "Verify and continue"
        )}
      </Button>

      <div className="flex items-center justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={cooldown > 0 || busy || submitting}
          className="text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
        <button
          type="button"
          onClick={onUseDifferentEmail}
          disabled={busy || submitting}
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}
