"use client";

import { useMemo } from "react";
import { parseLocalDate } from "@/lib/date-utils";
import { HeroChart, HeroRow, type HeroMetric } from "@/components/shared/hero-chart-v2";
import { FeaturedDeck } from "@/components/shared/featured-deck-v2";

/**
 * The Customers hero row: one simple graph, and the featured deck beside it.
 *
 * WHY THIS REPLACED THE FOUR STAT CARDS. The team lead's brief for every hero
 * tab (Rentals, Customers, Vehicles) is ONE graph over ~75% of the row,
 * "extremely simple, like Stripe's", because complicated graphs never get read;
 * and a featured card beside it. Their second pass asked for one more line in
 * the graph, not flashy. So: new customers over the chosen period, how many of
 * them are verified as a lighter second line, and the period before dotted
 * behind. The status and user type mix lives in the table and the filter panel,
 * where it can be acted on. v1 still renders
 * components/customers/customer-summary-cards.tsx, untouched.
 *
 * EVERY NUMBER HERE IS REAL. Each point is derived from the customers the page
 * already fetched (the `customers-list` query, filtered by tenant_id), and from
 * exactly the rows the table below shows (`filteredAndSortedCustomers`). This
 * file runs no query of its own, so it cannot say something the table does not.
 * The series math is lib/hero-series.ts, with hand-worked tests.
 *
 * WHAT COUNTS.
 *   - NEW CUSTOMERS counts each customer once, on the calendar day (viewer's
 *     local time, as the tables print dates) their record was created:
 *     `customers.created_at`.
 *   - VERIFIED counts the same customers, on the same day, when their identity
 *     is verified now: `identity_verification_status` is `verified` (the
 *     verification flow) or `manually_verified` (an operator checked the ID by
 *     hand, which New Rental accepts as verified). It is a cohort line: of the
 *     customers who joined on a day, how many are verified today. There is no
 *     verified-at date to place the verification itself on.
 *   - Blocked customers are not counted: the list leaves them out (they live on
 *     /blocked-customers). So blocking someone later removes them from the past
 *     points too, and a deleted customer is gone from history.
 *   - Customers brought in by CSV import or promoted from Turo are stamped with
 *     the moment of the import, so an import shows as one day's jump. That is
 *     the day they joined this list, not the day they first rented.
 *   - A record with no created_at, or one dated after today, is not placed.
 *
 * These are the FILTERED customers: the row describes the list you are looking
 * at, and says "Filtered" when search, status or user type narrows it.
 *
 * THE CARD is the featured deck (components/shared/featured-deck-v2.tsx): the
 * invite link, CSV import and the blocklist, plus Ask Trax and announcements,
 * each gated in the registry (lib/featured-cards.ts) under the same permission
 * as the header control it mirrors. The page passes `onInvite` and `onImport`
 * only when the viewer may use them; a card whose handler is missing is not
 * shown.
 *
 * Single stable root, no fixed height: the overview flip measures this face with
 * a ResizeObserver. The root keeps `data-tour="customers-stats"`, the anchor the
 * existing customers tour steps point at.
 */

/** The fields this row reads from a customer. */
export interface OverviewCustomer {
  created_at?: string | null;
  identity_verification_status?: string | null;
}

interface Props {
  /** The rows the table shows (`filteredAndSortedCustomers`), not a page of them. */
  customers: readonly OverviewCustomer[];
  /** True when search or a filter narrows the list. */
  filtered: boolean;
  /** Opens the invite-link dialog. Pass it only when the viewer may invite. */
  onInvite?: () => void;
  /** Opens the CSV import dialog. Pass it only when the viewer may import. */
  onImport?: () => void;
  /** For tests. Defaults to now, and the chart rolls over at midnight. */
  today?: Date;
}

/** Identity statuses that count as verified: the table's Verified column reads the same two. */
export const VERIFIED_STATUSES: ReadonlySet<string> = new Set(["verified", "manually_verified"]);

/**
 * `created_at` is a timestamptz ("2026-09-15T08:30:00.123+00:00"), a real
 * instant, so `new Date` puts it on the viewer's own calendar day. A bare date
 * would be read by `new Date` as UTC midnight and slip to the day before west of
 * Greenwich, so that shape goes through parseLocalDate instead.
 */
function createdAt(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseLocalDate(value) : new Date(value);
}

const DECK_ROUTES = ["/customers", "/blocked-customers"] as const;

export function CustomersOverview({ customers, filtered, onInvite, onImport, today }: Props) {
  const metrics = useMemo<HeroMetric[]>(() => {
    const dated = customers.filter((c): c is OverviewCustomer & { created_at: string } => !!c.created_at);
    return [
      {
        key: "new-customers",
        label: "New customers",
        kind: "flow",
        description:
          "Customers added to this list, each counted on the day their record was created. Blocked customers are not counted.",
        format: (v) => v.toLocaleString(),
        events: dated.map((c) => ({ at: createdAt(c.created_at), amount: 1 })),
        secondary: {
          label: "Verified",
          events: dated
            .filter((c) => VERIFIED_STATUSES.has(c.identity_verification_status ?? ""))
            .map((c) => ({ at: createdAt(c.created_at), amount: 1 })),
        },
      },
    ];
  }, [customers]);

  const handlers = useMemo(() => {
    const out: Record<string, () => void> = {};
    if (onInvite) out.openInvite = onInvite;
    if (onImport) out.openImport = onImport;
    return out;
  }, [onInvite, onImport]);

  return (
    <div data-tour="customers-stats">
      <HeroRow
        chart={
          <HeroChart
            metrics={metrics}
            anchor="customers-chart"
            note={filtered ? "Filtered" : undefined}
            today={today}
          />
        }
        card={
          <FeaturedDeck
            tab="customers"
            routePrefixes={DECK_ROUTES}
            handlers={handlers}
            anchor="customers-featured"
            className="lg:min-h-0"
          />
        }
      />
    </div>
  );
}
