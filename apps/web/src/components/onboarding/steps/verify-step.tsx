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
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ScreenHead, SIGNUP_HIT, SIGNUP_PRIMARY, SIGNUP_QUIET } from "@/components/onboarding/signup-ui";
import { resendCooldownSeconds } from "@/components/onboarding/pending-verify";
import { MAIL_WEB_URL, openMailApp, type MailProvider } from "@/components/onboarding/mail-apps";

/** Mirrors OTP_RESEND_COOLDOWN_MS in supabase/functions/_shared/signup-otp.ts. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * True on a phone or tablet: a touch screen with no mouse. The mail-app
 * buttons are for people who would otherwise have to leave the browser to find
 * the code; on a laptop the inbox is one tab away and the buttons are noise.
 * Read after mount, so the server render and the first client render agree.
 */
function useTouchOnly(): boolean {
  const [touch, setTouch] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    setTouch(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setTouch(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return touch;
}

/** Gmail's mark, inline (no third-party image request on the signup). */
function GmailLogo() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-[18px] shrink-0">
      <path fill="#4caf50" d="M45 16.2l-5 2.75-5 4.75V40h7c1.657 0 3-1.343 3-3V16.2z" />
      <path fill="#1e88e5" d="M3 16.2l3.614 1.71L13 23.7V40H6c-1.657 0-3-1.343-3-3V16.2z" />
      <path fill="#e53935" d="M35 11.2l-11 8.25-11-8.25-1 5.8 1 6.7 11 8.25 11-8.25 1-6.7z" />
      <path fill="#c62828" d="M3 12.298V16.2l10 7.5V11.2L9.876 8.859A4.3 4.3 0 0 0 7.298 8C4.924 8 3 9.924 3 12.298z" />
      <path fill="#fbc02d" d="M45 12.298V16.2l-10 7.5V11.2l3.124-2.341A4.3 4.3 0 0 1 40.702 8C43.076 8 45 9.924 45 12.298z" />
    </svg>
  );
}

/** Outlook's mark, simplified and inline: the blue envelope with the "O" tile. */
function OutlookLogo() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-[18px] shrink-0">
      <rect x="18" y="9" width="27" height="30" rx="3" fill="#28a8ea" />
      <path fill="#0078d4" d="M18 18l13.5 9L45 18v18a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3z" />
      <rect x="3" y="12" width="24" height="24" rx="3" fill="#0364b8" />
      <ellipse cx="15" cy="24" rx="5.6" ry="6.6" fill="none" stroke="#ffffff" strokeWidth="3" />
    </svg>
  );
}

const MAIL_BUTTONS: readonly { provider: MailProvider; label: string; Logo: () => React.JSX.Element }[] = [
  { provider: "gmail", label: "Open Gmail", Logo: GmailLogo },
  { provider: "outlook", label: "Open Outlook", Logo: OutlookLogo },
];

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
  /**
   * When the code on screen was sent (Date.now()). A code screen restored after
   * a reload starts the resend countdown from here rather than from 60 again.
   */
  sentAt?: number | null;
}

