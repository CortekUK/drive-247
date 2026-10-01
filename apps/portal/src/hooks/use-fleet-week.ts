'use client';

/**
 * The week ahead, per car and per pickup. Feeds the "This week" band on the v2
 * dashboard (northwind canary only).
 *
 * It answers two questions an operator otherwise answers by opening every
 * rental one at a time:
 *   1. Can each car actually do the work booked on it this week? (booked days,
 *      clashes, cars not back, inspection or registration lapsed)
 *   2. Is every customer due to pick up this week ready to drive away?
 *      (approved, signed, ID verified, paid)
 *
 * Three reads, one round trip each: vehicles, the live rentals that touch the
 * window, and the verifications for those rentals' customers. Everything else
 * is classified here in TS.
 *
 * TENANT ISOLATION: RLS is OFF on `rentals` and `customers` (V2_PLAN §5). Every
 * query below carries `.eq('tenant_id', tenant.id)` and the hook is `enabled`
 * only once a tenant is resolved. Do not remove either.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useSettings } from '@/stores/settings-store';

/** Days shown on the fleet strip, today included. */
export const WEEK_DAYS = 7;

/**
 * How far back a rental that is past its end date still counts as "car not
 * back". Older ones are rentals nobody closed off, which the Attention card
 * already counts separately. Same window as useTodayOperations.
 */
const OVERDUE_WINDOW_DAYS = 30;

/** How far back a pickup that never happened is still worth chasing. */
const MISSED_PICKUP_DAYS = 14;

/** Inspection / registration within this many days is flagged as due soon. */
const COMPLIANCE_WARN_DAYS = 14;

/** `rentals.status` is free text; these are the two that are really happening. */
const LIVE = ['Pending', 'Active'];

const SIGNED = ['signed', 'completed'];

// ─── Types ─────────────────────────────────────────────────────────────────

export type DayUse = 'free' | 'booked' | 'held' | 'late' | 'clash';

export type FlagTone = 'late' | 'waiting' | 'idle';

export interface FleetFlag {
  tone: FlagTone;
  text: string;
}

export interface FleetCar {
  id: string;
  name: string;
  reg: string;
  /** One entry per day in the window, today first. */
  days: DayUse[];
  freeDays: number;
  /** The single most serious thing about this car this week, if any. */
  flag: FleetFlag | null;
  /** Numeric rank of `flag`, lower is worse. Used for sorting and the note. */
  rank: number;
}

export type ReadyCheck = 'approved' | 'signed' | 'id' | 'paid';

export interface Pickup {
  rentalId: string;
  rentalNumber: string | null;
  customerName: string;
  vehicleName: string;
  startDate: string;
  /** Negative when the pickup date has already passed. */
  daysAway: number;
  checks: { key: ReadyCheck; ok: boolean }[];
  missing: ReadyCheck[];
  ready: boolean;
}

// ─── Dates (tenant's calendar, not the browser's) ─────────────────────────────

function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

