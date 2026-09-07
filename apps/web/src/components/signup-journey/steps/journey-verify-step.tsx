"use client";

/**
 * Step 2 of the dialog — confirming the email address.
 *
 * THIS SCREEN DOES NOT EXIST IN THE LIVE SIGNUP YET. The real flow goes account
 * -> payment with no confirmation in between (`signup-begin` creates the auth
 * user and signs them straight in). It is written here the way the real one
 * would be: a fixed-length code, one box per digit, paste-aware,
 * keyboard-navigable, auto-submitting on the last digit, with a resend that says
 * what it did.
 *
 * The accepted code lives in `lib/signup-journey.ts` and is deliberately NOT
 * printed anywhere on this screen. The only affordance is the per-box
 * placeholder, which every four-box code input renders anyway.
 *
 * The headline and the "I've sent a code to …" sentence are the DIALOG's, not
 * this component's — there is one headline per step and it is set at the
 * dialog's scale.
 *
 * If this ever becomes real, the shape to keep is the input and its keyboard
 * handling; the parts to replace are `verify()` (which compares against a
 * constant) and `resend()` (which sends nothing).
 */

import * as React from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ACCEPTED_OTP_CODE, OTP_LENGTH } from "@/lib/signup-journey";
import { cn } from "@/lib/utils";

/** Long enough to read as a round trip, short enough not to stall. */
const VERIFY_LATENCY_MS = 650;

interface JourneyVerifyStepProps {
  onBack(): void;
  onVerified(): void;
}

export function JourneyVerifyStep({
  onBack,
  onVerified,
}: JourneyVerifyStepProps) {
  const [digits, setDigits] = React.useState<string[]>(() =>
    Array.from({ length: OTP_LENGTH }, () => ""),
  );
  const [checking, setChecking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const inputsRef = React.useRef<(HTMLInputElement | null)[]>([]);
  /**
   * Guards the auto-submit. Without it, the effect that fires on a complete code
   * re-fires on every subsequent render while the check is in flight, and the
   * same code is submitted three times.
   */
  const submittedRef = React.useRef(false);

  const code = digits.join("");
  const complete = code.length === OTP_LENGTH;

  React.useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  const focusBox = (index: number) => {
    const clamped = Math.max(0, Math.min(OTP_LENGTH - 1, index));
    const box = inputsRef.current[clamped];
    box?.focus();
    box?.select();
  };

  const clear = React.useCallback((refocus: boolean) => {
    submittedRef.current = false;
    setDigits(Array.from({ length: OTP_LENGTH }, () => ""));
    if (refocus) {
      // After the state flush, or the boxes still hold their old values and
      // `select()` highlights a character that is about to disappear.
      window.setTimeout(() => inputsRef.current[0]?.focus(), 0);
    }
  }, []);

  const verify = React.useCallback(
    (entered: string) => {
      if (checking) return;
      setChecking(true);
      setError(null);
      setNotice(null);

      window.setTimeout(() => {
        setChecking(false);
        if (entered === ACCEPTED_OTP_CODE) {
          onVerified();
          return;
        }
        setError("That code isn't right. Check it and try again.");
        clear(true);
      }, VERIFY_LATENCY_MS);
    },
    [checking, clear, onVerified],
  );

  // Auto-submit the moment the last box is filled — the whole point of one box
  // per digit is that nobody has to reach for a button.
  React.useEffect(() => {
    if (!complete || submittedRef.current) return;
    submittedRef.current = true;
    verify(code);
  }, [complete, code, verify]);

  const setDigitAt = (index: number, value: string) => {
    setError(null);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleChange = (index: number, raw: string) => {
    const digitsOnly = raw.replace(/\D/g, "");
    if (!digitsOnly) {
      setDigitAt(index, "");
      return;
    }
    // Typing over a filled box replaces it, so take the LAST character rather
    // than the first — the first is the value that was already there.
    setDigitAt(index, digitsOnly[digitsOnly.length - 1]);
    if (index < OTP_LENGTH - 1) focusBox(index + 1);
  };

  const handleKeyDown = (
    index: number,
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    switch (event.key) {
      case "Backspace":
        // An empty box hands the deletion backwards, which is what every OTP
        // input people have used before does.
        if (!digits[index]) {
          event.preventDefault();
          setDigitAt(index - 1 < 0 ? 0 : index - 1, "");
          focusBox(index - 1);
        }
        return;
      case "ArrowLeft":
        event.preventDefault();
        focusBox(index - 1);
        return;
      case "ArrowRight":
        event.preventDefault();
        focusBox(index + 1);
        return;
      case "Home":
        event.preventDefault();
        focusBox(0);
        return;
      case "End":
        event.preventDefault();
        focusBox(OTP_LENGTH - 1);
        return;
      default:
        return;
    }
  };

  /**
   * A pasted code lands whole, wherever it is dropped.
   *
   * Non-digits are stripped first so "code: 4821" and "4 8 2 1" both work — the
   * two shapes people actually paste out of an email.
   */
  const handlePaste = (
    index: number,
    event: React.ClipboardEvent<HTMLInputElement>,
  ) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    event.preventDefault();
    setError(null);
    setDigits((prev) => {
      const next = [...prev];
      for (let i = 0; i < pasted.length && index + i < OTP_LENGTH; i++) {
        next[index + i] = pasted[i];
      }
      return next;
    });
    focusBox(index + pasted.length);
  };

  const resend = () => {
    clear(true);
    setError(null);
    setNotice("I've sent you a fresh code. It can take a moment to arrive.");
  };

  return (
    <form
      // Enter submits from any box: the form's own submit handler runs the same
      // check the last-digit auto-submit does, and an incomplete code jumps to
      // the first empty box instead of failing.
      onSubmit={(event) => {
        event.preventDefault();
        if (complete) verify(code);
        else focusBox(digits.findIndex((d) => !d));
      }}
      noValidate
    >
      {/*
        `role="group"` with a label, rather than four separately-labelled inputs:
        this is one value spread across four boxes, and a screen reader should
        hear it announced once.
      */}
      <div
        role="group"
        aria-label={`${OTP_LENGTH}-digit confirmation code`}
        aria-describedby="journey-otp-status"
        className="flex gap-3 sm:gap-4"
      >
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              inputsRef.current[index] = element;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
            aria-invalid={Boolean(error)}
            maxLength={1}
            placeholder="0"
            value={digit}
            disabled={checking}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={(event) => handlePaste(index, event)}
            onFocus={(event) => event.currentTarget.select()}
            className={cn(
              "h-16 w-full max-w-[5rem] rounded-xl border bg-transparent text-center font-mono text-3xl transition-[color,box-shadow] outline-none sm:h-[4.5rem]",
              "placeholder:text-muted-foreground/25",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error &&
                "border-red-500 focus-visible:ring-red-500/30 dark:border-red-500",
            )}
          />
        ))}
      </div>

      {/* One polite region for every outcome — checking, wrong, resent. */}
      <div id="journey-otp-status" aria-live="polite" className="mt-4 min-h-5">
        {checking ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Checking your code…
          </p>
        ) : error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : notice ? (
          <p className="text-sm text-muted-foreground">{notice}</p>
        ) : null}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={!complete || checking}
        className="mt-7 h-12 w-full bg-indigo-600 text-[15px] text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        {checking ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking…
          </>
        ) : (
          <>
            Confirm and continue
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </>
        )}
      </Button>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <button
          type="button"
          onClick={resend}
          disabled={checking}
          className="font-medium underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
        >
          Send the code again
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={checking}
          className="font-medium underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
        >
          Use a different email
        </button>
      </div>
    </form>
  );
}
