'use client';

/**
 * The operator's page furniture, for the customer pages that open on it
 * (owner, Oct 22 2026: "take their structure directly ... import the
 * components"). Every visual piece here is the operator's own, from
 * shared/portal-v2:
 *
 *   - the hero row and chart (hero-chart.tsx): label, big figure, delta chip,
 *     legend, range menu, on three columns, with the featured card on the
 *     fourth — the operator's Customers, Rentals, Agreements and Finances tabs;
 *   - the featured card (featured-card.tsx): "Calendar View", "Template
 *     Studio", "Auto-charge";
 *   - the alert (alert.tsx), tinted the way the operator's customer record
 *     tints its verdict ("Not ready"): the tone at a few percent behind it and a
 *     ring of the same tone.
 *
 * What is local is only the wiring: a loading face sized like the chart, a
 * featured card that is a link, and the alert's tones.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { CircleCheck, Clock, Info, TriangleAlert, type LucideIcon } from 'lucide-react-nw';

import { Alert, AlertDescription, AlertTitle } from '@portal-v2-shared/alert';
import { FEATURED_ACTION_CLASS, FeaturedCardFace, FeaturedCardShell } from '@portal-v2-shared/featured-card';
import { HERO_CHART_HEIGHT } from '@portal-v2-shared/hero-chart';
import { cn } from '@nw/lib/utils';

/** 'YYYY-MM-DD' (or an ISO timestamp) as local midnight. Never `new Date(str)`, which reads UTC. */
export function localDay(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** The chart's place while its rows load, so the row does not jump when it lands. */
export function HeroChartLoading({ label, range = 'Last 12 months' }: { label: string; range?: string }) {
  return (
    <section className="flex flex-col gap-3" aria-label={label} aria-busy>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-v2-fg">{label}</span>
          <span className="text-sm font-medium text-v2-muted-fg">{range}</span>
        </div>
        <div className="flex min-h-[30px] items-center" aria-hidden>
          <span className="inline-block h-[30px] w-28 animate-pulse rounded-md bg-v2-muted" />
        </div>
      </div>
      <div className={cn(HERO_CHART_HEIGHT, 'w-full animate-pulse rounded-xl bg-v2-muted/60')} aria-hidden />
    </section>
  );
}

/** The operator's featured card, as a link: a big heavy title, one line, "Open →". */
export function FeaturedLinkCard({
  title,
  subtitle,
  href,
  onClick,
  children,
}: {
  title: string;
  subtitle: string;
  /** A link, or an action on the page (opening Trax). */
  href?: string;
  onClick?: () => void;
  /** Anything between the title and the line, e.g. a progress bar. */
  children?: ReactNode;
}) {
  const face = children ? (
    <>
      <div className="flex flex-col gap-4">
        <FeaturedTitle title={title} />
        {children}
      </div>
      <FeaturedCardFaceFooter subtitle={subtitle} />
    </>
  ) : (
    <FeaturedCardFace title={title} subtitle={subtitle} />
  );
  return (
    <FeaturedCardShell className="lg:min-h-0" aria-label={title}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {href ? (
          <Link href={href} className={cn(FEATURED_ACTION_CLASS, 'pb-4')}>
            {face}
          </Link>
        ) : (
          <button type="button" onClick={onClick} className={cn(FEATURED_ACTION_CLASS, 'pb-4')}>
            {face}
          </button>
        )}
      </div>
    </FeaturedCardShell>
  );
}

/*
 * The face split in two, for a card that carries something between its title
 * and its line. Same classes as FeaturedCardFace (shared/portal-v2/
 * featured-card.tsx), which draws both halves as one fragment.
 */
function FeaturedTitle({ title }: { title: string }) {
  return (
    <h3
      className="relative line-clamp-2 max-w-[10.5ch] pb-[0.1em] text-[26px] font-black leading-[1] tracking-[-0.04em] text-neutral-950 dark:text-white"
      title={title}
    >
      {title}
    </h3>
  );
}

function FeaturedCardFaceFooter({ subtitle }: { subtitle: string }) {
  return (
    <div className="relative min-w-0 pt-3">
      <p className="truncate text-[13px] leading-5 text-neutral-600 dark:text-neutral-300" title={subtitle}>
        {subtitle}
      </p>
      <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#5b5bd6] dark:text-v2-link">
        Open
        <span aria-hidden>→</span>
      </span>
    </div>
  );
}

type Tone = 'danger' | 'warning' | 'success' | 'neutral';

/** The operator's verdict tints (customers-v2/customer-detail/overview-rail.tsx). */
const TONE_CLASS: Record<Tone, string> = {
  danger: 'border-transparent bg-pv-danger/[0.07] ring-1 ring-pv-danger/20 text-pv-danger',
  warning: 'border-transparent bg-pv-warning-light/60 ring-1 ring-pv-warning/25 text-pv-warning',
  success: 'border-transparent bg-pv-success-light/70 ring-1 ring-pv-success/25 text-pv-success',
  neutral: 'border-transparent bg-pv-primary/[0.06] ring-1 ring-pv-primary/20 text-pv-primary',
};

const TONE_ICON: Record<Tone, LucideIcon> = {
  danger: TriangleAlert,
  warning: Clock,
  success: CircleCheck,
  neutral: Info,
};

/**
 * The shared alert, tinted: icon, a title in the tone, one muted line, and the
 * action on the right.
 */
export function ToneAlert({
  tone,
  title,
  description,
  action,
  className,
}: {
  tone: Tone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <Alert className={cn('flex items-center gap-3 rounded-3xl px-4 py-3', TONE_CLASS[tone], className)}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <AlertTitle className="font-heading text-sm font-semibold">{title}</AlertTitle>
        {description ? (
          <AlertDescription className="mt-0.5 text-[12px] leading-relaxed text-pv-fg/70">{description}</AlertDescription>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </Alert>
  );
}
