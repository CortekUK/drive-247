'use client';

/**
 * The three bands of the dashboard, assembled from whatever is real.
 *
 * Read top to bottom as a shrinking time horizon: **Important** is anything,
 * any time, that cannot wait; **Today** is only what happens between now and
 * closing; **Stats** is the weeks behind you. Naming the bands is what lets a
 * card title be short — "Money today" does not have to explain itself when it
 * sits under Today.
 *
 * Every band runs on a four-column grid and cards claim one or two of them, so
 * each band has its own rhythm (wide-first, wide-last, wide-middle). Equal
 * thirds cannot say which card matters; width can.
 *
 * ── On the data ──────────────────────────────────────────────────────────────
 * Cards marked LIVE below read real hooks the dashboard already mounts, so
 * React Query dedupes them and they cost no extra request. Cards marked MOCK
 * have no source in the schema yet and render constants from `./mock`; each one
 * is a single swap once its query exists. Nothing here writes anything.
 *
 * TENANT ISOLATION: this component issues no query of its own. Every hook it
 * reads (`useDashboardKPIs`, `usePendingBookingsCount`, `useTodayOperations`)
 * carries its own `.eq('tenant_id', tenant.id)` and is `enabled` only once a
 * tenant is resolved — see V2_PLAN §5, RLS is OFF on these tables.
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTenant } from '@/contexts/TenantContext';
import { useDashboardKPIs } from '@/hooks/use-dashboard-kpis';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { usePendingBookingsCount } from '@/hooks/use-pending-bookings';
import { useTodayOperations, type Movement as OpsMovement } from '@/hooks/use-today-operations';
import { formatCurrency } from '@/lib/format-utils';
import {
  BOOKINGS_SERIES,
  RATIOS,
  REVENUE_SERIES,
  SOURCE_MIX,
  TODOS,
  TOP_CUSTOMERS,
  TOP_VEHICLES,
  type Movement,
  type WorkItem,
} from './mock';
import {
  AddNote,
  Band,
  Card,
  CardFooter,
  Delta,
  Eyebrow,
  Figure,
  FlowRow,
  Lead,
  MagnitudeBar,
  NowDivider,
  Row,
  Spark,
  TodoRow,
} from './ui';
import { AnnouncementCarousel } from '@/components/dashboard-v2/announcement-carousel';

/** "14:30:00" → 870. Null when the rental never had a time set. */
function toMinutes(time: string | null): number | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

