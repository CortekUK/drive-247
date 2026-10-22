'use client';

/**
 * The furniture /portal-v2/settings is built from — the operator portal v2's
 * settings kit (`apps/portal/src/components/settings-v2/settings-kit.tsx`)
 * redrawn on the `--pv-*` tokens, one step roomier.
 *
 * The same rules carry over:
 *  - FLAT. A section is a heading over rows, straight on the page — no card,
 *    no icon tile, no rim. Sections are separated by space, not lines.
 *  - TWO COLUMNS. Every row is a label column (what it is, and one line on why)
 *    beside its control; the row stacks on a phone. The label column is 320px
 *    here against the operator's 420px — a customer's page is half as wide in
 *    practice, and its controls need the room more than the labels do.
 *  - ONE SOFT HAIRLINE under each row, none under the last.
 *  - ONE SAVE BAR for the page, always floating at the foot, its buttons
 *    disabled until something changes — the operator's `SettingsStickySaveBar`.
 *
 * Local to this route rather than in the shared primitives because none of it
 * has a second caller yet.
 */

import { Loader2 } from 'lucide-react-nw';
import type { ReactNode } from 'react';

import { Button } from '@nw/components/ui/button';
import { Skeleton } from '@nw/components/ui/skeleton';
import { Switch } from '@nw/components/ui/switch';
import { cn } from '@nw/lib/utils';
import { PortalAlertBar } from '@nw/portal-v2/alert-bar';

import { PV_BUTTON_OUTLINE_SM, PV_BUTTON_SM } from './pv-kit';

/* ──────────────────────────── page furniture ─────────────────────────── */

/**
 * The operator's settings page title and section heading
 * (settings-kit.tsx SETTINGS_PAGE_TITLE / SETTINGS_SECTION_TITLE).
 */
export const SETTINGS_PAGE_TITLE = 'font-heading text-2xl font-bold tracking-tight text-pv-fg';
export const SETTINGS_SECTION_TITLE = 'font-heading text-base font-semibold tracking-tight text-pv-fg';

/**
 * The operator's settings column (V2_SETTINGS_PAGE_COLUMN): every settings
 * page, the index included, sits in it.
 */
export const SETTINGS_PAGE_COLUMN = 'w-full min-h-full max-w-[1160px] space-y-8 pb-6 md:pt-[26px]';

/** A settings page's header (settings-kit.tsx SettingsPageHeader), with room for one action. */
export function SettingsPageHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className={SETTINGS_PAGE_TITLE}>{title}</h1>
          {description ? <p className="max-w-2xl text-sm text-pv-muted-fg">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {/* The alert bar, under every page header (alert-bar.tsx). */}
      <PortalAlertBar />
    </div>
  );
}

/* ─────────────────────────────── sections ──────────────────────────────── */

/** One titled part of the page: a heading, one line on what it is, its rows. */
export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="pb-1">
        <h2
          id={`${id}-title`}
          className="text-[17px] font-semibold tracking-tight text-pv-fg"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[14px] text-pv-muted-fg">{description}</p>
        ) : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

/**
 * One setting: the label column beside its control.
 *
 * `align="end"` puts the control at the far end of the row and lets the label
 * take the rest — for a switch, whose control is a thumb's width and whose
 * explanation is the long part.
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  note,
  align = 'start',
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children?: ReactNode;
  /** A warning or consequence that belongs to this row, shown under it. */
  note?: ReactNode;
  align?: 'start' | 'end';
}) {
  const end = align === 'end';
  return (
    <div className="border-b border-pv-border/60 py-5 last:border-b-0">
      <div
        className={cn(
          'flex flex-col gap-3',
          end
            ? 'sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-10'
            : 'md:grid md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-start md:gap-x-10',
        )}
      >
        <div className={cn('min-w-0', end ? 'sm:max-w-2xl' : 'md:pt-2.5')}>
          {htmlFor ? (
            <label htmlFor={htmlFor} className="text-[14px] font-medium text-pv-fg">
              {label}
            </label>
          ) : (
            <p className="text-[14px] font-medium text-pv-fg">{label}</p>
          )}
          {description ? (
            <div className="mt-0.5 text-[13px] leading-relaxed text-pv-muted-fg">
              {description}
            </div>
          ) : null}
        </div>
        {children ? <div className="min-w-0">{children}</div> : null}
      </div>
      {note ? <div className="mt-2 text-[13px] leading-relaxed">{note}</div> : null}
    </div>
  );
}

/** Help or an error under a control. */
export function RowHint({
  children,
  tone = 'muted',
  id,
}: {
  children: ReactNode;
  tone?: 'muted' | 'danger' | 'success' | 'warning';
  id?: string;
}) {
  return (
    <div
      id={id}
      role={tone === 'danger' ? 'alert' : undefined}
      className={cn(
        'mt-1.5 px-1 text-[12px] leading-relaxed',
        tone === 'muted' && 'text-pv-muted-fg',
        tone === 'danger' && 'text-pv-danger',
        tone === 'success' && 'text-pv-success',
        tone === 'warning' && 'text-pv-warning',
      )}
    >
      {children}
    </div>
  );
}

/* ────────────────────────── read-only values ───────────────────────────── */

/**
 * A fact the customer cannot change here — their date of birth, their ID
 * expiry, the email they sign in with.
 *
 * Plain text in the control column, not a greyed-out `<input>`: a disabled box
 * reads as "broken, try again later"; text reads as "this comes from somewhere
 * else", which is exactly what these are.
 */
