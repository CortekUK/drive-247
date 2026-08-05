// INSHUR / ABI Period Z — monthly vendor cost sync.
//
// `GET /customer/{CN}/billing/vins/` is the only place ABI tells us what Period
// Z actually cost. It bills PER VIN OVER A DATE RANGE, not per rental, and no
// read endpoint echoes back our EXTERNALREF — so exact per-rental attribution
// is impossible through this API. We therefore store the vendor's own numbers
// verbatim, attribute them by VIN, and report what does not line up rather than
// pretending we can reconcile to the cent.
//
// WHERE THE ROWS GO. The architecture note proposed a dedicated
// `inshur_billing_lines` table; the schema that was actually applied does not
// contain one, and inventing a table from an edge function is not an option.
// `vehicle_expenses` is the repo's existing per-vehicle cost ledger — it already
// has `vendor`, `reference`, `notes` and a P&L trigger — so the vendor cost
// lands there, keyed by a deterministic reference so re-running the month is a
// no-op. This also closes a real gap: without it the operator's entire INSHUR
// spend is invisible in P&L while the rental revenue is counted, which
// overstates per-vehicle margin by exactly the insurance cost.
//
// QUERY-PARAM CASING IS NOT KNOWN. The API reference says `?STARTDATE=&ENDDATE=`
// and our own 2026-05-23 discovery doc says `?startDate=&endDate=`. Getting it
// wrong most likely means the filters are ignored, which yields either the whole
// history or nothing — silently wrong money either way. Rather than guess, this
// function tries the documented default, falls back to the alternate, and
// records the winner in `tenants.inshur_endpoint_overrides` so the answer is a
// Settings value from then on and never a redeploy.
//
// AUTH: pg_cron with `Authorization: Bearer <service_role_key>`, matching the
// repo's existing cron template. No bespoke cron-secret header — the template
// does not send one, and because `net.http_post` is asynchronous a 401 would
// never surface in `cron.job_run_details`.

import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { notifyOperatorsInApp } from '../_shared/notify-inapp.ts';
import {
  createServiceClient,
  getCostByVin,
  getInshurApiUrl,
  getInshurConfig,
  InshurError,
  InshurNotConfiguredError,
  TwoFactorRequiredError,
  type InshurBillingRow,
  type InshurConfig,
  type InshurMode,
} from '../_shared/inshur-client.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RUN_MS = 55_000;

/** Neither casing is a fact yet, so both are first-class candidates. */
type ParamCasing = 'upper' | 'lower';
const DOCUMENTED_CASING: ParamCasing = 'upper';

interface TenantRow {
  id: string;
  name: string | null;
  inshur_mode: string | null;
  inshur_endpoint_overrides: Record<string, unknown> | null;
}

