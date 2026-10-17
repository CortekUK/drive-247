'use client';

/**
 * Super admin's empty state — the layout of Northwind's TeachingEmptyState
 * (apps/portal/src/components/empty-states/teaching-empty-state.tsx): a
 * picture, a headline, one line saying what will be here, and at most one way
 * forward. A funnel, each layer a little narrower than the one above, so the
 * eye runs straight down to the action.
 *
 *   size="page"     a whole list with nothing in it yet (the default)
 *   size="section"  a card or tab inside a page: smaller picture, less air
 *
 * `NoMatchState` is the other case — there IS data, the filters hid all of it —
 * and says so with a way to clear them, rather than reading as "nothing here".
 */

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { NoMatchArt } from '@/components/admin/illustrations/scenes/admin-scenes';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

export function EmptyState({
  illustration,
  headline,
  body,
  action,
  size = 'page',
  className,
}: {
  /** One of the scene components, e.g. `<CompaniesEmptyArt />`. */
  illustration?: ReactNode;
  headline: string;
  body?: ReactNode;
  action?: EmptyStateAction;
  size?: 'page' | 'section';
  className?: string;
}) {
  const page = size === 'page';
  const Icon = action?.icon;
  return (
    <div className={cn(page ? 'px-6 py-10 sm:py-14' : 'px-4 py-6', className)}>
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        {illustration && (
          <div aria-hidden="true" className={cn('w-full', page ? 'max-w-[400px]' : 'max-w-[260px]')}>
            {illustration}
          </div>
        )}
        <h3
          className={cn(
            'max-w-[460px] font-semibold tracking-tight text-foreground',
            page ? 'mt-5 text-[21px]' : 'mt-3 text-base',
          )}
        >
          {headline}
        </h3>
        {body && (
          <p
            className={cn(
              'mt-1.5 max-w-[380px] leading-relaxed text-muted-foreground',
              page ? 'text-[15px]' : 'text-[13px]',
            )}
          >
            {body}
          </p>
        )}
        {action && (
          <Button onClick={action.onClick} className={page ? 'mt-6' : 'mt-4'} size={page ? 'default' : 'sm'}>
            {Icon && <Icon className="h-4 w-4" />}
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Data exists, but the search or filters hid all of it. */
export function NoMatchState({
  noun = 'results',
  onClear,
  size = 'page',
  className,
}: {
  /** What was being searched for, plural: "companies", "requests". */
  noun?: string;
  /** Clears the search and filters. Omitted where there is nothing to clear. */
  onClear?: () => void;
  size?: 'page' | 'section';
  className?: string;
}) {
  return (
    <EmptyState
      illustration={<NoMatchArt />}
      headline={`No ${noun} match`}
      body="Nothing fits this search or these filters. Try a different word, or clear them to see everything."
      action={onClear ? { label: 'Clear filters', onClick: onClear } : undefined}
      size={size}
      className={className}
    />
  );
}
