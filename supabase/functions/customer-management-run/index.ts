// customer-management-run
//
// The scheduler behind the super admin dashboard's Customer Management Service.
// Called every 30 seconds by the pg_cron job `customer-management-run`, which is
// what makes the module fully automatic: a new tenant's day-0 email goes out on
// the next tick after the tenant is created, with nobody pressing anything.
// The admin page also calls it with `dry_run` to preview, and once right after
// test mode is switched on so the day-0 rehearsal email arrives immediately.
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
//   TEST MODE IS NORTHWIND ONLY. With `test_mode` on, the tenant query is
//   narrowed to the scope tenant (Northwind) even if `scope_all_tenants` is on,
//   and every email goes to `test_recipient_email` — which the admin page fills
//   in automatically with Northwind's own email, falling back here to
//   Northwind's contact address if it is somehow empty. Compressing a 14-day
//   sequence into three minutes across every tenant would deliver "Welcome to
//   Drive247" to paying customers a minute apart; a rehearsal is one tenant.
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
// Depends on the tables from PENDING_20261006_customer_management_service.sql.txt
// (applied 2026-10-06). Without them this function returns 503 and sends
// nothing — it fails closed.

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
  renewalTestSeconds,
  latestDueIndex,
  latestRepeatDue,
  repeatEveryMs,
  daysText,
  type AutomationId,
  type SubscriptionFacts,
} from './schedule.ts';
import { renderBody } from './plain-text.ts';

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
 * is short because its whole timeline is three minutes long — a 2-day grace
 * there would make every step due immediately and defeat the compression.
 */
const BACKFILL_GRACE_MS = 2 * 86_400_000;
const BACKFILL_GRACE_MS_TEST = 10 * 60_000;

/**
 * The tenant's own sites, built the way the rest of the platform builds them
 * (send-user-welcome-email, signup-provision). There is no shared host with a
 * slug path: book.drive-247.com/{slug} is a 404 and app.drive-247.com is the
 * booking app with no tenant.
 */
const portalUrl = (slug: string) => `https://${slug}.portal.drive-247.com`;
const bookingUrl = (slug: string) => `https://${slug}.drive-247.com`;
/** Where the tenant sees its real invoices — a receipt's link when Stripe gave none. */
const billingUrl = (slug: string) => `${portalUrl(slug)}/subscription`;

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
  /**
   * Developer page's renewal simulator: a pretend next payment date for the
   * scope tenant (Northwind). See RENEWAL SIMULATOR below.
   */
  test_renewal_date: string | null;
  /**
   * Developer page's receipt simulator: when a pretend payment for the scope
   * tenant (Northwind) was made. See RECEIPT SIMULATOR below.
   */
  test_receipt_at: string | null;
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
  /** Checked when the step is due; NULL sends always. See `unmetCondition`. */
  send_if: SendIf | null;
  /**
   * Conditional steps only: send again every N days until the condition stops
   * holding. NULL sends once. Ignored without `send_if` — an unconditional
   * step that repeated would never stop.
   */
  repeat_every_days: number | null;
  created_at: string;
}

type SendIf = 'stripe_not_connected' | 'bonzah_form_not_submitted';

interface TenantRow {
  id: string;
  slug: string;
  company_name: string | null;
  admin_email: string | null;
  contact_email: string | null;
  notification_recipient_email: string | null;
  created_at: string;
  stripe_onboarding_complete: boolean | null;
  stripe_account_status: string | null;
  own_stripe_account_id: string | null;
  own_stripe_test_account_id: string | null;
}

/**
 * Stripe is connected, by the same rule the portal's setup checklist uses
 * (apps/portal/src/hooks/use-setup-status.ts): the tenant's own Stripe
 * account, or a Connect account that finished onboarding and is active.
 */
function stripeConnected(t: TenantRow): boolean {
  return (
    !!t.own_stripe_account_id ||
    !!t.own_stripe_test_account_id ||
    (!!t.stripe_onboarding_complete && t.stripe_account_status === 'active')
  );
}

