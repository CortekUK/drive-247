'use client';

/**
 * The building blocks of a super-admin settings page, drawn exactly like the
 * portal's v2 (northwind) settings: apps/portal/src/components/settings-v2/
 * settings-kit.tsx. Same classes, same row grid, same save bar, so the two
 * settings screens read as one product.
 *
 * Modelled on Stripe's settings detail pages: one heading, then flat panels of
 * rows — label and a line of help on the left, the control after it. No
 * breadcrumb (Settings in the nav is the way back), no card per field, no
 * decorative icons, and ONE save bar per page.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The page title: always heavier than any section title under it. */
export const SETTINGS_PAGE_TITLE = 'text-2xl font-bold tracking-tight text-foreground';
/** A section title (and a panel title). */
export const SETTINGS_SECTION_TITLE = 'text-base font-semibold tracking-tight text-foreground';
/** The page column every settings screen sits in. */
export const SETTINGS_COLUMN = 'w-full max-w-[1160px] space-y-9 pb-6';

export function SettingsPageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="space-y-1.5">
      <h1 className={SETTINGS_PAGE_TITLE}>{title}</h1>
      {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}

/** A titled part of a page. Draws no box and no line under its heading. */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className={SETTINGS_SECTION_TITLE}>{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div data-settings-rows="">{children}</div>
    </section>
  );
}

export type SettingsRowAlign = 'start' | 'end';

const SettingsRowAlignContext = createContext<SettingsRowAlign>('end');

/** Every SettingsRow inside puts its control at the start or the far end. */
export function SettingsRowAlignProvider({ align, children }: { align: SettingsRowAlign; children: ReactNode }) {
  return <SettingsRowAlignContext.Provider value={align}>{children}</SettingsRowAlignContext.Provider>;
}

const ROW_GRID_END = 'flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-10';
const ROW_GRID_START =
  'flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:items-center md:gap-x-10';

/**
 * One setting: label and help on the left, the control beside it. Rows are
 * separated by a hairline, the last one by nothing. The default puts the
 * control at the far end of the row — the house style for a settings form.
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  note,
  align,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
  note?: ReactNode;
  align?: SettingsRowAlign;
  className?: string;
}) {
  const inherited = useContext(SettingsRowAlignContext);
  const end = (align ?? inherited) === 'end';
  return (
    <div
      data-settings-row=""
      className={cn('border-b border-border/60 py-4 last:border-b-0', className)}
    >
      <div className={end ? ROW_GRID_END : ROW_GRID_START}>
        <div className={end ? 'min-w-0 md:max-w-2xl' : 'min-w-0'}>
          {htmlFor ? (
            <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
              {label}
            </label>
          ) : (
            <p className="text-sm font-medium text-foreground">{label}</p>
          )}
          {description && (
            <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</div>
          )}
        </div>
        {children && (
          <div
            className={
              end
                ? 'flex min-w-0 flex-wrap items-center justify-start gap-2 md:justify-end'
                : 'flex min-w-0 flex-wrap items-center justify-start gap-2'
            }
          >
            {children}
          </div>
        )}
      </div>
      {note && <div className="mt-1.5 text-[13px] leading-snug">{note}</div>}
    </div>
  );
}

/** A labelled field inside a row's control area or a section. */
export function SettingsField({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && <div className="text-xs leading-snug text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * A choice between a few values, drawn as the portal's settings tab pills:
 * the brand tint on the chosen one, the v2 hover on the rest.
 */
export function SettingsSegmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-1', disabled && 'opacity-70')}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-8 rounded-full px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-wait',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-primary/10 hover:text-foreground dark:hover:bg-muted',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A quiet bordered note inside a section: a dependency, a block, an error. */
export function SettingsNotice({
  tone = 'default',
  children,
  className,
}: {
  tone?: 'default' | 'danger';
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-3 text-sm',
        tone === 'danger' ? 'border-destructive/40 text-destructive' : 'text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

function SettingsSaveState({ status, error }: { status: SaveStatus; error?: unknown }) {
  if (status === 'idle') return <span aria-live="polite" className="sr-only" />;
  return (
    <div
      aria-live="polite"
      role={status === 'error' ? 'alert' : undefined}
      className="mr-1 inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-sm"
    >
      {status === 'saving' && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Saving…
        </span>
      )}
      {status === 'saved' && (
        <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" aria-hidden="true" />
          Saved
        </span>
      )}
      {status === 'dirty' && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          Unsaved changes
        </span>
      )}
      {status === 'error' && (
        <span className="min-w-0 text-destructive [overflow-wrap:anywhere]">
          <span className="font-medium">Couldn&apos;t save.</span>{' '}
          {error instanceof Error ? error.message : 'Try again.'}
        </span>
      )}
    </div>
  );
}

/**
 * The page's one Reset + Save changes, sticky at the bottom while scrolling.
 * Reset DISCARDS unsaved edits; it never restores defaults.
 */
export function SettingsStickySaveBar({
  dirty,
  saving,
  saved,
  error,
  onSave,
  onReset,
}: {
  dirty: boolean;
  saving: boolean;
  saved?: boolean;
  error?: unknown;
  onSave: () => void;
  onReset: () => void;
}) {
  const status: SaveStatus = saving ? 'saving' : error ? 'error' : dirty ? 'dirty' : saved ? 'saved' : 'idle';
  return (
    <div className="pointer-events-none sticky bottom-4 z-30 flex justify-end pt-2">
      <div
        role="region"
        aria-label="Save changes"
        className={cn(
          'pointer-events-auto flex max-w-full flex-wrap items-center justify-end gap-2 border bg-card p-1.5 pl-4 shadow-lg',
          status === 'error' ? 'rounded-3xl' : 'rounded-full',
        )}
      >
        <SettingsSaveState status={status} error={error} />
        <Button type="button" variant="outline" size="sm" onClick={onReset} disabled={!dirty || saving}>
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={!dirty || saving}
          aria-busy={saving || undefined}
          className="min-w-[112px]"
        >
          {saving && <Loader2 className="animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
