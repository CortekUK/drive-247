// Core Tesla Supercharger sync engine.
//
// Polls Tesla Fleet API for charging history for one tenant's Tesla-enabled
// vehicles, matches each charge to a rental, and writes:
//   - tesla_supercharger_charges row (status 'pending')
//   - ledger_entries row (category 'Supercharger') for the matched rental
//   - notifications row to alert tenant admins
//
// Called from two places:
//   - sync-tesla-charges        (user-initiated, single tenant, optional rentalId/vehicleId scope)
//   - sync-tesla-charges-cron   (pg_cron, loops over every Tesla-enabled tenant)

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { getValidTeslaToken, getChargingHistory } from './tesla-fleet-client.ts';

export interface SyncOptions {
  rentalId?: string;
  vehicleId?: string;
}

export interface SyncResult {
  synced: number;
  vehiclesChecked: number;
  results: Array<{ vehicleId: string; vehicleReg: string; chargesChecked?: number; error?: string }>;
  message?: string;
}

export async function syncTeslaChargesForTenant(
  supabase: SupabaseClient,
  tenantId: string,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const { rentalId, vehicleId } = opts;

  const apiToken = await getValidTeslaToken(supabase, tenantId);

  let vehicleQuery = supabase
    .from('vehicles')
    .select('id, reg, tesla_fleet_vehicle_id, vin')
    .eq('tenant_id', tenantId)
    .eq('tesla_fleet_enabled', true)
    .not('tesla_fleet_vehicle_id', 'is', null);

  if (vehicleId) {
    vehicleQuery = vehicleQuery.eq('id', vehicleId);
  }

  const { data: vehicles, error: vehiclesError } = await vehicleQuery;
  if (vehiclesError) throw new Error(`Failed to fetch vehicles: ${vehiclesError.message}`);
  if (!vehicles?.length) return { synced: 0, vehiclesChecked: 0, results: [], message: 'No Tesla-enabled vehicles found' };

  let totalNewCharges = 0;
  const results: SyncResult['results'] = [];

  for (const vehicle of vehicles) {
    try {
      let rentalQuery = supabase
        .from('rentals')
        .select('id, start_date, end_date, status, customer_id')
        .eq('vehicle_id', vehicle.id)
        .eq('tenant_id', tenantId);

      if (rentalId) {
        rentalQuery = rentalQuery.eq('id', rentalId);
      } else {
        // Active/upcoming rentals, plus rentals closed within last 30 days
        // (Tesla often posts Supercharger charges days after the session).
        // Cancelled rentals are intentionally excluded.
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        rentalQuery = rentalQuery.or(
          `status.in.(Pending,Active),and(status.eq.Closed,end_date.gte.${thirtyDaysAgo})`,
        );
      }

      const { data: rentals } = await rentalQuery;
      if (!rentals?.length) continue;

      const earliestStart = rentals.reduce((min, r) => {
        const d = r.start_date;
        return d < min ? d : min;
      }, rentals[0].start_date);

      const charges = await getChargingHistory(
        apiToken,
        vehicle.tesla_fleet_vehicle_id!,
        earliestStart,
        new Date().toISOString(),
      );

      for (const charge of charges) {
        const teslaChargeId = charge.sessionId || charge.id || `${vehicle.tesla_fleet_vehicle_id}_${charge.chargeStartDateTime}`;

        const { data: existing } = await supabase
          .from('tesla_supercharger_charges')
          .select('id')
          .eq('tesla_charge_id', teslaChargeId)
          .maybeSingle();
        if (existing) continue;

        const chargeDate = charge.chargeStartDateTime || charge.timestamp;
        const matchedRental = rentals.find((r) => {
          const start = new Date(r.start_date).getTime();
          const end = r.end_date ? new Date(r.end_date).getTime() : Date.now();
          const chargeTime = new Date(chargeDate).getTime();
          return chargeTime >= start && chargeTime <= end;
        });

        if (!matchedRental && rentalId) continue;

        const amount = charge.fees?.[0]?.totalDue ?? charge.totalCharged ?? charge.cost ?? 0;
        const location = charge.superchargerName || charge.location || 'Unknown Supercharger';
        const kwhUsed = charge.chargeKwh ?? charge.energyAdded ?? null;

        const { data: newCharge, error: insertError } = await supabase
          .from('tesla_supercharger_charges')
          .insert({
            tenant_id: tenantId,
            vehicle_id: vehicle.id,
            rental_id: matchedRental?.id || null,
            charge_date: chargeDate,
            location,
            kwh_used: kwhUsed,
            amount,
            currency: charge.currencyCode || 'USD',
            tesla_charge_id: teslaChargeId,
            status: 'pending',
          })
          .select()
          .single();

        if (insertError) {
          console.error(`[tesla-sync] Insert error for ${teslaChargeId}:`, insertError);
          continue;
        }

        if (matchedRental) {
          const { data: ledgerEntry } = await supabase
            .from('ledger_entries')
            .insert({
              tenant_id: tenantId,
              rental_id: matchedRental.id,
              entry_type: 'charge',
              category: 'Supercharger',
              amount,
              remaining_amount: amount,
              entry_date: chargeDate,
              due_date: chargeDate,
              reference: `Supercharger: ${location}`,
            })
            .select()
            .single();

          if (ledgerEntry) {
            await supabase
              .from('tesla_supercharger_charges')
              .update({ ledger_entry_id: ledgerEntry.id })
              .eq('id', newCharge.id);

            // Finance Sync — enqueue charging_cost for the accounting layer.
            // Tesla supercharger costs flow through as invoice lines so the
            // customer's bill matches what they actually consumed. Non-fatal.
            try {
              const { data: tenantRow } = await supabase
                .from('tenants')
                .select('currency_code')
                .eq('id', tenantId)
                .maybeSingle();
              await supabase.rpc('enqueue_financial_event', {
                p_tenant_id: tenantId,
                p_event_type: 'charging_cost',
                p_amount_cents: Math.round(Number(amount) * 100),
                p_currency: (tenantRow?.currency_code as string) ?? 'USD',
                p_rental_id: matchedRental.id,
                p_customer_id: matchedRental.customer_id ?? null,
                p_vehicle_id: vehicle.id ?? null,
                p_source_table: 'ledger_entries',
                p_source_id: ledgerEntry.id,
                p_description: `Supercharger: ${location}`,
                p_metadata: { tesla_charge_id: teslaChargeId, location, charge_date: chargeDate },
              });
            } catch (err) {
              console.error('[finance-sync] enqueue charging_cost failed (non-fatal):', err);
            }
          }

          await supabase
            .from('notifications')
            .insert({
              tenant_id: tenantId,
              user_id: null,
              title: 'New Supercharger Charge',
              message: `${vehicle.reg} charged $${Number(amount).toFixed(2)} at ${location}`,
              type: 'general',
              is_read: false,
              link: `/rentals/${matchedRental.id}`,
              metadata: {
                rental_id: matchedRental.id,
                vehicle_id: vehicle.id,
                charge_id: newCharge.id,
                amount,
                location,
                vehicle_reg: vehicle.reg,
              },
            });
        }

        totalNewCharges++;
      }

      results.push({
        vehicleId: vehicle.id,
        vehicleReg: vehicle.reg,
        chargesChecked: charges.length,
      });
    } catch (vehicleErr: any) {
      console.error(`[tesla-sync] Error for vehicle ${vehicle.reg}:`, vehicleErr);
      results.push({
        vehicleId: vehicle.id,
        vehicleReg: vehicle.reg,
        error: vehicleErr.message,
      });
    }
  }

  return { synced: totalNewCharges, vehiclesChecked: results.length, results };
}
