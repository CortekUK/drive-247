'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useSettings } from '@/stores/settings-store';

/**
 * Everything that happens to the business across ONE day, in the tenant's
 * timezone, for the v2 dashboard's horizontal day timeline.
 *
 * Each event is `done`, `missed` or `upcoming`:
 *  - done     — it happened (a handover recorded, a reminder sent, a charge taken)
 *  - missed   — its time has passed and it did not happen, or it was attempted
 *               and failed
 *  - upcoming — its time has not come yet
 *
 * Only TODAY is covered. Older misses already surface in "Attention required
 * now" (vehicles not returned, overdue payments), so repeating them here would
 * show the same problem twice.
 *
 * Sources, each verified against production (Sep 26 2026):
 *  - car out / car back   rentals.start_date|end_date + pickup_time|return_time,
 *                          done when rental_key_handovers has the giving /
 *                          receiving row (or the rental is Closed, for a return)
 *  - payment reminders    auto_extension_reminders, payg_reminder_log
 *  - return reminders     rentals.return_reminder_sent_at
 *  - extension charges    rentals.auto_extend_next_charge_at / _last_charge_at
 *  - lockbox codes        rentals.lockbox_sent_at
 *  - installments         scheduled_installments.due_date
 *
 * TENANT ISOLATION: RLS is OFF on `rentals` and most of these tables
 * (V2_PLAN §5). EVERY query below carries `.eq('tenant_id', tenant.id)`, and
 * the hook is `enabled` only once a tenant is resolved. Do not remove either.
 */

export type DayEventKind =
  | 'pickup'
  | 'return'
  | 'payment_reminder'
  | 'return_reminder'
  | 'extension_charge'
  | 'installment'
  | 'lockbox';

export type DayEventState = 'done' | 'missed' | 'upcoming';

export interface DayEvent {
  id: string;
  kind: DayEventKind;
  /** Minutes after midnight in the tenant's timezone. Null = no time set. */
  at: number | null;
  /** What happens, e.g. "Car out", "Payment reminder". */
  title: string;
  /** Who / what it is about, e.g. "Sam Lee · Tesla Model 3". */
  subject: string;
  state: DayEventState;
  /** A short reason, shown on a missed or done event ("Not handed over", "Sent by SMS"). */
  note?: string;
  rentalId: string | null;
}

export interface DayTimeline {
  events: DayEvent[];
  /** Tenant's today, `yyyy-MM-dd`. */
  today: string;
  /** Now, in minutes after the tenant's midnight. */
  nowMinutes: number;
  /** The tenant's opening hours today, in minutes. Null when always open / unknown. */
  open: number | null;
  close: number | null;
  timezone: string;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Parts of an instant as seen in `tz`. */
function zonedParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    date: `${String(get('year')).padStart(4, '0')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`,
    minutes: get('hour') * 60 + get('minute'),
    // An instant's wall-clock reading in `tz`, re-read as if it were UTC.
    asUtc: Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')),
  };
}

/** The UTC instant at which `date` (yyyy-MM-dd) starts in `tz`. */
function zonedMidnight(date: string, tz: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  // Two passes: the second corrects for a DST change between the guess and midnight.
  let ts = guess;
  for (let i = 0; i < 2; i++) {
    const offset = zonedParts(new Date(ts), tz).asUtc - ts;
    ts = guess - offset;
  }
  return new Date(ts);
}

function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** "14:30:00" → 870. */
function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

