// INSHUR / ABI Period Z — drift reconciler.
//
// ABI publishes NO webhooks, has no idempotency keys, and answers most failures
// with a bare `{}`. Nothing on their side can ever tell us that cover was
// cancelled in portal.abiweb.com, that a Create we timed out on actually
// landed, or that a rental aged out. This cron is therefore not a safety net
// bolted onto the integration — it is the mechanism by which the integration is
// correct at all.
//
// It detects four things, in descending order of seriousness:
//
//   1. UNINSURED RENTAL — we believe cover is active, ABI does not have it, and
//      the rental is under way. A vehicle is on the road with a driver who is
//      not covered. Everything else here exists to make this one detectable.
//   2. REMOTE-ONLY cover — ABI holds a rental we lost track of (a Create that
//      succeeded after our DB write failed, or a manual bind in the portal).
//      Left alone it bills the operator forever and never appears anywhere.
//   3. ENDED-WITHOUT-END — the rental is finished but the Period Z is still
//      open at ABI, so the operator keeps paying for it.
//   4. STUCK PENDING — a bind that never resolved. Retried with backoff off
//      `attempt_count`, then failed loudly rather than sitting silent.
//
// AUTH: called by pg_cron with `Authorization: Bearer <service_role_key>`,
// which is what the repo's cron template already sends. There is deliberately
// no X-Cron-Secret: inventing a new header the template does not send would
// 401 every tick, and because `net.http_post` is asynchronous the failure would
// never show up in `cron.job_run_details` — the loop would look healthy while
// nothing reconciled.

import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { notifyOperatorsInApp } from '../_shared/notify-inapp.ts';
import {
  createServiceClient,
  createRentalPeriod,
  endRentalPeriod,
  formatAbiDateTime,
  getInshurConfig,
  listRentals,
  InshurError,
  InshurNotConfiguredError,
  TwoFactorRequiredError,
  type InshurConfig,
  type InshurMode,
} from '../_shared/inshur-client.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Stop starting new work after this long so the isolate is never killed
 *  mid-repair. Whatever is left is picked up on the next tick. */
const MAX_RUN_MS = 50_000;

/** A `pending` row younger than this is simply a bind still in flight. */
const PENDING_STALE_MS = 15 * 60_000;

/** ABI ages rentals out silently, so a cover that disappears shortly after the
 *  rental's own end time is expected housekeeping, not drift. */
const END_GRACE_MS = 60 * 60_000;

const MAX_BIND_ATTEMPTS = 6;

/** Bound the per-tenant work so one large fleet cannot starve the others. */
const MAX_COVERAGE_ROWS_PER_TENANT = 400;
const MAX_REMOTE_ONLY_ADOPTIONS_PER_TENANT = 25;

const TERMINAL_RENTAL_STATUSES = new Set(['closed', 'cancelled', 'canceled', 'rejected']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TenantRow {
  id: string;
  name: string | null;
  timezone: string | null;
  inshur_mode: string | null;
}

interface CoverageRow {
  id: string;
  tenant_id: string;
  rental_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  vin: string;
  inshur_rental_id: string | null;
  inshur_renter_id: string | null;
  status: string;
  usage_type: string;
  state: string | null;
  timezone: string | null;
  start_time_sent: string | null;
  end_time_sent: string | null;
  source_mode: string;
  error_message: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  created_at: string;
}

interface RentalRow {
  id: string;
  status: string;
  rental_number: string | null;
  end_date: string | null;
  return_time: string | null;
  vehicle_id: string | null;
  customer_id: string | null;
}

/** One ABI rental, flattened out of whatever casing the response used. */
interface RemoteRental {
  vin: string;
  abiRentalId: string | null;
  renterId: string | null;
  startTime: string | null;
  endTime: string | null;
  minuteKey: string | null;
  claimed: boolean;
}

interface TenantSummary {
  tenantId: string;
  mode: InshurMode;
  remoteCount: number;
  localCount: number;
  adopted: number;
  uninsured: number;
  uninsuredRepaired: number;
  endedAtAbi: number;
  closedLocally: number;
  remoteOnly: number;
  remoteOnlyAdopted: number;
  retried: number;
  failed: number;
  errors: string[];
  truncated: boolean;
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

/**
 * `verify_jwt = false` in config.toml, so the gateway lets anonymous requests
 * through and this check is the only gate. The service-role key is the exact
 * credential the cron template already carries.
 */
function isServiceRoleCall(req: Request): boolean {
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (!serviceKey) return false;
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  return constantTimeEquals(token, serviceKey);
}

// ---------------------------------------------------------------------------
// Time helpers
//
// Everything ABI sends and receives is a local wall clock plus a TIMEZONE
// field, never an instant. Comparing those against our timestamptz columns
// needs a real conversion — treating "2026-08-05 09:00" as UTC would move the
// end of cover by up to twelve hours, which is precisely the window in which a
// rental looks finished when it is not.
// ---------------------------------------------------------------------------

function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const hour = get('hour') === '24' ? '0' : get('hour');
  const asUtc = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(hour),
    Number(get('minute')),
    Number(get('second'))
  );
  return asUtc - instant.getTime();
}

