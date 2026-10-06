/**
 * Customer Management Service — everything that touches Supabase.
 *
 * Kept apart from the components so the pure rules in `schedule.ts` stay
 * testable without a database and the components stay readable without a query
 * in the middle of the JSX.
 *
 * Every table here is super-admin-only by RLS. A sales agent reaching this
 * module at all is a routing bug (the protected layout confines them to
 * /admin/sales), but if one did, PostgREST returns empty rather than data.
 */

import { supabase } from '@/lib/supabase';

import { SETTINGS_DEFAULTS } from './catalog';
import type {
  AutomationId,
  CustomerManagementSendRow,
  CustomerManagementSettings,
  CustomerManagementStep,
  RunSummary,
} from './types';

const SETTINGS_COLUMNS =
  'id, signup_enabled, renewal_enabled, receipt_enabled, scope_all_tenants, scope_tenant_slug, test_mode, test_mode_started_at, test_run_id, test_recipient_email, test_renewal_date, test_receipt_at, max_sends_per_run, updated_at, updated_by';

const STEP_COLUMNS =
  'id, automation, step_key, label, offset_days, subject, body_html, enabled, sort_order, send_if, repeat_every_days, updated_at, updated_by';

/**
 * Raised when the tables are not there yet.
 *
 * The tables come from `PENDING_20261006_customer_management_service.sql.txt`.
 * On a database where that has not been run, the page has to render something
 * honest. PostgREST answers an unknown relation with 42P01;
 * treating that as "not installed" rather than as a generic failure is what
 * lets the page say which file to run instead of "Something went wrong".
 */
export class NotInstalledError extends Error {
  constructor() {
    super('Customer Management Service tables are not installed yet.');
    this.name = 'NotInstalledError';
  }
}

