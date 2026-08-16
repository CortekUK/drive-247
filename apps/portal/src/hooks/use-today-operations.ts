'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useSettings } from '@/stores/settings-store';

/**
 * What has to physically happen today: which cars go out, which come back, and
 * which were due back and have not.
 *
 * `start_date` and `end_date` are `date` columns, so "today" is a plain string
 * comparison — but it has to be the TENANT's today. An operator in Denver
 * opening the portal at 11pm UK time must still see Denver's Tuesday, so the
 * date is formatted in the tenant's configured timezone rather than the
 * browser's. Same timezone source as useDashboardKPIs, so the two panels can
 * never disagree about what day it is.
 */

export type MovementKind = 'pickup' | 'return' | 'overdue';

export interface Movement {
  id: string;
  kind: MovementKind;
  /** `time` column, "HH:MM:SS" — null when the rental never had one set. */
  time: string | null;
  customerName: string;
  vehicleLabel: string;
  rentalNumber: string | null;
  /** Whole days past the due date. Only set on `overdue`. */
  daysLate?: number;
}

/** Statuses that represent a rental that is really happening. */
const LIVE = ['Pending', 'Active'];

/**
 * How far back an overdue return is still treated as today's work.
 *
 * Checked against production before picking the number: of 60 live rentals whose
 * end_date has passed, 42 are more than a month old and 22 are past 90 days. A
 * car is not actually missing for three months — those are rentals that were
 * never closed out. Listing them would bury the two or three genuinely late
 * vehicles and teach the operator to ignore the panel.
 *
 * The older ones are NOT hidden: they are counted separately and surfaced as a
 * single line, so the backlog is visible as a data-hygiene job rather than
 * mixed in with "someone has not brought a car back".
 */
const OVERDUE_WINDOW_DAYS = 30;

const SELECT =
  'id, rental_number, start_date, end_date, pickup_time, return_time, ' +
  'customer:customers(name), vehicle:vehicles(reg, make, model)';

/** Today in a given IANA zone, as `yyyy-MM-dd`. */
function todayIn(timezone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the shape a date column wants.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  // Supabase returns a many-to-one embed as an object, but an array shape shows
  // up depending on how the FK is resolved.
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

function toMovement(row: any, kind: MovementKind, today: string): Movement {
  const customer = one<any>(row.customer);
  const vehicle = one<any>(row.vehicle);
  const vehicleLabel =
    [vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || vehicle?.reg || 'Vehicle';

  const movement: Movement = {
    id: row.id,
    kind,
    time: kind === 'pickup' ? row.pickup_time : row.return_time,
    customerName: customer?.name || 'Customer',
    vehicleLabel,
    rentalNumber: row.rental_number ?? null,
  };

  if (kind === 'overdue' && row.end_date) {
    const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.end_date}T00:00:00Z`);
    movement.daysLate = Math.max(1, Math.round(ms / 86_400_000));
  }

  return movement;
}

export function useTodayOperations() {
  const { tenant } = useTenant();
  const { settings } = useSettings();
  const timezone = settings?.timezone || 'America/New_York';
  const today = todayIn(timezone);

  const query = useQuery({
    queryKey: ['today-operations', tenant?.id, today],
    queryFn: async () => {
      const base = () =>
        supabase.from('rentals').select(SELECT).eq('tenant_id', tenant!.id).in('status', LIVE);

      const windowStart = new Date(Date.parse(`${today}T00:00:00Z`));
      windowStart.setUTCDate(windowStart.getUTCDate() - OVERDUE_WINDOW_DAYS);
      const cutoff = windowStart.toISOString().slice(0, 10);

      /**
       * PAYG and auto-extending rentals are excluded from "late" on purpose.
       * Both legitimately run past `end_date` — PAYG accrues until it is closed,
       * and an auto-renewing rental sits a few days past its date between
       * charges. Neither is a car someone failed to bring back, and calling them
       * late would be wrong on every single one.
       */
      const notRolling = () =>
        base().eq('is_pay_as_you_go', false).eq('auto_extend_enabled', false);

      const [pickups, returns, overdue, stale] = await Promise.all([
        base().eq('start_date', today).order('pickup_time', { ascending: true }),
        base().eq('end_date', today).order('return_time', { ascending: true }),
        notRolling()
          .lt('end_date', today)
          .gte('end_date', cutoff)
          .order('end_date', { ascending: true }),
        // Everything older, as a count only.
        supabase
          .from('rentals')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant!.id)
          .in('status', LIVE)
          .eq('is_pay_as_you_go', false)
          .eq('auto_extend_enabled', false)
          .lt('end_date', cutoff),
      ]);

      const err = pickups.error || returns.error || overdue.error || stale.error;
      if (err) throw err;

      return {
        pickups: (pickups.data || []).map((r) => toMovement(r, 'pickup', today)),
        returns: (returns.data || []).map((r) => toMovement(r, 'return', today)),
        overdue: (overdue.data || []).map((r) => toMovement(r, 'overdue', today)),
        staleCount: stale.count ?? 0,
      };
    },
    enabled: !!tenant?.id,
    // Cheap, and this is the panel someone leaves open all morning.
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  return {
    pickups: query.data?.pickups ?? [],
    returns: query.data?.returns ?? [],
    overdue: query.data?.overdue ?? [],
    /** Live rentals more than OVERDUE_WINDOW_DAYS past their end date. */
    staleCount: query.data?.staleCount ?? 0,
    staleAfterDays: OVERDUE_WINDOW_DAYS,
    isLoading: query.isLoading,
    today,
  };
}
