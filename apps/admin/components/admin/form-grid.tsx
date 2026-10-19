'use client';

/**
 * The stepped "add" dialog kit — Northwind's form-grid-v2
 * (apps/portal/src/components/shared/form-grid-v2.tsx), copied so super
 * admin's add-company forms read exactly like the portal's add-vehicle and
 * add-customer dialogs (Ghulam, Oct 17 2026).
 *
 *   CONTROL     one 44px control shape: softly rounded, a firm hairline,
 *               accent on hover and focus, red on error
 *   Cell        label → control → one RESERVED line for a hint or error, so
 *               an error never pushes a row out of line
 *   ToggleTile  a yes/no field drawn in the same 44px shape as an input
 *   Segmented   a few choices in one 44px control
 *   ChipToggle  a pick-many option, drawn as a small pill
 *   StepScreen  picture → one-line question → two rows of fields
 *   StepFooter  Cancel/Back on the left, the step dots, Next/finish on the right
 */

import type { ComponentType, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

/** One shape for every control: 44px, softly rounded, a firm hairline. */
export const CONTROL =
  'h-11 w-full rounded-xl border border-foreground/15 bg-background px-3.5 text-sm text-foreground ' +
  'shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] outline-none transition-[border-color,box-shadow] duration-200 ' +
  'placeholder:text-muted-foreground/70 hover:border-primary/40 focus-visible:border-primary/60 ' +
  'focus-visible:ring-3 focus-visible:ring-primary/15 aria-invalid:border-destructive/60 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

/** The accent wash behind an "add" dialog — the portal's, from the same tokens. */
export const FORM_DIALOG_WASH = {
  backgroundImage: [
    'radial-gradient(40rem 26rem at 105% -10%, hsl(var(--v2-wash, 248 61% 46%) / 0.30), transparent 62%)',
    'radial-gradient(34rem 24rem at -8% -6%, hsl(var(--chart-3) / 0.24), transparent 58%)',
    'radial-gradient(36rem 22rem at 50% 118%, hsl(var(--v2-wash, 248 61% 46%) / 0.20), transparent 62%)',
    'linear-gradient(180deg, hsl(var(--v2-wash, 248 61% 46%) / 0.08) 0%, transparent 45%)',
  ].join(', '),
} as const;

/** The "done" screens' sparkles: each pops in once, then holds still. Mount in a <style>. */
export const TWINKLE_CSS =
  '@keyframes v2-twinkle{0%{opacity:0;transform:scale(.3)}55%{opacity:1;transform:scale(1.15)}100%{opacity:1;transform:scale(1)}}' +
  '.v2-twinkle{animation:v2-twinkle .6s ease-out both;animation-delay:inherit}' +
  '@media (prefers-reduced-motion:reduce){.v2-twinkle{animation:none}}';

/** The dialog shell's classes: narrow, no padding, the wash behind it. */
// flex, not the base grid: a grid track grows to a long URL's width.
export const FORM_DIALOG = 'flex max-w-[720px] flex-col gap-0 overflow-hidden p-0';

export function Cell({
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="truncate px-0.5 text-[13px] font-medium text-foreground/80">
        {label}
        {required && <span className="ml-0.5 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">*</span>}
      </span>
      {children}
      {/* Reserved: an error or a hint never moves the row. */}
      <span
        className={cn(
          'min-h-[18px] truncate px-0.5 text-[11px] leading-[18px]',
          error ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {error ?? hint}
      </span>
    </div>
  );
}

/** A yes/no field drawn as a 44px tile with a switch — same shape as an input. */
export function ToggleTile({
  label,
  checked,
  onChange,
  on = 'Yes',
  off = 'No',
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  on?: string;
  off?: string;
}) {
  return (
    <div
      // The switch handles its own click; the rest of the tile toggles it too.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[role="switch"]')) return;
        onChange(!checked);
      }}
      className={cn(
        'flex h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 text-sm transition-colors duration-200 motion-reduce:transition-none',
        checked
          ? 'border-primary/40 bg-primary/[0.06] text-foreground'
          : 'border-foreground/15 bg-background text-foreground/80 hover:border-primary/30',
      )}
    >
      <span className="truncate">{checked ? on : off}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

/** A few choices in one 44px control — Production / Test. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="grid h-11 gap-1 rounded-xl border border-foreground/15 bg-muted/40 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'rounded-lg text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary/30 motion-reduce:transition-none',
            value === o.value
              ? 'bg-background font-medium text-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.08)] ring-1 ring-foreground/10'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One pick-many option (vehicle types, open days), as a small pill. */
export function ChipToggle({
  on,
  onClick,
  children,
  className,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'h-9 rounded-full border px-3.5 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary/30 motion-reduce:transition-none',
        on
          ? 'border-primary/40 bg-primary/10 font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]'
          : 'border-foreground/15 bg-background text-foreground/80 hover:border-primary/30',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * One screen: the picture, what is being asked, then the fields. Every screen
 * is the same height, so nothing jumps between steps and nothing scrolls.
 */
export function StepScreen({
  stepKey,
  art: Art,
  title,
  line,
  children,
}: {
  stepKey: string | number;
  art: ComponentType<{ className?: string }>;
  title: string;
  line: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      key={stepKey}
      className="flex h-[520px] flex-col items-center overflow-hidden px-10 pt-8 duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none"
    >
      <Art className="max-w-[280px]" />
      <h3 className="mt-4 text-center text-xl font-medium leading-snug text-foreground [text-wrap:balance]">{title}</h3>
      <p className="mx-auto mt-1.5 min-h-[2lh] max-w-[26rem] text-center text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
        {line}
      </p>
      <div className="mt-5 grid w-full grid-cols-2 gap-x-5 gap-y-1">{children}</div>
    </div>
  );
}

/** The "done" screen: the picture, a headline, a line, then what to hand over. */
export function DoneScreen({
  art: Art,
  title,
  line,
  children,
}: {
  art: ComponentType<{ className?: string }>;
  title: string;
  line: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-[520px] flex-col items-center overflow-y-auto px-10 pt-8 text-center">
      <style>{TWINKLE_CSS}</style>
      <div className="w-full max-w-[260px] duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
        <Art />
      </div>
      <div className="w-full duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-3 [animation-delay:120ms] [animation-fill-mode:both] motion-reduce:animate-none">
        <h3 className="mt-4 text-2xl font-medium text-foreground [text-wrap:balance]">{title}</h3>
        <p className="mx-auto mt-2 max-w-[28rem] text-sm leading-relaxed text-muted-foreground [text-wrap:balance]">
          {line}
        </p>
        {children && <div className="mt-5 w-full text-left">{children}</div>}
      </div>
    </div>
  );
}

/** The foot: Cancel/Back, where you are, Next/finish. Nothing else. */
export function StepFooter({
  steps,
  step,
  loading,
  onBack,
  onCancel,
  finishLabel,
  busyLabel,
}: {
  steps: readonly string[];
  step: number;
  loading?: boolean;
  onBack: () => void;
  onCancel: () => void;
  finishLabel: string;
  busyLabel: string;
}) {
  const last = step === steps.length - 1;
  return (
    <div className="flex items-center justify-between gap-4 px-8 py-4">
      <Button
        type="button"
        variant="outline"
        className="h-10 rounded-full px-5"
        onClick={() => (step === 0 ? onCancel() : onBack())}
        disabled={loading}
      >
        {step === 0 ? (
          'Cancel'
        ) : (
          <>
            <ArrowLeft className="size-4" /> Back
          </>
        )}
      </Button>

      <ol className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}: ${steps[step]}`}>
        {steps.map((title, i) => (
          <li
            key={title}
            title={title}
            className={cn(
              'size-1.5 rounded-full transition-colors duration-200 motion-reduce:transition-none',
              i === step
                ? 'bg-primary dark:bg-[hsl(var(--v2-link,var(--primary)))]'
                : i < step
                  ? 'bg-primary/40'
                  : 'bg-foreground/15',
            )}
          />
        ))}
      </ol>

      <Button type="submit" className="h-10 rounded-full px-5" variant={last ? 'default' : 'outline'} disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" /> {busyLabel}
          </>
        ) : last ? (
          <>
            <Check className="size-4" /> {finishLabel}
          </>
        ) : (
          <>
            Next <ArrowRight className="size-4" />
          </>
        )}
      </Button>
    </div>
  );
}

const ROW_ICON =
  'inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors ' +
  'hover:bg-primary/10 hover:text-primary focus-visible:ring-3 focus-visible:ring-primary/30 dark:hover:text-[hsl(var(--v2-link,var(--primary)))]';

/**
 * A read-only value with a copy button, for the done screens' hand-over. With
 * `href` (a portal or booking link) it also opens in a new tab.
 */
export function CopyRow({ label, value, onCopy, href }: { label: string; value: string; onCopy: () => void; href?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0">
      <span className="w-24 shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 select-all truncate font-mono text-[13px] text-foreground">{value}</code>
      {/* Icons only: open in a new tab, then copy. */}
      <div className="-my-1 flex shrink-0 items-center gap-0.5">
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${label} in a new tab`}
            title="Open in a new tab"
            className={ROW_ICON}
          >
            <ExternalLink className="size-4" />
          </a>
        )}
        <button type="button" onClick={onCopy} aria-label={`Copy ${label}`} title="Copy" className={ROW_ICON}>
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  );
}
