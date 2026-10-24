'use client';

/**
 * Page-header controls, drawn as Northwind's
 * (apps/portal/src/components/shared/header-icon-button-v2.tsx).
 *
 * The rule: ONE labelled button per header — the page's main action (Add New
 * Rental, New announcement) — and everything else as a round icon with its
 * name in a tooltip (and in `aria-label`, so nothing loses its name).
 *
 *   <div className={HEADER_ACTIONS}>
 *     <HeaderIconButton label="Refresh" onClick={…}><RefreshCw /></HeaderIconButton>
 *     <Button className={HEADER_PRIMARY}><Plus /> Add New Rental</Button>
 *   </div>
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The header's control cluster, centred on the SUBTITLE line, not the heading
 * (Northwind's HEADER_ACTIONS_V2). The box is the subtitle's line box (text-sm =
 * 20px) at the bottom of the header row, so the 32px controls overflow it by 6px
 * above and below and their centre lands on the subtitle's. Below `sm` the
 * header stacks and the cluster keeps its natural height.
 */
export const HEADER_ACTIONS = 'flex shrink-0 items-center gap-2 sm:self-end sm:h-5 max-sm:justify-self-end';

/**
 * A page header on a phone (below `sm`): the title on its own line, then ONE
 * line of description — cut short with an ellipsis, never removed — with the
 * header's buttons at the right end of that line, instead of a full-width
 * button stacked underneath (asked for Oct 24 2026). Every class is
 * `max-sm:`, so the desktop header is untouched.
 *
 *   <div className={cn('flex …', PAGE_HEADER)}>       the header row
 *     <div className={PAGE_HEADER_TEXT}>                each wrapper around the h1 and p
 *       <h1 className={cn('…', PAGE_TITLE)}>…</h1>
 *       <p className={cn('…', PAGE_DESCRIPTION)}>…</p>
 *     </div>
 *     <div className={HEADER_ACTIONS}>…</div>
 *   </div>
 *
 * The wrappers dissolve (`display: contents`) so the title, the description
 * and the actions are the grid's own items: the title spans both columns, the
 * description takes what the buttons leave of the second row.
 */
export const PAGE_HEADER =
  'max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-1';
export const PAGE_HEADER_TEXT = 'max-sm:contents';
export const PAGE_TITLE = 'max-sm:col-span-2';
export const PAGE_DESCRIPTION = 'max-sm:mt-0 max-sm:min-w-0 max-sm:truncate';

/**
 * The header's one labelled button, Northwind's HEADER_PRIMARY_V2: a 32px brand
 * pill, 13px text, 14px icon.
 */
export const HEADER_PRIMARY =
  'h-8 gap-1.5 rounded-full bg-gradient-primary px-3.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 [&_svg]:!size-3.5 [&_svg]:!mr-0';

/**
 * The round icon button's look, for a control that is its own trigger (a menu
 * opened from the header) and so cannot be wrapped in the tooltip. Purple at
 * rest — tinted outline, faint purple ground, purple glyph — a shade deeper on
 * hover or while open; `aria-pressed` fills it.
 */
export function headerIconButtonClass(className?: string) {
  return cn(
    'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border outline-none transition-colors duration-200',
    'border-primary/30 bg-primary/5 text-primary [&_svg]:!size-3.5',
    'dark:border-[hsl(var(--v2-link,var(--primary))_/_0.3)] dark:bg-primary/10 dark:text-[hsl(var(--v2-link,var(--primary)))]',
    'hover:border-primary/50 hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]',
    'aria-expanded:border-primary/50 aria-expanded:bg-primary/10',
    'aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground',
    'focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
    className,
  );
}

type Common = { label: string; children: ReactNode; className?: string; pressed?: boolean };
type AsButton = Common & { href?: undefined; external?: undefined; onClick: () => void; disabled?: boolean };
type AsLink = Common & { href: string; external?: boolean; onClick?: undefined; disabled?: undefined };

export function HeaderIconButton(props: AsButton | AsLink) {
  const { label, children, className, pressed } = props;
  const classes = headerIconButtonClass(className);
  const trigger =
    props.href !== undefined ? (
      props.external ? (
        <a href={props.href} target="_blank" rel="noopener noreferrer" aria-label={label} className={classes}>
          {children}
        </a>
      ) : (
        <Link href={props.href} aria-label={label} className={classes}>
          {/* A JSX literal, not the prop itself: next/link types its children
              with a second copy of @types/react (as in the portal's version). */}
          <>{children}</>
        </Link>
      )
    ) : (
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        aria-label={label}
        aria-pressed={pressed}
        className={classes}
      >
        {children}
      </button>
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
