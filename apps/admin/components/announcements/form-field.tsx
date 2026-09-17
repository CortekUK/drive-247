'use client';

import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { codePointLength } from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';

/**
 * Appended to `outline` / `ghost` Buttons on this page: the admin primitives
 * give outline a white fill and both a grey hover, but announcement surfaces
 * use no white buttons and an indigo-tint neutral hover (spec §3).
 */
export const QUIET_BUTTON = 'bg-transparent hover:bg-indigo-50 dark:hover:bg-indigo-500/15';

/**
 * Hides a scroll container's scrollbar while it still scrolls (wheel, touch,
 * keyboard): the editor dialog shows no scrollbars anywhere.
 */
export const HIDDEN_SCROLLBAR = '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden';

/** Label + control + help/error, the one field layout every editor section uses. */
export function FormField({
  label,
  htmlFor,
  required,
  counter,
  help,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  counter?: { value: string; max: number };
  help?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  const errorId = htmlFor ? htmlFor + '-error' : undefined;
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
        {counter && <CharCounter value={counter.value} max={counter.max} />}
      </div>
      {children}
      {help && !error && <p className="text-xs leading-5 text-muted-foreground">{help}</p>}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium leading-5 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Counts code points, like the database's char_length(). */
export function CharCounter({ value, max }: { value: string; max: number }) {
  const n = codePointLength(value);
  return (
    <span className={cn('shrink-0 text-xs tabular-nums', n > max ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
      {n}/{max}
    </span>
  );
}

/** A titled group inside the editor form. */
export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