export function VerifyStep({
  email,
  busy,
  onVerify,
  onResend,
  onUseDifferentEmail,
  error,
  onClearError,
  sentAt = null,
}: VerifyStepProps) {
  const [code, setCode] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [cooldown, setCooldown] = React.useState(() =>
    sentAt ? resendCooldownSeconds(sentAt) : RESEND_COOLDOWN_SECONDS,
  );
  const touchOnly = useTouchOnly();
  /* Only so the active box can show a caret — the real one is invisible. */
  const [focused, setFocused] = React.useState(true);
  // Set when the mail app did not open (an iPhone without it, or an in-app
  // browser): the web inbox is then offered as a link to tap.
  const [mailFallback, setMailFallback] = React.useState<MailProvider | null>(null);
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

  // A ref, not the `submitting` state: a paste can reach `submit` twice before
  // React re-renders, and the second copy of an already-spent code comes back
  // "not valid" over the top of the first one's success.
  const inFlightRef = React.useRef(false);

  const submit = React.useCallback(
    async (value: string) => {
      if (inFlightRef.current || value.length !== 6) return;
      inFlightRef.current = true;
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
        inFlightRef.current = false;
        setSubmitting(false);
      }
    },
    [onVerify],
  );

  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (error) onClearError();
    // Submit on the sixth digit. Typing a code and then hunting for a button is
    // the one interaction everybody expects to be automatic.
    if (digits.length === 6) void submit(digits);
  };

  // A code copied out of an email rarely arrives clean: Gmail brings a space or
  // a line break with it, and the email may space the digits out. Read the
  // clipboard ourselves and keep only the digits, replacing whatever was typed.
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const digits = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!digits) return;
    e.preventDefault();
    onChange(digits);
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
    <div className="space-y-6">
      <ScreenHead
        title="Check your inbox"
        lead={
          <>
            I sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>. Type it in and we&apos;re through.
          </>
        }
      />

      <div className="space-y-2">
        <Label htmlFor="signup-otp" className="sr-only">Verification code</Label>

        {/*
          SIX BOXES, ONE INPUT.

          The boxes are drawn; the thing being typed into is a single field laid
          transparently over them. Six real inputs is the usual way to build
          this and it is the reason so many of them misbehave: each one needs
          focus moved on entry and on backspace, a pasted code has to be split
          across them by hand, and the browser no longer sees one field to
          autofill — which costs exactly the `one-time-code` autofill that lets
          a phone offer the code from the notification.

          With one field all of that is free: paste, backspace, autofill and
          selection are the browser's own, and the boxes are just a view of
          `code`.
        */}
        <div className="relative">
          <Input
            ref={inputRef}
            id="signup-otp"
            /* `inputMode` and `autoComplete` together are what make a phone
               offer the code from the notification instead of making them
               retype it. */
            name="one-time-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            enterKeyHint="done"
            /* No `maxLength`: the browser clips a paste to it BEFORE onChange
               sees it, so " 220465" arrived as " 22046". `onChange` keeps the
               first six digits itself. */
            value={code}
            disabled={busy || submitting}
            onChange={(e) => onChange(e.target.value)}
            onPaste={onPaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-describedby={error ? "signup-otp-error" : undefined}
            aria-invalid={!!error}
            /* Invisible, but still the real input: it keeps its own caret and
               selection, so it must sit exactly over the boxes and stay the
               full height of them. `text-transparent` rather than `hidden`,
               which would take it out of the tab order and off the a11y tree. */
            className="absolute inset-0 h-14 w-full cursor-pointer bg-transparent text-transparent caret-transparent opacity-0"
          />
          <div className="pointer-events-none flex items-center justify-between gap-2" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => {
              const char = code[i] ?? "";
              // The caret sits on the next empty box, and stays on the last one
              // once all six are in.
              const active = focused && !busy && !submitting && (i === code.length || (code.length === 6 && i === 5));
              return (
                <div
                  key={i}
                  className={cn(
                    "flex h-14 flex-1 items-center justify-center rounded-xl border text-2xl font-semibold tabular-nums transition-colors duration-200 ease-out motion-reduce:transition-none",
                    "border-zinc-200 bg-white text-foreground dark:border-white/10 dark:bg-white/[0.03]",
                    char && "border-zinc-300 dark:border-white/20",
                    error && "border-destructive",
                    active && !error && "border-indigo-500 ring-[3px] ring-indigo-500/20 dark:border-indigo-400",
                    (busy || submitting) && "opacity-60",
                  )}
                >
                  {char || (active ? <span className="h-6 w-px animate-pulse bg-foreground" /> : null)}
                </div>
              );
            })}
          </div>
        </div>

        {error ? (
          <p id="signup-otp-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {/*
        Under the boxes, phones only. Leaving the browser to find the code is where phone
        signups were lost; these open the mail app and leave this tab where it
        is. Secondary on purpose: Verify stays the one primary action.
      */}
      {touchOnly ? (
        <div className="-mt-2 grid grid-cols-2 gap-2.5">
          {MAIL_BUTTONS.map(({ provider, label, Logo }) => (
            <Button
              key={provider}
              type="button"
              variant="outline"
              onClick={() => {
                setMailFallback(null);
                openMailApp(provider, setMailFallback);
              }}
              className="h-11 gap-2 rounded-xl border-zinc-200 bg-white text-[14px] font-medium text-foreground shadow-none dark:border-white/10 dark:bg-white/[0.03]"
            >
              <Logo />
              {label}
            </Button>
          ))}
          {mailFallback && (
            <p className="col-span-2 text-center text-[13px] text-muted-foreground" role="status">
              {mailFallback === "gmail" ? "Gmail" : "Outlook"} app didn&rsquo;t open.{" "}
              <a
                href={MAIL_WEB_URL[mailFallback]}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                onClick={() => setMailFallback(null)}
              >
                Open it in your browser
              </a>
            </p>
          )}
        </div>
      ) : null}

      {/*
        The same indigo the dialog's own primary buttons use — "Continue to
        payment" sits a few pixels below this one, and the default variant read
        as a dead grey slab beside it. Disabled still dims, so the button is
        honest about not being pressable until six digits are in.
      */}
      <Button
        type="button"
        className={SIGNUP_PRIMARY}
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
          className={cn(SIGNUP_HIT, "font-medium text-indigo-600 underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline dark:text-indigo-400")}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
        <button
          type="button"
          onClick={onUseDifferentEmail}
          disabled={busy || submitting}
          className={cn(SIGNUP_QUIET, SIGNUP_HIT)}
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}
