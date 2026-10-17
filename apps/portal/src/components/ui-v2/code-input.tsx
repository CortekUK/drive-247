"use client";

import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from "input-otp";

import { cn } from "@/lib/utils";

/**
 * A six-digit confirmation code: one box per digit, the v2 field look.
 *
 * Built on `input-otp`, which keeps ONE real <input> underneath — so paste,
 * the iOS / Android "from Messages / Mail" suggestion (`one-time-code`),
 * backspace and arrow keys all behave natively. The boxes are only drawing.
 *
 * `onComplete` fires the moment the last digit lands, so a caller can check
 * the code without a button press.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
  length = 6,
  id,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  length?: number;
  id?: string;
  className?: string;
}) {
  return (
    <OTPInput
      id={id}
      maxLength={length}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      autoFocus={autoFocus}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      containerClassName={cn("flex items-center gap-2 has-[:disabled]:opacity-50", className)}
      render={({ slots }) => (
        <>
          {slots.map((slot, index) => (
            <CodeSlot key={index} {...slot} />
          ))}
        </>
      )}
    />
  );
}

function CodeSlot({ char, isActive, hasFakeCaret }: SlotProps) {
  return (
    <div
      className={cn(
        "relative flex h-12 w-11 items-center justify-center rounded-2xl border border-transparent bg-input/50 text-lg font-medium tabular-nums text-foreground",
        "[transition:border-color_200ms_ease-out,box-shadow_200ms_ease-out] motion-reduce:transition-none",
        isActive && "border-ring ring-3 ring-ring/30",
      )}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-pulse bg-foreground" />
        </div>
      )}
    </div>
  );
}