function rethrow(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (error.code === '42P01') throw new NotInstalledError();
  throw new Error(error.message);
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export async function loadSettings(): Promise<CustomerManagementSettings> {
  const { data, error } = await supabase
    .from('customer_management_settings')
    .select(SETTINGS_COLUMNS)
    .eq('id', 1)
    .maybeSingle();
  rethrow(error);

  // The migration seeds this row, so a missing one means the table exists but
  // the seed did not run. Returning the catalogue defaults keeps the page
  // usable and the first save writes the row.
  if (!data) {
    return {
      id: 1,
      ...SETTINGS_DEFAULTS,
      test_mode_started_at: null,
      test_run_id: null,
      test_recipient_email: null,
      test_renewal_date: null,
      test_receipt_at: null,
      updated_at: new Date().toISOString(),
      updated_by: null,
    } as CustomerManagementSettings;
  }
  return data as CustomerManagementSettings;
}

export async function saveSettings(
  patch: Partial<CustomerManagementSettings>,
): Promise<CustomerManagementSettings> {
  const { data, error } = await supabase
    .from('customer_management_settings')
    .upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    .select(SETTINGS_COLUMNS)
    .single();
  rethrow(error);
  return data as CustomerManagementSettings;
}

/**
 * The email address of the rehearsal tenant (Northwind), in the same order the
 * runner picks an operator's address: notification recipient, then contact,
 * then admin email.
 */
export async function loadTestTargetEmail(slug: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('tenants')
    .select('notification_recipient_email, contact_email, admin_email')
    .eq('slug', slug)
    .maybeSingle();
  rethrow(error);
  if (!data) return null;
  return (
    data.notification_recipient_email?.trim() ||
    data.contact_email?.trim() ||
    data.admin_email?.trim() ||
    null
  );
}

/**
 * Switch Developer Test Mode on or off.
 *
 * Nobody types an address: switching on looks up the rehearsal tenant's own
 * email (Northwind's) and sends every rehearsal email there. It is looked up
 * fresh each time, so if Northwind's email changes the next rehearsal follows.
 *
 * Three columns move together with the flag: the anchor the compressed
 * timeline counts from, the run id that keeps one rehearsal's log rows from
 * blocking the next, and the recipient. The database's CHECK constraints
 * refuse test mode without the first and last of those.
 *
 * Switching ON also asks the runner to run once straight away, so the day-0
 * email lands now instead of on the next cron tick. Everything after that is
 * sent by the cron job on its own.
 *
 * Switching OFF clears the anchor and the run id so the next rehearsal starts
 * from scratch rather than resuming a timeline that began days ago.
 */
export async function setTestMode(
  on: boolean,
  scopeSlug: string,
): Promise<CustomerManagementSettings> {
  if (!on) {
    return saveSettings({ test_mode: false, test_mode_started_at: null, test_run_id: null });
  }

  const recipient = await loadTestTargetEmail(scopeSlug);
  if (!recipient) {
    throw new Error(`The ${scopeSlug} tenant has no email address to send the rehearsal to.`);
  }

  const next = await saveSettings({
    test_mode: true,
    test_mode_started_at: new Date().toISOString(),
    test_run_id: crypto.randomUUID().slice(0, 8),
    test_recipient_email: recipient,
  });

  // Fire-and-forget: the cron job would pick it up within 30 seconds anyway,
  // so a failure here only delays the first email, it does not lose it.
  void runNow({ dryRun: false }).catch(() => undefined);

  return next;
}

/* -------------------------------------------------------------------------- */
/* Renewal simulator                                                          */
/* -------------------------------------------------------------------------- */

/** The scope tenant's real subscription, as the renewal reminder reads it. */
export interface TenantSubscriptionSnapshot {
  status: string;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at: string | null;
  created_at: string;
  plan_name: string | null;
}

export async function loadSubscriptionsFor(slug: string): Promise<TenantSubscriptionSnapshot[]> {
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  rethrow(error);
  if (!tenant) return [];
  const { data, error: subError } = await supabase
    .from('tenant_subscriptions')
    .select('status, current_period_end, trial_end, cancel_at, created_at, plan_name')
    .eq('tenant_id', tenant.id);
  rethrow(subError);
  return (data || []) as TenantSubscriptionSnapshot[];
}

/**
 * Set (or clear, with null) the pretend payment date for the scope tenant.
 *
 * Only `customer_management_settings` is written — never the real
 * subscription — so testing a reminder cannot change what Northwind is
 * charged or what its portal shows.
 */
export async function setSimulatedRenewalDate(
  date: Date | null,
): Promise<CustomerManagementSettings> {
  return saveSettings({ test_renewal_date: date ? date.toISOString() : null });
}

/**
 * Pretend the scope tenant (Northwind) just paid its subscription. The runner
 * sends the receipt on its next tick, through the real template and sender.
 * Each press is a new pretend payment, so it can be repeated.
 */
export async function simulateReceipt(): Promise<CustomerManagementSettings> {
  return saveSettings({ test_receipt_at: new Date().toISOString() });
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                      */
/* -------------------------------------------------------------------------- */

export async function loadSteps(): Promise<CustomerManagementStep[]> {
  const { data, error } = await supabase
    .from('customer_management_steps')
    .select(STEP_COLUMNS)
    .order('automation')
    .order('sort_order');
  rethrow(error);
  return (data || []) as CustomerManagementStep[];
}

/**
 * Save one step's editable fields.
 *
 * `step_key` and `automation` are deliberately NOT in the patch type. The key
 * is half of the send log's idempotency key, so renaming it re-sends every
 * mail that step has ever sent to every tenant that received it.
 */
export async function saveStep(
  id: string,
  patch: Partial<
    Pick<CustomerManagementStep, 'label' | 'offset_days' | 'subject' | 'body_html' | 'enabled' | 'repeat_every_days'>
  >,
): Promise<void> {
  const { error } = await supabase
    .from('customer_management_steps')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  rethrow(error);
}

/* -------------------------------------------------------------------------- */
/* Log                                                                        */
/* -------------------------------------------------------------------------- */

export async function loadSends(options?: {
  automation?: AutomationId;
  limit?: number;
  includeTests?: boolean;
}): Promise<CustomerManagementSendRow[]> {
  let query = supabase
    .from('customer_management_sends')
    .select(
      'id, tenant_id, automation, step_key, cycle_key, due_at, sent_at, status, to_email, subject, detail, test_mode, created_at, tenants(company_name, slug)',
    )
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 100);

  if (options?.automation) query = query.eq('automation', options.automation);
  if (options?.includeTests === false) query = query.eq('test_mode', false);

  const { data, error } = await query;
  rethrow(error);

  return (data || []).map((row: Record<string, unknown>) => {
    const tenant = row.tenants as { company_name?: string; slug?: string } | null;
    const { tenants: _dropped, ...rest } = row;
    return {
      ...rest,
      tenant_name: tenant?.company_name ?? null,
      tenant_slug: tenant?.slug ?? null,
    } as CustomerManagementSendRow;
  });
}

/* -------------------------------------------------------------------------- */
/* The runner                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Ask the runner what it would do, or make it do it.
 *
 * Sending is the cron job's job; the page only ever previews (`dryRun`, the
 * default). The one real call from here is the kick `setTestMode` gives the
 * runner when a rehearsal starts, which can only reach the rehearsal address.
 */
export async function runNow(options?: {
  dryRun?: boolean;
  automation?: AutomationId;
  limit?: number;
}): Promise<RunSummary> {
  const { data, error } = await supabase.functions.invoke('customer-management-run', {
    body: {
      dry_run: options?.dryRun !== false,
      automation: options?.automation,
      limit: options?.limit,
    },
  });
  if (error) throw new Error(error.message);
  return data as RunSummary;
}

/* -------------------------------------------------------------------------- */
/* Scope preview                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How many operators the scope toggle reaches, each way.
 *
 * Shown beside the switch rather than after it is flipped. "All tenants" is an
 * abstraction; "142 operators" is a decision.
 */
export async function loadScopeCounts(scopeSlug: string): Promise<{ all: number; scoped: number }> {
  const [all, scoped] = await Promise.all([
    supabase.from('tenants').select('id', { count: 'exact', head: true }),
    supabase.from('tenants').select('id', { count: 'exact', head: true }).eq('slug', scopeSlug),
  ]);
  rethrow(all.error);
  return { all: all.count ?? 0, scoped: scoped.count ?? 0 };
}
