// Sync Tesla Supercharger charges for active/recent rentals
// Called on-demand (refresh button) or could be scheduled
// Polls Tesla Fleet API for charging history, matches to rentals, creates ledger entries + notifications

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  getValidTeslaToken,
  getTenantTeslaFleetMode,
  getChargingHistory,
} from '../_shared/tesla-fleet-client.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return errorResponse('Unauthorized', 401);

    // Get user's tenant
    const { data: appUser } = await supabase
      .from('app_users')
      .select('tenant_id, role, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (!appUser) return errorResponse('User not found', 403);

    const body = await req.json();
    const tenantId = body.tenantId || appUser.tenant_id;
    const rentalId = body.rentalId; // Optional: sync for a specific rental only
    const vehicleId = body.vehicleId; // Optional: sync for a specific vehicle only

    if (!tenantId) return errorResponse('No tenant ID', 400);

    // Check tenant has Tesla Fleet enabled
    const { data: tenant } = await supabase
      .from('tenants')
      .select('integration_tesla_fleet, tesla_fleet_mode')
      .eq('id', tenantId)
      .single();

    if (!tenant?.integration_tesla_fleet) {
      return errorResponse('Tesla Fleet API not enabled for this tenant', 400);
    }

    // Get valid API token
    const mode = await getTenantTeslaFleetMode(supabase, tenantId);
    const apiToken = await getValidTeslaToken(supabase, tenantId);

    // Find Tesla-enabled vehicles with active or recent rentals
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
    if (vehiclesError) return errorResponse(`Failed to fetch vehicles: ${vehiclesError.message}`, 500);
    if (!vehicles?.length) return jsonResponse({ synced: 0, message: 'No Tesla-enabled vehicles found' });

    let totalNewCharges = 0;
    const results: any[] = [];

    for (const vehicle of vehicles) {
      try {
        // Find rentals for this vehicle (active, or recently completed within last 30 days)
        let rentalQuery = supabase
          .from('rentals')
          .select('id, start_date, end_date, status, customer_id')
          .eq('vehicle_id', vehicle.id)
          .eq('tenant_id', tenantId);

        if (rentalId) {
          rentalQuery = rentalQuery.eq('id', rentalId);
        } else {
          // Active rentals or completed within last 30 days (for late charges)
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          rentalQuery = rentalQuery.or(
            `status.in.(active,confirmed,pending),and(status.eq.completed,end_date.gte.${thirtyDaysAgo})`
          );
        }

        const { data: rentals } = await rentalQuery;
        if (!rentals?.length) continue;

        // Fetch charging history from Tesla
        const earliestStart = rentals.reduce((min, r) => {
          const d = r.start_date;
          return d < min ? d : min;
        }, rentals[0].start_date);

        const charges = await getChargingHistory(
          apiToken,
          mode,
          vehicle.tesla_fleet_vehicle_id!,
          earliestStart,
          new Date().toISOString()
        );

        for (const charge of charges) {
          // Dedup by tesla_charge_id
          const teslaChargeId = charge.sessionId || charge.id || `${vehicle.tesla_fleet_vehicle_id}_${charge.chargeStartDateTime}`;

          const { data: existing } = await supabase
            .from('tesla_supercharger_charges')
            .select('id')
            .eq('tesla_charge_id', teslaChargeId)
            .maybeSingle();

          if (existing) continue; // Already recorded

          // Match charge to rental by date
          const chargeDate = charge.chargeStartDateTime || charge.timestamp;
          const matchedRental = rentals.find(r => {
            const start = new Date(r.start_date).getTime();
            const end = r.end_date ? new Date(r.end_date).getTime() : Date.now();
            const chargeTime = new Date(chargeDate).getTime();
            return chargeTime >= start && chargeTime <= end;
          });

          if (!matchedRental && rentalId) continue; // If filtering by rental, skip unmatched

          const amount = charge.fees?.[0]?.totalDue ?? charge.totalCharged ?? charge.cost ?? 0;
          const location = charge.superchargerName || charge.location || 'Unknown Supercharger';
          const kwhUsed = charge.chargeKwh ?? charge.energyAdded ?? null;

          // Insert charge record
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
            console.error(`[sync-tesla-charges] Insert error for ${teslaChargeId}:`, insertError);
            continue;
          }

          // Create ledger entry for the matched rental
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

            // Link ledger entry to charge record
            if (ledgerEntry) {
              await supabase
                .from('tesla_supercharger_charges')
                .update({ ledger_entry_id: ledgerEntry.id })
                .eq('id', newCharge.id);
            }

            // Create notification for admin
            await supabase
              .from('notifications')
              .insert({
                tenant_id: tenantId,
                user_id: null, // Broadcast to all tenant admins
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
        console.error(`[sync-tesla-charges] Error for vehicle ${vehicle.reg}:`, vehicleErr);
        results.push({
          vehicleId: vehicle.id,
          vehicleReg: vehicle.reg,
          error: vehicleErr.message,
        });
      }
    }

    return jsonResponse({
      synced: totalNewCharges,
      vehiclesChecked: results.length,
      results,
    });
  } catch (err: any) {
    console.error('[sync-tesla-charges] Error:', err);
    return errorResponse(err.message || 'Internal server error', 500);
  }
});