/** "YYYY-MM-DD HH:mm[:ss]" in `timeZone` → the instant it names. */
function wallClockToInstant(wall: string, timeZone: string): Date | null {
  const m = wall
    .trim()
    .replace('T', ' ')
    .match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const naive = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? '0')
  );
  // Two passes: the offset depends on the instant, and the instant depends on
  // the offset. One correction is enough everywhere except the hour inside a
  // DST transition, where either answer is defensible.
  const first = new Date(naive - tzOffsetMs(new Date(naive), timeZone));
  return new Date(naive - tzOffsetMs(first, timeZone));
}

/**
 * ABI returns "YYYY-MM-DD HH:mm" while we send "YYYY-MM-DD HH:mm:ss", so the
 * join key is compared at MINUTE precision. String equality would report every
 * single coverage as missing.
 */
function minuteKey(wall: string | null): string | null {
  if (!wall) return null;
  const s = wall.trim().replace('T', ' ');
  return s.length >= 16 ? s.slice(0, 16) : null;
}

function resolveTimezone(coverage: CoverageRow | null, tenant: TenantRow): string {
  return coverage?.timezone?.trim() || tenant.timezone?.trim() || 'UTC';
}

/** Retry cadence for a stuck bind: 5, 10, 20, 40, 80 minutes, then 4-hourly. */
function backoffMs(attempt: number): number {
  return Math.min(5 * 60_000 * Math.pow(2, Math.max(0, attempt)), 4 * 60 * 60_000);
}

// ---------------------------------------------------------------------------
// Alerting
//
// Every call site is `await raiseAlert(...)` with no error handling of its own,
// because this function is contractually incapable of throwing. An alert that
// breaks the repair it is reporting on turns a recoverable uninsured rental
// into an unrecoverable one with no alert at all.
// ---------------------------------------------------------------------------

interface AlertParams {
  tenantId: string;
  ruleCode: string;
  objectType: 'Rental' | 'Integration';
  objectId: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  context: Record<string, unknown>;
  link?: string;
  simulated: boolean;
}

async function raiseAlert(supabase: SupabaseClient, params: AlertParams): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // A simulated tenant can raise the same alerts, but nothing that reaches an
    // operator may be mistakable for a real uninsured vehicle.
    const title = params.simulated ? `[SIMULATED] ${params.title}` : params.title;

    // `ux_reminders_identity` is UNIQUE on (rule_code, object_type, object_id,
    // due_on, remind_on). A plain insert therefore throws 23505 the second time
    // the same rental drifts on the same day — which is exactly when the alert
    // matters most. Read first so the repeat count survives the upsert.
    const { data: existing } = await supabase
      .from('reminders')
      .select('id, context')
      .eq('rule_code', params.ruleCode)
      .eq('object_type', params.objectType)
      .eq('object_id', params.objectId)
      .eq('due_on', today)
      .eq('remind_on', today)
      .maybeSingle();

    const prior = (existing?.context ?? {}) as Record<string, unknown>;
    const occurrences = (typeof prior.occurrences === 'number' ? prior.occurrences : 0) + 1;

    const { error } = await supabase.from('reminders').upsert(
      {
        rule_code: params.ruleCode,
        object_type: params.objectType,
        object_id: params.objectId,
        title,
        message: params.message,
        severity: params.severity,
        due_on: today,
        remind_on: today,
        // Re-open a reminder an operator already dismissed: the condition came
        // back, so it is pending again.
        status: 'pending',
        last_sent_at: new Date().toISOString(),
        context: { ...params.context, occurrences, simulated: params.simulated, source: 'inshur-reconcile' },
        tenant_id: params.tenantId,
      },
      { onConflict: 'rule_code,object_type,object_id,due_on,remind_on' }
    );

    if (error) {
      console.error(`[InshurReconcile] Reminder upsert failed (${params.ruleCode}):`, error.message);
    }

    // One bell per condition per day. notifyOperatorsInApp never throws.
    if (occurrences === 1) {
      await notifyOperatorsInApp({
        tenantId: params.tenantId,
        type: 'inshur_coverage_alert',
        title,
        message: params.message,
        link: params.link,
        metadata: { ...params.context, rule_code: params.ruleCode, simulated: params.simulated },
        dedupeKey: `${params.ruleCode}:${params.objectId}:${today}`,
      });
    }
  } catch (err) {
    console.error('[InshurReconcile] Alerting failed (swallowed):', (err as Error)?.message ?? err);
  }
}

