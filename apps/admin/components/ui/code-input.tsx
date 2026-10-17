'use client';

/**
 * A six-digit code field drawn as six boxes — the portal's ui-v2 CodeInput
 * (apps/portal/src/components/ui-v2/code-input.tsx), slot for slot, without
 * its `input-otp` dependency.
 *
 * One real <input> lies over the boxes, transparent, so typing, pasting, the
 * phone's one-time-code autofill and screen readers all see an ordinary field;
 * the boxes only draw what it holds.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';

export function CodeInput({
  value,
  onChange,
  disabled,
  autoFocus,
  length = 6,
  id,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  length?: number;
  id?: string;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, length - 1);

  return (
    <div className={cn('relative flex w-fit items-center gap-2', disabled && 'opacity-50', className)}>
      {Array.from({ length }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn(
            'relative flex h-12 w-11 items-center justify-center rounded-2xl border border-transparent bg-input/50 text-lg font-medium tabular-nums text-foreground',
            '[transition:border-color_200ms_ease-out,box-shadow_200ms_ease-out] motion-reduce:transition-none',
            focused && i === active && 'border-ring ring-3 ring-ring/30',
          )}
        >
          {value[i] ?? ''}
          {focused && i === value.length && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-5 w-px animate-pulse bg-foreground" />
            </div>
          )}
        </div>
      ))}
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        autoFocus={autoFocus}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
      />
    </div>
  );
}
