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

/**
 * Edge to edge, with the navbar's side padding (the landing page's: 20px on a
 * phone, growing with the window to 100px). For the bar, the footer and the
 * closing call to action, which line up with it.
 */
export const SITE_EDGE = 'px-[clamp(20px,5.2vw,100px)]';

/** The home page's column: the navbar's edges, so every section lines up with the bar and the hero. */
export const SITE_WIDE = `mx-auto w-full max-w-[1920px] ${SITE_EDGE}`;

/**
 * The top of a page: the navbar's own surface (`--nw-hero-bg`, styles/site.css)
 * edge to edge, fading into the page at the foot, so the bar and the page's
 * opening read as one piece. The home hero and every page intro sit on it.
 */
export const PAGE_TOP_SURFACE = 'bg-[linear-gradient(to_bottom,var(--nw-hero-bg)_82%,transparent)]';

/** The home hero's two buttons: the dark one leads, the light one is the other way on. */
export const PILL_DARK =
  'inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-pv-fg px-7 text-[15px] font-semibold text-pv-bg ' +
  'transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pv-primary/25 motion-reduce:transition-none';
export const PILL_LIGHT =
  'inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-pv-border bg-pv-card px-7 text-[15px] font-semibold text-pv-fg ' +
  'transition-colors duration-200 hover:border-pv-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none';

/** A small rounded label over a heading ("About us", "Our story"): what the section is. */
export const EYEBROW =
  'inline-flex items-center gap-1.5 rounded-full bg-pv-tint px-3.5 py-1.5 text-[13px] font-semibold text-pv-primary dark:text-pv-fg';

/** The home page's section heading type: big, extrabold, tight. */
export const SITE_H2 =
  'text-[32px] font-extrabold leading-[1.06] tracking-[-0.045em] text-pv-fg [text-wrap:balance] sm:text-[42px] lg:text-[48px]';

/**
 * A section's heading in the home page's style: the title, one muted line,
 * centred (the default) or on the left with an action across from it.
 */
