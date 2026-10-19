import { ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EnterpriseCard as EnterpriseCardData } from "@/lib/enterprise-card-server";

/**
 * The last card on the pricing grid: drawn like a PlanCard, but its button is a
 * link to a contact page, never a checkout. Edited on the admin Signup Plans page.
 */
export function EnterpriseCard({ card }: { card: EnterpriseCardData }) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-600/20 to-transparent"
      />
      <p className="text-sm font-semibold tracking-tight">{card.name}</p>
      {card.fleetBand && (
        <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400">
          {card.fleetBand}
        </p>
      )}
      <div className="mt-5 flex items-baseline gap-1">
        <span className="text-4xl font-bold tracking-tighter">{card.priceLabel}</span>
      </div>
      <p className="mt-2 min-h-[2.875rem] text-sm leading-relaxed text-muted-foreground">{card.tagline}</p>
      <Button
        asChild
        size="lg"
        className="mt-6 w-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
      >
        <a href={card.ctaHref}>
          {card.ctaLabel} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </Button>
      {card.bullets.length > 0 && (
        <ul className="mt-6 space-y-2.5 border-t pt-6">
          {card.bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2.5 text-sm text-muted-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
              {bullet}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
