'use client';

/**
 * The furniture /portal/settings is built from.
 *
 * Everything here is the portal's flat recipe — 1px `brand-border-soft` on
 * `brand-card`, no shadows — matched to `components/portal/primitives.tsx` so a
 * settings panel and a booking panel read as the same object. It is local to
 * this route rather than added to the shared primitives because none of it has
 * a second caller yet.
 */

import type { LucideIcon } from 'lucide-react';
import { Check, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/* ─────────────────────────────── panels ────────────────────────────────── */

/**
 * One titled block of the page.
 *
 * The icon is a landmark, not decoration: this page is five near-identical
 * white rectangles and the glyph is what lets someone scrolling find "the one
 * with the padlock". It is `aria-hidden` — the `<h2>` carries the meaning.
 */
export function SettingsPanel({
  icon: Icon,
  title,
  description,
  children,
  footer,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-brand-border-soft bg-brand-card">
      <div className="flex items-start gap-3 border-b border-brand-border-soft px-4 py-3.5 sm:px-5">
        <span
          aria-hidden
          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-brand-stone"
        >
          <Icon strokeWidth={1.75} className="size-4 text-brand-text-subtle" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-brand-text">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-brand-text-soft">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5">{children}</div>

      {footer ? (
        <div className="border-t border-brand-border-soft px-4 py-3 sm:px-5">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/**
 * The save row at the foot of an editable panel.
 *
 * The button is DISABLED until something actually changed. A settings form
 * whose save button is always live invites a pointless write on every visit,
 * and each of those is a real UPDATE against `customers` plus a membership
 * re-read. "Saved" replaces the hint rather than appearing beside it, so the
 * row's height never changes and the page does not jump under the cursor.
 *
 * IT SUBMITS THE ENCLOSING `<form>` AND CARRIES NO `onClick`, deliberately.
 * An earlier version did both, which meant one click ran the save twice: once
 * from the handler and once from the form's `onSubmit`. Two UPDATEs, two
 * membership re-reads, and — had the mutation not been idempotent — two of
 * whatever it did. Every panel that uses this must therefore be wrapped in a
 * form whose `onSubmit` performs the save; that also buys Enter-to-save from
 * any field in it, which a plain `onClick` button does not.
 */
export function SaveFooter({
  dirty,
  saving,
  saved,
  label = 'Save changes',
  hint,
}: {
  dirty: boolean;
  saving: boolean;
  /** True for a few seconds after a successful save. */
  saved: boolean;
  label?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p
        className={cn(
          'text-xs leading-relaxed',
          saved ? 'text-success' : 'text-brand-text-subtle',
        )}
        // The result of a save has to reach a screen reader that never sees the
        // button's state change. `polite` so it does not interrupt typing.
        aria-live="polite"
      >
        {saved ? (
          <span className="inline-flex items-center gap-1.5">
            <Check aria-hidden className="size-3.5" />
            Saved
          </span>
        ) : dirty ? (
          'You have unsaved changes.'
        ) : (
          (hint ?? '')
        )}
      </p>

      <Button
        type="submit"
        variant="brand"
        disabled={!dirty || saving}
        aria-busy={saving}
        className="h-11 w-full sm:w-auto"
      >
        {saving ? (
          <>
            <Loader2 aria-hidden className="animate-spin" />
            Saving…
          </>
        ) : (
          label
        )}
      </Button>
    </div>
  );
}

/* ────────────────────────── read-only value rows ───────────────────────── */

/**
 * A fact the customer cannot change here — their date of birth, their ID
 * expiry, the email on their sign-in.
 *
 * Rendered as text on a tinted plate rather than as a disabled `<input>`. A
 * greyed-out field reads as "broken, try again later"; a plate reads as "this
 * comes from somewhere else", which is exactly what these are.
 */
export function ReadOnlyField({
  label,
  value,
  hint,
  badge,
  action,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-brand-text-soft">{label}</p>
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-brand-border-soft bg-brand-stone/50 px-3 py-2.5">
        <span className="min-w-0 flex-1 break-words text-sm text-brand-text">
          {value}
        </span>
        {badge}
        {action}
      </div>
      {hint ? (
        <div className="text-xs leading-relaxed text-brand-text-subtle">{hint}</div>
      ) : null}
    </div>
  );
}

/** A small status pill — "Verified", "Expired". Never the indigo `Badge`. */
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
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
        tone === 'positive' && 'bg-success-light text-success',
        tone === 'notice' && 'bg-warning-light text-warning',
        tone === 'negative' && 'bg-danger-light text-danger',
        tone === 'neutral' && 'bg-brand-stone text-brand-text-soft',
      )}
    >
      {children}
    </span>
  );
}

/* ───────────────────────────── switch rows ─────────────────────────────── */

/**
 * One notification preference.
 *
 * TAP TARGET — the whole row is the target, twice over. `<label htmlFor>` bound
 * to the switch forwards a click from anywhere in the text (a `<button>` is a
 * labelable element, so this is spec behaviour, not a trick), and the switch
 * itself carries a 44px invisible hit area via `before:`. The visible switch
 * stays 18px, which is the design.
 *
 * The insets are measured against the PADDING box, not the border box: the
 * switch is 18.4x32 with a 1px transparent border, so its padding box is
 * 16.4x30 and 14/7 of extra inset is what reaches 44 in both axes.
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
    <div className="flex min-h-11 items-start justify-between gap-4 py-1">
      <Label
        htmlFor={id}
        className="block cursor-pointer text-sm font-medium text-brand-text"
      >
        {title}
        <span className="mt-1 block text-xs font-normal leading-relaxed text-brand-text-soft">
          {description}
        </span>
      </Label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="relative mt-1 shrink-0 before:absolute before:-inset-x-[7px] before:-inset-y-[14px] before:content-['']"
      />
    </div>
  );
}

/* ─────────────────────────────── skeleton ──────────────────────────────── */

/**
 * Sized like the real thing, not a generic grey box: the panel chrome and the
 * field rows are the same height as what replaces them, so the page does not
 * reflow when the query lands.
 */
function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <section className="rounded-[14px] border border-brand-border-soft bg-brand-card">
      <div className="flex items-center gap-3 border-b border-brand-border-soft px-4 py-3.5 sm:px-5">
        <Skeleton className="size-8 shrink-0 rounded-full bg-brand-stone" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-32 bg-brand-stone" />
          <Skeleton className="h-3 w-56 max-w-full bg-brand-stone" />
        </div>
      </div>
      <div className="space-y-4 px-4 py-4 sm:px-5">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="space-y-1.5">
            <Skeleton className="h-3 w-24 bg-brand-stone" />
            <Skeleton className="h-11 w-full rounded-md bg-brand-stone" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <PanelSkeleton rows={3} />
      <PanelSkeleton rows={2} />
      <PanelSkeleton rows={2} />
    </div>
  );
}
