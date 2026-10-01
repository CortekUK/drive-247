'use client';

import { useTenant } from '@/contexts/TenantContext';
import { useDashboardKPIs } from '@/hooks/use-dashboard-kpis';
import { useTodayOperations } from '@/hooks/use-today-operations';
import { useDepositHoldAlerts } from '@/hooks/use-deposit-hold-alerts';
import { usePendingBookingsCount } from '@/hooks/use-pending-bookings';
import { useFleetWeek } from '@/hooks/use-fleet-week';
import { formatCurrency } from '@/lib/format-utils';

/**
 * What Trax says about the whole business, for the Trax card on the v2
 * dashboard (Sep 27 2026).
 *
 * The same rule as the ⌘K search brief (use-search-brief.ts): NOTHING IS
 * GENERATED. Every figure comes from a hook the dashboard already runs; Trax's
 * voice is the wording, not the source, so the brief cannot say anything the
 * data does not. The full conversation — with Trax's own verified tools —
 * starts from the card's "Continue" handoff, using `question`.
 *
 * First person, no emojis: Trax is the voice of the app.
 *
 * TENANT ISOLATION: no query of its own. Every hook used here filters by
 * `tenant_id` and is `enabled` only once a tenant is resolved (V2_PLAN §5).
 */

export interface BusinessBrief {
  /** The one-sentence verdict, typed out as the headline. */
  headline: string;
  /** One point per line, most important first. */
  points: string[];
  /**
   * Follow-ups; each opens the conversation in Trax with `question`. `label`
   * is the short form shown on the chip, so they sit two to a row.
   */
  suggestions: { label: string; question: string }[];
  /** What the operator asks when the conversation moves to Trax. */
  question: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Morning", "Afternoon" or "Evening", by the viewer's own clock. */
function partOfDay(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
}

/**
 * Written as an assistant briefing the boss (Ghulam, Sep 27 2026): a greeting
 * by name, "we" for the business, the one thing to do first, then the rest in
 * plain, friendly sentences. Still first person, still no emojis, and still
 * nothing that the data behind it does not say.
 */
export function useBusinessBrief({
  canSeeRentals,
  canSeePayments,
  canSeeFleet,
  canSeeRequests,
  firstName,
}: {
  canSeeRentals: boolean;
  canSeePayments: boolean;
  canSeeFleet: boolean;
  canSeeRequests: boolean;
  /** Who is being briefed, for the greeting. */
  firstName?: string | null;
}) {
  const { tenant } = useTenant();
  const kpisQ = useDashboardKPIs();
  const ops = useTodayOperations();
  const deposits = useDepositHoldAlerts();
  const pendingQ = usePendingBookingsCount();
  const week = useFleetWeek();

  const isLoading = kpisQ.isLoading || ops.isLoading || week.isLoading;
  const kpis = kpisQ.data;
  if (isLoading) return { brief: null as BusinessBrief | null, isLoading: true };

  const money = (n: number) =>
    formatCurrency(n, tenant?.currency_code || 'USD', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const hello = firstName ? `${partOfDay()}, ${firstName}.` : `${partOfDay()}.`;

  const notBack = canSeeRentals ? [...ops.overdue].sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0)) : [];
  const worstLate = notBack[0];
  const overdueMoney = canSeePayments && kpis && kpis.overdue.count ? kpis.overdue : null;
  const unsecured = canSeePayments
    ? (deposits.data?.issues ?? []).filter(
        (i) => (i.kind === 'unsecured' || i.kind === 'needs_review') && !i.isSelfHealing
      )
    : [];
  const requests = canSeeRequests ? pendingQ.data ?? 0 : 0;
  const todayPickups = canSeeRentals ? week.pickups.filter((p) => p.daysAway <= 0) : [];
  const notReady = todayPickups.filter((p) => !p.ready);
  const idleAllWeek = canSeeFleet ? week.cars.filter((c) => c.freeDays === c.days.length) : [];

