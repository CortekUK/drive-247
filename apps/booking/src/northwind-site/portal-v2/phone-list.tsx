'use client';

/**
 * A list's phone face. Below `md` a table's columns cannot fit 390px without
 * squeezing into each other, so each row becomes one tappable line: what it
 * is and one line of detail on the left, the figure or status on the right,
 * and an optional trailing control (a Pay button, a row menu). The page keeps
 * its table from `md` up (`max-md:hidden` on the table, this is `md:hidden`).
 *
 * Agreements has used this shape on phones since Oct 22; Rentals, Insurances
 * and Finances now share it, so every list in the portal reads the same.
 */

import type { ReactNode } from 'react';

import { cn } from '@nw/lib/utils';

export function PhoneList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul className={cn('divide-y divide-pv-border overflow-hidden rounded-2xl border border-pv-border bg-pv-card md:hidden', className)}>
      {children}
    </ul>
  );
}

export function PhoneRow({
  title,
  detail,
  value,
  valueDetail,
  valueClassName,
  trailing,
  onOpen,
  muted = false,
}: {
  title: ReactNode;
  detail?: ReactNode;
  /** The right-hand figure or status. */
  value?: ReactNode;
  valueDetail?: ReactNode;
  valueClassName?: string;
  /** A control after the value (Pay, a ⋮ menu). Taps on it do not open the row. */
  trailing?: ReactNode;
  onOpen?: () => void;
  /** A cancelled row: greyed, as the tables grey it. */
  muted?: boolean;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[15px] font-semibold', muted ? 'text-pv-muted-fg' : 'text-pv-fg')}>{title}</span>
        {detail ? <span className="mt-0.5 block truncate text-[13px] text-pv-muted-fg">{detail}</span> : null}
      </span>
      {value !== undefined || valueDetail ? (
        <span className="flex shrink-0 flex-col items-end text-right">
          {value !== undefined ? (
            <span className={cn('text-[14px] font-semibold tabular-nums', muted ? 'text-pv-muted-fg line-through' : 'text-pv-fg', valueClassName)}>
              {value}
            </span>
          ) : null}
          {valueDetail ? <span className="mt-0.5 text-[12px] text-pv-muted-fg">{valueDetail}</span> : null}
        </span>
      ) : null}
    </>
  );

  return (
    <li className="flex items-center gap-2 pr-2">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3.5 pl-4 pr-2 text-left transition-colors duration-150 active:bg-pv-hover motion-reduce:transition-none"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 pr-2">{body}</div>
      )}
      {trailing ? <div className="flex shrink-0 items-center">{trailing}</div> : <span className="w-2" />}
    </li>
  );
}