function subjectOf(row: any): string {
  const customer = one<any>(row?.customer);
  const vehicle = one<any>(row?.vehicle);
  const car = [vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || vehicle?.reg || '';
  return [customer?.name || 'Customer', car].filter(Boolean).join(' · ');
}

const HOURS_SELECT = [
  'timezone',
  'working_hours_always_open',
  'working_hours_open',
  'working_hours_close',
  ...WEEKDAYS.flatMap((d) => [`${d}_open`, `${d}_close`]),
].join(', ');

const RENTAL_SELECT =
  'id, status, start_date, end_date, pickup_time, return_time, ' +
  'customer:customers(name), vehicle:vehicles(reg, make, model)';

export function useDayTimeline() {
  const { tenant } = useTenant();
  const { settings } = useSettings();
  const fallbackZone = settings?.timezone || 'America/New_York';

  const query = useQuery({
    queryKey: ['day-timeline', tenant?.id],
    queryFn: async (): Promise<DayTimeline> => {
      const tenantId = tenant!.id;

      // The tenant's own timezone decides what "today" is. org_settings is NOT
      // used first: its timezone is often null, and the settings function then
      // answers Europe/London — which put a New York operator on tomorrow's
      // date every evening and showed an empty day.
      const hours = await (supabase as any)
        .from('tenants')
        .select(HOURS_SELECT)
        .eq('id', tenantId)
        .maybeSingle();
      const timezone = safeZone((hours.data as any)?.timezone || fallbackZone);
      const today = zonedParts(new Date(), timezone).date;
      const dayStart = zonedMidnight(today, timezone);
      const nextDay = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      const dayEnd = zonedMidnight(nextDay, timezone);
      const from = dayStart.toISOString();
      const to = dayEnd.toISOString();

      const minutesOf = (iso: string | null | undefined): number | null =>
        iso ? zonedParts(new Date(iso), timezone).minutes : null;

      const rentals = () => supabase.from('rentals').select(RENTAL_SELECT).eq('tenant_id', tenantId);

      const [
        pickups,
        returns,
        returnReminders,
        lockbox,
        chargesDue,
        chargesTaken,
        autoExtReminders,
        paygReminders,
        installments,
      ] = await Promise.all([
        rentals().eq('start_date', today).neq('status', 'Cancelled'),
        rentals().eq('end_date', today).neq('status', 'Cancelled'),
        supabase
          .from('rentals')
          .select(`${RENTAL_SELECT}, return_reminder_sent_at`)
          .eq('tenant_id', tenantId)
          .gte('return_reminder_sent_at', from)
          .lt('return_reminder_sent_at', to),
        supabase
          .from('rentals')
          .select(`${RENTAL_SELECT}, lockbox_sent_at`)
          .eq('tenant_id', tenantId)
          .gte('lockbox_sent_at', from)
          .lt('lockbox_sent_at', to),
        supabase
          .from('rentals')
          .select(`${RENTAL_SELECT}, auto_extend_next_charge_at, auto_extend_paused`)
          .eq('tenant_id', tenantId)
          .eq('auto_extend_enabled', true)
          .gte('auto_extend_next_charge_at', from)
          .lt('auto_extend_next_charge_at', to),
        supabase
          .from('rentals')
          .select(`${RENTAL_SELECT}, auto_extend_last_charge_at`)
          .eq('tenant_id', tenantId)
          .gte('auto_extend_last_charge_at', from)
          .lt('auto_extend_last_charge_at', to),
        (supabase as any)
          .from('auto_extension_reminders')
          .select('id, rental_id, status, channel, sent_at, created_at')
          .eq('tenant_id', tenantId)
          .gte('created_at', from)
          .lt('created_at', to),
        (supabase as any)
          .from('payg_reminder_log')
          .select('id, rental_id, success, channel, sent_at')
          .eq('tenant_id', tenantId)
          .gte('sent_at', from)
          .lt('sent_at', to),
        (supabase as any)
          .from('scheduled_installments')
          .select('id, rental_id, status, amount, paid_at, last_attempted_at')
          .eq('tenant_id', tenantId)
          .eq('due_date', today),
      ]);

      // The two car movements are the backbone of the day; if they fail, the
      // timeline fails rather than showing a day that looks quiet.
      if (pickups.error) throw pickups.error;
      if (returns.error) throw returns.error;

      const now = zonedParts(new Date(), timezone).minutes;
      const events: DayEvent[] = [];

      // ── Handovers, to tell "car out" from "car should have gone out" ─────────
      const movementIds = [...(pickups.data || []), ...(returns.data || [])].map((r: any) => r.id);
      const handedOut = new Set<string>();
      const handedBack = new Set<string>();
      if (movementIds.length) {
        const { data: handovers } = await (supabase as any)
          .from('rental_key_handovers')
          .select('rental_id, handover_type, handed_at')
          .eq('tenant_id', tenantId)
          .in('rental_id', movementIds)
          .not('handed_at', 'is', null);
        for (const h of handovers || []) {
          if (h.handover_type === 'giving') handedOut.add(h.rental_id);
          if (h.handover_type === 'receiving') handedBack.add(h.rental_id);
        }
      }

      for (const r of (pickups.data || []) as any[]) {
        const at = timeToMinutes(r.pickup_time);
        const done = handedOut.has(r.id);
        const missed = !done && at !== null && at < now;
        events.push({
          id: `pickup-${r.id}`,
          kind: 'pickup',
          at,
          title: 'Car out',
          subject: subjectOf(r),
          state: done ? 'done' : missed ? 'missed' : 'upcoming',
          note: done ? 'Handed over' : missed ? 'Not handed over' : undefined,
          rentalId: r.id,
        });
      }

      for (const r of (returns.data || []) as any[]) {
        const at = timeToMinutes(r.return_time);
        const done = handedBack.has(r.id) || r.status === 'Closed';
        const missed = !done && at !== null && at < now;
        events.push({
          id: `return-${r.id}`,
          kind: 'return',
          at,
          title: 'Car back',
          subject: subjectOf(r),
          state: done ? 'done' : missed ? 'missed' : 'upcoming',
          note: done ? 'Returned' : missed ? 'Not back yet' : undefined,
          rentalId: r.id,
        });
      }

      for (const r of (returnReminders.data || []) as any[]) {
        events.push({
          id: `return-reminder-${r.id}`,
          kind: 'return_reminder',
          at: minutesOf(r.return_reminder_sent_at),
          title: 'Return reminder',
          subject: subjectOf(r),
          state: 'done',
          note: 'Sent',
          rentalId: r.id,
        });
      }

      for (const r of (lockbox.data || []) as any[]) {
        events.push({
          id: `lockbox-${r.id}`,
          kind: 'lockbox',
          at: minutesOf(r.lockbox_sent_at),
          title: 'Lockbox code',
          subject: subjectOf(r),
          state: 'done',
          note: 'Sent',
          rentalId: r.id,
        });
      }

      const charged = new Set<string>();
      for (const r of (chargesTaken.data || []) as any[]) {
        charged.add(r.id);
        events.push({
          id: `charge-done-${r.id}`,
          kind: 'extension_charge',
          at: minutesOf(r.auto_extend_last_charge_at),
          title: 'Extension charge',
          subject: subjectOf(r),
          state: 'done',
          note: 'Charged',
          rentalId: r.id,
        });
      }
      for (const r of (chargesDue.data || []) as any[]) {
        if (charged.has(r.id) || r.auto_extend_paused) continue;
        const at = minutesOf(r.auto_extend_next_charge_at);
        const missed = at !== null && at < now;
        events.push({
          id: `charge-due-${r.id}`,
          kind: 'extension_charge',
          at,
          title: 'Extension charge',
          subject: subjectOf(r),
          state: missed ? 'missed' : 'upcoming',
          note: missed ? 'Not taken' : undefined,
          rentalId: r.id,
        });
      }

      // ── Reminder logs carry only a rental id; resolve names in one query ─────
      const reminderRows: { row: any; source: 'autoext' | 'payg' }[] = [
        ...((autoExtReminders.data || []) as any[]).map((row) => ({ row, source: 'autoext' as const })),
        ...((paygReminders.data || []) as any[]).map((row) => ({ row, source: 'payg' as const })),
      ];
      const installmentRows = (installments.data || []) as any[];
      const lookupIds = [
        ...new Set(
          [...reminderRows.map((r) => r.row.rental_id), ...installmentRows.map((r) => r.rental_id)].filter(
            Boolean
          )
        ),
      ];
      const subjects = new Map<string, string>();
      if (lookupIds.length) {
        const { data } = await supabase
          .from('rentals')
          .select('id, customer:customers(name), vehicle:vehicles(reg, make, model)')
          .eq('tenant_id', tenantId)
          .in('id', lookupIds);
        for (const r of (data || []) as any[]) subjects.set(r.id, subjectOf(r));
      }

      for (const { row, source } of reminderRows) {
        const failed = source === 'payg' ? row.success === false : row.status === 'failed';
        const channel = row.channel ? ` by ${String(row.channel).toLowerCase() === 'sms' ? 'SMS' : row.channel}` : '';
        events.push({
          id: `payment-reminder-${source}-${row.id}`,
          kind: 'payment_reminder',
          at: minutesOf(row.sent_at || row.created_at),
          title: 'Payment reminder',
          subject: subjects.get(row.rental_id) || 'Customer',
          state: failed ? 'missed' : 'done',
          note: failed ? 'Failed to send' : `Sent${channel}`,
          rentalId: row.rental_id ?? null,
        });
      }

      for (const row of installmentRows) {
        const paid = row.status === 'paid';
        const failed = row.status === 'failed';
        events.push({
          id: `installment-${row.id}`,
          kind: 'installment',
          at: minutesOf(paid ? row.paid_at : failed ? row.last_attempted_at : null),
          title: 'Installment',
          subject: subjects.get(row.rental_id) || 'Customer',
          state: paid ? 'done' : failed ? 'missed' : 'upcoming',
          note: paid ? 'Collected' : failed ? 'Payment failed' : 'Due today',
          rentalId: row.rental_id ?? null,
        });
      }

      // ── Opening hours for today, to frame the axis ───────────────────────────
      let open: number | null = null;
      let close: number | null = null;
      const t = hours.data as any;
      if (t && !t.working_hours_always_open) {
        const weekday = WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()];
        open = timeToMinutes(t[`${weekday}_open`]) ?? timeToMinutes(t.working_hours_open);
        close = timeToMinutes(t[`${weekday}_close`]) ?? timeToMinutes(t.working_hours_close);
      }

      events.sort((a, b) => (a.at ?? -1) - (b.at ?? -1));
      return { events, today, nowMinutes: now, open, close, timezone };
    },
    enabled: !!tenant?.id,
    staleTime: 60 * 1000,
    // The panel someone leaves open all day: "now" and the missed states move.
    refetchInterval: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  return {
    timeline: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
