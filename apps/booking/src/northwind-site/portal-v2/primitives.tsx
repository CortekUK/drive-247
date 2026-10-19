/**
 * Customer portal v2's page furniture — the same API as the current portal's
 * `components/portal/primitives.tsx` (so every screen ported from it works
 * unchanged), drawn in the operator portal v2's language: a big tight heading,
 * 16px-radius white cards with a 1px border, tinted table-style headers, the
 * brand tint for fills.
 */

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { Skeleton } from '@nw/components/ui/skeleton';
import { cn } from '@nw/lib/utils';

/* ──────────────────────────── page furniture ───────────────────────────── */

/**
 * The operator v2 page header (billing-page-v2.tsx, agreements-page-v2.tsx):
 * a tight bold title, 24px on a phone and 30px from `sm`, and ONE muted line
 * under it saying what the page is for. Pass that line as `description`.
 * `eyebrow` is a small muted line above the title (a date, a step) for the few
 * screens that need one.
 */
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3 pt-1 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-medium text-pv-muted-fg">{eyebrow}</p> : null}
        <h1 className="text-2xl font-bold tracking-tight text-pv-fg sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-pv-muted-fg sm:text-base">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** The standard card surface. */
export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn('rounded-2xl border border-pv-border bg-pv-card', className)}>{children}</section>;
}

export function PanelHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  /** One muted line under the title. */
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-t-2xl border-b border-pv-border bg-pv-tint/60 px-4 py-3 sm:px-5',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold text-pv-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-pv-muted-fg">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/* ─────────────────────────────── data rows ─────────────────────────────── */

/** A label beside a value. Renders nothing for an empty value. */
export function DetailRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  if (value === null || value === undefined || value === '') return null;

  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-xs text-pv-muted-fg sm:w-44 sm:text-[13px]">{label}</dt>
      <dd className="min-w-0 text-[13px] font-medium text-pv-fg">
        {value}
        {hint ? <span className="mt-0.5 block text-xs font-normal text-pv-muted-fg">{hint}</span> : null}
      </dd>
    </div>
  );
}

export function DetailList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn('divide-y divide-pv-border', className)}>{children}</dl>;
}

/** A single headline number. */
export function StatTile({
  label,
  value,
  caption,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  caption?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-2xl border border-pv-border bg-pv-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        {Icon ? (
          <span className="grid size-7 place-items-center rounded-lg bg-pv-tint">
            <Icon aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-pv-primary" />
          </span>
        ) : null}
        <span className="truncate text-xs font-medium text-pv-muted-fg">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-[-0.02em] tabular-nums text-pv-fg">{value}</p>
      {caption ? <p className="mt-0.5 truncate text-xs text-pv-muted-fg">{caption}</p> : null}
    </div>
  );
}

/* ────────────────────────────── empty states ───────────────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-pv-tint">
        <Icon aria-hidden strokeWidth={1.75} className="size-5 text-pv-primary" />
      </span>
      <div className="max-w-sm">
        <p className="text-[15px] font-semibold text-pv-fg">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-pv-muted-fg">{description}</p>
      </div>
      {action ? (
        <Button asChild variant="brand" className="mt-1 h-10">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

export function ComingSoon({
  icon: Icon,
  title,
  description,
  meanwhile,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  meanwhile?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      <Panel>
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-pv-tint">
            <Icon aria-hidden strokeWidth={1.75} className="size-5 text-pv-primary" />
          </span>
          <div className="max-w-sm">
            <p className="text-[15px] font-semibold text-pv-fg">Not here yet</p>
            <p className="mt-1 text-[13px] leading-relaxed text-pv-muted-fg">
              This part of your account is still being built. Nothing is missing from your booking.
            </p>
          </div>
          {meanwhile ? (
            <Button asChild variant="brand-outline" className="mt-1 h-10">
              <Link href={meanwhile.href}>{meanwhile.label}</Link>
            </Button>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

/* ─────────────────────────────── skeletons ─────────────────────────────── */

export function BookingCardSkeleton() {
  return (
    <div className="flex gap-4 rounded-2xl border border-pv-border bg-pv-card p-3.5">
      <Skeleton className="size-20 shrink-0 rounded-xl bg-pv-tint sm:size-24" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
        <Skeleton className="h-4 w-40 bg-pv-tint" />
        <Skeleton className="h-3 w-28 bg-pv-tint" />
        <Skeleton className="h-3 w-52 bg-pv-tint" />
      </div>
    </div>
  );
}

export function BookingListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <BookingCardSkeleton key={index} />
      ))}
    </div>
  );
}

/* ───────────────────────────── error surface ───────────────────────────── */

export function LoadError({
  title = 'We could not load this',
  error,
  onRetry,
}: {
  title?: string;
  error: Error | null;
  onRetry?: () => void;
}) {
  return (
    <Panel className="px-5 py-5">
      <p className="text-[13px] font-semibold text-pv-fg">{title}</p>
      <p className="mt-1 break-words text-[13px] leading-relaxed text-pv-muted-fg">
        {error?.message ?? 'Please try again in a moment.'}
      </p>
      {onRetry ? (
        <Button type="button" variant="brand-outline" className="mt-4 h-10" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </Panel>
  );
}
