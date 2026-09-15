"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Ban, Link2, User } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { parseLocalDate } from "@/lib/date-utils";
import { HeroChart, HeroRow, type HeroMetric } from "@/components/shared/hero-chart-v2";

/**
 * The Customers hero row: one simple graph, and one featured card.
 *
 * WHY THIS REPLACED THE FOUR STAT CARDS. The team lead's brief for every hero
 * tab (Rentals, Customers, Vehicles) is ONE graph over ~75% of the row,
 * "extremely simple, like Stripe's", because complicated graphs never get read;
 * and a featured card beside it. So this is one line: new customers over the
 * chosen period, with the period before it dotted behind. The status and user
 * type mix lives in the table and the filter panel, where it can be acted on.
 * v1 still renders components/customers/customer-summary-cards.tsx, untouched.
 *
 * EVERY NUMBER HERE IS REAL. Each point is derived from the customers the page
 * already fetched (the `customers-list` query, filtered by tenant_id), and from
 * exactly the rows the table below shows (`filteredAndSortedCustomers`). This
 * file runs no query of its own, so it cannot say something the table does not.
 * The series math is lib/hero-series.ts, with hand-worked tests.
 *
 * WHAT COUNTS. "New customers" counts each customer once, on the calendar day
 * (viewer's local time, as the tables print dates) their record was created:
 * `customers.created_at`. The headline is how many were added in the chosen
 * period; the smaller number and the dotted line are the period before it.
 *   - Blocked customers are not counted: the list leaves them out (they live on
 *     /blocked-customers). So blocking someone later removes them from the past
 *     points too, and a deleted customer is gone from history.
 *   - Customers brought in by CSV import or promoted from Turo are stamped with
 *     the moment of the import, so an import shows as one day's jump. That is
 *     the day they joined this list, not the day they first rented.
 *   - A record with no created_at, or one dated after today, is not placed.
 *
 * WHY ONLY ONE METRIC. No other field on the loaded rows is a dated history.
 * Balances are a point-in-time figure with no past, status and gig driver have
 * no date of change, and portal sign-up dates (customer_users.created_at) are
 * not loaded. Rather than invent a second line, the chart has none, so there is
 * no metric picker.
 *
 * These are the FILTERED customers: the row describes the list you are looking
 * at, and says "Filtered" when search, status or user type narrows it.
 *
 * THE FEATURED CARD mirrors a header control and is gated exactly as it is:
 *   - "Invite customers" opens the page's own invite-link dialog
 *     (GenerateInviteDialog), shown when the viewer passes canEdit('customers'),
 *     the header Invite button's gate. The page passes `onInvite` only then.
 *   - Otherwise "Blocked customers" links to /blocked-customers, under the header
 *     Blocked button's condition (lean tenant and canView('blocked_customers')).
 *   - With neither, there is no card and the graph takes the whole row.
 *
 * Single stable root, no fixed height: the overview flip measures this face with
 * a ResizeObserver. The root keeps `data-tour="customers-stats"`, the anchor the
 * existing customers tour steps point at.
 */

/** The only field this row reads from a customer. */
export interface OverviewCustomer {
  created_at?: string | null;
}

interface Props {
  /** The rows the table shows (`filteredAndSortedCustomers`), not a page of them. */
  customers: readonly OverviewCustomer[];
  /** True when search or a filter narrows the list. */
  filtered: boolean;
  /** Opens the invite-link dialog. Pass it only when the viewer may invite. */
  onInvite?: () => void;
  /** The header Blocked button's condition. */
  showBlocked: boolean;
  /** For tests. Defaults to the moment the chart mounts. */
  today?: Date;
}

/**
 * `created_at` is a timestamptz ("2026-09-15T08:30:00.123+00:00"), a real
 * instant, so `new Date` puts it on the viewer's own calendar day. A bare date
 * would be read by `new Date` as UTC midnight and slip to the day before west of
 * Greenwich, so that shape goes through parseLocalDate instead.
 */
function createdAt(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseLocalDate(value) : new Date(value);
}

export function CustomersOverview({ customers, filtered, onInvite, showBlocked, today }: Props) {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion;

  const metrics = useMemo<HeroMetric[]>(
    () => [
      {
        key: "new-customers",
        label: "New customers",
        kind: "flow",
        description:
          "Customers added to this list, each counted on the day their record was created. Blocked customers are not counted.",
        format: (v) => v.toLocaleString(),
        events: customers.flatMap((c) => (c.created_at ? [{ at: createdAt(c.created_at), amount: 1 }] : [])),
      },
    ],
    [customers],
  );

  const card = onInvite ? (
    <InviteCard onClick={onInvite} animate={animate} />
  ) : showBlocked ? (
    <BlockedCard animate={animate} />
  ) : null;

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
        card={card}
      />
    </div>
  );
}

