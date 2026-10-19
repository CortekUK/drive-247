'use client';

/**
 * The small pieces the Documents, ID verification and Gig driver pages share,
 * drawn in the operator portal v2's language (apps/portal/src/components/ui-v2
 * and customers-v2/customer-detail/kit.tsx), one notch calmer: a little more
 * air, one main action per screen.
 *
 * `PvDialogContent` is re-exported from `@nw/portal-v2/dialog`, the one copy of
 * the operator dialog every v2 screen uses.
 */

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { LucideIcon } from 'lucide-react-nw';
import { CircleAlert, CircleCheck, Info, Loader2, TriangleAlert } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { PvDialogContent } from '@nw/portal-v2/dialog';
import { cn } from '@nw/lib/utils';

/* ─────────────────────────────── tones ─────────────────────────────────── */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Icon tiles and the dialog art: a tinted square, the tone's ink on it. */
export const TONE_TILE: Record<Tone, string> = {
  neutral: 'bg-pv-muted text-pv-muted-fg',
  info: 'bg-pv-tint text-pv-primary',
  success: 'bg-pv-success-light text-pv-success',
  warning: 'bg-pv-warning-light text-pv-warning',
  danger: 'bg-pv-danger-light text-pv-danger',
};

export function IconTile({
  icon: Icon,
  tone = 'info',
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('grid size-11 shrink-0 place-items-center rounded-2xl', TONE_TILE[tone], className)}
    >
      <Icon strokeWidth={1.75} className="size-5" />
    </span>
  );
}

/* ─────────────────────────────── notices ───────────────────────────────── */

/** The operator's inline callout: a tinted ground, a hairline ring of its tone. */
const NOTICE_GROUND: Record<Tone, string> = {
  neutral: 'bg-pv-muted/60 ring-black/5',
  info: 'bg-pv-tint/70 ring-pv-primary/15',
  success: 'bg-pv-success-light/70 ring-pv-success/20',
  warning: 'bg-pv-warning-light/70 ring-pv-warning/25',
  danger: 'bg-pv-danger-light/70 ring-pv-danger/20',
};

const NOTICE_INK: Record<Tone, string> = {
  neutral: 'text-pv-muted-fg',
  info: 'text-pv-primary',
  success: 'text-pv-success',
  warning: 'text-pv-warning',
  danger: 'text-pv-danger',
};

const NOTICE_ICON: Record<Tone, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

export function Notice({
  tone,
  title,
  lines,
  children,
  className,
}: {
  tone: Tone;
  title?: string;
  /** One line per item; rendered as a list. */
  lines?: string[];
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = NOTICE_ICON[tone];
  return (
    <div
      // `alert` interrupts a screen reader; `status` waits for a pause. A failure
      // is worth the interruption, good news is not.
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-2xl px-5 py-4 ring-1', NOTICE_GROUND[tone], className)}
    >
      <Icon aria-hidden strokeWidth={1.75} className={cn('mt-0.5 size-4 shrink-0', NOTICE_INK[tone])} />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-semibold text-pv-fg">{title}</p> : null}
        {lines && lines.length > 0 ? (
          <ul className={cn('flex flex-col gap-0.5', title && 'mt-1')}>
            {lines.map((line, index) => (
              // Index keys: two lines can repeat (two files with one name), and
              // the list is rebuilt wholesale rather than reordered.
              // eslint-disable-next-line react/no-array-index-key
              <li key={index} className="text-[13px] leading-relaxed text-pv-muted-fg">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        {children ? (
          <div className={cn('text-[13px] leading-relaxed text-pv-muted-fg', title && 'mt-1')}>{children}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────────────────── metadata ──────────────────────────────── */

/** A small uppercase label over a value — the operator kit's `Meta`. */
export function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-pv-muted-fg">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-pv-fg">{value}</dd>
    </div>
  );
}

/* ─────────────────────────────── upload zone ───────────────────────────── */

/**
 * The dashed drop target. Hover and drag are a 200ms fade of the border and
 * ground (V2_PLAN §12 — hovers fade, they do not move).
 */
export function UploadZone({
  active,
  onFiles,
  onDragState,
  children,
  className,
}: {
  active: boolean;
  onFiles: (files: FileList | null) => void;
  onDragState: (active: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        onDragState(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        onDragState(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        onDragState(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDragState(false);
        onFiles(event.dataTransfer.files);
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed px-6 py-8 text-center',
        '[transition:border-color_200ms_ease-out,background-color_200ms_ease-out] motion-reduce:transition-none',
        active
          ? 'border-pv-primary bg-pv-tint'
          : 'border-pv-border bg-pv-row/70 hover:border-pv-primary/50',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────── dialogs ───────────────────────────────── */

/** The operator dialog surface lives in one place, shared by every v2 screen. */
export { PvDialogContent };

/**
 * The top of a dialog screen: the art, the one idea, one line under it.
 * Centred and stacked, like the operator's verify-ID screens.
 */
export function DialogScreenHeader({
  icon,
  tone = 'info',
  title,
  description,
}: {
  icon: LucideIcon;
  tone?: Tone;
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center pt-2 text-center">
      <IconTile icon={icon} tone={tone} className="size-14 rounded-3xl [&>svg]:size-6" />
      <DialogPrimitive.Title className="mt-5 text-xl font-semibold tracking-[-0.02em] text-pv-fg [text-wrap:balance]">
        {title}
      </DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="mx-auto mt-1.5 max-w-[24rem] text-sm leading-relaxed text-pv-muted-fg [text-wrap:balance]">
          {description}
        </DialogPrimitive.Description>
      ) : (
        // Radix warns without a description; an empty one is the honest answer.
        <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
      )}
    </div>
  );
}

/**
 * A confirm screen: art, one idea, one primary button, and a quiet way out.
 * The primary is the destructive action, so it is never the autofocus.
 */
export function ConfirmDialog({
  open,
  icon,
  tone = 'danger',
  title,
  description,
  confirmLabel,
  busyLabel,
  cancelLabel = 'Keep it',
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  icon: LucideIcon;
  tone?: Tone;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel?: string;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <PvDialogContent showCloseButton={!busy} onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogScreenHeader icon={icon} tone={tone} title={title} description={description} />

        {error ? <Notice tone="danger" lines={[error]} /> : null}

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="brand-ghost"
            // ui-v2's `destructive`: a soft red tint, not a solid red slab.
            className="h-11 w-full bg-pv-danger-light text-pv-danger hover:bg-pv-danger/15 hover:text-pv-danger focus-visible:ring-pv-danger/25"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            {busy ? busyLabel : confirmLabel}
          </Button>
          <Button
            type="button"
            variant="brand-ghost"
            className="h-11 w-full"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
        </div>
      </PvDialogContent>
    </DialogPrimitive.Root>
  );
}

