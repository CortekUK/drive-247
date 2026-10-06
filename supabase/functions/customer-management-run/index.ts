// customer-management-run
//
// The scheduler behind the super admin dashboard's Customer Management Service.
// Called every minute by cron, and on demand (with `dry_run`) by the admin page
// so somebody can see what WOULD go out before anything does.
//
// Three automations, none of which anything else on the platform sends:
//   signup   a sequence after an operator creates their Drive247 account
//   renewal  a warning before the subscription card is charged
//   receipt  a branded confirmation that a payment succeeded
//
// Request (POST, JSON), all optional:
//   { dry_run?: boolean, automation?: 'signup'|'renewal'|'receipt', limit?: number }
// Response: RunSummary from apps/admin/lib/customer-management/types.ts.
//
// ── ACCESS ─────────────────────────────────────────────────────────────────
//
// Two callers, and the difference matters. The cron job presents the SERVICE
// ROLE key and may send. A human presents their own JWT and must hold an active
// super admin row. `verify_jwt` stays at its default (true), so there is no
// supabase/config.toml entry; the anon key alone satisfies verify_jwt and is in
// every browser bundle, which is why the checks below are done again here
// rather than trusted from the gateway.
//
// ── WHY NOTHING HERE CAN MAIL THE WRONG PERSON ─────────────────────────────
//
// Three independent guards, because each one fails differently:
//
//   SCOPE. While `scope_all_tenants` is false — the seeded default — the tenant
//   query is narrowed to one slug. Not filtered later: narrowed in the query,
//   so a bug further down has no other tenant to reach.
//
//   TEST MODE REDIRECTS. With `test_mode` on, every recipient is replaced by
//   `test_recipient_email` and the runner HALTS if that is empty. Compressing a
//   14-day sequence into five minutes while still writing to the real operator
//   would deliver "Welcome to Drive247" to a paying customer at 26-second
//   intervals. Test mode changes the clock; it must never change who is written
//   to.
//
//   BACKFILL GRACE. A step is only sent if its due time is within
//   BACKFILL_GRACE_MS of now. Without this, the first tick after switching the
//   feature on would find every step of every existing tenant "due" — an
//   operator who signed up last year would receive the day-0 welcome, the day-7
//   check-in and the day-14 mail at once. Anything older is written as
//   'skipped' with detail 'past_backfill_grace', which closes the slot for good
//   and leaves the log saying why.
//
// Idempotency is the unique index on
// (tenant_id, automation, step_key, cycle_key) in
// customer_management_sends. The row is inserted BEFORE the provider is
// called, so a crash halfway leaves a record and does not double-mail; a
// duplicate-key error is the normal "already handled" path and is not an error.
//
// Depends on PENDING_20261006_customer_management_service.sql.txt. Until that
// is applied this function returns 503 and sends nothing — it fails closed.
// NOT DEPLOYED.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  emailBodyToPlainText,
  renderNotificationEmailHtml,
  sanitizeEmailBodyHtml,
  type EmailLayoutBrand,
} from '../_shared/notification-email-layout-v2.ts';
import {
  compressOffsets,
  cycleKey,
  nextBillingDate,
  selectSubscription,
  signupStepDueAt,
  renewalReminderDueAt,
  type AutomationId,
  type SubscriptionFacts,
} from './schedule.ts';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Drive247's own sender and brand for platform mail. Twins of
 * PLATFORM_SENDER_* / PLATFORM_EMAIL_BRAND in notification-test-v2/index.ts,
 * which are themselves twins of DEFAULT_BRANDING in _shared/resend-service.ts.
 * Keep them in step or these mails stop looking like the rest of ours.
 */
const PLATFORM_SENDER = 'Drive 247 <noreply@drive-247.com>';
const PLATFORM_EMAIL_BRAND: EmailLayoutBrand = {
  companyName: 'Drive 247',
  logoUrl: null,
  primaryColor: '#1a1a1a',
  accentColor: '#C5A572',
  contactEmail: 'support@drive-247.com',
  contactPhone: null,
};

