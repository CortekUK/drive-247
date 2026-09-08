'use client';

/**
 * The WRITE this screen never had.
 *
 * ── what this fixes ─────────────────────────────────────────────────────────
 *
 * `availability-v2` read the tenant's real hours and real blocked ranges and
 * persisted nothing: every control moved React state and was gone on reload.
 * The permanent "changes aren't saved" pill was the only thing telling the
 * operator the truth. This makes the screen able to save, so that pill can go.
 *
 * ── it reuses the existing paths; it does not invent a third ────────────────
 *
 * Two writes, both already used by the v1 cards the other 36 tenants render:
 *
 *   WEEKLY PATTERN -> `tenants`, the same 21 per-day columns plus
 *     `working_hours_always_open` and `timezone` that
 *     `blocked-dates/working-hours-card.tsx` writes. Column for column, and
 *     `working_hours_enabled` is deliberately NOT written here for the reason
 *     that card documents at length: the booking site reads it as a master
 *     kill-switch, and re-asserting a field the operator never touched could
 *     flip an intentionally-unrestricted tenant into a restricted one.
 *
 *   FULL-DAY CLOSURES -> `blocked_dates`, the same insert/delete
 *     `hooks/use-blocked-dates.ts` performs, with `vehicle_id: null`. NULL is
 *     what makes a block tenant-wide rather than about one car: the booking
 *     site filters `vehicle_id.eq.<id>,vehicle_id.is.null`, so a NULL row
 *     blocks the date for every vehicle. That is what "close the whole day"
 *     means here.
 *
 * ── what CANNOT be saved, and is not pretended ──────────────────────────────
 *
 * DATE-SPECIFIC CUSTOM HOURS — "this Friday 10-2 instead of the usual 9-5".
 * `blocked_dates.start_date` and `.end_date` are DATE columns. There is no time
 * on that table at all, so a custom-hours override has nowhere to live. It is
 * therefore NOT offered by the save path, rather than accepted and silently
 * dropped. See the note in `availability-v2.tsx` for the schema change it
 * would take.
 *
 * ── ordering, and why failure is reported per part ──────────────────────────
 *
 * The two writes go to different tables and can fail independently. They are
 * not a transaction and cannot be made one from the client, so the result says
 * WHICH part succeeded: an operator whose hours saved but whose closure did not
 * must not be told "saved", and must not be told "failed" either.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { DAY_KEYS, type WeeklyDefaults } from './availability-model';

/** A full-day, tenant-wide closure, keyed by ISO date (yyyy-MM-dd). */
export interface ClosureDraft {
  date: string;
  /** Present when this closure already exists in the database. */
  id?: string;
}

export interface AvailabilitySaveInput {
  /** The whole weekly pattern — it already carries `alwaysOpen` and `timezone`. */
  defaults: WeeklyDefaults;
  /** Dates to close that are not closed yet, as "yyyy-MM-dd". */
  addClosures: string[];
  /** Ids of existing `blocked_dates` rows to remove. */
  removeClosureIds: string[];
}

export interface AvailabilitySaveResult {
  hoursSaved: boolean;
  closuresAdded: number;
  closuresRemoved: number;
}

export function useAvailabilitySave() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation<AvailabilitySaveResult, Error, AvailabilitySaveInput>({
    mutationFn: async (input) => {
      if (!tenant?.id) throw new Error('No tenant context — cannot save availability.');

      /* ── 1. the weekly pattern ─────────────────────────────────────────── */
      const updateData: Record<string, unknown> = {
        working_hours_always_open: input.defaults.alwaysOpen,
        timezone: input.defaults.timezone,
      };
      for (const day of DAY_KEYS) {
        const d = input.defaults.days[day];
        updateData[`${day}_enabled`] = d.enabled;
        updateData[`${day}_open`] = d.open;
        updateData[`${day}_close`] = d.close;
      }

      const { error: hoursError } = await supabase
        .from('tenants')
        .update(updateData)
        .eq('id', tenant.id);

      if (hoursError) {
        throw new Error(`Working hours could not be saved: ${hoursError.message}`);
      }

      /* ── 2. closures added ─────────────────────────────────────────────── */
      let closuresAdded = 0;
      if (input.addClosures.length > 0) {
        const rows = input.addClosures.map((date) => ({
          start_date: date,
          end_date: date,
          reason: 'Closed — not bookable online',
          /* NULL = every vehicle. See the header. */
          vehicle_id: null,
          tenant_id: tenant.id,
        }));

        const { error, data } = await supabase.from('blocked_dates').insert(rows).select('id');
        if (error) {
          /* The hours DID save. Saying "nothing saved" would be false and would
             invite the operator to redo an edit that is already persisted. */
          throw new Error(
            `Working hours saved, but the closed dates could not be: ${error.message}`,
          );
        }
        closuresAdded = data?.length ?? rows.length;
      }

      /* ── 3. closures removed ───────────────────────────────────────────── */
      let closuresRemoved = 0;
      if (input.removeClosureIds.length > 0) {
        const { error, count } = await supabase
          .from('blocked_dates')
          .delete({ count: 'exact' })
          .in('id', input.removeClosureIds)
          /* Scoped to the tenant as well as the id. Defence in depth: the ids
             come from this screen's own query, but a delete keyed on id alone
             is one stale cache away from touching another tenant's row. */
          .eq('tenant_id', tenant.id);

        if (error) {
          throw new Error(
            `Working hours saved, but a date could not be reopened: ${error.message}`,
          );
        }
        closuresRemoved = count ?? input.removeClosureIds.length;
      }

      return { hoursSaved: true, closuresAdded, closuresRemoved };
    },

    onSuccess: () => {
      /* Re-read from the source of truth rather than trusting the draft: the
         saved state becomes the new baseline, which is what makes Reset mean
         "back to what is in the database". `tenant` too — TenantContext carries
         the timezone, and the rest of the app reads it from there. */
      queryClient.invalidateQueries({ queryKey: ['working-hours', tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ['tenant'] });
      queryClient.invalidateQueries({ queryKey: ['blocked-dates'] });
    },
  });
}
