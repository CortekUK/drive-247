import { ArrowRight, Check, Droplets, Sparkles, Wrench } from "lucide-react-nw";
import Link from "next/link";

import { DEFAULT_HOME_HERO } from "@nw/lib/cms/defaults";
import { Editable } from "@nw/lib/cms/editable";
import { completeRows } from "@nw/lib/cms/merge";
import type { ReadinessMetricItem } from "@nw/lib/cms/types";
import { cn } from "@nw/lib/utils";
import { CARD, ICON_TILE } from "@nw/site-v2/kit";

/** The metric icons, by position — the design's, not the operator's. */
const METRIC_ICONS = [Sparkles, Wrench, Droplets];

/** The car this card is about, when the hero could resolve a real one. */
export type ReadinessVehicle = {
  id: string;
  name: string;
  categoryLabel: string | null;
};

/** The shipped copy, used when the fleet is empty or unreachable. */
const PLACEHOLDER_NAME = "Lexus RX";
const PLACEHOLDER_CATEGORY = "SUV";

type ReadinessCardProps = {
  className?: string;
  /** `home_hero.readiness_status` — the chip in the corner. */
  status?: string;
  /** `home_hero.readiness_cta` — the link at the foot of the card. */
  ctaText?: string;
  /** `home_hero.readiness_metrics` — the three labelled bars. */
  metrics?: ReadinessMetricItem[];
  /** A real vehicle from the tenant's fleet; null keeps the shipped copy and links to /fleet. */
  vehicle?: ReadinessVehicle | null;
};

/**
 * v2 of `components/cards/readiness-card.tsx` — same props, same CMS marks,
 * same rules (a specific car links to that car, otherwise /fleet; values are
 * only marked editable when the caller bound them).
 */
export function ReadinessCard({ className, vehicle = null, status, ctaText, metrics }: ReadinessCardProps) {
  const href = vehicle === null ? "/fleet" : `/booking/${vehicle.id}`;
  const name = vehicle?.name ?? PLACEHOLDER_NAME;
  const category = vehicle?.categoryLabel ?? PLACEHOLDER_CATEGORY;

  const statusText = status?.trim() ? status.trim() : DEFAULT_HOME_HERO.readiness_status;
  const cta = ctaText?.trim() ? ctaText.trim() : DEFAULT_HOME_HERO.readiness_cta;
  const rows = completeRows(
    metrics && metrics.length > 0 ? metrics : DEFAULT_HOME_HERO.readiness_metrics,
    DEFAULT_HOME_HERO.readiness_metrics,
  ).slice(0, 3);
  const bound = metrics !== undefined;

  return (
    <article className={cn(CARD, "w-[280px] p-5", className)}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-pv-fg">{name}</p>
          <p className="mt-0.5 text-xs text-pv-muted-fg">{category}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-pv-success-light px-2 py-0.5 text-[11px] font-medium text-pv-success">
          <Check aria-hidden className="size-3" strokeWidth={2.5} />
          {bound ? <Editable path="home.home_hero.readiness_status">{statusText}</Editable> : statusText}
        </span>
      </header>

      <ul className="mt-5 flex flex-col gap-4">
        {rows.map((metric, index) => {
          const Icon = METRIC_ICONS[Math.min(index, METRIC_ICONS.length - 1)];
          return (
            <li key={`${metric.label}-${index}`} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-[13px] text-pv-fg">
                  <span className={cn(ICON_TILE, "size-6 rounded-md")}>
                    <Icon aria-hidden className="size-3" strokeWidth={2} />
                  </span>
                  {bound ? (
                    <Editable path={`home.home_hero.readiness_metrics.${index}.label`}>{metric.label}</Editable>
                  ) : (
                    metric.label
                  )}
                </span>
                <span className="text-[13px] font-semibold tabular-nums text-pv-fg">{metric.value}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-pv-muted">
                <div
                  className="h-full rounded-full bg-pv-primary"
                  style={{ width: `${Math.max(0, Math.min(100, Number(metric.value) || 0))}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <Link
        href={href}
        className="mt-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-pv-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30"
      >
        {bound ? <Editable path="home.home_hero.readiness_cta">{cta}</Editable> : cta}
        <ArrowRight aria-hidden className="size-3.5" strokeWidth={2} />
        <span className="sr-only"> for {name}</span>
      </Link>
    </article>
  );
}
