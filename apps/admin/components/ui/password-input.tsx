"use client";

import * as React from "react";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface PasswordInputProps
  // `type` is ours to own — the whole point of the component is that the
  // reveal toggle swaps it on the SAME element, so a caller must not set it.
  extends Omit<React.ComponentProps<"input">, "type"> {
  /** Render the in-field reveal control. */
  showToggle?: boolean;
  /**
   * Warn while Caps Lock is on. On a sign-in screen this is the difference
   * between "wrong password" and "wrong password, and here is why" — the field
   * is masked, so nothing else on screen can give the user that clue.
   */
  showCapsLockWarning?: boolean;
  /** Classes for the positioning wrapper, not for the input itself. */
  containerClassName?: string;
}

/**
 * Password field with a reveal toggle, mirroring the portal's
 * (apps/portal/src/components/ui/password-input.tsx). The apps deliberately do
 * not share components, so this is a sibling rather than an import.
 *
 * The wrapper is `relative` and sized by the input alone: the Caps Lock notice
 * hangs out of flow beneath it so that dropping a field into a bordered shell
 * cannot make the shell grow a second line when the warning appears. Callers
 * are expected to leave ~1.5rem of room under the field for it.
 */
const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  (
    {
      className,
      containerClassName,
      showToggle = true,
      showCapsLockWarning = true,
      id,
      disabled,
      onKeyDown,
      onKeyUp,
      onBlur,
      "aria-describedby": ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const [visible, setVisible] = React.useState(false);
    const [capsLockOn, setCapsLockOn] = React.useState(false);

    const capsLockId = `${React.useId()}-caps`;

    const readCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (showCapsLockWarning) setCapsLockOn(e.getModifierState("CapsLock"));
    };

    return (
      <div className={cn("relative min-w-0 flex-1", containerClassName)}>
        <Input
          // One element, one identity: the type attribute flips but the input
          // is never remounted, so revealing does not drop the typed value,
          // the caret position, or the browser's autofill association.
          type={visible ? "text" : "password"}
          id={id}
          disabled={disabled}
          ref={ref}
          // Keep the text clear of the toggle's 40px hit area.
          className={cn("pr-11", className)}
          aria-describedby={
            [ariaDescribedBy, showCapsLockWarning ? capsLockId : null]
              .filter(Boolean)
              .join(" ") || undefined
          }
          onKeyDown={(e) => {
            readCapsLock(e);
            onKeyDown?.(e);
          }}
          onKeyUp={(e) => {
            readCapsLock(e);
            onKeyUp?.(e);
          }}
          onBlur={(e) => {
            // The warning is only ever true while this field has focus — Caps
            // Lock can be released anywhere, and we only hear about it here.
            setCapsLockOn(false);
            onBlur?.(e);
          }}
          {...props}
        />

        {showToggle && (
          <button
            // A <button> inside a <form> defaults to type="submit". Without
            // this, clicking the eye submits the login form.
            type="button"
            tabIndex={0}
            // Follows the field: revealing a field nobody can edit is noise,
            // and it would stay tabbable inside a form that is mid-submit.
            disabled={disabled}
            aria-label={visible ? "Hide password" : "Show password"}
            // A two-state control, not an action — announce the state too.
            aria-pressed={visible}
            aria-controls={id}
            title={visible ? "Hide password" : "Show password"}
            // mousedown is what moves focus; preventing it keeps the caret
            // exactly where the user left it instead of throwing them out of
            // the field mid-password.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setVisible((v) => !v)}
            className="absolute right-0 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50"
          >
            {visible ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}

        {showCapsLockWarning && (
          // Always mounted, even when empty: a live region has to be in the DOM
          // *before* its content changes or screen readers stay silent.
          <p
            id={capsLockId}
            role="status"
            aria-live="polite"
            className="absolute left-0 top-full mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-600"
          >
            {capsLockOn && (
              <>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Caps Lock is on</span>
              </>
            )}
          </p>
        )}
      </div>
    );
  },
);

PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