/**
 * The Calendar View card's look (components/rentals-v2/rentals-overview.tsx):
 * a primary-tinted gradient, soft glows, faint art that echoes the feature, a
 * title and one line under it, and a nudging arrow. The minimum height only
 * matters when the row stacks on a narrow screen, where the card would otherwise
 * shrink to its text and the art would run into the title and the arrow.
 */
const CARD =
  "group relative flex min-h-[13rem] cursor-pointer flex-col justify-end overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 text-left text-foreground shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/15";

/** Art layer placement, shared by both cards. */
const ART =
  "pointer-events-none absolute inset-x-5 top-[38%] -translate-y-1/2 opacity-80 transition-opacity duration-300 group-hover:opacity-100";

/**
 * `shine-sweep`, `icon-float`, `timeline-grow` and `arrow-nudge` are real
 * keyframes in styles/v2-theme.css, which the root layout puts on <body> for the
 * same gated tenants that reach this screen. With reduced motion asked for, the
 * art holds still.
 */
function loop(animate: boolean, animation: string, delaySeconds = 0) {
  if (!animate) return undefined;
  return delaySeconds ? { animation, animationDelay: `${delaySeconds}s` } : { animation };
}

function CardGlow() {
  return (
    <>
      <span className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full bg-primary/15 blur-2xl transition-all duration-300 group-hover:bg-primary/25" />
      <span className="pointer-events-none absolute -bottom-10 -left-6 size-24 rounded-full bg-primary/10 blur-2xl" />
    </>
  );
}

function CardText({ title, subtitle, animate }: { title: string; subtitle: string; animate: boolean }) {
  return (
    <>
      <div className="relative">
        <div className="mt-3 text-lg font-bold tracking-tight">{title}</div>
        <div className="text-sm text-muted-foreground">{subtitle}</div>
      </div>
      <ArrowRight
        className="absolute right-4 top-4 size-5 text-primary"
        style={loop(animate, "arrow-nudge 4s ease-in-out infinite")}
      />
    </>
  );
}

/** A registration link being shared, and the people it brings in. */
function InviteCard({ onClick, animate }: { onClick: () => void; animate: boolean }) {
  return (
    <button type="button" onClick={onClick} data-tour="customers-featured" className={CARD}>
      <CardGlow />
      <div className={ART} aria-hidden>
        <div className="relative flex items-center gap-2 overflow-hidden rounded-full border border-primary/25 bg-primary/5 px-3 py-2">
          <Link2 className="size-3.5 shrink-0 text-primary" />
          <span className="h-1.5 flex-1 rounded-full bg-primary/30" />
          <span className="h-1.5 w-8 rounded-full bg-primary/60" />
          {animate && (
            <span
              className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/25 to-transparent"
              style={{ animation: "shine-sweep 4s ease-in-out infinite", transform: "translateX(-120%)" }}
            />
          )}
        </div>
        <div className="mt-3 flex items-center justify-center gap-2.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="flex size-7 items-center justify-center rounded-full border border-primary/30 bg-primary/15"
              style={loop(animate, "icon-float 3.6s ease-in-out infinite", i * 0.45)}
            >
              <User className="size-3.5 text-primary" />
            </span>
          ))}
        </div>
      </div>
      <CardText title="Invite customers" subtitle="Share a link, they sign up" animate={animate} />
    </button>
  );
}

/** A short customer list with one person struck off it. */
function BlockedCard({ animate }: { animate: boolean }) {
  return (
    <Link href="/blocked-customers" data-tour="customers-featured" className={CARD}>
      <CardGlow />
      <div className={`${ART} space-y-2.5`} aria-hidden>
        <div className="flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-full bg-primary/20" />
          <span className="h-1.5 flex-[3] rounded-full bg-primary/20" />
          <span className="h-1.5 flex-1 rounded-full bg-primary/15" />
        </div>
        <div className="flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-full bg-primary/40" />
          <span className="relative h-1.5 flex-[3] rounded-full bg-primary/15">
            <span
              className="absolute inset-0 origin-left rounded-full bg-primary/55"
              style={loop(animate, "timeline-grow 3.6s ease-in-out infinite")}
            />
          </span>
          <Ban
            className="size-4 shrink-0 text-primary"
            style={loop(animate, "icon-float 3.6s ease-in-out infinite", 0.45)}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-full bg-primary/20" />
          <span className="h-1.5 flex-[2] rounded-full bg-primary/20" />
          <span className="h-1.5 flex-[2] rounded-full bg-primary/15" />
        </div>
      </div>
      <CardText title="Blocked customers" subtitle="Who you won't rent to" animate={animate} />
    </Link>
  );
}