interface TenantSummary {
  tenantId: string;
  mode: InshurMode;
  periodStart: string;
  periodEnd: string;
  casingUsed: ParamCasing | null;
  casingRecorded: boolean;
  vendorRows: number;
  vendorTotal: number;
  expensesWritten: number;
  expensesUpdated: number;
  unmatchedVins: string[];
  billedNotCovered: string[];
  coveredNotBilled: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isServiceRoleCall(req: Request): boolean {
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (!serviceKey) return false;
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  return constantTimeEquals(token, serviceKey);
}

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/** Previous whole calendar month, in UTC. Runs on the 3rd, so the vendor has
 *  had time to close the month before we ask for it. */
function previousCalendarMonth(now: Date): { startDate: string; endDate: string } {
  const firstOfThis = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const lastOfPrev = new Date(firstOfThis - 86_400_000);
  const firstOfPrev = new Date(Date.UTC(lastOfPrev.getUTCFullYear(), lastOfPrev.getUTCMonth(), 1));
  return {
    startDate: firstOfPrev.toISOString().slice(0, 10),
    endDate: lastOfPrev.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Transport for the ALTERNATE casing
//
// The client's getCostByVin hardcodes the documented `?STARTDATE=&ENDDATE=`
// path, which is correct — it is the single source of truth for the documented
// surface. The alternate spelling cannot be expressed through it, and the whole
// point of the override is that resolving this must not require editing and
// redeploying that file. Hence one narrow local request here, deliberately
// limited to this single uncertain path.
// ---------------------------------------------------------------------------

async function fetchCostByVinLowercase(
  config: InshurConfig,
  startDate: string,
  endDate: string
): Promise<InshurBillingRow[]> {
  if (config.mode === 'mock') return [];

  const host = getInshurApiUrl(config.mode as Exclude<InshurMode, 'mock'>);
  const url =
    `${host}/customer/${encodeURIComponent(config.customerNumber)}/billing/vins/` +
    `?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${btoa(`${config.username}:${config.password}`)}`,
  };
  if (config.twoFactorToken) headers['Token'] = config.twoFactorToken;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    console.log(`[InshurSyncBilling] GET /customer/{CN}/billing/vins/ [lowercase params] (mode: ${config.mode})`);
    response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new InshurError('INSHUR_TIMEOUT', `INSHUR did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`, 504);
    }
    throw new InshurError('INSHUR_NETWORK', `Could not reach INSHUR: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    const text = await response.text().catch(() => '');
    if (/2\s*factor|two\s*factor|token/i.test(text)) throw new TwoFactorRequiredError();
    throw new InshurError('INSHUR_AUTH_FAILED', 'INSHUR rejected these credentials.', 401);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new InshurError('INSHUR_BAD_RESPONSE', `INSHUR returned a non-JSON response (HTTP ${response.status}).`, 502);
  }

  const env = payload as { STATUS?: string; RESULT?: unknown; ERROR?: string };
  if (!response.ok || env?.STATUS !== 'success') {
    throw new InshurError(
      'INSHUR_REQUEST_FAILED',
      env?.ERROR || `INSHUR rejected the request (HTTP ${response.status}).`,
      response.status || 400
    );
  }

  const result = Array.isArray(env.RESULT) ? (env.RESULT as Array<Record<string, unknown>>) : [];
  return result.map((r) => ({
    vin: String(r.VIN ?? ''),
    found: Boolean(r.FOUND),
    premium: r.PREMIUM == null ? null : Number(r.PREMIUM),
    // ABI's key is literally "SOFTWARE FEE", with a space.
    softwareFee: r['SOFTWARE FEE'] == null ? null : Number(r['SOFTWARE FEE']),
    totalCost: r.TOTALCOST == null ? null : Number(r.TOTALCOST),
  }));
}

function normalizeCasing(raw: unknown): ParamCasing | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v === 'upper' || v === 'STARTDATE' || v === 'UPPER') return 'upper';
  if (v === 'lower' || v === 'startDate' || v === 'LOWER') return 'lower';
  return null;
}

interface BillingFetch {
  rows: InshurBillingRow[];
  casing: ParamCasing | null;
  inconclusive: boolean;
  errors: string[];
}

/**
 * Try each casing in turn and stop at the first one that returns rows.
 *
 * "Returned rows" is the only signal available: the response carries no echo of
 * the filter, so a casing the server ignored is indistinguishable from one it
 * honoured whenever both would produce the same set. An empty month therefore
 * resolves nothing and is reported as inconclusive rather than recorded as an
 * answer — recording it would pin the wrong spelling on the strength of no
 * evidence at all.
 */
async function fetchBilling(
  config: InshurConfig,
  startDate: string,
  endDate: string,
  order: ParamCasing[]
): Promise<BillingFetch> {
  const errors: string[] = [];
  for (const casing of order) {
    try {
      const rows =
        casing === 'upper'
          ? await getCostByVin(config, startDate, endDate)
          : await fetchCostByVinLowercase(config, startDate, endDate);
      if (rows.length > 0) return { rows, casing, inconclusive: false, errors };
    } catch (err) {
      // A 2FA failure is fatal for every casing — stop rather than burning the
      // second attempt on the same rejection.
      if (err instanceof TwoFactorRequiredError) throw err;
      errors.push(`${casing}: ${(err as Error)?.message ?? 'failed'}`);
    }
  }
  return { rows: [], casing: null, inconclusive: true, errors };
}

// ---------------------------------------------------------------------------
// Alerting — contractually incapable of throwing, for the same reason as in
// inshur-reconcile: a failed alert must never take down the sync it reports on.
// ---------------------------------------------------------------------------

interface AlertParams {
  tenantId: string;
  ruleCode: string;
  objectId: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  context: Record<string, unknown>;
  simulated: boolean;
}

async function raiseAlert(supabase: SupabaseClient, params: AlertParams): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const title = params.simulated ? `[SIMULATED] ${params.title}` : params.title;

    // ux_reminders_identity is UNIQUE on (rule_code, object_type, object_id,
    // due_on, remind_on): a second insert on the same day throws 23505.
    const { data: existing } = await supabase
      .from('reminders')
      .select('id, context')
      .eq('rule_code', params.ruleCode)
      .eq('object_type', 'Integration')
      .eq('object_id', params.objectId)
      .eq('due_on', today)
      .eq('remind_on', today)
      .maybeSingle();

    const prior = (existing?.context ?? {}) as Record<string, unknown>;
    const occurrences = (typeof prior.occurrences === 'number' ? prior.occurrences : 0) + 1;

    const { error } = await supabase.from('reminders').upsert(
      {
        rule_code: params.ruleCode,
        object_type: 'Integration',
        object_id: params.objectId,
        title,
        message: params.message,
        severity: params.severity,
        due_on: today,
        remind_on: today,
        status: 'pending',
        last_sent_at: new Date().toISOString(),
        context: { ...params.context, occurrences, simulated: params.simulated, source: 'inshur-sync-billing' },
        tenant_id: params.tenantId,
      },
      { onConflict: 'rule_code,object_type,object_id,due_on,remind_on' }
    );

    if (error) {
      console.error(`[InshurSyncBilling] Reminder upsert failed (${params.ruleCode}):`, error.message);
    }

    if (occurrences === 1) {
      await notifyOperatorsInApp({
        tenantId: params.tenantId,
        type: 'inshur_billing_alert',
        title,
        message: params.message,
        link: '/settings?tab=integrations',
        metadata: { ...params.context, rule_code: params.ruleCode, simulated: params.simulated },
        dedupeKey: `${params.ruleCode}:${params.objectId}:${today}`,
      });
    }
  } catch (err) {
    console.error('[InshurSyncBilling] Alerting failed (swallowed):', (err as Error)?.message ?? err);
  }
}

// ---------------------------------------------------------------------------
// Per-tenant sync
// ---------------------------------------------------------------------------

async function syncTenant(
  supabase: SupabaseClient,
  tenant: TenantRow,
  startDate: string,
  endDate: string,
  dryRun: boolean
): Promise<TenantSummary> {
  const summary: TenantSummary = {
    tenantId: tenant.id,
    mode: 'mock',
    periodStart: startDate,
    periodEnd: endDate,
    casingUsed: null,
    casingRecorded: false,
    vendorRows: 0,
    vendorTotal: 0,
    expensesWritten: 0,
    expensesUpdated: 0,
    unmatchedVins: [],
    billedNotCovered: [],
    coveredNotBilled: [],
    errors: [],
  };

  let config: InshurConfig;
  try {
    config = await getInshurConfig(supabase, tenant.id);
  } catch (err) {
    summary.errors.push((err as Error)?.message ?? 'Unknown configuration error');
    if (err instanceof InshurNotConfiguredError) {
      await raiseAlert(supabase, {
        tenantId: tenant.id,
        ruleCode: 'INSHUR_CONFIG_INVALID',
        objectId: tenant.id,
        title: 'INSHUR insurance is not fully configured',
        message: `${(err as Error).message} Vendor costs cannot be synced until this is fixed.`,
        severity: 'warning',
        context: { tenant_id: tenant.id },
        simulated: false,
      });
    }
    return summary;
  }

  summary.mode = config.mode;
  const simulated = config.mode !== 'live';

  const overrides = (tenant.inshur_endpoint_overrides ?? {}) as Record<string, unknown>;
  const pinned = normalizeCasing(overrides.billing_params);
  const pinnedManually = pinned !== null && overrides.billing_params_source === 'manual';

  // A manual pin is an operator's explicit statement about the vendor's API and
  // outranks anything we could infer; probing past it would silently overwrite
  // a deliberate fix.
  const order: ParamCasing[] = pinnedManually
    ? [pinned!]
    : pinned
      ? [pinned, pinned === 'upper' ? 'lower' : 'upper']
      : [DOCUMENTED_CASING, DOCUMENTED_CASING === 'upper' ? 'lower' : 'upper'];

  let fetched: BillingFetch;
  try {
    fetched = await fetchBilling(config, startDate, endDate, order);
  } catch (err) {
    summary.errors.push((err as Error)?.message ?? 'Unknown error');
    if (err instanceof TwoFactorRequiredError) {
      await raiseAlert(supabase, {
        tenantId: tenant.id,
        ruleCode: 'INSHUR_TOKEN_EXPIRED',
        objectId: tenant.id,
        title: 'INSHUR needs a new two-factor code',
        message:
          'INSHUR rejected the stored two-factor code, so this month\'s insurance costs could not be retrieved. ' +
          'Re-authenticate in Settings, or ask INSHUR for a service login with two-factor disabled.',
        severity: 'critical',
        context: { tenant_id: tenant.id, mode: config.mode },
        simulated,
      });
    }
    return summary;
  }

  summary.errors.push(...fetched.errors);
  summary.casingUsed = fetched.casing;
  summary.vendorRows = fetched.rows.length;

  if (fetched.inconclusive) {
    console.log(
      `[InshurSyncBilling] Tenant ${tenant.id}: no billing rows for ${startDate}..${endDate}` +
        (fetched.errors.length ? ` (errors: ${fetched.errors.join('; ')})` : '')
    );
  }

  // Persist the spelling that actually produced data, so the next run — and
  // every future run — skips the probe.
  if (!dryRun && fetched.casing && fetched.casing !== pinned && !pinnedManually) {
    const { error } = await supabase
      .from('tenants')
      .update({
        inshur_endpoint_overrides: {
          ...overrides,
          billing_params: fetched.casing,
          billing_params_source: 'probed',
          billing_params_resolved_at: new Date().toISOString(),
        },
      })
      .eq('id', tenant.id);
    if (error) summary.errors.push(`override write: ${error.message}`);
    else summary.casingRecorded = true;
  }

  const billable = fetched.rows.filter((r) => r.found && r.totalCost != null && Number(r.totalCost) > 0);
  summary.vendorTotal = Math.round(billable.reduce((sum, r) => sum + Number(r.totalCost), 0) * 100) / 100;

  // -- resolve VINs to vehicles ---------------------------------------------
  const vendorVins = [...new Set(fetched.rows.map((r) => (r.vin || '').trim().toUpperCase()).filter(Boolean))];
  const vehicleByVin = new Map<string, string>();
  if (vendorVins.length) {
    const { data: vehicles, error: vehErr } = await supabase
      .from('vehicles')
      .select('id, vin')
      .eq('tenant_id', tenant.id)
      .not('vin', 'is', null);
    if (vehErr) summary.errors.push(`vehicle read: ${vehErr.message}`);
    for (const v of ((vehicles ?? []) as Array<{ id: string; vin: string | null }>)) {
      const key = (v.vin ?? '').trim().toUpperCase();
      if (key) vehicleByVin.set(key, v.id);
    }
  }

  // -- store the vendor's numbers -------------------------------------------
  for (const row of billable) {
    const vin = (row.vin || '').trim().toUpperCase();
    const vehicleId = vehicleByVin.get(vin);
    if (!vehicleId) {
      // A VIN we are billed for but do not own. Never fabricate a vehicle to
      // hang the cost on — report it and let the operator explain it.
      summary.unmatchedVins.push(vin);
      continue;
    }

    const reference = `inshur-${startDate}-${endDate}-${vin}`;
    const amount = Math.round(Number(row.totalCost) * 100) / 100;
    const parts = [
      `INSHUR Period Z cover ${startDate} to ${endDate}.`,
      row.premium == null ? null : `Premium ${row.premium}.`,
      row.softwareFee == null ? null : `Software fee ${row.softwareFee}.`,
      `Total ${amount}.`,
      config.mode === 'live' ? null : `Retrieved in ${config.mode} mode — not a real invoice.`,
    ].filter(Boolean);
    const notes = parts.join(' ');

    if (dryRun) continue;

    const { data: existing, error: lookupErr } = await supabase
      .from('vehicle_expenses')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('reference', reference)
      .maybeSingle();

    if (lookupErr) {
      summary.errors.push(`expense lookup ${vin}: ${lookupErr.message}`);
      continue;
    }

    if (existing) {
      const { error } = await supabase
        .from('vehicle_expenses')
        .update({
          amount,
          notes,
          vendor: 'INSHUR',
          vehicle_id: vehicleId,
          expense_date: endDate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', (existing as { id: string }).id);
      if (error) summary.errors.push(`expense update ${vin}: ${error.message}`);
      else summary.expensesUpdated++;
    } else {
      const { error } = await supabase.from('vehicle_expenses').insert({
        tenant_id: tenant.id,
        vehicle_id: vehicleId,
        // `expense_category` has no Insurance member; the vendor column carries
        // the real classification and the P&L trigger maps Other to Expenses.
        category: 'Other',
        vendor: 'INSHUR',
        amount,
        expense_date: endDate,
        notes,
        reference,
      });
      if (error) summary.errors.push(`expense insert ${vin}: ${error.message}`);
      else summary.expensesWritten++;
    }
  }

  // -- reconcile the vendor's view against ours ------------------------------
  const { data: coverageData, error: covErr } = await supabase
    .from('inshur_rental_coverage')
    .select('vin, status')
    .eq('tenant_id', tenant.id)
    .in('status', ['active', 'ended'])
    // start_time_sent / end_time_sent are "YYYY-MM-DD HH:mm:ss" strings, so
    // lexicographic comparison is chronological. Overlap, not containment: a
    // rental that straddles the month boundary is billed in this period too.
    .lte('start_time_sent', `${endDate} 23:59:59`)
    .gte('end_time_sent', `${startDate} 00:00:00`);

  if (covErr) {
    summary.errors.push(`coverage read: ${covErr.message}`);
  } else {
    const coveredVins = new Set(
      ((coverageData ?? []) as Array<{ vin: string }>).map((c) => (c.vin ?? '').trim().toUpperCase()).filter(Boolean)
    );
    const billedVins = new Set(billable.map((r) => (r.vin || '').trim().toUpperCase()));

    summary.billedNotCovered = [...billedVins].filter((v) => !coveredVins.has(v));
    summary.coveredNotBilled = [...coveredVins].filter((v) => !billedVins.has(v));
  }

  const varianceCount = summary.billedNotCovered.length + summary.coveredNotBilled.length + summary.unmatchedVins.length;
  if (varianceCount > 0 && !dryRun) {
    const preview = (vins: string[]) => vins.slice(0, 5).join(', ') + (vins.length > 5 ? `, +${vins.length - 5} more` : '');
    const lines = [
      `INSHUR billed ${summary.vendorRows} vehicle${summary.vendorRows === 1 ? '' : 's'} for ${startDate} to ${endDate}, totalling ${summary.vendorTotal}.`,
      summary.billedNotCovered.length
        ? `Billed with no cover recorded here: ${preview(summary.billedNotCovered)}.`
        : null,
      summary.coveredNotBilled.length
        ? `Cover recorded here with no charge from INSHUR: ${preview(summary.coveredNotBilled)}.`
        : null,
      summary.unmatchedVins.length
        ? `Billed for VINs not in your fleet: ${preview(summary.unmatchedVins)}.`
        : null,
    ].filter(Boolean);

    await raiseAlert(supabase, {
      tenantId: tenant.id,
      ruleCode: 'INSHUR_BILLING_VARIANCE',
      objectId: tenant.id,
      title: 'INSHUR invoice does not match your cover records',
      message: lines.join(' '),
      // Being billed for a VIN we do not own is a different kind of problem
      // from a timing mismatch, and is worth waking someone up for.
      severity: summary.unmatchedVins.length > 0 ? 'critical' : 'warning',
      context: {
        tenant_id: tenant.id,
        period_start: startDate,
        period_end: endDate,
        vendor_total: summary.vendorTotal,
        billed_not_covered: summary.billedNotCovered,
        covered_not_billed: summary.coveredNotBilled,
        unmatched_vins: summary.unmatchedVins,
        mode: config.mode,
      },
      simulated,
    });
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (!isServiceRoleCall(req)) {
    return errorResponse('Unauthorized', 401);
  }

  let tenantId: string | null = null;
  let dryRun = false;
  let startOverride: string | null = null;
  let endOverride: string | null = null;
  try {
    const body = await req.json();
    tenantId = typeof body?.tenantId === 'string' ? body.tenantId : null;
    dryRun = body?.dryRun === true;
    startOverride = isDateOnly(body?.startDate) ? body.startDate.trim() : null;
    endOverride = isDateOnly(body?.endDate) ? body.endDate.trim() : null;
  } catch {
    // No body — a normal cron tick.
  }

  if ((startOverride && !endOverride) || (!startOverride && endOverride)) {
    return errorResponse('startDate and endDate must be supplied together (yyyy-mm-dd).', 400);
  }
  if (startOverride && endOverride && startOverride > endOverride) {
    return errorResponse('startDate must not be after endDate.', 400);
  }

  const supabase = createServiceClient();
  const startedAt = new Date();
  const deadline = startedAt.getTime() + MAX_RUN_MS;
  const period =
    startOverride && endOverride
      ? { startDate: startOverride, endDate: endOverride }
      : previousCalendarMonth(startedAt);

  try {
    let query = supabase
      .from('tenants')
      .select('id, name, inshur_mode, inshur_endpoint_overrides')
      .eq('integration_inshur', true);
    if (tenantId) query = query.eq('id', tenantId);

    const { data: tenantData, error: tenantErr } = await query;
    if (tenantErr) throw tenantErr;

    // Mock is excluded with no override: the mock transport returns no billing
    // rows because there is no vendor invoice to return, and synthesising cost
    // figures would put invented money into the operator's P&L.
    const tenants = ((tenantData ?? []) as TenantRow[]).filter(
      (t) => t.inshur_mode === 'test' || t.inshur_mode === 'live'
    );

    console.log(
      `[InshurSyncBilling] Starting at ${startedAt.toISOString()} — ${tenants.length} tenant(s), ` +
        `period ${period.startDate}..${period.endDate}, dryRun=${dryRun}`
    );

    const summaries: TenantSummary[] = [];
    let skipped = 0;
    for (const tenant of tenants) {
      if (Date.now() > deadline) {
        skipped++;
        continue;
      }
      try {
        summaries.push(await syncTenant(supabase, tenant, period.startDate, period.endDate, dryRun));
      } catch (err) {
        const message = (err as Error)?.message ?? 'Unknown error';
        console.error(`[InshurSyncBilling] Tenant ${tenant.id} failed:`, message);
        summaries.push({
          tenantId: tenant.id,
          mode: 'mock',
          periodStart: period.startDate,
          periodEnd: period.endDate,
          casingUsed: null,
          casingRecorded: false,
          vendorRows: 0,
          vendorTotal: 0,
          expensesWritten: 0,
          expensesUpdated: 0,
          unmatchedVins: [],
          billedNotCovered: [],
          coveredNotBilled: [],
          errors: [message],
        });
      }
    }

    const totals = summaries.reduce(
      (acc, s) => ({
        vendorRows: acc.vendorRows + s.vendorRows,
        vendorTotal: Math.round((acc.vendorTotal + s.vendorTotal) * 100) / 100,
        expensesWritten: acc.expensesWritten + s.expensesWritten,
        expensesUpdated: acc.expensesUpdated + s.expensesUpdated,
        variances: acc.variances + s.billedNotCovered.length + s.coveredNotBilled.length + s.unmatchedVins.length,
        errors: acc.errors + s.errors.length,
      }),
      { vendorRows: 0, vendorTotal: 0, expensesWritten: 0, expensesUpdated: 0, variances: 0, errors: 0 }
    );

    console.log(
      `[InshurSyncBilling] Done in ${Date.now() - startedAt.getTime()}ms — ` +
        `rows=${totals.vendorRows} total=${totals.vendorTotal} written=${totals.expensesWritten} ` +
        `updated=${totals.expensesUpdated} variances=${totals.variances} errors=${totals.errors}`
    );

    return jsonResponse({
      success: true,
      dryRun,
      period,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      tenantsProcessed: summaries.length,
      tenantsSkippedForTime: skipped,
      totals,
      tenants: summaries,
    });
  } catch (error) {
    console.error('[InshurSyncBilling] Fatal error:', error);
    return jsonResponse({ success: false, error: (error as Error)?.message ?? 'Unknown error' }, 500);
  }
});