/** 870 → "14:30". The board is 24h so the column stays four characters wide. */
function toLabel(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** A rental with no time set still has to happen, so it sorts to the end. */
const UNTIMED = 24 * 60 + 1;

function toFlow(m: OpsMovement): Movement {
  const at = toMinutes(m.time);
  return {
    id: `${m.kind}-${m.id}`,
    at: at ?? UNTIMED,
    time: at === null ? '—' : toLabel(at),
    direction: m.kind === 'pickup' ? 'out' : 'back',
    customer: m.customerName,
    vehicle: m.vehicleLabel,
    state: 'ready',
  };
}

export function HomeBands() {
  const router = useRouter();
  const { tenant } = useTenant();
  const { canView } = useManagerPermissions();
  const { data: kpis } = useDashboardKPIs();
  const { data: pendingBookings } = usePendingBookingsCount();
  const { pickups, returns, overdue, staleCount, staleAfterDays } = useTodayOperations();

  const currencyCode = tenant?.currency_code || 'USD';
  const canSeeRentals = canView('rentals');
  const canSeePayments = canView('payments');
  const canSeeFleet = canView('vehicles');

  const money = (amount: number) =>
    formatCurrency(amount, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // Local clock rather than the tenant's: this only decides where a divider
  // sits in a list, and a wrong-by-an-hour divider is a cosmetic problem, not a
  // data one. `useMemo` with no deps freezes it for the render so the marker
  // cannot move between two rows mid-paint.
  const nowMinutes = useMemo(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }, []);

  // ── LIVE · today's movements, in one queue in time order ──────────────────
  const flow = useMemo(
    () => [...pickups, ...returns].map(toFlow).sort((a, b) => a.at - b.at),
    [pickups, returns]
  );
  const doneCount = flow.filter((m) => m.at < nowMinutes).length;
  const next = flow.find((m) => m.at >= nowMinutes);
  const nextLabel = next ? `Next: ${next.customer.split(' ')[0]}` : 'Nothing left today';

  // ── LIVE · what cannot wait ───────────────────────────────────────────────
  const attention: WorkItem[] = [];
  if (canSeeRentals && overdue.length > 0) {
    const worst = Math.max(...overdue.map((o) => o.daysLate ?? 0));
    attention.push({
      id: 'overdue-vehicles',
      label:
        overdue.length === 1 ? '1 vehicle not returned' : `${overdue.length} vehicles not returned`,
      meta: overdue[0]?.customerName ? `Worst is ${overdue[0].customerName}` : undefined,
      clock: `${worst}d`,
      state: 'late',
    });
  }
  if (canSeePayments && kpis && kpis.overdue.count > 0) {
    attention.push({
      id: 'overdue-payments',
      label: `${kpis.overdue.count} overdue payments`,
      meta: 'Not collected past their due date',
      clock: 'Late',
      state: 'late',
      amount: money(kpis.overdue.amount),
    });
  }
  if (canView('pending_bookings') && (pendingBookings ?? 0) > 0) {
    attention.push({
      id: 'pending-bookings',
      label:
        pendingBookings === 1 ? '1 booking request' : `${pendingBookings} booking requests`,
      meta: 'Waiting on your approval',
      clock: 'New',
      state: 'waiting',
    });
  }
  if (canView('fines') && kpis && kpis.finesOpen.dueSoonCount > 0) {
    attention.push({
      id: 'fines',
      label: `${kpis.finesOpen.dueSoonCount} fines due soon`,
      meta: 'They get more expensive on a deadline',
      clock: 'Soon',
      state: 'waiting',
      amount: money(kpis.finesOpen.amount),
    });
  }
  if (canSeeRentals && staleCount > 0) {
    attention.push({
      id: 'stale',
      label: `${staleCount} rentals never closed off`,
      meta: `Past their end date by ${staleAfterDays} days or more`,
      clock: `${staleAfterDays}d+`,
      state: 'idle',
    });
  }
  const lead = attention[0];
  const urgent = attention.filter((i) => i.state === 'late').length;

  // ── LIVE · money in play today ────────────────────────────────────────────
  const moneyToday: WorkItem[] = [];
  if (kpis) {
    if (kpis.dueToday.count > 0) {
      moneyToday.push({
        id: 'due-today',
        label: 'Due today',
        meta: `${kpis.dueToday.count} customers`,
        clock: 'Today',
        state: 'waiting',
        amount: money(kpis.dueToday.amount),
      });
    }
    if (kpis.overdue.count > 0) {
      moneyToday.push({
        id: 'overdue',
        label: 'Overdue',
        meta: `${kpis.overdue.count} invoices`,
        clock: 'Late',
        state: 'late',
        amount: money(kpis.overdue.amount),
      });
    }
    if (kpis.finesOpen.count > 0) {
      moneyToday.push({
        id: 'fines-open',
        label: 'Open fines',
        meta: `${kpis.finesOpen.count} to recharge`,
        clock: 'Open',
        state: 'waiting',
        amount: money(kpis.finesOpen.amount),
      });
    }
    moneyToday.push({
      id: 'month',
      label: 'Collected this month',
      meta: 'Cleared payments',
      clock: 'MTD',
      state: 'clear',
      amount: money(kpis.monthlyRevenue.amount),
    });
  }
  const inPlay = kpis ? kpis.dueToday.amount + kpis.overdue.amount : 0;

  // ── LIVE · the rest of today ──────────────────────────────────────────────
  const elseToday: WorkItem[] = [];
  if (canSeeRentals) {
    elseToday.push({
      id: 'handovers',
      label: `${pickups.length} going out`,
      meta: pickups.length ? 'Keys, agreements and deposits' : 'Nothing scheduled to leave',
      clock: pickups.length ? 'Today' : '—',
      state: pickups.length ? 'waiting' : 'idle',
    });
    elseToday.push({
      id: 'returns',
      label: `${returns.length} coming back`,
      meta: returns.length ? 'Check in, damage and fuel' : 'Nothing due back',
      clock: returns.length ? 'Today' : '—',
      state: returns.length ? 'waiting' : 'idle',
    });
  }
  if (canSeeFleet && kpis) {
    const idle = Math.max(0, kpis.fleetUtilization.total - kpis.fleetUtilization.rented);
    elseToday.push({
      id: 'idle',
      label: `${idle} cars idle`,
      meta: `of ${kpis.fleetUtilization.total} in the fleet`,
      clock: `${kpis.fleetUtilization.percentage}%`,
      state: 'idle',
    });
  }
  if (canSeeRentals) {
    elseToday.push({
      id: 'active',
      label: `${kpis?.activeRentals.count ?? 0} rentals running`,
      meta: 'Out on the road right now',
      clock: 'Live',
      state: 'clear',
    });
  }

  const maxVehicleDays = Math.max(...TOP_VEHICLES.map((v) => v.days));
  const openTodos = TODOS.filter((t) => !t.done).length;
  const fleetPct = kpis ? `${kpis.fleetUtilization.percentage}%` : '—';

  return (
    <div className="space-y-16">
      {/* ── Important ─────────────────────────────────────────────────────── */}
      {/* Rhythm: narrow · wide · narrow. The poster is a fixed shape; the list
          that can ruin your morning gets the width. */}
      <Band title="On your desk" hint="What’s new, what’s urgent, and what you wrote down">
        <AnnouncementCarousel className="min-h-[288px] rounded-2xl border-0 shadow-none" />

        {/* LIVE */}
        <Card title="Attention required now" count={attention.length || undefined} tall>
          {lead ? (
            <>
              <Lead
                title={lead.label}
                meta={lead.meta}
                clock={lead.clock ?? ''}
                amount={lead.amount}
                tone={lead.state}
              />
              <div className="divide-y divide-[var(--pv-line)]">
                {attention.slice(1).map((i) => (
                  <Row key={i.id} item={i} />
                ))}
              </div>
              <CardFooter label={`See all ${attention.length}`} />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 py-8 text-center">
              <p className="text-sm font-medium">Nothing needs you</p>
              <p className="text-[11px] text-[var(--pv-ink-3)]">
                No late cars, overdue money or waiting requests.
              </p>
            </div>
          )}
        </Card>

        {/* MOCK — there is no reminders table yet. */}
        <Card title="Reminders" count={`${openTodos} open`} tall>
          <div className="divide-y divide-[var(--pv-line)]">
            {TODOS.map((t) => (
              <TodoRow key={t.id} todo={t} />
            ))}
          </div>
          <AddNote />
        </Card>
      </Band>

      {/* ── Today ─────────────────────────────────────────────────────────── */}
      {/* Rhythm: wide · narrow · narrow. The day queue leads — it is the only
          card here about the next hour. */}
      <Band
        title="Today"
        hint={flow.length ? `${doneCount} of ${flow.length} movements done` : 'Nothing scheduled'}
      >
        {/* LIVE */}
        <Card
          title="Coming and going"
          count={`${pickups.length} out · ${returns.length} back`}
        >
          {flow.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 py-8 text-center">
              <p className="text-sm font-medium">Nothing due today</p>
              <p className="text-[11px] text-[var(--pv-ink-3)]">
                No pickups or returns on the diary.
              </p>
            </div>
          ) : (
            /* One queue in time order, with NOW cut in where the day has
               actually reached. Two columns would make you merge them in your
               head to answer the only question that matters: what is next. */
            <div className="divide-y divide-[var(--pv-line)]">
              {flow.map((m, i) => {
                const past = m.at < nowMinutes;
                const crossing = !past && (i === 0 || flow[i - 1].at < nowMinutes);
                return (
                  <div key={m.id}>
                    {crossing && <NowDivider label={toLabel(nowMinutes)} next={nextLabel} />}
                    <FlowRow m={m} past={past} />
                  </div>
                );
              })}
            </div>
          )}
          <CardFooter label="Open the diary" />
        </Card>

        {/* LIVE */}
        {canSeePayments && (
          <Card title="Money today">
            {/* Leads with the figure, because the first question is how much is
                in play, not which invoice. */}
            <Figure value={money(inPlay)} label="in play" />
            <div className="divide-y divide-[var(--pv-line)] border-t border-[var(--pv-line)]">
              {moneyToday.map((i) => (
                <Row key={i.id} item={i} />
              ))}
            </div>
            <CardFooter label="Go to payments" />
          </Card>
        )}

        {/* LIVE */}
        <Card title="Everything else on today" count={elseToday.length || undefined}>
          <div className="divide-y divide-[var(--pv-line)]">
            {elseToday.map((i) => (
              <Row key={i.id} item={i} />
            ))}
          </div>
          <CardFooter label="See today in full" />
        </Card>
      </Band>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      {/* Rhythm: narrow · narrow · wide — the mirror of the band above, so the
          eye is not walked down the same shape three times. */}
      <Band title="How it’s going" hint="The last 14 days">
        {/* MOCK — needs the top-customers / top-vehicles aggregate. */}
        <Card title="Who and what earns">
          <div className="flex flex-1 flex-col gap-4 px-6 pb-6 pt-2.5">
            <div>
              <Eyebrow>Customers</Eyebrow>
              <div className="mt-1.5 space-y-1">
                {TOP_CUSTOMERS.map((c) => (
                  <div key={c.name} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.name}</span>
                    <span className="w-[46px] shrink-0 text-right text-[13px] font-semibold tabular-nums">
                      {c.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-auto border-t border-[var(--pv-line)] pt-2.5">
              <Eyebrow>Busiest cars</Eyebrow>
              <div className="mt-1.5 space-y-2">
                {TOP_VEHICLES.map((v) => (
                  <div key={v.name}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{v.name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--pv-ink-3)]">
                        {v.days}d
                      </span>
                    </div>
                    <MagnitudeBar value={v.days} max={maxVehicleDays} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Fleet on rent is LIVE; the three ratios are MOCK until booking
            attempts are tracked as records that can be counted. */}
        <Card title="Other stats">
          <div className="flex flex-1 flex-col px-6 pb-6 pt-2.5">
            <div className="grid grid-cols-2 gap-x-5 gap-y-6">
              <div>
                <span className="block truncate text-[11px] text-[var(--pv-ink-3)]">
                  Fleet on rent
                </span>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-[19px] font-semibold leading-none tabular-nums">
                    {fleetPct}
                  </span>
                </div>
              </div>
              {RATIOS.slice(0, 3).map((r) => (
                <div key={r.label}>
                  <span className="block truncate text-[11px] text-[var(--pv-ink-3)]">
                    {r.label}
                  </span>
                  <div className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-[19px] font-semibold leading-none tabular-nums">
                      {r.value}
                    </span>
                    <Delta value={r.delta} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-auto border-t border-[var(--pv-line)] pt-3">
              <Eyebrow>Where bookings come from</Eyebrow>
              {/* Stacked, with a 2px surface gap so the parts stay countable
                  rather than melting into one bar. */}
              <div className="mt-2 flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
                {SOURCE_MIX.map((s) => (
                  <span
                    key={s.label}
                    className="block rounded-full"
                    style={{ width: `${s.share}%`, backgroundColor: s.color }}
                  />
                ))}
              </div>
              {/* A legend is always present for more than one series — identity
                  is never carried by colour alone. */}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {SOURCE_MIX.map((s) => (
                  <span key={s.label} className="flex items-center gap-1.5">
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-[11px] text-[var(--pv-ink-2)]">{s.label}</span>
                    <span className="text-[11px] font-medium tabular-nums">{s.share}%</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* MOCK — needs the daily revenue / bookings series. */}
        <Card title="Revenue and bookings" action="Reports">
          <div className="flex flex-1 flex-col justify-center gap-6 px-6 pb-6 pt-2.5">
            <div>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
                  {money(REVENUE_SERIES[REVENUE_SERIES.length - 1])}
                </span>
                <span className="text-[11px] text-[var(--pv-ink-3)]">revenue this week</span>
                <span className="ml-auto">
                  <Delta value={12} suffix="%" />
                </span>
              </div>
              <Spark data={REVENUE_SERIES} color="#5b5bd6" height={40} />
            </div>

            <div className="border-t border-[var(--pv-line)] pt-4">
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
                  {BOOKINGS_SERIES[BOOKINGS_SERIES.length - 1]}
                </span>
                <span className="text-[11px] text-[var(--pv-ink-3)]">bookings this week</span>
                <span className="ml-auto">
                  <Delta value={18} suffix="%" />
                </span>
              </div>
              <Spark data={BOOKINGS_SERIES} color="#12a594" height={40} />
            </div>
          </div>
        </Card>
      </Band>
    </div>
  );
}