const carName = (v: any) => [v?.make, v?.model].filter(Boolean).join(' ') || v?.reg || 'Vehicle';

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useFleetWeek() {
  const { tenant } = useTenant();
  const { settings } = useSettings();
  const today = todayIn(settings?.timezone || 'America/New_York');
  const windowEnd = addDays(today, WEEK_DAYS - 1);

  const query = useQuery({
    queryKey: ['fleet-week', tenant?.id, today],
    enabled: !!tenant?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const tenantId = tenant!.id;

      const [vehiclesRes, rentalsRes, tenantRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('id, reg, make, model, status, mot_due_date, tax_due_date')
          .eq('tenant_id', tenantId)
          .neq('status', 'Disposed')
          .order('make', { ascending: true }),
        supabase
          .from('rentals')
          .select(
            'id, rental_number, vehicle_id, customer_id, start_date, end_date, status, ' +
              'approval_status, document_status, payment_status, id_verification_waived, ' +
              'is_pay_as_you_go, auto_extend_enabled, customer:customers(name), ' +
              'vehicle:vehicles(reg, make, model)'
          )
          .eq('tenant_id', tenantId)
          .in('status', LIVE)
          .lte('start_date', windowEnd)
          .gte('end_date', addDays(today, -OVERDUE_WINDOW_DAYS)),
        supabase
          .from('tenants')
          .select('require_identity_verification')
          .eq('id', tenantId)
          .maybeSingle(),
      ]);
      if (vehiclesRes.error) throw vehiclesRes.error;
      if (rentalsRes.error) throw rentalsRes.error;

      const rentals = (rentalsRes.data ?? []) as any[];
      const customerIds = [...new Set(rentals.map((r) => r.customer_id).filter(Boolean))];

      let verified = new Set<string>();
      if (customerIds.length > 0) {
        const { data, error } = await supabase
          .from('identity_verifications')
          .select('customer_id')
          .eq('tenant_id', tenantId)
          .in('customer_id', customerIds)
          .eq('review_result', 'GREEN');
        if (error) throw error;
        verified = new Set((data ?? []).map((v: any) => v.customer_id));
      }

      return {
        vehicles: (vehiclesRes.data ?? []) as any[],
        rentals,
        verified,
        requireId: (tenantRes.data as any)?.require_identity_verification !== false,
      };
    },
  });

  const derived = useMemo(() => {
    if (!query.data) return null;
    const { vehicles, rentals, verified, requireId } = query.data;
    const days = Array.from({ length: WEEK_DAYS }, (_, i) => addDays(today, i));

    // ── Fleet ──────────────────────────────────────────────────────────────
    const cars: FleetCar[] = vehicles.map((v) => {
      const mine = rentals.filter((r) => r.vehicle_id === v.id);
      const rolling = (r: any) => r.is_pay_as_you_go || r.auto_extend_enabled;
      // A car past its end date and not rolling is still out: it occupies
      // today, and every day after, until someone closes it off.
      // An older Active rental whose car has since gone out again on a newer
      // Active rental was simply never closed off, the car did come back. That
      // is the Attention card's "never closed off" line, not a missing car.
      const notBack = mine
        .filter(
          (r) =>
            r.status === 'Active' &&
            r.end_date < today &&
            !rolling(r) &&
            !mine.some((n) => n !== r && n.status === 'Active' && n.start_date > r.end_date && n.start_date <= today)
        )
        .sort((a, b) => (a.end_date < b.end_date ? 1 : -1))[0];

      const superseded = (r: any) =>
        r.status === 'Active' && r.end_date < today && !rolling(r) && r !== notBack;

      const use: DayUse[] = days.map((day) => {
        const covering = mine.filter((r) => !superseded(r)).filter(
          (r) => r.start_date <= day && (r.end_date >= day || (rolling(r) && r.status === 'Active'))
        );
        const count = covering.length + (notBack ? 1 : 0);
        if (count >= 2) return 'clash';
        if (notBack) return 'late';
        if (count === 1) return covering[0].status === 'Active' ? 'booked' : 'held';
        return 'free';
      });

      const out = mine.some((r) => r.start_date <= windowEnd);
      const busy = use.some((u) => u !== 'free');
      const flags: { rank: number; flag: FleetFlag }[] = [];

      for (const [col, label] of [
        ['mot_due_date', 'Inspection'],
        ['tax_due_date', 'Registration'],
      ] as const) {
        const due = v[col] as string | null;
        if (!due) continue;
        const left = diffDays(due, today);
        if (left < 0 && (busy || out)) {
          flags.push({ rank: 0, flag: { tone: 'late', text: `${label} lapsed ${-left}d ago` } });
        } else if (left < 0) {
          flags.push({ rank: 3, flag: { tone: 'waiting', text: `${label} lapsed` } });
        } else if (left <= COMPLIANCE_WARN_DAYS) {
          flags.push({
            rank: 4,
            flag: { tone: 'waiting', text: left === 0 ? `${label} due today` : `${label} due in ${left}d` },
          });
        }
      }
      if (notBack) {
        flags.push({
          rank: 1,
          flag: { tone: 'late', text: `Not back · ${diffDays(today, notBack.end_date)}d` },
        });
      }
      const clashAt = use.indexOf('clash');
      if (clashAt >= 0) {
        flags.push({
          rank: 2,
          flag: {
            tone: 'late',
            text: clashAt === 0 ? 'Double-booked today' : `Double-booked ${weekday(days[clashAt])}`,
          },
        });
      }
      const freeDays = use.filter((u) => u === 'free').length;
      if (freeDays === WEEK_DAYS) flags.push({ rank: 5, flag: { tone: 'idle', text: 'Free all week' } });

      flags.sort((a, b) => a.rank - b.rank);
      return {
        id: v.id,
        name: carName(v),
        reg: v.reg ?? '',
        days: use,
        freeDays,
        flag: flags[0]?.flag ?? null,
        rank: flags[0]?.rank ?? 9,
      };
    });
    cars.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

    // ── Pickups ────────────────────────────────────────────────────────────
    const pickups: Pickup[] = rentals
      .filter((r) => {
        const away = diffDays(r.start_date, today);
        // Upcoming this week, any status; or a pickup date that passed while the
        // rental never went live (still Pending).
        return (away >= 0 && away < WEEK_DAYS) || (r.status === 'Pending' && away < 0 && away >= -MISSED_PICKUP_DAYS);
      })
      .map((r) => {
        const checks: { key: ReadyCheck; ok: boolean }[] = [
          { key: 'approved', ok: r.status === 'Active' || r.approval_status === 'approved' },
          { key: 'signed', ok: SIGNED.includes(r.document_status ?? '') },
        ];
        if (requireId) {
          checks.push({ key: 'id', ok: !!r.id_verification_waived || verified.has(r.customer_id) });
        }
        checks.push({ key: 'paid', ok: r.payment_status === 'fulfilled' });
        const missing = checks.filter((c) => !c.ok).map((c) => c.key);
        return {
          rentalId: r.id,
          rentalNumber: r.rental_number ?? null,
          customerName: one<any>(r.customer)?.name || 'Customer',
          vehicleName: carName(one<any>(r.vehicle)),
          startDate: r.start_date,
          daysAway: diffDays(r.start_date, today),
          checks,
          missing,
          ready: missing.length === 0,
        };
      })
      .sort((a, b) => Number(a.ready) - Number(b.ready) || a.daysAway - b.daysAway);

    return { cars, pickups, days };
  }, [query.data, today]);

  return {
    cars: derived?.cars ?? [],
    pickups: derived?.pickups ?? [],
    days: derived?.days ?? [],
    today,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/** "Sat" for a yyyy-MM-dd. Read as UTC, since the string is already the tenant's day. */
export function weekday(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}
