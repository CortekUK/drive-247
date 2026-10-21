"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { CodeInput } from "@/components/ui-v2/code-input";
import { Input } from "@/components/ui-v2/input";
import { Label } from "@/components/ui-v2/label";

/**
 * Change password, as one well-made panel (Ghulam, Oct 21 2026: "build a
 * proper, well-designed UI for it … fix it in both places") — the customer
 * portal's Settings → Account draws the same panel on its own palette.
 *
 * Two steps under a small stepper:
 *   1. The new password, with a show/hide eye, a four-step strength bar and the
 *      rules ticking off as they are met; then the confirmation field, which
 *      says as soon as the two match. Continue sends the code.
 *   2. The six-digit code in boxes, checked the moment the last digit lands;
 *      "Send a new code" waits 30 seconds between sends.
 *
 * The flow behind it is unchanged (profile-sheet-v2.tsx header): a sign-in
 * code to the account's own address, checked with `verifyOtp({ type: "email"
 * })`, and only then `updateUser({ password })`. The caller runs both steps;
 * each resolves to an error message, or null when it worked.
 */

export const PASSWORD_RULES: ReadonlyArray<{ label: string; test: (password: string) => boolean }> = [
  { label: "12 characters or more", test: (p) => p.length >= 12 },
  { label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "A number", test: (p) => /\d/.test(p) },
];

function strengthOf(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: "" };
  const met = PASSWORD_RULES.filter((rule) => rule.test(password)).length;
  if (met < 4) return { score: met <= 1 ? 1 : 2, label: met <= 1 ? "Weak" : "Fair" };
  const extra = password.length >= 16 || /[^A-Za-z0-9]/.test(password);
  return extra ? { score: 4, label: "Strong" } : { score: 3, label: "Good" };
}

const STRENGTH_TONE = ["", "bg-destructive", "bg-amber-500", "bg-emerald-500", "bg-emerald-500"];

function Stepper({ step }: { step: 1 | 2 }) {
  return (
    <ol className="flex items-center gap-2 text-[12px]" aria-label="Steps">
      {["New password", "Confirm it's you"].map((label, index) => {
        const number = index + 1;
        const done = number < step;
        const current = number === step;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
            {index > 0 && <span aria-hidden className={cn("h-px w-6", done || current ? "bg-primary/50" : "bg-border")} />}
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                done ? "bg-primary text-primary-foreground" : current ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check aria-hidden className="size-3" strokeWidth={3} /> : number}
            </span>
            <span className={cn("font-medium", current ? "text-foreground" : "text-muted-foreground")}>{label}</span>
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
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

export function PasswordChangePanelV2({
  email,
  required,
  onSendCode,
  onSave,
  onCancel,
}: {
  /** Where the code goes. */
  email: string;
  /** `app_users.must_change_password`. */
  required?: boolean;
  onSendCode: (password: string) => Promise<string | null>;
  onSave: (password: string, code: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const strength = strengthOf(password);
  const rulesMet = PASSWORD_RULES.every((rule) => rule.test(password));
  const matches = confirm.length > 0 && confirm === password;
  const mismatch = confirm.length > 0 && confirm !== password && !password.startsWith(confirm);

  const sendCode = useCallback(async () => {
    if (!rulesMet || !matches) return;
    setBusy(true);
    setError(null);
    const problem = await onSendCode(password);
    setBusy(false);
    if (problem) return setError(problem);
    setCode("");
    setStep(2);
    setCooldown(30);
  }, [matches, onSendCode, password, rulesMet]);

  const save = useCallback(
    async (token: string) => {
      if (token.trim().length < 6 || busy) return;
      setBusy(true);
      setError(null);
      const problem = await onSave(password, token.trim());
      setBusy(false);
      if (problem) {
        setError(problem);
        setCode("");
      }
    },
    [busy, onSave, password],
  );

  return (
    <div className="space-y-5 rounded-xl border border-border p-4">
      <Stepper step={step} />

      {step === 1 ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2.5">
              <PasswordField id="new-password" label="New password" value={password} onChange={setPassword} placeholder="At least 12 characters" autoFocus />
              <div className="flex items-center gap-2" aria-live="polite">
                <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden>
                  {[1, 2, 3, 4].map((segment) => (
                    <span
                      key={segment}
                      className={cn(
                        "h-1 rounded-full transition-colors duration-200 motion-reduce:transition-none",
                        strength.score >= segment ? STRENGTH_TONE[strength.score] : "bg-muted",
                      )}
                    />
                  ))}
                </div>
                <span className="w-12 text-right text-[11px] font-medium text-muted-foreground">{strength.label}</span>
              </div>
            </div>
            <div className="space-y-2.5">
              <PasswordField id="confirm-password" label="Confirm password" value={confirm} onChange={setConfirm} placeholder="Type it again" invalid={mismatch} />
              <p
                className={cn("text-[12px]", matches ? "text-emerald-600 dark:text-emerald-400" : mismatch ? "text-destructive" : "text-muted-foreground")}
                aria-live="polite"
              >
                {matches ? "Passwords match" : mismatch ? "Passwords do not match yet" : "Type the same password again"}
              </p>
            </div>
          </div>

          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {PASSWORD_RULES.map((rule) => {
              const ok = rule.test(password);
              return (
                <li key={rule.label} className={cn("flex items-center gap-2 text-[12.5px]", ok ? "text-foreground" : "text-muted-foreground")}>
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full transition-colors duration-200 motion-reduce:transition-none",
                      ok ? "bg-emerald-500 text-white" : "border border-border",
                    )}
                  >
                    {ok && <Check className="size-2.5" strokeWidth={3.5} />}
                  </span>
                  {rule.label}
                  <span className="sr-only">{ok ? "(met)" : "(not met yet)"}</span>
                </li>
              );
            })}
          </ul>

          {required && <p className="text-[12px] font-medium text-destructive">A password change is required before continuing.</p>}
          {error && (
            <p role="alert" className="text-[12px] text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-[12px] text-muted-foreground">Next, I email a code to {email} to confirm it&apos;s you.</p>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!rulesMet || !matches || busy}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                {busy ? "Sending code…" : "Continue"}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-[15px] font-semibold text-foreground">Enter the code I emailed you</p>
            <p className="text-[13px] text-muted-foreground">
              <ShieldCheck aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
              Sent to <span className="font-medium text-foreground">{email}</span>. Your password changes once it checks out.
            </p>
          </div>
          <CodeInput id="reauth-code" value={code} onChange={setCode} onComplete={(value) => void save(value)} disabled={busy} autoFocus />
          <p className="text-[12px] text-muted-foreground">
            Didn&apos;t get it?{" "}
            <button
              type="button"
              className="font-medium text-foreground underline-offset-2 hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline"
              onClick={() => void sendCode()}
              disabled={busy || cooldown > 0}
            >
              {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
            </button>
          </p>
          {error && (
            <p role="alert" className="text-[12px] text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setError(null);
              }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft aria-hidden className="size-3.5" />
              Change the password
            </button>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void save(code)} disabled={busy || code.trim().length < 6}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                {busy ? "Updating…" : "Update password"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