  // ── The verdict: the one thing to do first, or that there is nothing ──────
  let lead: 'notBack' | 'notReady' | 'money' | 'deposit' | 'calm';
  let headline: string;
  if (notBack.length) {
    lead = 'notBack';
    headline = `${hello} ${notBack.length === 1 ? 'One car still hasn\u2019t' : `${notBack.length} cars still haven\u2019t`} come back, so I\u2019d start there.`;
  } else if (notReady.length) {
    lead = 'notReady';
    headline = `${hello} ${notReady.length === 1 ? 'One of today\u2019s pickups isn\u2019t' : `${notReady.length} of today\u2019s pickups aren\u2019t`} ready yet, so let\u2019s sort ${notReady.length === 1 ? 'that' : 'those'} first.`;
  } else if (overdueMoney) {
    lead = 'money';
    headline = `${hello} We\u2019re owed ${money(overdueMoney.amount)}, so chasing that is today\u2019s priority.`;
  } else if (unsecured.length) {
    lead = 'deposit';
    headline = `${hello} ${plural(unsecured.length, 'car is', 'cars are')} out with no deposit held, worth a look first.`;
  } else {
    lead = 'calm';
    headline = `${hello} All quiet today, nothing needs you urgently.`;
  }

  // ── Everything else, most urgent first. The card shows as many as fit. ────
  const points: string[] = [];
  if (lead === 'notBack' && worstLate) {
    points.push(
      `${worstLate.customerName} is the one I\u2019m most worried about, ${plural(worstLate.daysLate ?? 0, 'day', 'days')} past the return date now.`
    );
    const others = notBack.slice(1, 3).map((o) => o.customerName);
    if (others.length) {
      points.push(`${others.join(' and ')} ${others.length === 1 ? 'is' : 'are'} also still out past their date.`);
    }
  }
  if (notReady.length && lead !== 'notReady') {
    points.push(
      `Heads up: ${notReady.length === 1 ? 'one of today\u2019s pickups isn\u2019t' : `${notReady.length} of today\u2019s pickups aren\u2019t`} ready to go yet.`
    );
  }
  if (overdueMoney && lead !== 'money') {
    points.push(`We\u2019re still waiting on ${money(overdueMoney.amount)} across ${plural(overdueMoney.count, 'overdue payment', 'overdue payments')}.`);
  }
  if (unsecured.length && lead !== 'deposit') {
    points.push(`${plural(unsecured.length, 'car is', 'cars are')} out without a deposit held, so we\u2019re exposed on ${unsecured.length === 1 ? 'that one' : 'those'}.`);
  }
  if (requests) {
    points.push(`${plural(requests, 'booking request has', 'booking requests have')} come in and ${requests === 1 ? 'is' : 'are'} waiting on your okay.`);
  }
  if (canSeeRentals && (todayPickups.length || ops.returns.length)) {
    const allReady = todayPickups.length > 0 && notReady.length === 0 ? ', and every pickup is good to go' : '';
    points.push(
      `On the diary today: ${plural(todayPickups.length, 'car goes', 'cars go')} out and ${plural(ops.returns.length, 'comes', 'come')} back${allReady}.`
    );
  }
  if (canSeeFleet && kpis && kpis.fleetUtilization.total) {
    points.push(
      `${plural(kpis.activeRentals.count, 'rental is', 'rentals are')} on the road, so ${kpis.fleetUtilization.percentage}% of the fleet is earning right now.`
    );
  }
  if (idleAllWeek.length) {
    points.push(
      `${plural(idleAllWeek.length, 'car has', 'cars have')} nothing booked all week, so there\u2019s room to take more bookings.`
    );
  }
  if (canSeePayments && kpis) {
    points.push(`We\u2019ve brought in ${money(kpis.monthlyRevenue.amount)} so far this month.`);
  }

  const suggestions = [
    {
      label: 'Tell me more',
      question:
        'Tell me more. Give me a full rundown of the business today: what needs my attention first, money owed, today\u2019s handovers and the fleet.',
    },
    { label: 'What first?', question: 'What should I do first today?' },
    canSeePayments
      ? { label: 'Who owes most?', question: 'Who owes me the most, and for what?' }
      : { label: 'Idle cars', question: 'Which cars are sitting idle this week?' },
  ];

  return {
    brief: {
      headline,
      points,
      suggestions,
      question:
        'Give me a full rundown of the business today: what needs my attention first, money owed, today\u2019s handovers and the fleet.',
    } satisfies BusinessBrief,
    isLoading: false,
  };
}