/**
 * How late a step may be and still go out: 2 days in production, 10 minutes in
 * a rehearsal.
 *
 * This is the backfill guard described in the header. Two days is wide enough
 * that a weekend of failed cron runs still delivers, and narrow enough that
 * turning the feature on does not mail a year of history. The rehearsal window
 * is short because its whole timeline is five minutes long — a 2-day grace
 * there would make every step due immediately and defeat the compression.
 */
const BACKFILL_GRACE_MS = 2 * 86_400_000;
const BACKFILL_GRACE_MS_TEST = 10 * 60_000;

/** The platform URLs the templates link to. */
const PORTAL_URL = 'https://app.drive-247.com';
const BOOKING_URL_BASE = 'https://book.drive-247.com';

const PAID_INVOICE_LOOKBACK_MS = 36 * 3_600_000;

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

interface SettingsRow {
  signup_enabled: boolean;
  renewal_enabled: boolean;
  receipt_enabled: boolean;
  scope_all_tenants: boolean;
  scope_tenant_slug: string;
  test_mode: boolean;
  test_mode_started_at: string | null;
  test_run_id: string | null;
  test_recipient_email: string | null;
  max_sends_per_run: number;
}

interface StepRow {
  automation: AutomationId;
  step_key: string;
  label: string;
  offset_days: number;
  subject: string;
  body_html: string;
  enabled: boolean;
  sort_order: number;
}

interface TenantRow {
  id: string;
  slug: string;
  company_name: string | null;
  admin_email: string | null;
  contact_email: string | null;
  notification_recipient_email: string | null;
  created_at: string;
}

interface SubRow extends SubscriptionFacts {
  tenant_id: string;
  plan_name: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
}

interface InvoiceRow {
  id: string;
  tenant_id: string;
  status: string;
  amount_paid: number | null;
  currency: string | null;
  invoice_date: string | null;
  created_at: string;
}

type Candidate = {
  tenant: TenantRow;
  step: StepRow;
  dueAt: Date;
  cycle: string;
  /** Template variables particular to this candidate. */
  vars: Record<string, string>;
  /** Set when the candidate must be recorded but not sent. */
  skip?: string;
};

type Outcome = {
  tenant_slug: string;
  automation: AutomationId;
  step_key: string;
  status: 'sent' | 'skipped' | 'failed';
  to_email?: string | null;
  detail?: string | null;
};

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    return await handleRequest(req);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[CUSTOMER-MANAGEMENT-RUN] unhandled', reason);
    return jsonResponse({ ok: false, halted: reason }, 500);
  }
});

