// INSHUR / ABI Period Z — end cover on a rental that has already started.
//
// End is servicing, not selling, so it is deliberately NOT gated on
// getInshurUsability: a tenant who has just switched INSHUR off still has live
// policies accruing on their ABI invoice, and refusing to end them would strand
// the cover with no way out of the portal.
//
// ABI keys End on the VIN, not on the rental period id, and answers a failed
// End with a bare `{}`. "Already ended" and "genuinely failed" therefore look
// identical, which is why a failure is followed by a Get Rentals probe before
// anything is written.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { notifyOperatorsInApp } from '../_shared/notify-inapp.ts';
import { authorizeTenantAccess } from '../_shared/tenant-auth.ts';
import {
  createServiceClient,
  endRentalPeriod,
  getInshurConfig,
  InshurError,
  listRentals,
  type InshurConfig,
} from '../_shared/inshur-client.ts';

const LOG = '[INSHUR End]';

function errorCodeOf(err: unknown): string {
  return err instanceof InshurError ? err.code : 'INSHUR_UNEXPECTED';
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Is this VIN still on the policy at ABI?
 *
 * The shape of the Get Rentals entries is not pinned down — the field is `VIN`
 * in the docs we have, but the read response was never fully specified — so the
 * whole entry is serialised and searched. A false "still present" only costs a
 * retry; a false "absent" would mark cover ended while it keeps billing.
 */
async function vinStillOnPolicy(config: InshurConfig, vin: string): Promise<boolean | null> {
  try {
    const rentals = await listRentals(config);
    return rentals.some((entry) => JSON.stringify(entry ?? '').toUpperCase().includes(vin.toUpperCase()));
  } catch (err) {
    console.error(`${LOG} Get Rentals probe failed:`, errorMessageOf(err));
    return null;
  }
}

/** Alerting must never fail — or mask — the operation it reports on. */
async function emitEndFailureAlert(
  supabase: any,
  params: {
    tenantId: string;
    /** Null once the rental has been hard-deleted; the cover can still be live. */
    rentalId: string | null;
    rentalNumber: string | null;
    vin: string;
    errorCode: string;
    errorMessage: string;
  }
): Promise<void> {
  const label = params.rentalNumber ? `rental ${params.rentalNumber}` : 'a rental';
  const title = 'INSHUR cover could not be ended';
  const message = `Cover for ${label} (VIN ${params.vin}) is still running at INSHUR and will keep billing. ${params.errorMessage}`;
  const today = new Date().toISOString().slice(0, 10);

  try {
    await notifyOperatorsInApp({
      tenantId: params.tenantId,
      type: 'reminder_warning',
      title,
      message,
      link: params.rentalId ? `/rentals/${params.rentalId}` : '/insurances',
      metadata: { rule_code: 'INSHUR_END_FAILED', rental_id: params.rentalId, error_code: params.errorCode },
      // One bell per rental per cause per day; retrying is one problem, not many.
      dedupeKey: `inshur-end-failed-${params.rentalId ?? params.vin}-${params.errorCode}-${today}`,
    });
  } catch (err) {
    console.error(`${LOG} in-app alert failed (ignored):`, err);
  }

  // reminders.object_id is a NOT NULL uuid, so an orphaned coverage gets the
  // bell but no reminder row rather than a failed insert.
  if (!params.rentalId) return;

  try {
    // ux_reminders_identity is UNIQUE(rule_code, object_type, object_id, due_on,
    // remind_on): a second failure on the same day would 23505 on insert.
    const { data: existing } = await supabase
      .from('reminders')
      .select('context')
      .eq('rule_code', 'INSHUR_END_FAILED')
      .eq('object_type', 'Rental')
      .eq('object_id', params.rentalId)
      .eq('due_on', today)
      .eq('remind_on', today)
      .maybeSingle();

    const { error } = await supabase.from('reminders').upsert(
      {
        rule_code: 'INSHUR_END_FAILED',
        object_type: 'Rental',
        object_id: params.rentalId,
        tenant_id: params.tenantId,
        title,
        message,
        due_on: today,
        remind_on: today,
        severity: 'warning',
        status: 'pending',
        context: {
          occurrences: Number(existing?.context?.occurrences ?? 0) + 1,
          error_code: params.errorCode,
          error_message: params.errorMessage,
          vin: params.vin,
          rental_number: params.rentalNumber,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'rule_code,object_type,object_id,due_on,remind_on' }
    );
    if (error) console.error(`${LOG} reminder upsert failed (ignored):`, error.message);
  } catch (err) {
    console.error(`${LOG} reminder emission failed (ignored):`, err);
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization header', 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse('Unauthorized', 401);

    const supabase = createServiceClient();

    // Both spellings are accepted: the portal hooks send camelCase, server-side
    // callers send snake_case. `coverage_id` targets one specific row, which is
    // what an operator acting on a rental that has been re-covered needs.
    const body = await req.json().catch(() => ({}));
    const tenantId: string | undefined = body?.tenant_id ?? body?.tenantId;
    const rentalId: string | undefined = body?.rental_id ?? body?.rentalId;
    const coverageId: string | undefined = body?.coverage_id ?? body?.coverageId;

    if (!tenantId) return errorResponse('tenant_id is required', 400);
    if (!rentalId && !coverageId) return errorResponse('rental_id (or coverage_id) is required', 400);

    const access = await authorizeTenantAccess(supabase, user.id, tenantId);
    if (!access.ok) return errorResponse(access.message, access.status);

    let rowQuery = supabase
      .from('inshur_rental_coverage')
      .select('*')
      .eq('tenant_id', tenantId);
    rowQuery = coverageId ? rowQuery.eq('id', coverageId) : rowQuery.eq('rental_id', rentalId);

    const { data: rows, error: rowsError } = await rowQuery.order('created_at', { ascending: false });

    if (rowsError) {
      console.error(`${LOG} coverage lookup failed:`, rowsError.message);
      return errorResponse('Could not load INSHUR cover for this rental.', 500);
    }

    const coverage = (rows || []).find((r: any) => r.status === 'pending' || r.status === 'active');

    if (!coverage) {
      const settled = (rows || []).find((r: any) => r.status === 'ended' || r.status === 'cancelled');
      if (settled) {
        return jsonResponse({
          ok: true,
          already_ended: true,
          status: settled.status,
          mode: settled.source_mode,
          simulated: settled.source_mode !== 'live',
          coverage_id: settled?.id ?? null,
          coverage: settled,
          message: settled.status === 'ended' ? 'This cover has already ended.' : 'This cover was cancelled before it started.',
        });
      }
      return jsonResponse({ error: 'This rental has no INSHUR cover to end.', error_code: 'INSHUR_NO_COVERAGE' }, 404);
    }

    // `inshur_rental_coverage.rental_id` is ON DELETE SET NULL, so a coverage
    // targeted by id may outlive its rental — and that is exactly the row an
    // operator most needs to be able to end, since it is still billing.
    const resolvedRentalId: string | null = coverage.rental_id ?? rentalId ?? null;

    const { data: rental } = resolvedRentalId
      ? await supabase.from('rentals').select('rental_number').eq('id', resolvedRentalId).maybeSingle()
      : { data: null };
    const rentalNumber: string | null = rental?.rental_number ?? null;

    let config: InshurConfig;
    try {
      config = await getInshurConfig(supabase, tenantId);
    } catch (err) {
      return jsonResponse({ error: errorMessageOf(err), error_code: errorCodeOf(err) }, 400);
    }

    const nowIso = new Date().toISOString();

    // A simulated policy has no counterpart at ABI, so there is nothing to call
    // even if the tenant has since moved to real credentials. Close it locally.
    if (coverage.source_mode === 'mock' && config.mode !== 'mock') {
      const { data: closed } = await supabase
        .from('inshur_rental_coverage')
        .update({ status: 'ended', ended_at: nowIso, updated_at: nowIso })
        .eq('id', coverage.id)
        .select('*')
        .single();
      return jsonResponse({
        ok: true,
        status: 'ended',
        mode: coverage.source_mode,
        simulated: true,
        coverage_id: (closed ?? coverage)?.id ?? null,
        coverage: closed ?? coverage,
        message: 'This was simulated cover, so nothing needed ending at INSHUR. The record has been closed.',
      });
    }

    // The reverse mismatch is dangerous: ending a real policy while the tenant
    // is in simulated mode would mark it ended here while it keeps running —
    // and keeps billing — at ABI.
    if (coverage.source_mode !== config.mode) {
      return jsonResponse(
        {
          error:
            `This cover was created in ${coverage.source_mode} mode but INSHUR is currently set to ${config.mode} mode. ` +
            `Switch INSHUR back to ${coverage.source_mode} mode in Settings → Integrations to end it, or end it at portal.abiweb.com.`,
          error_code: 'INSHUR_MODE_MISMATCH',
          coverage_id: coverage?.id ?? null,
          coverage,
        },
        409
      );
    }

    try {
      await endRentalPeriod(config, coverage.vin);
    } catch (err) {
      const stillOnPolicy = await vinStillOnPolicy(config, coverage.vin);

      if (stillOnPolicy === false) {
        // ABI rejected the End because the period is already gone. That is the
        // outcome we wanted, so it counts as success rather than a retry that
        // would fail identically forever.
        console.log(`${LOG} End rejected but VIN ${coverage.vin} is absent from the policy — treating as ended`);
      } else {
        const message = `INSHUR would not end this cover. ${errorMessageOf(err)}`;
        const { data: row } = await supabase
          .from('inshur_rental_coverage')
          .update({
            // Status is deliberately left as-is: the policy is still live at
            // ABI, and recording it as ended would hide a cover that is still
            // being billed.
            error_code: errorCodeOf(err),
            error_message: message,
            attempt_count: (coverage.attempt_count ?? 0) + 1,
            last_attempt_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', coverage.id)
          .select('*')
          .single();

        await emitEndFailureAlert(supabase, {
          tenantId,
          rentalId: resolvedRentalId,
          rentalNumber,
          vin: coverage.vin,
          errorCode: errorCodeOf(err),
          errorMessage: message,
        });

        console.error(`${LOG} could not end coverage ${coverage.id} (VIN ${coverage.vin}):`, errorMessageOf(err));
        return jsonResponse(
          {
            ok: false,
            error: message,
            error_code: errorCodeOf(err),
            status: coverage.status,
            probe_inconclusive: stillOnPolicy === null,
            mode: config.mode,
            simulated: config.mode !== 'live',
            coverage_id: (row ?? coverage)?.id ?? null,
            coverage: row ?? coverage,
          },
          err instanceof InshurError ? err.status : 502
        );
      }
    }

    const { data: ended, error: updateError } = await supabase
      .from('inshur_rental_coverage')
      .update({
        status: 'ended',
        ended_at: nowIso,
        error_code: null,
        error_message: null,
        last_attempt_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', coverage.id)
      .select('*')
      .single();

    if (updateError) {
      console.error(`${LOG} cover ended at ABI but the row update failed:`, updateError.message);
      return jsonResponse(
        {
          ok: false,
          error: 'Cover WAS ended at INSHUR, but we could not update our record. It may still show as active here until the next reconciliation.',
          error_code: 'INSHUR_RECORD_WRITE_FAILED',
          status: coverage.status,
          mode: config.mode,
          simulated: config.mode !== 'live',
          coverage_id: coverage?.id ?? null,
          coverage,
        },
        500
      );
    }

    console.log(`${LOG} coverage ${coverage.id} ended (VIN ${coverage.vin}, mode ${config.mode})`);

    return jsonResponse({
      ok: true,
      status: 'ended',
      mode: config.mode,
      simulated: config.mode !== 'live',
      coverage_id: ended?.id ?? null,
      coverage: ended,
      message:
        config.mode === 'live'
          ? 'INSHUR cover has been ended. The renter is no longer insured through INSHUR from now on.'
          : 'SIMULATED cover ended. No real policy was involved.',
    });
  } catch (error) {
    console.error(`${LOG} unhandled error:`, error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to end INSHUR cover', 500);
  }
});
