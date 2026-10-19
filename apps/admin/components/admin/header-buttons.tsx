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
export const HEADER_ACTIONS = 'flex shrink-0 items-center gap-2 sm:self-end sm:h-5';

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
