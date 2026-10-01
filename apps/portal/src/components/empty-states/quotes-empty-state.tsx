"use client";

/**
 * Quotes teaching empty state (docs/brand/illustration-guide.md §4a).
 *
 * Quotes are not stored — the page is a generator — so "empty" means the
 * operator has not started one on this visit. The tile reveals the generator.
 * Rendered only for lean tenants (or the /dev force switch).
 */

import { CalendarRange, Plus } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { QuotesEmptyArt } from "@/components/illustrations-v2/scenes/quotes";

export function QuotesTeachingEmptyState({ onStartQuote }: { onStartQuote: () => void }) {
  return (
    <TeachingEmptyState
      icon={CalendarRange}
      illustration={<QuotesEmptyArt />}
      headline="Price your whole fleet for any dates"
      body="Pick the dates and every free car is priced. Email the quote, copy it, or save it as a PDF."
      primaryAction={{
        label: "Start a quote",
        hint: "Choose pickup and return dates to price your fleet.",
        onClick: onStartQuote,
        icon: Plus,
      }}
    />
  );
}