// ---------------------------------------------------------------------------
// Remote list parsing
//
// The Get Rentals response shape is only partly documented and its casing has
// already been observed to differ between endpoints, so every field is read
// through a tolerant picker rather than a fixed key.
// ---------------------------------------------------------------------------

function pickString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const direct = row[key];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    if (typeof direct === 'number') return String(direct);
  }
  const lowered = new Map(Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[\s_]/g, ''), v]));
  for (const key of keys) {
    const v = lowered.get(key.toLowerCase().replace(/[\s_]/g, ''));
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function parseRemote(raw: unknown[]): RemoteRental[] {
  const out: RemoteRental[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const vin = pickString(row, ['VIN', 'VEHICLEVIN']);
    if (!vin) continue;
    const startTime = pickString(row, ['STARTTIME', 'STARTDATE', 'START']);
    out.push({
      vin: vin.toUpperCase(),
      abiRentalId: pickString(row, ['RENTALID', 'ID', 'PERIODZEROID']),
      renterId: pickString(row, ['RENTERID', 'RENTER']),
      startTime,
      endTime: pickString(row, ['ENDTIME', 'ENDDATE', 'END']),
      minuteKey: minuteKey(startTime),
      claimed: false,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-tenant reconciliation
// ---------------------------------------------------------------------------

interface RunOptions {
  dryRun: boolean;
  deadline: number;
}

async function reconcileTenant(
  supabase: SupabaseClient,
  tenant: TenantRow,
  opts: RunOptions
): Promise<TenantSummary> {
  const summary: TenantSummary = {
    tenantId: tenant.id,
    mode: 'mock',
    remoteCount: 0,
    localCount: 0,
    adopted: 0,
    uninsured: 0,
    uninsuredRepaired: 0,
    endedAtAbi: 0,
    closedLocally: 0,
    remoteOnly: 0,
    remoteOnlyAdopted: 0,
    retried: 0,
    failed: 0,
    errors: [],
    truncated: false,
  };

  let config: InshurConfig;
  try {
    config = await getInshurConfig(supabase, tenant.id);
  } catch (err) {
    const message = (err as Error)?.message ?? 'Unknown configuration error';
    summary.errors.push(message);
    if (err instanceof InshurNotConfiguredError) {
      await raiseAlert(supabase, {
        tenantId: tenant.id,
        ruleCode: 'INSHUR_CONFIG_INVALID',
        objectType: 'Integration',
        objectId: tenant.id,
        title: 'INSHUR insurance is not fully configured',
        message: `${message} Cover cannot be created or reconciled until this is fixed.`,
        severity: 'warning',
        context: { tenant_id: tenant.id },
        link: '/settings?tab=inshur',
        simulated: false,
      });
    }
    return summary;
  }

  summary.mode = config.mode;
  const simulated = config.mode !== 'live';

  // The single reconciliation read. If it fails we must abort this tenant
  // entirely: an empty list from a failed call is indistinguishable from a
  // genuinely empty policy, and acting on it would mark every active coverage
  // uninsured and fire a critical alert per rental.
  let remote: RemoteRental[];
  try {
    remote = parseRemote(await listRentals(config));
  } catch (err) {
    const message = (err as Error)?.message ?? 'Unknown error';
    summary.errors.push(`listRentals: ${message}`);
    if (err instanceof TwoFactorRequiredError) {
      await raiseAlert(supabase, {
        tenantId: tenant.id,
        ruleCode: 'INSHUR_TOKEN_EXPIRED',
        objectType: 'Integration',
        objectId: tenant.id,
        title: 'INSHUR needs a new two-factor code',
        message:
          'INSHUR rejected the stored two-factor code, so cover cannot be created or checked. ' +
          'Re-authenticate in Settings, or ask INSHUR for a service login with two-factor disabled.',
        severity: 'critical',
        context: { tenant_id: tenant.id, mode: config.mode },
        link: '/settings?tab=inshur',
        simulated,
      });
    }
    return summary;
  }

  summary.remoteCount = remote.length;
  const remoteByAbiId = new Map<string, RemoteRental>();
  const remoteByVinStart = new Map<string, RemoteRental>();
  for (const r of remote) {
    if (r.abiRentalId) remoteByAbiId.set(r.abiRentalId, r);
    if (r.minuteKey) remoteByVinStart.set(`${r.vin}|${r.minuteKey}`, r);
  }

  const { data: coverageData, error: coverageErr } = await supabase
    .from('inshur_rental_coverage')
    .select(
      'id, tenant_id, rental_id, customer_id, vehicle_id, vin, inshur_rental_id, inshur_renter_id, status, usage_type, state, timezone, start_time_sent, end_time_sent, source_mode, error_message, attempt_count, last_attempt_at, created_at'
    )
    .eq('tenant_id', tenant.id)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: true })
    .limit(MAX_COVERAGE_ROWS_PER_TENANT);

  if (coverageErr) {
    summary.errors.push(`coverage read: ${coverageErr.message}`);
    return summary;
  }

  const coverages = (coverageData ?? []) as CoverageRow[];
  summary.localCount = coverages.length;
  if (coverages.length === MAX_COVERAGE_ROWS_PER_TENANT) summary.truncated = true;

  // Parent rentals, for "has this rental actually finished?".
  const rentalIds = [...new Set(coverages.map((c) => c.rental_id))];
  const rentalsById = new Map<string, RentalRow>();
  if (rentalIds.length) {
    const { data: rentalData, error: rentalErr } = await supabase
      .from('rentals')
      .select('id, status, rental_number, end_date, return_time, vehicle_id, customer_id')
      .in('id', rentalIds);
    if (rentalErr) {
      summary.errors.push(`rental read: ${rentalErr.message}`);
      return summary;
    }
    for (const r of (rentalData ?? []) as RentalRow[]) rentalsById.set(r.id, r);
  }

  const nowMs = Date.now();

  const findRemoteFor = (cov: CoverageRow): RemoteRental | null => {
    if (cov.inshur_rental_id) {
      const byId = remoteByAbiId.get(cov.inshur_rental_id);
      if (byId) return byId;
    }
    const key = minuteKey(cov.start_time_sent);
    if (key) {
      const byStart = remoteByVinStart.get(`${cov.vin.toUpperCase()}|${key}`);
      if (byStart) return byStart;
    }
    return null;
  };

  const rentalFinished = (cov: CoverageRow): boolean => {
    const rental = rentalsById.get(cov.rental_id);
    if (!rental) return false;
    if (TERMINAL_RENTAL_STATUSES.has((rental.status ?? '').toLowerCase())) return true;
    if (!rental.end_date) return false;
    const time = (rental.return_time ?? '23:59').slice(0, 5);
    const endInstant = wallClockToInstant(`${rental.end_date} ${time}`, resolveTimezone(cov, tenant));
    return !!endInstant && endInstant.getTime() + END_GRACE_MS < nowMs;
  };

  /** Exponential backoff off `attempt_count`, so a call ABI keeps refusing is
   *  not re-issued on every twenty-minute pass for the life of the rental. */
  const dueForAttempt = (cov: CoverageRow): boolean => {
    const last = cov.last_attempt_at ? new Date(cov.last_attempt_at).getTime() : 0;
    return nowMs - last >= backoffMs(cov.attempt_count ?? 0);
  };

  /**
   * Re-create cover at ABI for a row we hold the renter id for.
   *
   * Deliberately does NOT call addRenter: mapping a customer record onto ABI's
   * renter fields belongs to the bind path, and duplicating it here would give
   * two places that decide what a valid renter looks like. A row with no renter
   * id is escalated to the operator instead of half-repaired.
   */
  async function attemptRebind(
    cov: CoverageRow
  ): Promise<{ ok: boolean; abiRentalId?: string; hasCompColl?: boolean; error?: string }> {
    if (!cov.inshur_renter_id) {
      return { ok: false, error: 'No INSHUR renter id on this coverage — re-bind it from the rental page.' };
    }
    if (!cov.state) return { ok: false, error: 'No garaging state recorded on this coverage.' };
    if (!cov.end_time_sent) return { ok: false, error: 'No end time recorded on this coverage.' };

    const tz = resolveTimezone(cov, tenant);
    const originalStart = cov.start_time_sent ? wallClockToInstant(cov.start_time_sent, tz) : null;
    // ABI will not backdate cover. A repair for a rental already under way
    // starts now — the gap that already happened cannot be bought back, and
    // pretending otherwise would record cover we do not have.
    const startTime =
      originalStart && originalStart.getTime() > nowMs
        ? cov.start_time_sent!
        : formatAbiDateTime(new Date(), tz);

    try {
      const result = await createRentalPeriod(config, {
        vin: cov.vin,
        renterId: cov.inshur_renter_id,
        state: cov.state,
        timezone: tz,
        startTime,
        endTime: cov.end_time_sent,
        usageType: cov.usage_type === 'Rideshare' ? 'Rideshare' : 'Personal',
        externalRef: cov.rental_id,
      });
      if (!opts.dryRun) {
        await supabase
          .from('inshur_rental_coverage')
          .update({
            status: 'active',
            inshur_rental_id: result.rentalId,
            has_comp_coll: result.hasCompColl,
            start_time_sent: startTime,
            source_mode: config.mode,
            error_code: null,
            error_message: null,
            attempt_count: (cov.attempt_count ?? 0) + 1,
            last_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', cov.id);
      }
      return { ok: true, abiRentalId: result.rentalId, hasCompColl: result.hasCompColl };
    } catch (err) {
      const code = err instanceof InshurError ? err.code : 'INSHUR_UNKNOWN';
      const message = (err as Error)?.message ?? 'Unknown error';
      const attempts = (cov.attempt_count ?? 0) + 1;
      if (!opts.dryRun) {
        await supabase
          .from('inshur_rental_coverage')
          .update({
            status: attempts >= MAX_BIND_ATTEMPTS ? 'failed' : cov.status,
            error_code: code,
            error_message: message,
            attempt_count: attempts,
            last_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', cov.id);
      }
      return { ok: false, error: message };
    }
  }

  // -- 1/2/3: walk what we believe -----------------------------------------
  for (const cov of coverages) {
    if (Date.now() > opts.deadline) {
      summary.truncated = true;
      break;
    }

    const rental = rentalsById.get(cov.rental_id);
    const match = findRemoteFor(cov);
    if (match) match.claimed = true;

    if (cov.status === 'active') {
      if (match) {
        if (rentalFinished(cov) && dueForAttempt(cov)) {
          // Still open at ABI after the rental finished — the operator is
          // paying for cover on a car that is back on the lot.
          try {
            if (!opts.dryRun) {
              await endRentalPeriod(config, cov.vin);
              await supabase
                .from('inshur_rental_coverage')
                .update({
                  status: 'ended',
                  ended_at: new Date().toISOString(),
                  error_code: null,
                  error_message: null,
                  last_attempt_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', cov.id);
            }
            summary.endedAtAbi++;
          } catch (err) {
            const message = (err as Error)?.message ?? 'failed';
            summary.errors.push(`end ${cov.vin}: ${message}`);
            // Record the attempt so the backoff applies. Without this a cover
            // ABI refuses to close is re-attempted on every pass, forever.
            if (!opts.dryRun) {
              await supabase
                .from('inshur_rental_coverage')
                .update({
                  error_code: err instanceof InshurError ? err.code : 'INSHUR_UNKNOWN',
                  error_message: message,
                  attempt_count: (cov.attempt_count ?? 0) + 1,
                  last_attempt_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', cov.id);
            }
          }
        }
        continue;
      }

      if (rentalFinished(cov)) {
        // Gone from ABI and the rental is over — ABI aged it out. Nothing is
        // wrong; just stop calling it active.
        if (!opts.dryRun) {
          await supabase
            .from('inshur_rental_coverage')
            .update({
              status: 'ended',
              ended_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', cov.id);
        }
        summary.closedLocally++;
        continue;
      }

      // THE serious case. Our records say insured; ABI has nothing.
      summary.uninsured++;
      let repair: { ok: boolean; abiRentalId?: string; hasCompColl?: boolean; error?: string };
      if (opts.dryRun) {
        repair = { ok: false, error: 'dry run' };
      } else if (!dueForAttempt(cov)) {
        // Still inside the backoff from the last failed re-create. The alert
        // below fires regardless — a rental stays uninsured whether or not it
        // is currently this function's turn to try again.
        repair = { ok: false, error: cov.error_message ?? 'awaiting the next automatic retry' };
      } else {
        repair = await attemptRebind(cov);
      }
      if (repair.ok) summary.uninsuredRepaired++;

      if (!opts.dryRun) {
        const ref = rental?.rental_number ? `Rental ${rental.rental_number}` : 'This rental';
        await raiseAlert(supabase, {
          tenantId: tenant.id,
          ruleCode: 'INSHUR_UNINSURED_RENTAL',
          objectType: 'Rental',
          objectId: cov.rental_id,
          title: repair.ok ? 'INSHUR cover was missing and has been re-created' : 'Vehicle on rental has no INSHUR cover',
          message: repair.ok
            ? `${ref} (${cov.vin}) was recorded as insured but INSHUR had no matching cover. Cover has been re-created automatically — note that it starts from now, so any gap before that is not covered.`
            : `${ref} (${cov.vin}) is recorded as insured but INSHUR has no matching cover, and it could not be re-created automatically: ${repair.error}. Treat this vehicle as uninsured until it is fixed.`,
          severity: repair.ok ? 'warning' : 'critical',
          context: {
            rental_id: cov.rental_id,
            coverage_id: cov.id,
            vin: cov.vin,
            mode: config.mode,
            repaired: repair.ok,
            abi_rental_id: repair.abiRentalId ?? null,
          },
          link: `/rentals/${cov.rental_id}`,
          simulated,
        });
      }
      continue;
    }

    // cov.status === 'pending'
    if (match) {
      // The Create landed after all — the answer just never reached us. This is
      // how a timed-out bind resolves without buying cover twice.
      if (!opts.dryRun) {
        await supabase
          .from('inshur_rental_coverage')
          .update({
            status: 'active',
            inshur_rental_id: match.abiRentalId ?? cov.inshur_rental_id,
            inshur_renter_id: cov.inshur_renter_id ?? match.renterId,
            error_code: null,
            error_message: null,
            source_mode: config.mode,
            updated_at: new Date().toISOString(),
          })
          .eq('id', cov.id);
      }
      summary.adopted++;
      continue;
    }

    const ageMs = nowMs - new Date(cov.created_at).getTime();
    if (ageMs < PENDING_STALE_MS) continue;
    if (!dueForAttempt(cov)) continue;

    summary.retried++;
    const repair = opts.dryRun ? { ok: false, error: 'dry run' } : await attemptRebind(cov);
    if (repair.ok) {
      summary.adopted++;
      continue;
    }

    const attempts = (cov.attempt_count ?? 0) + 1;
    if (attempts >= MAX_BIND_ATTEMPTS && !opts.dryRun) {
      summary.failed++;
      // Severity depends on whether a car is already out on this rental: an
      // unbound future booking is a task, an unbound live rental is a hazard.
      const live = (rental?.status ?? '').toLowerCase() === 'active';
      await raiseAlert(supabase, {
        tenantId: tenant.id,
        ruleCode: 'INSHUR_BIND_FAILED',
        objectType: 'Rental',
        objectId: cov.rental_id,
        title: live ? 'INSHUR cover could not be created for a live rental' : 'INSHUR cover could not be created',
        message:
          `${rental?.rental_number ? `Rental ${rental.rental_number}` : 'A rental'} (${cov.vin}) has been retried ` +
          `${attempts} times without success: ${repair.error}. ` +
          (live ? 'This vehicle is out on rental and is not covered.' : 'Fix the underlying problem and re-bind from the rental page.'),
        severity: live ? 'critical' : 'warning',
        context: { rental_id: cov.rental_id, coverage_id: cov.id, vin: cov.vin, attempts, mode: config.mode },
        link: `/rentals/${cov.rental_id}`,
        simulated,
      });
    }
  }

  // -- 4: cover ABI holds that we know nothing about -------------------------
  const unclaimed = remote.filter((r) => !r.claimed);
  if (unclaimed.length) {
    // A row we already closed still shows up in Get Rentals for a while, so
    // check recent history before calling anything orphaned.
    const sevenDaysAgo = new Date(nowMs - 7 * 86_400_000).toISOString();
    const { data: recent } = await supabase
      .from('inshur_rental_coverage')
      .select('vin, inshur_rental_id, start_time_sent')
      .eq('tenant_id', tenant.id)
      .gte('updated_at', sevenDaysAgo)
      .limit(1000);

    const knownIds = new Set<string>();
    const knownVinStart = new Set<string>();
    for (const row of (recent ?? []) as Array<{ vin: string; inshur_rental_id: string | null; start_time_sent: string | null }>) {
      if (row.inshur_rental_id) knownIds.add(row.inshur_rental_id);
      const key = minuteKey(row.start_time_sent);
      if (key) knownVinStart.add(`${(row.vin ?? '').toUpperCase()}|${key}`);
    }

    let adoptions = 0;
    for (const entry of unclaimed) {
      if (entry.abiRentalId && knownIds.has(entry.abiRentalId)) continue;
      if (entry.minuteKey && knownVinStart.has(`${entry.vin}|${entry.minuteKey}`)) continue;

      summary.remoteOnly++;
      if (opts.dryRun || adoptions >= MAX_REMOTE_ONLY_ADOPTIONS_PER_TENANT || Date.now() > opts.deadline) continue;

      const adopted = await adoptRemoteOnly(supabase, tenant, config, entry);
      if (adopted) {
        summary.remoteOnlyAdopted++;
        adoptions++;
      }
    }

    const unattributed = summary.remoteOnly - summary.remoteOnlyAdopted;
    if (unattributed > 0 && !opts.dryRun) {
      await raiseAlert(supabase, {
        tenantId: tenant.id,
        ruleCode: 'INSHUR_COVERAGE_DRIFT',
        objectType: 'Integration',
        objectId: tenant.id,
        title: 'INSHUR is holding cover we cannot account for',
        message:
          `INSHUR reports ${unattributed} active Period Z cover${unattributed === 1 ? '' : 's'} that ` +
          'does not match any rental here. You are being billed for it. This usually means cover was ' +
          'created directly at portal.abiweb.com, or a rental was deleted after cover was bought.',
        severity: unattributed >= 3 ? 'critical' : 'warning',
        context: { tenant_id: tenant.id, unattributed, remote_count: summary.remoteCount, mode: config.mode },
        link: '/settings?tab=inshur',
        simulated,
      });
    }
  }

  return summary;
}

/**
 * Try to attach a remote-only Period Z to one of our rentals by VIN and window.
 *
 * `EXTERNALREF` is write-only at ABI — nothing in the read response carries our
 * rental id — so VIN plus start-time overlap is the only attribution available.
 * When it is ambiguous we do nothing and let the drift alert speak, rather than
 * attaching cover to the wrong rental.
 */
async function adoptRemoteOnly(
  supabase: SupabaseClient,
  tenant: TenantRow,
  config: InshurConfig,
  entry: RemoteRental
): Promise<boolean> {
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id')
    .eq('tenant_id', tenant.id)
    .ilike('vin', entry.vin)
    .limit(2);

  if (!vehicles || vehicles.length !== 1) return false;
  const vehicleId = (vehicles[0] as { id: string }).id;

  const startInstant = entry.startTime ? wallClockToInstant(entry.startTime, tenant.timezone || 'UTC') : null;
  if (!startInstant) return false;
  const day = startInstant.toISOString().slice(0, 10);

  const { data: candidates } = await supabase
    .from('rentals')
    .select('id, customer_id, status, start_date, end_date')
    .eq('tenant_id', tenant.id)
    .eq('vehicle_id', vehicleId)
    .lte('start_date', day)
    .gte('end_date', day)
    .in('status', ['Pending', 'Active'])
    .limit(2);

  if (!candidates || candidates.length !== 1) return false;
  const rental = candidates[0] as { id: string; customer_id: string | null };

  // The partial unique index allows only one non-terminal row per rental;
  // checking first turns a 23505 into a clean no-op.
  const { data: clash } = await supabase
    .from('inshur_rental_coverage')
    .select('id')
    .eq('rental_id', rental.id)
    .in('status', ['pending', 'active'])
    .maybeSingle();
  if (clash) return false;

  const { error } = await supabase.from('inshur_rental_coverage').insert({
    tenant_id: tenant.id,
    rental_id: rental.id,
    customer_id: rental.customer_id,
    vehicle_id: vehicleId,
    vin: entry.vin,
    inshur_rental_id: entry.abiRentalId,
    inshur_renter_id: entry.renterId,
    status: 'active',
    timezone: tenant.timezone || 'UTC',
    start_time_sent: entry.startTime,
    end_time_sent: entry.endTime,
    source_mode: config.mode,
    error_code: 'INSHUR_ADOPTED_BY_RECONCILER',
    error_message: 'Discovered at INSHUR with no local record and matched to this rental by VIN and date.',
  });

  if (error) {
    console.error(`[InshurReconcile] Adoption insert failed for ${entry.vin}:`, error.message);
    return false;
  }
  return true;
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
  let includeMock = false;
  try {
    const body = await req.json();
    tenantId = typeof body?.tenantId === 'string' ? body.tenantId : null;
    dryRun = body?.dryRun === true;
    // Mock tenants are excluded from the cron: the mock transport returns an
    // empty rental list, so every simulated coverage would read as uninsured.
    // Passing includeMock deliberately drives exactly that path, which is how
    // the uninsured-detection and repair branches are exercised with no
    // credentials at all.
    includeMock = body?.includeMock === true;
  } catch {
    // No body — a normal cron tick.
  }

  const supabase = createServiceClient();
  const startedAt = new Date();
  const deadline = startedAt.getTime() + MAX_RUN_MS;

  try {
    let query = supabase
      .from('tenants')
      .select('id, name, timezone, inshur_mode')
      .eq('integration_inshur', true);
    if (tenantId) query = query.eq('id', tenantId);

    const { data: tenantData, error: tenantErr } = await query;
    if (tenantErr) throw tenantErr;

    const allowedModes = includeMock ? ['mock', 'test', 'live'] : ['test', 'live'];
    const tenants = ((tenantData ?? []) as TenantRow[]).filter((t) =>
      allowedModes.includes(t.inshur_mode === 'live' || t.inshur_mode === 'test' ? t.inshur_mode : 'mock')
    );

    console.log(
      `[InshurReconcile] Starting at ${startedAt.toISOString()} — ${tenants.length} tenant(s), dryRun=${dryRun}`
    );

    const summaries: TenantSummary[] = [];
    let skipped = 0;
    for (const tenant of tenants) {
      if (Date.now() > deadline) {
        skipped++;
        continue;
      }
      try {
        summaries.push(await reconcileTenant(supabase, tenant, { dryRun, deadline }));
      } catch (err) {
        // One tenant's failure must never stop the others — the next tenant in
        // the list may be the one with an uninsured car on the road.
        const message = (err as Error)?.message ?? 'Unknown error';
        console.error(`[InshurReconcile] Tenant ${tenant.id} failed:`, message);
        summaries.push({
          tenantId: tenant.id,
          mode: 'mock',
          remoteCount: 0,
          localCount: 0,
          adopted: 0,
          uninsured: 0,
          uninsuredRepaired: 0,
          endedAtAbi: 0,
          closedLocally: 0,
          remoteOnly: 0,
          remoteOnlyAdopted: 0,
          retried: 0,
          failed: 0,
          errors: [message],
          truncated: false,
        });
      }
    }

    const totals = summaries.reduce(
      (acc, s) => ({
        uninsured: acc.uninsured + s.uninsured,
        uninsuredRepaired: acc.uninsuredRepaired + s.uninsuredRepaired,
        adopted: acc.adopted + s.adopted,
        endedAtAbi: acc.endedAtAbi + s.endedAtAbi,
        closedLocally: acc.closedLocally + s.closedLocally,
        remoteOnly: acc.remoteOnly + s.remoteOnly,
        remoteOnlyAdopted: acc.remoteOnlyAdopted + s.remoteOnlyAdopted,
        retried: acc.retried + s.retried,
        failed: acc.failed + s.failed,
        errors: acc.errors + s.errors.length,
      }),
      {
        uninsured: 0,
        uninsuredRepaired: 0,
        adopted: 0,
        endedAtAbi: 0,
        closedLocally: 0,
        remoteOnly: 0,
        remoteOnlyAdopted: 0,
        retried: 0,
        failed: 0,
        errors: 0,
      }
    );

    console.log(
      `[InshurReconcile] Done in ${Date.now() - startedAt.getTime()}ms — ` +
        `uninsured=${totals.uninsured} repaired=${totals.uninsuredRepaired} adopted=${totals.adopted} ` +
        `endedAtAbi=${totals.endedAtAbi} remoteOnly=${totals.remoteOnly} failed=${totals.failed} errors=${totals.errors}`
    );

    return jsonResponse({
      success: true,
      dryRun,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      tenantsProcessed: summaries.length,
      tenantsSkippedForTime: skipped,
      totals,
      tenants: summaries,
    });
  } catch (error) {
    console.error('[InshurReconcile] Fatal error:', error);
    return jsonResponse(
      { success: false, error: (error as Error)?.message ?? 'Unknown error' },
      500
    );
  }
});
