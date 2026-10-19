'use client';

/**
 * Northwind booking site v2 — the pieces both steps of the post-payment
 * documents screen share (v2 of `components/booking/documents-shared.tsx`, same
 * exported names and props). Drawn in the customer portal v2's language: tone
 * tiles, tinted callouts with a hairline ring, a dashed drop panel.
 *
 * The copy rule from v1 holds for every string on this surface: nothing says
 * "confirmed" or "complete". Sending documents is not approval — an operator
 * still reviews them. What these screens say is: received, under review.
 *
 * Extra shared primitives for this surface (not in `site-v2/kit`, which is not
 * ours to edit): `ToneTile`, `Callout`, `DropPanel`, `StepCard`.
 */

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react-nw';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react-nw';

import { Skeleton } from '@nw/components/ui/skeleton';
import { CARD, ICON_TILE } from '@nw/site-v2/kit';
import { cn } from '@nw/lib/utils';

import type { BookingDocumentsSession } from '@nw/hooks/use-booking-documents';

/** Bytes as something a person reads — the one implementation, v1's. */
export { formatSize } from '@nw/components/booking/documents-shared';

/* ─────────────────────────────── tones ─────────────────────────────────── */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TILE: Record<Tone, string> = {
  neutral: 'bg-pv-muted text-pv-muted-fg',
  info: 'bg-pv-tint text-pv-primary',
  success: 'bg-pv-success-light text-pv-success',
  warning: 'bg-pv-warning-light text-pv-warning',
  danger: 'bg-pv-danger-light text-pv-danger',
};

/** A tinted square with the tone's ink on it. `lg` is the notice-screen art. */
export function ToneTile({
  icon: Icon,
  tone = 'info',
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        size === 'lg'
          ? 'grid size-14 shrink-0 place-items-center rounded-3xl [&>svg]:size-6'
          : cn(ICON_TILE, 'size-10 rounded-xl [&>svg]:size-[18px]'),
        TILE[tone],
        className,
      )}
    >
      <Icon strokeWidth={1.75} />
    </span>
  );
}

/* ─────────────────────────────── callouts ──────────────────────────────── */

const GROUND: Record<Tone, string> = {
  neutral: 'bg-pv-muted/60 ring-black/5',
  info: 'bg-pv-tint/70 ring-pv-primary/15',
  success: 'bg-pv-success-light/70 ring-pv-success/20',
  warning: 'bg-pv-warning-light/70 ring-pv-warning/25',
  danger: 'bg-pv-danger-light/70 ring-pv-danger/20',
};

const INK: Record<Tone, string> = {
  neutral: 'text-pv-muted-fg',
  info: 'text-pv-primary',
  success: 'text-pv-success',
  warning: 'text-pv-warning',
  danger: 'text-pv-danger',
};

const CALLOUT_ICON: Record<Tone, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

/** An inline callout: a tinted ground, a hairline ring of its tone. */
export function Callout({
  tone,
  title,
  children,
  className,
}: {
  tone: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = CALLOUT_ICON[tone];
  return (
    <div
      // A failure is worth interrupting a screen reader for; good news is not.
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-2xl px-4 py-3.5 ring-1', GROUND[tone], className)}
    >
      <Icon aria-hidden strokeWidth={1.75} className={cn('mt-0.5 size-4 shrink-0', INK[tone])} />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-semibold text-pv-fg">{title}</p> : null}
        {children ? (
          <div className={cn('text-[13px] leading-relaxed text-pv-muted-fg', title ? 'mt-0.5' : null)}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A failure, next to what caused it. Same contract as v1's. */
export function ProblemBox({ message }: { message: string }) {
  return (
    <Callout tone="danger">
      <span className="text-pv-fg">{message}</span>
    </Callout>
  );
}

/* ─────────────────────────────── drop panel ────────────────────────────── */

/**
 * The dashed drop target, a tint panel. Hover and drag fade the border and
 * ground over 200ms; nothing moves.
 */
export function DropPanel({
  active,
  disabled,
  onFiles,
  onDragState,
  className,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onFiles: (files: FileList | null) => void;
  onDragState: (active: boolean) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) onDragState(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) onDragState(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (event.currentTarget === event.target) onDragState(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDragState(false);
        if (!disabled) onFiles(event.dataTransfer.files);
      }}
      className={cn(
        'rounded-2xl border border-dashed',
        '[transition:border-color_200ms_ease-out,background-color_200ms_ease-out] motion-reduce:transition-none',
        active ? 'border-pv-primary bg-pv-tint' : 'border-pv-border bg-pv-row/70 hover:border-pv-primary/50',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────── step card ─────────────────────────────── */

/** A step: icon tile, title, one muted line, a chip on the right, then the body. */
export function StepCard({
  icon,
  tone = 'info',
  title,
  description,
  chip,
  children,
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  title: React.ReactNode;
  description?: React.ReactNode;
  chip?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(CARD, 'pv2-enter', className)}>
      <header className="flex items-start gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <ToneTile icon={icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-pv-fg">{title}</h2>
            {chip}
          </div>
          {description ? (
            <p className="mt-1 text-[13px] leading-relaxed text-pv-muted-fg">{description}</p>
          ) : null}
        </div>
      </header>
      {children ? <div className="px-5 pb-5 pt-5 sm:px-6 sm:pb-6">{children}</div> : <div className="pb-5 sm:pb-6" />}
    </section>
  );
}

/* ─────────────────────────────── screens ───────────────────────────────── */

const NOTICE_TONE = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
} as const satisfies Record<string, Tone>;

/** A whole-screen state: the art, one idea, one line, one action. */
export function NoticeScreen({
  icon,
  tone,
  title,
  body,
  action,
  children,
}: {
  icon: LucideIcon;
  tone: keyof typeof NOTICE_TONE;
  title: string;
  body: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn(CARD, 'pv2-enter flex flex-col items-center gap-3 px-6 py-12 text-center sm:px-10')}>
      <ToneTile icon={icon} tone={NOTICE_TONE[tone]} size="lg" />
      <h1 className="mt-2 text-[22px] font-bold tracking-[-0.025em] text-pv-fg [text-wrap:balance]">{title}</h1>
      <p className="max-w-md text-sm leading-relaxed text-pv-muted-fg">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
      {children}
    </div>
  );
}

/**
 * The operator's name and mark, from what the LINK FUNCTION returned — not
 * from `TenantContext`, which can be the wrong tenant on an apex host (see
 * v1's note). `/` is deliberately relative.
 */
export function BrandHeader({ session }: { session: BookingDocumentsSession | null }) {
  const name = session?.tenant.companyName ?? null;
  const logo = session?.tenant.logoUrl ?? null;

  if (!name && !logo) return null;

  return (
    <div className="mb-6 flex items-center gap-3">
      <Link
        href="/"
        aria-label={name ? `${name} — go to the home page` : 'Go to the home page'}
        className="flex min-h-11 items-center gap-3 rounded-[10px] transition-opacity duration-200 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-9 w-auto max-w-[160px] object-contain" />
        ) : null}
        {name ? <span className="text-sm font-semibold text-pv-fg">{name}</span> : null}
      </Link>
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className={cn(CARD, 'flex flex-col gap-3 p-6')} aria-busy="true" aria-label="Opening your link">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl bg-pv-muted" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-48 bg-pv-muted" />
          <Skeleton className="h-3 w-2/3 bg-pv-muted" />
        </div>
      </div>
      <Skeleton className="mt-3 h-40 w-full rounded-2xl bg-pv-muted" />
    </div>
  );
}
