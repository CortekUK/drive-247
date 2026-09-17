'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { radioKeyTarget, radioTabStop } from './form-logic';

export interface SegmentedOption<T extends string | number | null> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * A single-choice pill group (Dialog | Banner, Soft | Hard, frequency, preview
 * toggles). Admin has no radio-group or toggle-group primitive, so this follows
 * the pill pattern of the Rental Companies filters, with radio semantics and
 * arrow-key movement.
 */
export function SegmentedControl<T extends string | number | null>({
  options,
  value,
  onChange,
  ariaLabel,
  id,
  disabled,
  noSelection,
  size = 'md',
  className,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  id?: string;
  disabled?: boolean;
  /** Show no option as chosen (e.g. frequency while it does not apply). */
  noSelection?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const isDisabled = (index: number) => !!(disabled || options[index].disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = radioKeyTarget(e.key, index, options.length, isDisabled);
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  const selectedIndex = noSelection ? -1 : options.findIndex((o) => o.value === value);
  const tabStop = radioTabStop(selectedIndex, options.length, isDisabled);

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn('inline-flex max-w-full flex-wrap items-center gap-1 rounded-3xl bg-secondary p-1', className)}
    >
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        const isDisabled = disabled || option.disabled;
        return (
          <button
            key={String(option.value)}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={isDisabled}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              'cursor-pointer whitespace-nowrap rounded-3xl border font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              selected
                ? 'border-primary/30 bg-primary/15 text-primary'
                : 'border-transparent text-muted-foreground hover:bg-primary/10 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