export function ReadOnlyValue({
  value,
  badge,
  action,
}: {
  value: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
      <span className="min-w-0 break-words text-[14px] text-pv-fg">{value}</span>
      {badge}
      {action ? <span className="ml-auto sm:ml-0">{action}</span> : null}
    </div>
  );
}

/** A small status pill — "Verified", "Expired" — in the v2 status tints. */
export function StatusPill({
  tone,
  children,
}: {
  tone: 'positive' | 'notice' | 'negative' | 'neutral';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[11px] font-medium',
        tone === 'positive' && 'bg-pv-success-light text-pv-success',
        tone === 'notice' && 'bg-pv-warning-light text-pv-warning',
        tone === 'negative' && 'bg-pv-danger-light text-pv-danger',
        tone === 'neutral' && 'bg-pv-muted text-pv-muted-fg',
      )}
    >
      {children}
    </span>
  );
}

/* ───────────────────────────── switch rows ─────────────────────────────── */

/**
 * One notification preference, as an `align="end"` row.
 *
 * The whole label is the target: `<label htmlFor>` bound to the switch
 * forwards a click from anywhere in the text (a `<button>` is labelable), and
 * the switch carries a 44px invisible hit area via `before:`.
 *
 * Sized as the operator's v2 switch — 20x44 track — rather than the shared
 * 18x32 one, which reads as a toy beside 44px fields.
 */
export function SwitchRow({
  id,
  checked,
  onChange,
  title,
  description,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: ReactNode;
  disabled?: boolean;
}) {
  return (
    <SettingsRow label={title} description={description} htmlFor={id} align="end">
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className={cn(
          'relative h-6 w-11 border-2 shadow-none before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[""]',
          'data-[state=checked]:border-pv-primary data-[state=checked]:bg-pv-primary',
          'data-[state=unchecked]:border-transparent data-[state=unchecked]:bg-pv-border',
          'focus-visible:border-pv-primary focus-visible:ring-3 focus-visible:ring-pv-primary/25',
          '[&>span]:size-5 [&>span]:data-[state=checked]:translate-x-5 [&>span]:shadow-sm',
        )}
      />
    </SettingsRow>
  );
}

/* ─────────────────────────────── save bar ──────────────────────────────── */

/**
 * The page's one Save — the operator's `SettingsStickySaveBar`, exactly: a
 * floating pill at the foot of the scroll area with the state on the left and
 * Reset / Save changes on the right.
 *
 * ALWAYS on screen (owner, Oct 22 2026): both buttons wait, disabled, for a
 * genuine change. A bar that only arrived after the first edit moved the page
 * under the customer's cursor.
 *
 * Save is `type="submit"` for the page's `<form>` (by `form={formId}` — the
 * bar sits after it, at the foot of the page), whose `onSubmit` performs the
 * save. No `onClick` as well — one click would then save twice. Enter in any
 * field submits the same way.
 */
export function SettingsSaveBar({
  formId,
  dirty,
  saving,
  saved,
  onReset,
}: {
  formId: string;
  dirty: boolean;
  saving: boolean;
  /** True for a few seconds after a successful save. */
  saved: boolean;
  onReset: () => void;
}) {
  return (
    <div data-settings-save-bar="" className="pointer-events-none sticky bottom-4 z-30 flex justify-end pt-2">
      <div
        role="region"
        aria-label="Save changes"
        className="pointer-events-auto flex max-w-full flex-wrap items-center justify-end gap-2 rounded-full border border-pv-border bg-pv-card p-1.5 pl-4 shadow-lg"
      >
        <p
          className={cn(
            'text-[13px] empty:hidden',
            saved && !dirty ? 'text-pv-success' : 'text-pv-muted-fg',
            (saving || dirty || saved) && 'mr-1',
          )}
          // The result of a save has to reach a screen reader that never sees
          // the bar move. `polite` so it does not interrupt typing.
          aria-live="polite"
        >
          {saving ? 'Saving…' : dirty ? 'You have unsaved changes' : saved ? 'Saved' : null}
        </p>
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={!dirty || saving}
          className={PV_BUTTON_OUTLINE_SM}
        >
          Reset
        </Button>
        <Button
          type="submit"
          form={formId}
          variant="ghost"
          disabled={!dirty || saving}
          aria-busy={saving || undefined}
          className={cn(PV_BUTTON_SM, 'min-w-[112px]')}
        >
          {saving ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
          Save changes
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────── skeleton ──────────────────────────────── */

/** Sized like the real rows, so the page does not reflow when the data lands. */
function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div>
      <Skeleton className="h-4 w-36 bg-pv-muted" />
      <Skeleton className="mt-2 h-3.5 w-72 max-w-full bg-pv-muted/70" />
      <div className="mt-2">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 border-b border-pv-border/60 py-5 last:border-b-0 md:grid md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:gap-x-10"
          >
            <div className="space-y-2 md:pt-2.5">
              <Skeleton className="h-3.5 w-28 bg-pv-muted" />
              <Skeleton className="h-3 w-48 max-w-full bg-pv-muted/70" />
            </div>
            <Skeleton className="h-11 w-full max-w-md rounded-3xl bg-pv-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-12" aria-hidden>
      <SectionSkeleton rows={3} />
      <SectionSkeleton rows={2} />
    </div>
  );
}
