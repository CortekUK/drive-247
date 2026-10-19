'use client';

/**
 * The v2 auth forms' controls: login-v2's 48px, 16px-radius fields (a real
 * edge, because there is no card behind them), its label / error markup and
 * its submit button, as components so signup v2 and forgot-password v2 do not
 * re-type them. Same contracts as v1's `auth-fields.tsx` (value in, string out,
 * error under the field), so the v1 form logic drops in unchanged.
 */

import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react-nw';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@nw/lib/utils';

/** The auth fields' recipe (login, sign-up, forgot password v2): 48px, a real edge, no card behind. */
export const AUTH_FIELD_CLASS =
  'h-12 w-full rounded-2xl border border-slate-900/20 bg-white px-4 text-[15px] text-pv-fg shadow-[0_1px_2px_rgb(15_23_42/0.04)] outline-none transition-colors placeholder:text-slate-400 hover:border-slate-900/30 focus-visible:border-pv-primary/60 focus-visible:ring-[3px] focus-visible:ring-pv-primary/25 disabled:cursor-not-allowed disabled:opacity-60';
export const AUTH_FIELD_ERROR_CLASS =
  'border-pv-danger hover:border-pv-danger focus-visible:border-pv-danger focus-visible:ring-pv-danger/20';

/** The page's title and its one muted line. */
export function AuthHeading({ title, description }: { title: ReactNode; description: ReactNode }) {
  return (
    <div className="mb-6 space-y-1.5">
      <h1 className="text-3xl font-semibold tracking-tight text-pv-fg">{title}</h1>
      <p className="text-sm leading-relaxed text-pv-muted-fg">{description}</p>
    </div>
  );
}

function Label({ htmlFor, children, optional }: { htmlFor: string; children: ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-pv-fg">
      {children}
      {optional ? <span className="ml-1.5 font-normal text-pv-muted-fg">(optional)</span> : null}
    </label>
  );
}

function HintAndError({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-pv-muted-fg">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-pv-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

interface BaseFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

export function AuthTextFieldV2({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  disabled,
  type = 'text',
  autoComplete,
  inputMode,
  placeholder,
  optional,
  autoFocus,
}: BaseFieldProps & {
  type?: 'text' | 'email' | 'tel';
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'tel';
  placeholder?: string;
  optional?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} optional={optional}>
        {label}
      </Label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-required={optional ? undefined : true}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(AUTH_FIELD_CLASS, error && AUTH_FIELD_ERROR_CLASS)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <HintAndError id={id} hint={hint} error={error} />
    </div>
  );
}

export function AuthPasswordFieldV2({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  disabled,
  autoComplete,
}: BaseFieldProps & { autoComplete: 'current-password' | 'new-password' }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <input
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-required
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(AUTH_FIELD_CLASS, 'pr-12', error && AUTH_FIELD_ERROR_CLASS)}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setRevealed((v) => !v)}
          aria-label="Show password"
          aria-pressed={revealed}
          aria-controls={id}
          className="absolute inset-y-0 right-1.5 my-auto inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-pv-tint hover:text-pv-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pv-primary/25 disabled:opacity-50"
        >
          {revealed ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
      </div>
      <HintAndError id={id} hint={hint} error={error} />
    </div>
  );
}

/** A one-time code: digits only as typed (a pasted "1 2 3 4 5 6" still lands), as v1's. */
export function AuthCodeFieldV2({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  disabled,
  length,
}: BaseFieldProps & { length: number }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        disabled={disabled}
        aria-required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(
          AUTH_FIELD_CLASS,
          'text-center text-lg font-semibold tracking-[0.4em] tabular-nums',
          error && AUTH_FIELD_ERROR_CLASS,
        )}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, length))}
        onBlur={onBlur}
      />
      <HintAndError id={id} hint={hint} error={error} />
    </div>
  );
}

/** The form-level message: what came back from the server, not from a field. */
export function AuthNoticeV2({ tone, children }: { tone: 'danger' | 'success'; children: ReactNode }) {
  const Icon = tone === 'danger' ? AlertCircle : CheckCircle2;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed',
        tone === 'danger'
          ? 'border-pv-danger/30 bg-pv-danger-light text-pv-danger'
          : 'border-pv-success/30 bg-pv-success-light text-pv-success',
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** login-v2's 48px submit. Never pressable twice: a second signup is a second account. */
export function AuthSubmitV2({
  children,
  pending,
  pendingLabel,
  disabled,
}: {
  children: ReactNode;
  pending: boolean;
  pendingLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={AUTH_PRIMARY_BUTTON}
    >
      {pending ? (
        <>
          <Loader2 aria-hidden className="size-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** The primary button's look, for a link that acts as one ("Sign in" after a reset). */
export const AUTH_PRIMARY_BUTTON =
  'inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-pv-primary text-base font-medium text-pv-primary-fg transition-colors hover:bg-pv-primary-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-pv-primary/30 active:translate-y-px disabled:pointer-events-none disabled:opacity-50';
