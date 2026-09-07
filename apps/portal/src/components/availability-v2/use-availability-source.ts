'use client';

/**
 * The two READS this screen makes. There is no third, and there is no write.
 *
 *   1. `tenants` — the 21 working-hours columns plus the always-open flag and
 *      the timezone. This is the "global" weekly pattern.
 *   2. `blocked_dates` — the real ranges an operator has already blocked.
 *
 * ── Sharing the working-hours cache with v1 ─────────────────────────────────
 *
 * The query key and the selected column list are IDENTICAL to the ones in
 * `components/blocked-dates/working-hours-card.tsx`. Two queries under one key
 * returning different column sets is a real bug — whichever mounts first wins
 * and the other reads fields that are not there — so if that card's select list
 * ever changes, this one changes with it. They can never actually render at the
 * same time (the v2 gate is a branch, not an addition), but keeping them in
 * lockstep means the cache is warm either way round and there is nothing to get
 * wrong later.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useBlockedDates } from '@/hooks/use-blocked-dates';
import {
  DAY_KEYS,
  FALLBACK_DEFAULTS,
  type DayKey,
  type RealBlock,
  type WeeklyDefaults,
} from './availability-model';

export interface AvailabilitySource {
  defaults: WeeklyDefaults;
  blocks: RealBlock[];
  isLoading: boolean;
  /** True once a real tenant row has been read, rather than the fallback shown. */
  hasRealHours: boolean;
}

export function useAvailabilitySource(): AvailabilitySource {
  const { tenant } = useTenant();

  const { data: hoursRow, isLoading: hoursLoading } = useQuery({
    queryKey: ['working-hours', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return null;

      const { data, error } = await supabase
        .from('tenants')
        .select(`
          working_hours_always_open,
          timezone,
          monday_enabled, monday_open, monday_close,
          tuesday_enabled, tuesday_open, tuesday_close,
          wednesday_enabled, wednesday_open, wednesday_close,
          thursday_enabled, thursday_open, thursday_close,
          friday_enabled, friday_open, friday_close,
          saturday_enabled, saturday_open, saturday_close,
          sunday_enabled, sunday_open, sunday_close
        `)
        .eq('id', tenant.id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!tenant?.id,
  });

  // `useBlockedDates()` with no vehicle id returns every current and future
  // block for the tenant — both the tenant-wide ones and the per-vehicle ones.
  // It only reads rows whose `end_date` is today or later, so a week in the
  // past shows no blocks at all. Stated on the screen rather than papered over.
  const { blockedDates, isLoading: blocksLoading } = useBlockedDates();

  const defaults = useMemo<WeeklyDefaults>(() => {
    if (!hoursRow) return FALLBACK_DEFAULTS;

    const row = hoursRow as Record<string, unknown>;
    const days = {} as WeeklyDefaults['days'];

    for (const key of DAY_KEYS) {
      const fallback = FALLBACK_DEFAULTS.days[key as DayKey];
      const enabled = row[`${key}_enabled`];
      days[key] = {
        // The columns are nullable. `?? fallback` rather than `|| fallback`,
        // so an explicit `false` survives instead of being read as "unset".
        enabled: typeof enabled === 'boolean' ? enabled : fallback.enabled,
        open: normaliseTime(row[`${key}_open`]) ?? fallback.open,
        close: normaliseTime(row[`${key}_close`]) ?? fallback.close,
      };
    }

    return {
      alwaysOpen:
        typeof row.working_hours_always_open === 'boolean'
          ? row.working_hours_always_open
          : FALLBACK_DEFAULTS.alwaysOpen,
      timezone: (row.timezone as string) || FALLBACK_DEFAULTS.timezone,
      days,
    };
  }, [hoursRow]);

  const blocks = useMemo<RealBlock[]>(
    () =>
      (blockedDates || []).map((b) => ({
        id: b.id,
        start: String(b.start_date).slice(0, 10),
        end: String(b.end_date).slice(0, 10),
        reason: b.reason ?? null,
        scope: b.vehicle_id ? 'vehicle' : 'tenant',
        vehicleLabel: b.vehicles
          ? `${b.vehicles.make} ${b.vehicles.model} (${b.vehicles.reg})`
          : b.vehicle_id
            ? 'One vehicle'
            : null,
      })),
    [blockedDates],
  );

  return {
    defaults,
    blocks,
    isLoading: hoursLoading || blocksLoading,
    hasRealHours: !!hoursRow,
  };
}

/**
 * The time columns are `text` and have been written by more than one screen
 * over the years, so they arrive as "09:00", "09:00:00" and occasionally "9:00".
 * Everything downstream indexes on "HH:mm"; anything else is treated as unset
 * rather than rendered as a broken bar.
 */
function normaliseTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
