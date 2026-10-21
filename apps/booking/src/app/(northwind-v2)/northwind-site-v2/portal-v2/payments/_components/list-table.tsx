/**
 * The operator portal v2's list table, drawn for the customer portal.
 *
 * Copied in spirit from `apps/portal/src/components/shared/list-table-v2.tsx`
 * (the rentals list's parts every operator list is built from): a bordered
 * card, a tinted header row of small uppercase column names, headings and
 * cells reading left with only money reading right, the row's identifier
 * weighted and everything else plain, and status as coloured TEXT — never a
 * pill. One step calmer than the operator's: taller rows and 14px body text,
 * because a customer reads this list a few times a year, not all day.
 *
 * Local to payments + agreements for now (both import it). If a third customer
 * screen wants a table, this belongs in `@nw/portal-v2/primitives`.
 */

import { cn } from '@nw/lib/utils';
import { StatusChip } from '@nw/portal-v2/status-chip';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Status is coloured text; hue is the only thing that changes. The shared
 * chip's `plain` form, so tables and chips draw one palette.
 */
export function StatusText({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <StatusChip plain tone={tone} className={className}>
      {children}
    </StatusChip>
  );
}

/** The card a list sits in. */
export function ListCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-pv-border bg-pv-card', className)}>
      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

export function ListHead({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-11 whitespace-nowrap px-4 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-pv-muted-fg first:pl-5 last:pr-5',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function ListHeaderRow({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-pv-tint/60">
      <tr className="border-b border-pv-border">{children}</tr>
    </thead>
  );
}

export function ListBody({ children }: { children: React.ReactNode }) {
  return <tbody className="[&>tr:last-child]:border-0">{children}</tbody>;
}

/**
 * One row. With `onOpen` the whole row opens the record (as every operator
 * list does); the hover is a fade, never a lift. Keyboard users reach the same
 * action through the `RowButton` the caller puts in the first cell, so the row
 * keeps its table semantics instead of pretending to be a button.
 */
export function ListRow({
  children,
  onOpen,
  className,
}: {
  children: React.ReactNode;
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        'border-b border-pv-border transition-colors duration-200 ease-out motion-reduce:transition-none',
        onOpen ? 'cursor-pointer hover:bg-pv-row-hover has-[:focus-visible]:bg-pv-row-hover' : null,
        className,
      )}
      onClick={onOpen}
    >
      {children}
    </tr>
  );
}

/** The row's identifier, as the focusable control that opens it. */
export function RowButton({
  children,
  onOpen,
  label,
}: {
  children: React.ReactNode;
  onOpen: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        // The row already opens on click; stop it firing twice.
        event.stopPropagation();
        onOpen();
      }}
      className="block max-w-full text-left focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

export function ListCell({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={cn('px-4 py-3.5 text-left align-middle first:pl-5 last:pr-5', className)}>{children}</td>
  );
}

/** Section title above a list — the operator's "title, then filter bar, then table". */
export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  // Title and control share the top line; the description runs underneath at
  // full width. With the description beside the tabs, the pill track ran into
  // it on narrower screens (owner, Oct 22 2026).
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-pv-fg">{title}</h2>
        {action ? <div className="w-full shrink-0 sm:w-auto">{action}</div> : null}
      </div>
      {description ? <p className="text-[13px] text-pv-muted-fg">{description}</p> : null}
    </div>
  );
}

/**
 * The operator's pill tabs (`ui-v2/tabs`): a muted track, the active segment
 * a white pill. Used as the list's filter bar.
 */
export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex w-full items-center rounded-full bg-pv-muted p-1 sm:w-auto">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-200 ease-out motion-reduce:transition-none sm:flex-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50',
              active ? 'bg-pv-card text-pv-fg ring-1 ring-pv-border' : 'text-pv-muted-fg hover:text-pv-fg',
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={cn('tabular-nums', active ? 'text-pv-muted-fg' : 'text-pv-muted-fg/70')}>
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
