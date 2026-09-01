"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import {
  FIELD_INPUT_CLASS,
  FieldError,
  FieldHint,
  FieldLabel,
} from "@/components/booking/field-primitives";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The auth forms' controls.
 *
 * Built on `components/booking/field-primitives` rather than beside it: the
 * label, hint and error markup and the 44px input recipe are already settled
 * there, and a second set would drift the moment one of them is adjusted. What
 * is added here is what the booking form has no use for — a password field with
 * a reveal toggle, and a six-digit code field.
 *
 * Every control follows the same layout contract as the booking primitives: a
 * self-contained block, label first, error last, sized by the caller's
 * `className`.
 */

/* ─────────────────────────────── text ───────────────────────────────────── */

export function AuthTextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  type = "text",
  autoComplete,
  inputMode,
  placeholder,
  hint,
  optional,
  disabled,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  type?: "text" | "email" | "tel";
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel";
  placeholder?: string;
  hint?: string;
  optional?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} required={!optional} optional={optional}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        disabled={disabled}
        // Only ever set on the FIRST field of a single-purpose form the visitor
        // navigated here specifically to fill in — never on a form embedded in
        // a longer page, where it would scroll the page out from under them.
        autoFocus={autoFocus}
        aria-required={optional ? undefined : true}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={cn(FIELD_INPUT_CLASS, error && "border-danger")}
      />
      {hint ? (
        <div id={hintId}>
          <FieldHint>{hint}</FieldHint>
        </div>
      ) : null}
      <FieldError message={error} />
    </div>
  );
}

/* ───────────────────────────── password ─────────────────────────────────── */

export function AuthPasswordField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  autoComplete,
  hint,
  disabled,
  action,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  /** "current-password" on sign-in, "new-password" everywhere else. */
  autoComplete: "current-password" | "new-password";
  hint?: string;
  disabled?: boolean;
  /** Sits on the label's line — the "Forgot password?" link. */
  action?: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel htmlFor={id} required>
          {label}
        </FieldLabel>
        {action}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={revealed ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-required
          aria-invalid={error ? true : undefined}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          // pr-11 keeps the typed value clear of the 44px toggle.
          className={cn(FIELD_INPUT_CLASS, "pr-11", error && "border-danger")}
        />
        {/*
          44x44, flush inside the 44px-tall field — the touch floor is met by
          the button's own box rather than by an invisible expander, so it can
          never overlap the field's own tap area.

          `aria-pressed` rather than a changing label: the control is one toggle
          with two states, and a screen-reader user who has just pressed it
          should not hear its name change under them.
        */}
        <Button
          type="button"
          variant="brand-ghost"
          size="icon"
          disabled={disabled}
          aria-label="Show password"
          aria-pressed={revealed}
          aria-controls={id}
          onClick={() => setRevealed((previous) => !previous)}
          className="absolute inset-y-0 right-0 size-11 text-brand-text-subtle hover:bg-transparent hover:text-brand-text"
        >
          {revealed ? (
            <EyeOff strokeWidth={1.75} aria-hidden />
          ) : (
            <Eye strokeWidth={1.75} aria-hidden />
          )}
        </Button>
      </div>
      {hint ? (
        <div id={hintId}>
          <FieldHint>{hint}</FieldHint>
        </div>
      ) : null}
      <FieldError message={error} />
    </div>
  );
}

/* ─────────────────────────────── code ───────────────────────────────────── */

export function AuthCodeField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  disabled,
  length,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  length: number;
}) {
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-1.5">
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <Input
        id={id}
        // `text` with `inputMode="numeric"`, not `type="number"`: a number input
        // drops a leading zero, grows spinner arrows nobody wants on a one-time
        // code, and scrolls its value on a trackpad.
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        disabled={disabled}
        aria-required
        aria-invalid={error ? true : undefined}
        aria-describedby={hint ? hintId : undefined}
        // Strip everything that is not a digit as it is typed, so a pasted
        // "1 2 3 4 5 6" out of an email client still lands as a valid code.
        onChange={(event) =>
          onChange(event.target.value.replace(/\D/g, "").slice(0, length))
        }
        onBlur={onBlur}
        className={cn(
          FIELD_INPUT_CLASS,
          "text-center text-lg font-medium tracking-[0.4em] tabular-nums",
          error && "border-danger",
        )}
      />
      {hint ? (
        <div id={hintId}>
          <FieldHint>{hint}</FieldHint>
        </div>
      ) : null}
      <FieldError message={error} />
    </div>
  );
}

/* ────────────────────────────── feedback ────────────────────────────────── */

/**
 * The form-level message: what came back from the server, not from a field.
 *
 * The `Alert` primitive already carries `role="alert"`, so mounting one is
 * itself the announcement — no extra live region, which would otherwise make a
 * screen reader read the same sentence twice.
 */
export function FormNotice({
  tone,
  children,
}: {
  tone: "danger" | "success" | "info";
  children: ReactNode;
}) {
  return (
    <Alert variant={tone}>
      <AlertDescription className="text-sm leading-relaxed text-brand-text">
        {children}
      </AlertDescription>
    </Alert>
  );
}

/* ─────────────────────────────── submit ─────────────────────────────────── */

export function SubmitButton({
  children,
  pending,
  pendingLabel,
  disabled,
}: {
  children: ReactNode;
  pending: boolean;
  /** What the button says while it is working — "Signing you in…". */
  pendingLabel: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      variant="brand"
      size="xl"
      disabled={pending || disabled}
      // The submit is the one control that must never be pressable twice: a
      // second signup would create a second auth user for the same address.
      aria-busy={pending}
      className="w-full"
    >
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/**
 * A stable id prefix for one form's fields.
 *
 * `useId` rather than hardcoded strings so two forms on one page (or a form
 * inside a dialog) cannot collide on `htmlFor` — and so the ids match between
 * the server-rendered HTML and the client, which hardcoding across a shared
 * component would not guarantee.
 *
 * Generic over the name tuple, so `ids.emial` is a compile error rather than
 * `undefined` in a `htmlFor`.
 */
export function useFieldIds<const T extends readonly string[]>(
  names: T,
): Record<T[number], string> {
  const prefix = useId();
  const ids = {} as Record<T[number], string>;
  for (const name of names) {
    ids[name as T[number]] = `${prefix}-${name}`;
  }
  return ids;
}