async function handleRequest(req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ ok: false, halted: 'not_configured' }, 500);
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  /* ---- who is calling ---- */

  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return jsonResponse({ ok: false, halted: 'unauthenticated' }, 401);

  const isCron = bearer === serviceKey;
  if (!isCron) {
    const { data: userData } = await db.auth.getUser(bearer);
    const authId = userData?.user?.id;
    if (!authId) return jsonResponse({ ok: false, halted: 'unauthenticated' }, 401);

    // An ACTIVE super admin, checked here rather than trusted from the
    // gateway: verify_jwt is satisfied by the anon key, which ships in every
    // browser bundle.
    const { data: appUser } = await db
      .from('app_users')
      .select('is_super_admin, is_active')
      .eq('auth_user_id', authId)
      .maybeSingle();
    if (!appUser?.is_super_admin || appUser.is_active === false) {
      return jsonResponse({ ok: false, halted: 'forbidden' }, 403);
    }
  }

  const body = (await req.json().catch(() => ({}))) as {
    dry_run?: boolean;
    automation?: AutomationId;
    limit?: number;
  };
  // A human may rehearse without sending. Cron never dry-runs: a scheduled run
  // that decided not to send would simply never deliver anything.
  const dryRun = !isCron && body.dry_run === true;
  const onlyAutomation = body.automation;

  /* ---- settings ---- */

  const { data: settings, error: settingsError } = await db
    .from('customer_management_settings')
    .select(
      'signup_enabled, renewal_enabled, receipt_enabled, scope_all_tenants, scope_tenant_slug, test_mode, test_mode_started_at, test_run_id, test_recipient_email, max_sends_per_run',
    )
    .eq('id', 1)
    .maybeSingle<SettingsRow>();

  if (settingsError || !settings) {
    // FAILS CLOSED. Without the settings row there is no scope, no test-mode
    // flag and no cap, so "send to everybody with defaults" is the one thing
    // this must not do.
    console.error('[CUSTOMER-MANAGEMENT-RUN] settings unavailable', settingsError?.message);
    return jsonResponse({ ok: false, halted: 'not_installed' }, 503);
  }

  const testMode = settings.test_mode === true;

  if (testMode && !settings.test_recipient_email) {
    return jsonResponse({ ok: false, test_mode: true, halted: 'test_recipient_missing' }, 409);
  }
  if (testMode && !settings.test_mode_started_at) {
    return jsonResponse({ ok: false, test_mode: true, halted: 'test_anchor_missing' }, 409);
  }

  const enabledAutomations = new Set<AutomationId>();
  if (settings.signup_enabled) enabledAutomations.add('signup');
  if (settings.renewal_enabled) enabledAutomations.add('renewal');
  if (settings.receipt_enabled) enabledAutomations.add('receipt');
  if (onlyAutomation) {
    for (const a of [...enabledAutomations]) if (a !== onlyAutomation) enabledAutomations.delete(a);
  }

  const summaryBase = { dry_run: dryRun, test_mode: testMode };
  if (enabledAutomations.size === 0) {
    return jsonResponse({ ok: true, ...summaryBase, considered: 0, sent: 0, skipped: 0, failed: 0, capped: false, results: [] });
  }

  /* ---- steps ---- */

  const { data: stepRows } = await db
    .from('customer_management_steps')
    .select('automation, step_key, label, offset_days, subject, body_html, enabled, sort_order')
    .eq('enabled', true)
    .order('automation')
    .order('sort_order');

  const steps = ((stepRows || []) as StepRow[]).filter((s) => enabledAutomations.has(s.automation));
  if (steps.length === 0) {
    return jsonResponse({ ok: true, ...summaryBase, considered: 0, sent: 0, skipped: 0, failed: 0, capped: false, results: [] });
  }

  /* ---- tenants: NARROWED, not filtered afterwards ---- */

  let tenantQuery = db
    .from('tenants')
    .select('id, slug, company_name, admin_email, contact_email, notification_recipient_email, created_at');
  if (!settings.scope_all_tenants) {
    tenantQuery = tenantQuery.eq('slug', settings.scope_tenant_slug);
  }
  const { data: tenantRows } = await tenantQuery;
  const tenants = (tenantRows || []) as TenantRow[];
  if (tenants.length === 0) {
    return jsonResponse({ ok: true, ...summaryBase, considered: 0, sent: 0, skipped: 0, failed: 0, capped: false, results: [] });
  }

  const tenantIds = tenants.map((t) => t.id);

  /* ---- subscriptions, grouped per tenant ---- */

  const { data: subRows } = await db
    .from('tenant_subscriptions')
    .select('tenant_id, status, current_period_end, trial_end, cancel_at, created_at, plan_name, amount, currency, interval')
    .in('tenant_id', tenantIds);

  const subsByTenant = new Map<string, SubRow[]>();
  for (const row of (subRows || []) as SubRow[]) {
    const list = subsByTenant.get(row.tenant_id) || [];
    list.push(row);
    subsByTenant.set(row.tenant_id, list);
  }

  /* ---- build candidates ---- */

  const now = new Date();
  const grace = testMode ? BACKFILL_GRACE_MS_TEST : BACKFILL_GRACE_MS;
  const anchorAt = settings.test_mode_started_at;
  const testRunId = settings.test_run_id;

  const candidates: Candidate[] = [];

  for (const automation of ['signup', 'renewal', 'receipt'] as AutomationId[]) {
    if (!enabledAutomations.has(automation)) continue;
    const automationSteps = steps.filter((s) => s.automation === automation);
    if (automationSteps.length === 0) continue;

    // Compress the whole set together, not step by step: that is what keeps
    // day 0, day 7 and day 14 distinct and in order in a rehearsal.
    const compressed = testMode
      ? compressOffsets(automationSteps.map((s) => s.offset_days))
      : new Map<number, number>();

    if (automation === 'receipt') {
      candidates.push(
        ...(await receiptCandidates(db, tenants, subsByTenant, automationSteps, now, testMode, testRunId)),
      );
      continue;
    }

    for (const tenant of tenants) {
      const sub = selectSubscription(subsByTenant.get(tenant.id) || []);

      for (const step of automationSteps) {
        const seconds = compressed.get(step.offset_days);

        if (automation === 'signup') {
          const dueAt = signupStepDueAt({
            signedUpAt: tenant.created_at,
            offsetDays: step.offset_days,
            testMode,
            anchorAt,
            compressedSeconds: seconds,
          });
          if (!dueAt || dueAt.getTime() > now.getTime()) continue;

          const cycle = cycleKey({ automation, testMode, testRunId });
          const late = now.getTime() - dueAt.getTime() > grace;
          candidates.push({
            tenant,
            step,
            dueAt,
            cycle,
            skip: late ? 'past_backfill_grace' : undefined,
            vars: planVars(sub),
          });
          continue;
        }

        /* renewal */
        const billing = nextBillingDate(sub, now);
        if (billing.skip) {
          // Recorded, not silently dropped: "why did this operator not get the
          // renewal reminder" is exactly what the log is for. Keyed on the
          // reason so one skip row is written per cycle, not per tick.
          candidates.push({
            tenant,
            step,
            dueAt: now,
            cycle: cycleKey({ automation, anchor: `skip:${billing.skip}`, testMode, testRunId }),
            skip: billing.skip,
            vars: planVars(sub),
          });
          continue;
        }

        const dueAt = renewalReminderDueAt({
          billingDate: billing.date,
          offsetDays: step.offset_days,
          testMode,
          anchorAt,
          compressedSeconds: seconds,
        });
        if (!dueAt || dueAt.getTime() > now.getTime()) continue;

        const late = now.getTime() - dueAt.getTime() > grace;
        const days = Math.max(
          0,
          Math.round((billing.date!.getTime() - now.getTime()) / 86_400_000),
        );
        candidates.push({
          tenant,
          step,
          dueAt,
          cycle: cycleKey({ automation, anchor: billing.date, testMode, testRunId }),
          skip: late ? 'past_backfill_grace' : undefined,
          vars: {
            ...planVars(sub),
            renewal_date: formatDay(billing.date),
            days_until_renewal: String(days),
          },
        });
      }
    }
  }

  /* ---- act ---- */

  const cap = Math.min(Math.max(body.limit ?? settings.max_sends_per_run, 1), settings.max_sends_per_run);
  // Skip rows are cheap but a first run can produce thousands of them; this
  // stops one tick writing the whole backlog and lets the next one continue.
  const writeCap = cap * 10;

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const results: Outcome[] = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let writes = 0;
  let capped = false;

  // Oldest first: if a run is capped, the mail that has been waiting longest
  // goes out rather than whichever tenant happened to sort first.
  candidates.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  for (const candidate of candidates) {
    if (sent >= cap || writes >= writeCap) {
      capped = true;
      break;
    }

    const recipient = testMode
      ? settings.test_recipient_email
      : candidate.tenant.notification_recipient_email?.trim() ||
        candidate.tenant.contact_email?.trim() ||
        candidate.tenant.admin_email?.trim() ||
        null;

    const skipReason = candidate.skip || (recipient ? null : 'no_recipient');

    if (dryRun) {
      results.push({
        tenant_slug: candidate.tenant.slug,
        automation: candidate.step.automation,
        step_key: candidate.step.step_key,
        status: skipReason ? 'skipped' : 'sent',
        to_email: recipient,
        detail: skipReason || 'would send',
      });
      if (skipReason) skipped++;
      else sent++;
      continue;
    }

    const vars = { ...baseVars(candidate.tenant, recipient), ...candidate.vars };
    const subject = fill(candidate.step.subject, vars);

    /*
     * CLAIM THE SLOT FIRST. The row goes in before Resend is called, so a
     * timeout or a cold start between the two leaves evidence and cannot
     * double-mail. A 23505 here is the ordinary "another tick already did
     * this" answer, not a failure.
     */
    const { error: claimError } = await db.from('customer_management_sends').insert({
      tenant_id: candidate.tenant.id,
      automation: candidate.step.automation,
      step_key: candidate.step.step_key,
      cycle_key: candidate.cycle,
      due_at: candidate.dueAt.toISOString(),
      status: skipReason ? 'skipped' : 'sent',
      sent_at: skipReason ? null : new Date().toISOString(),
      to_email: recipient,
      subject,
      detail: skipReason,
      test_mode: testMode,
    });
    writes++;

    if (claimError) {
      if ((claimError as { code?: string }).code === '23505') continue; // already handled
      console.error('[CUSTOMER-MANAGEMENT-RUN] could not claim', claimError.message);
      failed++;
      results.push({
        tenant_slug: candidate.tenant.slug,
        automation: candidate.step.automation,
        step_key: candidate.step.step_key,
        status: 'failed',
        detail: claimError.message,
      });
      continue;
    }

    if (skipReason) {
      skipped++;
      results.push({
        tenant_slug: candidate.tenant.slug,
        automation: candidate.step.automation,
        step_key: candidate.step.step_key,
        status: 'skipped',
        to_email: recipient,
        detail: skipReason,
      });
      continue;
    }

    const bodyHtml = sanitizeEmailBodyHtml(fill(candidate.step.body_html, vars));
    const html = renderNotificationEmailHtml({
      bodyHtml,
      brand: PLATFORM_EMAIL_BRAND,
      preheader: subject,
    });
    const text = emailBodyToPlainText(bodyHtml);

    const outcome = await sendOne(apiKey, recipient!, subject, html, text);

    if (outcome.ok) {
      sent++;
      results.push({
        tenant_slug: candidate.tenant.slug,
        automation: candidate.step.automation,
        step_key: candidate.step.step_key,
        status: 'sent',
        to_email: recipient,
      });
    } else {
      failed++;
      /*
       * The claim stays, marked 'failed'. It is NOT deleted so the next tick
       * can retry: a provider that rejects one mail usually rejects the retry
       * too, and a slot that reopens every minute is a loop that mails the
       * operator the moment the fault clears — possibly days of backlog at
       * once. A failure here is for a human to look at, which is what the log
       * is for.
       */
      await db
        .from('customer_management_sends')
        .update({ status: 'failed', sent_at: null, detail: outcome.detail })
        .eq('tenant_id', candidate.tenant.id)
        .eq('automation', candidate.step.automation)
        .eq('step_key', candidate.step.step_key)
        .eq('cycle_key', candidate.cycle);

      results.push({
        tenant_slug: candidate.tenant.slug,
        automation: candidate.step.automation,
        step_key: candidate.step.step_key,
        status: 'failed',
        to_email: recipient,
        detail: outcome.detail,
      });
    }
  }

  console.log(
    `[CUSTOMER-MANAGEMENT-RUN] considered=${candidates.length} sent=${sent} skipped=${skipped} failed=${failed}` +
      `${dryRun ? ' (dry run)' : ''}${testMode ? ' (test mode)' : ''}`,
  );

  return jsonResponse({
    ok: true,
    ...summaryBase,
    considered: candidates.length,
    sent,
    skipped,
    failed,
    capped,
    results: results.slice(0, 200),
  });
}