export function SiteHeading({
  id,
  title,
  description,
  align = 'center',
  action,
  className,
}: {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'center' | 'left';
  action?: React.ReactNode;
  className?: string;
}) {
  if (align === 'center') {
    return (
      <div data-reveal className={cn('mx-auto max-w-2xl text-center', className)}>
        <h2 id={id} className={SITE_H2}>
          {title}
        </h2>
        {description ? (
          <p className="mt-3 text-[15px] leading-relaxed text-pv-muted-fg [text-wrap:balance] md:text-[17px]">{description}</p>
        ) : null}
      </div>
    );
  }
  return (
    <div data-reveal className={cn('flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0 max-w-2xl">
        <h2 id={id} className={SITE_H2}>
          {title}
        </h2>
        {description ? <p className="mt-3 text-[15px] leading-relaxed text-pv-muted-fg md:text-[17px]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * The top of every page but home: the navbar's surface edge to edge, the
 * page's headline at the home hero's scale and its one line, the page's next
 * step, and — when the page has one — its picture on the home hero's tinted
 * stage. Text left and picture right from lg; centred and stacked below.
 * With no picture it is one column on the left, so a page that is a list
 * (the fleet, a policy) gets to its content at once.
 */
export function PageHeader({
  title,
  description,
  actions,
  art,
  meta,
  cms,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  art?: React.ReactNode;
  /** A small line under the description: facts, a date. */
  meta?: React.ReactNode;
  /** `cmsSection(...)` props, when the words are the operator's. */
  cms?: Record<string, string>;
}) {
  return (
    <div className={PAGE_TOP_SURFACE}>
      <header
        {...cms}
        className={cn(
          SITE_WIDE,
          'grid items-center gap-10 pb-12 pt-8 sm:pt-12 lg:gap-16 lg:pb-20 lg:pt-16',
          art ? 'lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)]' : '',
        )}
      >
        <div className={cn('min-w-0', art ? 'max-lg:mx-auto max-lg:max-w-[640px] max-lg:text-center' : 'max-w-[820px]')}>
          <h1 className="nw-rise text-[40px] font-extrabold leading-[1.02] tracking-[-0.05em] text-pv-fg [text-wrap:balance] sm:text-[54px] lg:text-[64px]">
            {title}
          </h1>
          {description ? (
            <p
              style={{ '--d': '90ms' } as React.CSSProperties}
              className={cn(
                'nw-rise mt-5 max-w-[36rem] text-[16px] leading-relaxed text-pv-muted-fg md:text-[18px]',
                art && 'max-lg:mx-auto max-lg:[text-wrap:balance]',
              )}
            >
              {description}
            </p>
          ) : null}
          {meta ? (
            <div style={{ '--d': '140ms' } as React.CSSProperties} className="nw-rise mt-4 text-[14px] text-pv-muted-fg">
              {meta}
            </div>
          ) : null}
          {actions ? (
            <div
              style={{ '--d': '180ms' } as React.CSSProperties}
              className={cn('nw-rise mt-7 flex flex-wrap gap-3', art && 'max-lg:justify-center')}
            >
              {actions}
            </div>
          ) : null}
        </div>
        {art ? (
          <div
            style={{ '--d': '140ms' } as React.CSSProperties}
            className="nw-rise nw-live mx-auto w-full max-w-[560px] rounded-[32px] bg-pv-primary/[0.07] px-6 py-8 sm:px-10 sm:py-10"
          >
            {art}
          </div>
        ) : null}
      </header>
    </div>
  );
}

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

/**
 * A centred page opening (About, Contact, Fleet): the operator's headline, one muted line, on the navbar's surface over a
 * faint field of dots that fades out towards the edges. No art: the page's
 * first section starts right under it.
 */
export function CenteredHeader({
  title,
  description,
  cms,
  meta,
  wave = false,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** `cmsSection(...)` props, so the visual editor can find the block. */
  cms?: Record<string, string>;
  /**
   * End the surface in a soft S-shaped curve instead of fading out: the
   * surface stays solid to its bottom, and a drawn wave in the same colour
   * finishes it, so it reads as one shape at any width. `'arch'` is the soft
   * version: the surface melts into the page along a wide elliptical edge
   * (a masked background layer, so the text itself never fades) — a curve
   * with no hard line, for a page whose next section has its own arc.
   */
  wave?: boolean | 'arch';
  /** One short line of facts under the description ("9 cars · from $45 a day"). */
  meta?: React.ReactNode;
}) {
  return (
    <>
    <div
      className={cn(
        'relative isolate overflow-hidden',
        wave === true ? 'bg-[var(--nw-hero-bg)]' : wave === 'arch' ? '' : PAGE_TOP_SURFACE,
      )}
    >
      {wave === 'arch' ? (
        <div
          aria-hidden
          className="absolute inset-0 -z-20 bg-[var(--nw-hero-bg)] [mask-image:radial-gradient(130%_100%_at_50%_0%,#000_58%,transparent_100%)]"
        />
      ) : null}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 text-pv-primary/25 [background-image:radial-gradient(currentColor_1px,transparent_1.4px)] [background-size:18px_18px] [mask-image:radial-gradient(60%_70%_at_50%_40%,#000,transparent)] dark:text-pv-primary/30"
      />
      <header
        {...cms}
        className={cn(
          SITE_WIDE,
          'flex flex-col items-center text-center',
          // A waved header is the page's first screen together with what
          // follows it, so it stays tight; the wave itself is the breathing room.
          wave === true
            ? 'pb-4 pt-10 sm:pt-12 lg:pb-6 lg:pt-14'
            : wave === 'arch'
              ? 'pb-20 pt-12 sm:pt-16 lg:pb-32 lg:pt-20'
              : 'pb-20 pt-12 sm:pt-16 lg:pb-28 lg:pt-20',
        )}
      >
        <h1
          style={{ '--d': '60ms' } as React.CSSProperties}
          className="nw-rise max-w-[16ch] text-[42px] font-extrabold leading-[1.02] tracking-[-0.05em] text-pv-fg [text-wrap:balance] sm:text-[58px] lg:text-[72px]"
        >
          {title}
        </h1>
        {description ? (
          <p
            style={{ '--d': '120ms' } as React.CSSProperties}
            className="nw-rise mt-5 max-w-[38rem] text-[16px] leading-relaxed text-pv-muted-fg [text-wrap:balance] md:text-[18px]"
          >
            {description}
          </p>
        ) : null}
        {meta ? (
          <p
            style={{ '--d': '160ms' } as React.CSSProperties}
            className="nw-rise mt-5 rounded-full bg-pv-card px-4 py-2 text-[14px] font-semibold text-pv-fg"
          >
            {meta}
          </p>
        ) : null}
      </header>
    </div>
      {wave === true ? (
        // The surface's own colour, hanging below it in a wave; whatever is
        // behind the page shows through underneath, in light and dark alike.
        <svg
          aria-hidden
          viewBox="0 0 1440 120"
          preserveAspectRatio="none"
          className="-mt-px block h-[36px] w-full fill-[var(--nw-hero-bg)] sm:h-[52px] lg:h-[72px]"
        >
          <path d="M0 0H1440V30C1200 112 980 88 720 46S220 18 0 72Z" />
        </svg>
      ) : null}
    </>
  );
}
