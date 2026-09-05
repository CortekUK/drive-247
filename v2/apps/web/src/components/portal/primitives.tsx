/**
 * The small, repeated pieces of the portal: page headings, empty states,
 * label/value rows and the placeholder for routes that are not built yet.
 *
 * All flat — 1px `brand-border-soft` hairlines on `brand-card`, no shadows, no
 * gradients — which is the house recipe the booking surfaces already follow.
 */

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/* ──────────────────────────── page furniture ───────────────────────────── */

export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-medium tracking-[-0.02em] text-brand-text sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 text-sm leading-relaxed text-brand-text-soft">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** The standard card surface. Everything on a portal page sits in one of these. */
export function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-[14px] border border-brand-border-soft bg-brand-card',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-b border-brand-border-soft px-4 py-3 sm:px-5',
        className,
      )}
    >
      <h2 className="text-sm font-medium text-brand-text">{title}</h2>
      {action}
    </div>
  );
}

/* ─────────────────────────────── data rows ─────────────────────────────── */

/**
 * A label above a value, stacked on mobile and side-by-side from `sm`.
 *
 * Renders NOTHING when the value is null or an empty string. A booking detail
 * page has ~20 optional fields; a grid of "Delivery address —" placeholders
 * tells the customer nothing and buries the four rows that are filled in.
 */
export function DetailRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  if (value === null || value === undefined || value === '') return null;

  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-xs text-brand-text-subtle sm:w-44 sm:text-sm">
        {label}
      </dt>
      <dd className="min-w-0 text-sm text-brand-text">
        {value}
        {hint ? (
          <span className="mt-0.5 block text-xs text-brand-text-subtle">{hint}</span>
        ) : null}
      </dd>
    </div>
  );
}

export function DetailList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <dl className={cn('divide-y divide-brand-border-soft', className)}>{children}</dl>
  );
}

/** A single headline number, for the overview strip. */
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
    <div className="rounded-[14px] border border-brand-border-soft bg-brand-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        {Icon ? (
          <Icon
            aria-hidden
            strokeWidth={1.75}
            className="size-4 shrink-0 text-brand-text-subtle"
          />
        ) : null}
        <span className="truncate text-xs text-brand-text-subtle">{label}</span>
      </div>
      <p className="mt-1.5 text-2xl font-medium tabular-nums text-brand-text">{value}</p>
      {caption ? (
        <p className="mt-0.5 truncate text-xs text-brand-text-subtle">{caption}</p>
      ) : null}
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
      <span className="grid size-11 place-items-center rounded-full bg-brand-stone">
        <Icon aria-hidden strokeWidth={1.75} className="size-5 text-brand-text-subtle" />
      </span>
      <div className="max-w-sm">
        <p className="text-base font-medium text-brand-text">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">{description}</p>
      </div>
      {action ? (
        <Button asChild variant="brand" className="mt-1 h-11">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The placeholder for a nav destination that has no page yet.
 *
 * It names what is missing and points at the surface that DOES carry the
 * information today, so the route is a signpost rather than a dead end.
 */
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
          <span className="grid size-11 place-items-center rounded-full bg-brand-stone">
            <Icon
              aria-hidden
              strokeWidth={1.75}
              className="size-5 text-brand-text-subtle"
            />
          </span>
          <div className="max-w-sm">
            <p className="text-base font-medium text-brand-text">Not here yet</p>
            <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">
              This part of your account is still being built. Nothing is missing
              from your booking — it just is not shown here yet.
            </p>
          </div>
          {meanwhile ? (
            <Button asChild variant="brand-outline" className="mt-1 h-11">
              <Link href={meanwhile.href}>{meanwhile.label}</Link>
            </Button>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

/* ─────────────────────────────── skeletons ─────────────────────────────── */

/** Matches the shape of one `BookingCard` so the list does not jump on load. */
export function BookingCardSkeleton() {
  return (
    <div className="flex gap-4 rounded-[14px] border border-brand-border-soft bg-brand-card p-3.5">
      <Skeleton className="size-20 shrink-0 rounded-[10px] bg-brand-stone sm:size-24" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
        <Skeleton className="h-4 w-40 bg-brand-stone" />
        <Skeleton className="h-3 w-28 bg-brand-stone" />
        <Skeleton className="h-3 w-52 bg-brand-stone" />
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

/**
 * What a failed query looks like.
 *
 * The raw message is shown. It is nearly always a PostgREST column or grant
 * error, and hiding it behind "Something went wrong" costs the one detail that
 * makes it diagnosable — PostgREST rejects the whole row for a single bad
 * column name, so the message names the offender.
 */
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
    <Panel className="px-5 py-6">
      <p className="text-sm font-medium text-brand-text">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">
        {error?.message ?? 'Please try again in a moment.'}
      </p>
      {onRetry ? (
        <Button
          type="button"
          variant="brand-outline"
          className="mt-4 h-11"
          onClick={onRetry}
        >
          Try again
        </Button>
      ) : null}
    </Panel>
  );
}