/* -------------------------------------------------------------------------- */
/* Receipts                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Receipts are event-driven, so they are found by polling recently PAID
 * invoices rather than by arithmetic on a date.
 *
 * Polling, and not a hook in the Stripe webhook: the webhook is the most
 * load-bearing function on the platform and this feature is not worth a change
 * to it. The invoice's own id is the cycle key, so a replayed webhook, a
 * reconciler backfill and two cron ticks all collapse to one receipt.
 */
async function receiptCandidates(
  db: ReturnType<typeof createClient>,
  tenants: TenantRow[],
  subsByTenant: Map<string, SubRow[]>,
  steps: StepRow[],
  now: Date,
  testMode: boolean,
  testRunId: string | null,
): Promise<Candidate[]> {
  const step = steps[0];
  if (!step) return [];

  const since = new Date(now.getTime() - PAID_INVOICE_LOOKBACK_MS).toISOString();
  const byId = new Map(tenants.map((t) => [t.id, t]));

  const { data: invoiceRows } = await db
    .from('tenant_subscription_invoices')
    .select('id, tenant_id, status, amount_paid, currency, invoice_date, created_at')
    .in('tenant_id', [...byId.keys()])
    .eq('status', 'paid')
    .gte('created_at', since);

  const out: Candidate[] = [];
  for (const invoice of (invoiceRows || []) as InvoiceRow[]) {
    const tenant = byId.get(invoice.tenant_id);
    if (!tenant) continue;
    // A zero-value paid invoice is a 100% coupon or a proration that nets to
    // nothing. "We have received your payment of $0.00" is not a receipt.
    if (!invoice.amount_paid || invoice.amount_paid <= 0) continue;

    const sub = selectSubscription(subsByTenant.get(tenant.id) || []);
    const billing = nextBillingDate(sub, now);
    const paidOn = invoice.invoice_date || invoice.created_at;

    out.push({
      tenant,
      step,
      dueAt: new Date(paidOn),
      cycle: cycleKey({ automation: 'receipt', anchor: invoice.id, testMode, testRunId }),
      vars: {
        ...planVars(sub),
        receipt_amount: formatMoney(invoice.amount_paid, invoice.currency || sub?.currency || 'usd'),
        receipt_date: formatDay(new Date(paidOn)),
        receipt_reference: invoice.id,
        renewal_date: billing.date ? formatDay(billing.date) : '—',
      },
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

function baseVars(tenant: TenantRow, recipient: string | null): Record<string, string> {
  return {
    tenant_name: tenant.company_name || tenant.slug,
    tenant_slug: tenant.slug,
    // The operator's own name is not a column on tenants; the company reads
    // correctly in "Hi {{tenant_admin_name}}" and is never blank, which a
    // missing first name would be.
    tenant_admin_name: tenant.company_name || tenant.slug,
    tenant_contact_email: tenant.contact_email || '',
    sign_in_email: recipient || tenant.contact_email || '',
    portal_url: PORTAL_URL,
    booking_url: `${BOOKING_URL_BASE}/${tenant.slug}`,
  };
}

function planVars(sub: SubRow | null): Record<string, string> {
  return {
    plan_name: sub?.plan_name || 'your plan',
    plan_amount: sub ? formatMoney(sub.amount, sub.currency || 'usd') : '—',
    plan_interval: sub?.interval || 'month',
    renewal_date: sub?.current_period_end ? formatDay(new Date(sub.current_period_end)) : '—',
  };
}

/**
 * Replace every `{{key}}` the map knows about.
 *
 * An UNKNOWN key is left exactly as written rather than blanked. A mail that
 * reads "renews on {{renewal_date}}" is obviously broken and gets reported; one
 * that reads "renews on " looks like a design choice and survives for months.
 */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, key: string) => {
    const value = vars[key.toLowerCase()];
    return value === undefined ? whole : value;
  });
}

/** Stripe stores minor units; `amount` here is already major (see rentals page). */
function formatMoney(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}

function formatDay(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* -------------------------------------------------------------------------- */
/* Resend                                                                     */
/* -------------------------------------------------------------------------- */

async function sendOne(
  apiKey: string | undefined,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<{ ok: boolean; detail?: string }> {
  if (!apiKey) return { ok: false, detail: 'RESEND_API_KEY is not set' };

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: PLATFORM_SENDER,
        to: [to],
        subject,
        html,
        text,
        headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
      }),
    });
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as { message?: string } | null;
    const detail =
      typeof parsed?.message === 'string' && parsed.message.trim()
        ? parsed.message.trim().slice(0, 200)
        : `HTTP ${response.status}`;
    return { ok: false, detail };
  }

  return { ok: true };
}