/**
 * Why a conditional step should NOT go out, or null when it should. Checked at
 * the moment the step is due, so a tenant who connected Stripe on day 6 never
 * gets the day-7 nudge.
 *
 * The Bonzah check is about the FORM only: a pending or approved submission
 * counts as sent. A rejected one does not — they have to send it again. Whether
 * Bonzah is actually connected (approved and switched on) is a separate thing
 * and does not matter here.
 */
function unmetCondition(
  sendIf: SendIf | null,
  tenant: TenantRow,
  bonzahFormSent: Set<string>,
): string | null {
  if (sendIf === 'stripe_not_connected' && stripeConnected(tenant)) return 'stripe_already_connected';
  if (sendIf === 'bonzah_form_not_submitted' && bonzahFormSent.has(tenant.id)) {
    return 'bonzah_form_already_submitted';
  }
  return null;
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
  /** Minor units (cents), as Stripe sends them. */
  amount_paid: number | null;
  currency: string | null;
  invoice_date: string | null;
  paid_at: string | null;
  created_at: string;
  invoice_number: string | null;
  stripe_invoice_id: string | null;
  stripe_charge_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_receipt_url: string | null;
  stripe_hosted_invoice_url: string | null;
  stripe_invoice_pdf: string | null;
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
  /** Log the row as a test send even outside test mode (the simulator). */
  test?: boolean;
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
      'signup_enabled, renewal_enabled, receipt_enabled, scope_all_tenants, scope_tenant_slug, test_mode, test_mode_started_at, test_run_id, test_recipient_email, test_renewal_date, test_receipt_at, max_sends_per_run',
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
    .select('automation, step_key, label, offset_days, subject, body_html, enabled, sort_order, send_if, repeat_every_days, created_at')
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
    .select(
      'id, slug, company_name, admin_email, contact_email, notification_recipient_email, created_at, stripe_onboarding_complete, stripe_account_status, own_stripe_account_id, own_stripe_test_account_id',
    );
  // A rehearsal is always the scope tenant alone — see TEST MODE in the header.
  if (testMode || !settings.scope_all_tenants) {
    tenantQuery = tenantQuery.eq('slug', settings.scope_tenant_slug);
  }
  const { data: tenantRows } = await tenantQuery;
  const tenants = (tenantRows || []) as TenantRow[];
  if (tenants.length === 0) {
    return jsonResponse({ ok: true, ...summaryBase, considered: 0, sent: 0, skipped: 0, failed: 0, capped: false, results: [] });
  }

  // Where rehearsal mail goes: the address stamped when test mode was switched
  // on, else the scope tenant's own. Never a guess — no address, no send.
  const testRecipient = testMode
    ? settings.test_recipient_email?.trim() || tenantEmail(tenants[0])
    : null;
  if (testMode && !testRecipient) {
    return jsonResponse({ ok: false, test_mode: true, halted: 'test_recipient_missing' }, 409);
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

  /* ---- Bonzah forms sent (pending or approved), for the day-7 check ---- */

  const bonzahFormSent = new Set<string>();
  if (steps.some((s) => s.send_if === 'bonzah_form_not_submitted')) {
    const { data: formRows, error: formError } = await db
      .from('bonzah_onboarding_submissions')
      .select('tenant_id')
      .in('tenant_id', tenantIds)
      .in('status', ['pending', 'approved']);
    // Fail closed: without the answer we cannot know who still needs the
    // reminder, and nagging someone who already sent the form is the worse
    // mistake. Nothing is claimed, so the next tick tries again.
    if (formError) {
      return jsonResponse({ ok: false, halted: 'bonzah_forms_unreadable', detail: formError.message }, 500);
    }
    for (const row of (formRows || []) as { tenant_id: string }[]) bonzahFormSent.add(row.tenant_id);
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
    // day 0, day 7 and day 14 distinct and in order in a rehearsal. Renewal
    // reminders count DOWN, so they get their own one-minute countdown.
    const offsets = automationSteps.map((s) => s.offset_days);
    const compressed = !testMode
      ? new Map<number, number>()
      : automation === 'renewal'
        ? renewalTestSeconds(offsets)
        : compressOffsets(offsets);

    if (automation === 'receipt') {
      candidates.push(
        ...(await receiptCandidates(db, tenants, subsByTenant, automationSteps, now, settings, grace)),
      );
      continue;
    }

    for (const tenant of tenants) {
      const sub = selectSubscription(subsByTenant.get(tenant.id) || []);

      // Signup steps one by one; renewal is worked out per tenant below,
      // because only the latest due reminder may go out.
      for (const step of automation === 'signup' ? automationSteps : []) {
        if (step.send_if && step.repeat_every_days) {
          const reminder = repeatingReminder({ tenant, step, sub, compressed, testMode, anchorAt, testRunId, now, grace, bonzahFormSent });
          if (reminder) candidates.push(reminder);
          continue;
        }

        const dueAt = signupStepDueAt({
          signedUpAt: tenant.created_at,
          offsetDays: step.offset_days,
          testMode,
          anchorAt,
          compressedSeconds: compressed.get(step.offset_days),
        });
        if (!dueAt || dueAt.getTime() > now.getTime()) continue;

        const late = now.getTime() - dueAt.getTime() > grace;
        candidates.push({
          tenant,
          step,
          dueAt,
          cycle: cycleKey({ automation, testMode, testRunId }),
          skip: late ? 'past_backfill_grace' : unmetCondition(step.send_if, tenant, bonzahFormSent) ?? undefined,
          vars: planVars(sub),
        });
      }

      if (automation === 'renewal') {
        candidates.push(
          ...renewalCandidates({
            tenant,
            sub,
            steps: automationSteps,
            compressed,
            settings,
            now,
            grace,
          }),
        );
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

    const recipient = testMode ? testRecipient : tenantEmail(candidate.tenant);

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
      test_mode: testMode || candidate.test === true,
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

    // Plain-English templates become paragraphs, bullets and links here; a
    // template written in HTML is used as it is.
    const bodyHtml = sanitizeEmailBodyHtml(
      renderBody(candidate.step.body_html, (text) => fill(text, vars)),
    );
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
/* Renewal reminders                                                          */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/** Twin of `simRunId` in apps/admin/components/admin/developer/renewal-simulator.tsx. */
function simRunId(simDate: string): string {
  return `sim-${Math.floor(new Date(simDate).getTime() / 60_000)}`;
}

/**
 * The renewal countdown for one tenant: "3 days left", "2 days left",
 * "1 day left" before the next subscription payment.
 *
 * Every tick re-reads the tenant's subscription, works out the next payment
 * date (`nextBillingDate` — trial end for a trial, period end otherwise, and
 * nothing at all for a cancelled or past-due one), and sends whichever
 * reminder is due. The cycle key is the payment DAY, so each billing period
 * gets its own countdown and a later tick cannot repeat one.
 *
 * ONLY THE LATEST DUE REMINDER IS SENT. A tenant who comes into scope with one
 * day left gets "1 day left", not all three in the same minute; the earlier
 * ones are logged as superseded.
 *
 * ── RENEWAL SIMULATOR ──────────────────────────────────────────────────────
 *
 * `test_renewal_date`, set from the Developer page, replaces the scope
 * tenant's (Northwind's) real payment date with a pretend one, under the REAL
 * production rules — real days, real grace. Set it to 3 days from now and the
 * "3 days left" email goes out on the next tick; move it to 2 days and the
 * next one does. The billing tables are never touched, and the sends are
 * logged as test rows keyed apart from production, so a simulation can never
 * use up a real reminder.
 *
 * In TEST MODE the countdown is compressed instead: 3 days left at once, then
 * one minute per day. With no live subscription the rehearsal pretends the
 * payment is due when the countdown ends, so it can always be played.
 */
function renewalCandidates(args: {
  tenant: TenantRow;
  sub: SubRow | null;
  steps: StepRow[];
  compressed: Map<number, number>;
  settings: SettingsRow;
  now: Date;
  grace: number;
}): Candidate[] {
  const { tenant, sub, steps, compressed, settings, now, grace } = args;
  const testMode = settings.test_mode === true;

  const simDate =
    settings.test_renewal_date && tenant.slug === settings.scope_tenant_slug
      ? settings.test_renewal_date
      : null;
  const simulated = !testMode && simDate !== null;

  const effective: SubRow | null = simDate
    ? {
        tenant_id: tenant.id,
        status: 'active',
        current_period_end: simDate,
        trial_end: null,
        cancel_at: null,
        created_at: now.toISOString(),
        plan_name: sub?.plan_name ?? 'Test plan',
        amount: sub?.amount ?? null,
        currency: sub?.currency ?? 'usd',
        interval: sub?.interval ?? 'month',
      }
    : sub;

  let billing = nextBillingDate(effective, now);
  if (testMode && billing.skip) {
    const maxOffset = Math.max(0, ...steps.map((s) => s.offset_days));
    const anchor = new Date(settings.test_mode_started_at!).getTime();
    billing = { date: new Date(anchor + maxOffset * DAY_MS), skip: null };
  }

  // Each pretend date is its own run, so setting "3 days from now" again
  // later sends a fresh email instead of finding the first one already done.
  const testRunId = simulated ? simRunId(simDate!) : settings.test_run_id;
  const asTest = testMode || simulated;

  if (billing.skip) {
    // Recorded, not silently dropped: "why did this operator not get the
    // reminder" is exactly what the log is for. Keyed on the reason so one
    // skip row is written per step, not one per tick.
    return steps.map((step) => ({
      tenant,
      step,
      dueAt: now,
      cycle: cycleKey({ automation: 'renewal', anchor: `skip:${billing.skip}`, testMode: asTest, testRunId }),
      skip: billing.skip!,
      test: simulated,
      vars: planVars(effective),
    }));
  }

  const due: Candidate[] = [];
  for (const step of steps) {
    const dueAt = renewalReminderDueAt({
      billingDate: billing.date,
      offsetDays: step.offset_days,
      testMode,
      anchorAt: settings.test_mode_started_at,
      compressedSeconds: compressed.get(step.offset_days),
    });
    if (!dueAt || dueAt.getTime() > now.getTime()) continue;

    due.push({
      tenant,
      step,
      dueAt,
      cycle: cycleKey({ automation: 'renewal', anchor: billing.date, testMode: asTest, testRunId }),
      skip: now.getTime() - dueAt.getTime() > grace ? 'past_backfill_grace' : undefined,
      test: simulated,
      vars: {
        ...planVars(effective),
        renewal_date: formatDay(billing.date),
        // The step's own number, not arithmetic on the clock: the "3 days
        // left" email says 3 even if the tick ran a few seconds late.
        days_until_renewal: String(step.offset_days),
        days_until_renewal_text: daysText(step.offset_days),
      },
    });
  }

  const latest = latestDueIndex(due.map((c) => c.dueAt.getTime()));
  return due.map((c, i) => (i === latest || c.skip ? c : { ...c, skip: 'superseded' }));
}

/* -------------------------------------------------------------------------- */
/* Repeating setup reminders                                                  */
/* -------------------------------------------------------------------------- */

/**
 * "Connect Stripe" / "Send the Bonzah form": first on day `offset_days`, then
 * every `repeat_every_days` until the operator has done it — day 3, 6, 9, ...
 * Each repeat is its own send-log row (cycle `rep:<n>`), so one tick sends it
 * once however often the cron runs.
 *
 * - DONE: once the condition no longer holds there is nothing to remind them
 *   of, so no candidate at all. Not a skip row: a skip row per tenant every
 *   few days, forever, would bury the log.
 * - ONLY NEW SIGNUPS: a company that signed up before this reminder existed
 *   never gets it. Without that, switching on "all tenants" would start
 *   mailing every older account that never connected Stripe — many of them
 *   long gone — every three days.
 * - Only the latest repeat that is due is considered, never the backlog.
 */
function repeatingReminder(args: {
  tenant: TenantRow;
  step: StepRow;
  sub: SubRow | null;
  compressed: Map<number, number>;
  testMode: boolean;
  anchorAt: string | null;
  testRunId: string | null;
  now: Date;
  grace: number;
  bonzahFormSent: Set<string>;
}): Candidate | null {
  const { tenant, step, testMode, now } = args;
  if (unmetCondition(step.send_if, tenant, args.bonzahFormSent)) return null;
  // A rehearsal is anchored on when test mode started, not on signup, so the
  // new-signups rule would only ever stop Northwind from being tested.
  if (!testMode && new Date(tenant.created_at).getTime() < new Date(step.created_at).getTime()) return null;

  const firstDueAt = signupStepDueAt({
    signedUpAt: tenant.created_at,
    offsetDays: step.offset_days,
    testMode,
    anchorAt: args.anchorAt,
    compressedSeconds: args.compressed.get(step.offset_days),
  });
  if (!firstDueAt) return null;

  const latest = latestRepeatDue({
    firstDueAt,
    everyMs: repeatEveryMs(step.repeat_every_days ?? 0, testMode),
    now,
  });
  if (!latest) return null;

  return {
    tenant,
    step,
    dueAt: latest.dueAt,
    cycle: cycleKey({ automation: 'signup', occurrence: latest.occurrence, testMode, testRunId: args.testRunId }),
    skip: now.getTime() - latest.dueAt.getTime() > args.grace ? 'past_backfill_grace' : undefined,
    vars: planVars(args.sub),
  };
}

/* -------------------------------------------------------------------------- */
/* Receipts                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Billing receipts: one email per PAID subscription invoice, carrying Stripe's
 * own references — the invoice number, the invoice id and the payment id —
 * and links to Stripe's receipt and the invoice PDF.
 *
 * Found by polling recently paid invoices rather than by a hook in the Stripe
 * webhook: the webhook is the most load-bearing function on the platform and
 * this feature is not worth a change to it. The invoice's own row id is the
 * cycle key, so a replayed webhook, a reconciler backfill and two cron ticks
 * all collapse to one receipt.
 *
 * Polled on `updated_at`, not `created_at`: an invoice row is often written
 * while still open and only flips to paid later (a retried card, a hosted
 * invoice paid by hand). Polling on creation would miss exactly those.
 *
 * ── RECEIPT SIMULATOR ──────────────────────────────────────────────────────
 *
 * `test_receipt_at`, set by the Developer page's "Simulate a paid payment",
 * makes a pretend paid invoice for the scope tenant (Northwind), dated then,
 * with TEST references. It goes through exactly the same template and sender
 * as a real receipt, to the tenant's own email, and is logged as a test row.
 * No invoice row is written and Stripe is never called.
 */
async function receiptCandidates(
  // The service-role client from handleRequest. Typed loosely because
  // `ReturnType<typeof createClient>` resolves to a schema-less client that the
  // real one does not assign to.
  // deno-lint-ignore no-explicit-any
  db: any,
  tenants: TenantRow[],
  subsByTenant: Map<string, SubRow[]>,
  steps: StepRow[],
  now: Date,
  settings: SettingsRow,
  grace: number,
): Promise<Candidate[]> {
  const step = steps[0];
  if (!step) return [];

  const testMode = settings.test_mode === true;
  const since = new Date(now.getTime() - PAID_INVOICE_LOOKBACK_MS).toISOString();
  const byId = new Map(tenants.map((t) => [t.id, t]));

  const { data: invoiceRows } = await db
    .from('tenant_subscription_invoices')
    .select(
      'id, tenant_id, status, amount_paid, currency, invoice_date, paid_at, created_at, invoice_number, stripe_invoice_id, stripe_charge_id, stripe_payment_intent_id, stripe_receipt_url, stripe_hosted_invoice_url, stripe_invoice_pdf',
    )
    .in('tenant_id', [...byId.keys()])
    .eq('status', 'paid')
    .gte('updated_at', since);

  const invoices = (invoiceRows || []) as InvoiceRow[];

  /* ---- the simulator's pretend payment ---- */
  const scopeTenant = tenants.find((t) => t.slug === settings.scope_tenant_slug);
  if (settings.test_receipt_at && scopeTenant) {
    const sub = selectSubscription(subsByTenant.get(scopeTenant.id) || []);
    const stamp = Math.floor(new Date(settings.test_receipt_at).getTime() / 60_000);
    invoices.push({
      id: `sim-${stamp}`,
      tenant_id: scopeTenant.id,
      status: 'paid',
      amount_paid: sub?.amount && sub.amount > 0 ? sub.amount : 9900,
      currency: sub?.currency || 'usd',
      invoice_date: settings.test_receipt_at,
      paid_at: settings.test_receipt_at,
      created_at: settings.test_receipt_at,
      invoice_number: `TEST-${stamp}`,
      stripe_invoice_id: `in_test_${stamp}`,
      stripe_charge_id: `ch_test_${stamp}`,
      stripe_payment_intent_id: null,
      stripe_receipt_url: null,
      // A pretend payment has no Stripe invoice to link to, and another
      // tenant's real one must never be borrowed — so both links open the
      // tenant's own billing page, which is real and works.
      stripe_hosted_invoice_url: billingUrl(scopeTenant.slug),
      stripe_invoice_pdf: null,
    });
  }

  const out: Candidate[] = [];
  for (const invoice of invoices) {
    const tenant = byId.get(invoice.tenant_id);
    if (!tenant) continue;
    // A zero-value paid invoice is a 100% coupon or a proration that nets to
    // nothing. "We have received your payment of $0.00" is not a receipt.
    if (!invoice.amount_paid || invoice.amount_paid <= 0) continue;

    const simulated = invoice.id.startsWith('sim-');
    const sub = selectSubscription(subsByTenant.get(tenant.id) || []);
    const billing = nextBillingDate(sub, now);
    const paidOn = new Date(invoice.paid_at || invoice.invoice_date || invoice.created_at);

    out.push({
      tenant,
      step,
      dueAt: paidOn,
      cycle: cycleKey({
        automation: 'receipt',
        anchor: invoice.id,
        testMode: testMode || simulated,
        testRunId: simulated ? 'sim' : settings.test_run_id,
      }),
      // An old invoice that only just changed (a refund note, a backfilled
      // PDF link) is not a payment that just happened.
      skip: now.getTime() - paidOn.getTime() > grace ? 'past_backfill_grace' : undefined,
      test: simulated,
      vars: {
        ...planVars(sub),
        receipt_amount: formatMoney(invoice.amount_paid, invoice.currency || sub?.currency || 'usd'),
        receipt_date: formatDay(paidOn),
        receipt_reference: invoice.invoice_number || invoice.stripe_invoice_id || invoice.id,
        stripe_invoice_number: invoice.invoice_number || '—',
        stripe_invoice_id: invoice.stripe_invoice_id || '—',
        stripe_payment_id: invoice.stripe_charge_id || invoice.stripe_payment_intent_id || '—',
        receipt_url: invoice.stripe_receipt_url || invoice.stripe_hosted_invoice_url || billingUrl(tenant.slug),
        invoice_pdf_url: invoice.stripe_invoice_pdf || invoice.stripe_hosted_invoice_url || billingUrl(tenant.slug),
        renewal_date: billing.date ? formatDay(billing.date) : '—',
      },
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

/** The address an operator's mail goes to, in the platform's usual order. */
function tenantEmail(tenant: TenantRow): string | null {
  return (
    tenant.notification_recipient_email?.trim() ||
    tenant.contact_email?.trim() ||
    tenant.admin_email?.trim() ||
    null
  );
}

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
    portal_url: portalUrl(tenant.slug),
    booking_url: bookingUrl(tenant.slug),
    // The deep links the portal's own setup checklist uses
    // (use-setup-status.ts). They work on v1 and v2 alike: v2 forwards
    // ?tab=payments to the Integrations board, and ?tab=insurance still renders.
    // `/integrations` would 404 for every tenant not on v2.
    stripe_connect_url: `${portalUrl(tenant.slug)}/settings?tab=payments`,
    bonzah_form_url: `${portalUrl(tenant.slug)}/settings?tab=insurance`,
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

/**
 * Money from Stripe, in MINOR units (cents): 15000 -> "$150.00".
 *
 * Both `tenant_subscriptions.amount` and the invoice amounts are stored the
 * way Stripe sends them, and the admin Rental Companies page divides by 100
 * for the same reason (`formatMinor`, rentals/page.tsx). Formatting them as
 * dollars would tell an operator on a $350 plan that they pay $35,000.
 */
function formatMoney(amountMinor: number | null | undefined, currency: string): string {
  if (amountMinor === null || amountMinor === undefined || Number.isNaN(amountMinor)) return '—';
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
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
