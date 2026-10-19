/**
 * Northwind booking site v2 — the shared furniture every public page is built
 * from, in the operator portal v2's language (the `.pv2` tokens). The ONE copy:
 * a page, section or card that needs one of these imports it from here rather
 * than re-typing the classes.
 *
 * Page anatomy (the same as the customer portal v2 and the operator portal v2):
 * a big title with ONE muted line under it, then sections, each with its own
 * smaller heading and muted line, then flat 1px-bordered cards. No shadows, no
 * gradients beyond the shell's brand wash.
 */

import { cn } from '@nw/lib/utils';

/** The page column: 1200px, 16px gutters on phones, 24px from md. */
export const SITE_CONTAINER = 'mx-auto w-full max-w-[1200px] px-4 md:px-6';

/** A flat card: 1px border, 16px radius, white. Add padding at the call site. */
export const CARD = 'rounded-2xl border border-pv-border bg-pv-card';

/** A card that is a link or button: the border warms to the accent on hover. */
export const CARD_INTERACTIVE =
  `${CARD} transition-colors duration-200 ease-out hover:border-pv-primary/40 ` +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none';

/** The small rounded icon tile that leads a card or a step. */
export const ICON_TILE = 'grid size-8 shrink-0 place-items-center rounded-lg bg-pv-tint text-pv-primary';

/** A form field shell (input, select, textarea): 44px, 10px radius, accent focus ring. */
export const FIELD =
  'h-11 w-full rounded-[10px] border border-pv-border bg-pv-bg px-3 text-sm text-pv-fg outline-none ' +
  'transition-colors duration-200 placeholder:text-pv-muted-fg/80 hover:border-pv-fg/20 ' +
  'focus-visible:border-pv-primary focus-visible:ring-3 focus-visible:ring-pv-primary/15 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none';

/** A field's label line. */
export const FIELD_LABEL = 'text-xs font-medium text-pv-muted-fg';

/**
 * The top of a page: the title and its one muted line, with optional actions on
 * the right (stacked under on phones). Every v2 page opens with this, unless it
 * has a hero of its own (home).
 */
export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn(SITE_CONTAINER, 'pb-2 pt-10 md:pt-14', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? <p className="mb-2 text-xs font-medium text-pv-muted-fg">{eyebrow}</p> : null}
          <h1 className="text-[32px] font-bold leading-[1.1] tracking-[-0.035em] text-pv-fg md:text-[44px]">{title}</h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-pv-muted-fg md:text-base">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** A page section in the page column, with the standard rhythm above it. */
export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn(SITE_CONTAINER, 'pt-12 md:pt-16', className)}>
      {children}
    </section>
  );
}

/** A section's heading and its one muted line, with an optional action (a "See all" link). */
export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <h2 className="text-[24px] font-bold leading-[1.15] tracking-[-0.03em] text-pv-fg md:text-[28px]">{title}</h2>
        {description ? <p className="mt-1 text-[14px] text-pv-muted-fg">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** A card's own heading row: 15px semibold title, 13px muted line. */
export function CardHeading({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[15px] font-semibold text-pv-fg">{title}</p>
      {description ? <p className="mt-0.5 text-[13px] leading-relaxed text-pv-muted-fg">{description}</p> : null}
    </div>
  );
}

/** The empty / error state: icon tile, one line, one muted line, optional action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(CARD, 'flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      {icon ? <span className="grid size-12 place-items-center rounded-2xl bg-pv-tint text-pv-primary">{icon}</span> : null}
      <p className="text-[15px] font-semibold text-pv-fg">{title}</p>
      {description ? <p className="max-w-sm text-[13px] text-pv-muted-fg">{description}</p> : null}
      {action}
    </div>
  );
}
