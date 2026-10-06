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
  'id, signup_enabled, renewal_enabled, receipt_enabled, scope_all_tenants, scope_tenant_slug, test_mode, test_mode_started_at, test_run_id, test_recipient_email, max_sends_per_run, updated_at, updated_by';

const STEP_COLUMNS =
  'id, automation, step_key, label, offset_days, subject, body_html, enabled, sort_order, updated_at, updated_by';

/**
 * Raised when the tables are not there yet.
 *
 * The migration is `PENDING_20261006_customer_management_service.sql.txt` and
 * has deliberately not been applied, so the page has to render something
 * honest in the meantime. PostgREST answers an unknown relation with 42P01;
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
 * Switch Developer Test Mode on or off.
 *
 * Not a plain boolean write, because three columns have to move together: the
 * anchor the compressed timeline counts from, the run id that keeps one
 * rehearsal's log rows from blocking the next, and the recipient every mail is
 * redirected to. The database has CHECK constraints saying test mode cannot
 * exist without the first two, so writing the flag alone would simply fail —
 * which is the intended design, but a confusing error to hand somebody.
 *
 * Switching OFF clears the anchor and the run id so the next rehearsal starts
 * from scratch rather than resuming a timeline that began days ago.
 */
export async function setTestMode(
  on: boolean,
  recipientEmail: string | null,
): Promise<CustomerManagementSettings> {
  if (on && !recipientEmail?.trim()) {
    throw new Error('Add the email address rehearsal mail should go to first.');
  }

  return saveSettings(
    on
      ? {
          test_mode: true,
          test_mode_started_at: new Date().toISOString(),
          test_run_id: crypto.randomUUID().slice(0, 8),
          test_recipient_email: recipientEmail!.trim(),
        }
      : {
          test_mode: false,
          test_mode_started_at: null,
          test_run_id: null,
          // The address is kept: whoever rehearses next is almost always the
          // same person, and retyping it is the step they would skip.
          test_recipient_email: recipientEmail?.trim() || null,
        },
  );
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
  patch: Pick<CustomerManagementStep, 'label' | 'offset_days' | 'subject' | 'body_html' | 'enabled'>,
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
 * `dryRun` is the default on purpose. The page's button is "Preview what would
 * send", and sending for real is a second, explicit press — because the one
 * thing nobody wants from an admin page is to discover what the automation
 * does by having it mail every operator.
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
