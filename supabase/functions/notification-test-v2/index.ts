// notification-test-v2
//
// Sends ONE test of a notification template to the person testing it, for the
// v2 Settings → Notifications page (northwind canary; build-spec §Edge function,
// D15, D18). Nothing else calls it, and it can never reach a customer:
//   email  one address the operator typed (the page pre-fills their own);
//   push   the caller's OWN active staff devices in this tenant (send-push's
//          `self` target), never anyone else's.
//
// Request (POST, JSON) — NotificationTestRequest in
// apps/portal/src/lib/notifications-v2/types.ts, plus `tenantId` / `tenantSlug`
// which only a super admin's request uses:
//   { channel: 'email', notificationKey, to, subject, bodyHtml }
//   { channel: 'push',  notificationKey, title, body, url?, pushOptions? }
// Response — NotificationTestResponse: { success, sent?, failed?, message?,
// error?, code? }. Request, auth and configuration problems are 4xx/5xx with
// { success:false, error, code }. A valid push that reaches no device is a 200
// with success:false (code no_devices / devices_failed), so the page can show
// the sentence as it is.
//
// Access mirrors send-push exactly: a Bearer JWT, an ACTIVE app_users row, and
// one of super admin / head_admin / admin / a manager with editor on
// settings.reminders. The tenant comes from the caller's app_users row; only a
// super admin (tenant_id NULL by design) names one, by tenantId or tenantSlug.
//
// Rate limit: 20 tests per user per rolling hour, counted in
// notification_test_sends_v2 (ops/notifications_v2.sql). Until that table
// exists the send is allowed and a warning is logged. One row is written per
// send attempt that passed validation; rejected requests are not logged, so a
// locked-out user cannot extend their own lockout.
//
// The email is built by _shared/notification-email-layout-v2.ts, the
// byte-identical copy of the module the portal preview uses, from the same
// tenant columns (see emailBrandFromTenant), so the preview is what arrives.
// From is tenant_email_sender when it is valid, else today's sender
// "{company_name} <{slug}@drive-247.com>" (_shared/resend-service.ts). Resend is
// called directly: resend-service rewrites every From to the default, which
// would make the sender settings impossible to test.
//
// v2 rules: this is a NEW function; it edits no existing function or helper
// (it imports cors.ts, web-push.ts and the new layout helper). NOT DEPLOYED.
// verify_jwt stays at the default (true): no supabase/config.toml entry.
//
// TESTED (Sep 19 2026) with a Deno harness that stubs fetch (GoTrue, PostgREST,
// Resend, a push service) and drives real requests through handleRequest:
// roles, tenant resolution, validation, rate limit, sender fallback, preview
// parity, push fan-out and bookkeeping. It is not in the repo; it lives in the
// session scratchpad next to the SQL suite named in ops/notifications_v2.sql
// (edge_test.ts; `npx -y deno@2 run -A --no-check edge_test.ts`).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getVapidKeys, sendWebPush, type PushPayload } from '../_shared/web-push.ts';
import {
  emailBodyToPlainText,
  renderNotificationEmailHtml,
  sanitizeEmailBodyHtml,
  type EmailLayoutBrand,
} from '../_shared/notification-email-layout-v2.ts';

/* -------------------------------------------------------------------------- */
/* Limits (TS twins in apps/portal/src/lib/notifications-v2/*)                  */
/* -------------------------------------------------------------------------- */

/** Roles that may test without an explicit grant (send-push's FULL_ACCESS_ROLES). */
export const FULL_ACCESS_ROLES = new Set(['head_admin', 'admin']);
/** The manager grant that owns the Notifications page (lib/permissions.ts). */
export const MANAGER_TAB_KEY = 'settings.reminders';

export const RATE_LIMIT = 20;
export const RATE_WINDOW_MS = 60 * 60 * 1000;

/** The DB CHECK on notification_key (catalog keys). */
export const NOTIFICATION_KEY_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
export const EMAIL_SUBJECT_MAX = 200;
export const EMAIL_BODY_MAX_BYTES = 100 * 1024;
export const PUSH_TITLE_MAX = 100;
export const PUSH_BODY_MAX = 300;
const URL_MAX = 500;
/** Whole request cap: a 100 KB body plus JSON escaping headroom. */
const REQUEST_MAX_CHARS = 400_000;

export const EMAIL_SENDER_DOMAIN = 'drive-247.com';
/** The DB CHECK on tenant_email_sender.from_local_part (settings-model LOCAL_PART_PATTERN). */
export const LOCAL_PART_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** settings-model isValidEmail: one plausible address, nothing that could smuggle a second. */
const EMAIL_PATTERN = /^[^\s@<>"'(),;:\\[\]]+@[^\s@<>"'(),;:\\[\]]+\.[^\s@<>"'(),;:\\[\]]{2,}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PUSH_SOURCE = 'notif_test_v2';
/** A test that shows up hours later only confuses; the push service may drop it after this. */
const PUSH_TTL_SECONDS = 10 * 60;

const TENANT_COLUMNS =
  'id, slug, company_name, logo_url, favicon_url, primary_color, accent_color, contact_email, contact_phone, phone, push_notifications_enabled';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface PushDisplayOptions {
  requireInteraction?: boolean;
  silent?: boolean;
  replacePrevious?: boolean;
  openInApp?: boolean;
}

export interface TenantRow {
  id: string;
  slug: string | null;
  company_name: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  phone: string | null;
  push_notifications_enabled: boolean | null;
}

export interface SenderRow {
  from_name: string | null;
  from_local_part: string | null;
  reply_to: string | null;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  audience: 'customer' | 'staff';
  failure_count: number;
}

type Failure = { ok: false; status: number; error: string; code: string };
type Checked<T> = { ok: true; value: T } | Failure;

/* -------------------------------------------------------------------------- */
/* Pure rules (exported for tests)                                             */
/* -------------------------------------------------------------------------- */

function fail(status: number, code: string, error: string): Failure {
  return { ok: false, status, code, error };
}

/** {success:false, error, code}: the error shape of send-push, plus `success` for NotificationTestResponse. */
function errorResponse(f: Failure): Response {
  return jsonResponse({ success: false, error: f.error, message: f.error, code: f.code }, f.status);
}

/** A missing table (the SQL is not applied yet), from PostgREST or Postgres. */
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    /could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
}

export function isValidEmailAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v.length > 0 && v.length <= 254 && EMAIL_PATTERN.test(v);
}

/**
 * settings-model isValidLocalPart, as a boolean: the slug, or the slug + ('.'|'_') + more.
 * Never '-' after the slug: slugs contain dashes, so tenant "open" could otherwise
 * send as "open-bay@", tenant "open-bay"'s default address.
 */
export function isValidLocalPart(local: string | null | undefined, slug: string | null | undefined): boolean {
  const value = String(local ?? '');
  const s = String(slug ?? '').trim().toLowerCase();
  if (!value || !s) return false;
  if (!LOCAL_PART_PATTERN.test(value)) return false;
  if (value.includes('..') || value.endsWith('.')) return false;
  if (value === s) return true;
  const sep = value.charAt(s.length);
  return value.startsWith(s) && (sep === '.' || sep === '_') && value.length > s.length + 1;
}

/** Removes what cannot sit in a display name (control characters, <, >, "), squeezes spaces, caps the length. */
function cleanDisplayName(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/[\x00-\x1f\x7f<>"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim();
}

export interface SenderIdentity {
  name: string;
  address: string;
  /** The From header value, the name quoted when it needs quoting. */
  header: string;
  replyTo: string | null;
}

/**
 * Who the email is from: settings-model senderAddress(). A saved name or local
 * part is used only when it is valid today; otherwise today's default
 * "{company_name} <{slug}@drive-247.com>", so a stale or hand-edited row can
 * never make one tenant send as another.
 */
export function senderFrom(sender: Partial<SenderRow> | null | undefined, tenant: Pick<TenantRow, 'company_name' | 'slug'>): SenderIdentity {
  const slug = String(tenant?.slug ?? '').trim().toLowerCase();
  const name = cleanDisplayName(sender?.from_name) || cleanDisplayName(tenant?.company_name) || 'Drive 247';
  const wanted = String(sender?.from_local_part ?? '').trim();
  const customLocal = wanted && isValidLocalPart(wanted, slug) ? wanted : '';
  const local = customLocal || (/^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : 'noreply');
  const address = `${local}@${EMAIL_SENDER_DOMAIN}`;
  const atext = /^[A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~]+$/;
  const header = (atext.test(name) ? name : `"${name.replace(/\\/g, '\\\\')}"`) + ` <${address}>`;
  const replyTo = isValidEmailAddress(sender?.reply_to) ? String(sender?.reply_to).trim() : null;
  return { name, address, header, replyTo };
}

/**
 * The layout brand from a tenants row. The portal preview builds it the same
 * way (apps/portal/src/hooks/use-email-branding-v2.ts emailBrandFromTenantRow);
 * keep the two in step or the preview stops matching the test.
 */
export function emailBrandFromTenant(row: Partial<TenantRow> | null | undefined): EmailLayoutBrand {
  const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    companyName: text(row?.company_name) ?? '',
    logoUrl: text(row?.logo_url),
    primaryColor: text(row?.primary_color),
    accentColor: text(row?.accent_color),
    contactEmail: text(row?.contact_email),
    contactPhone: text(row?.contact_phone) ?? text(row?.phone),
  };
}

/**
 * A same-origin path for the notification click, or '/'. Only a path that
 * starts with one '/' is kept: no scheme, no '//host', no backslash, no control
 * characters or spaces, no '.' / '..' segments. The service worker checks the
 * origin again before it navigates.
 */
export function safeRelativeUrl(value: unknown): string {
  if (typeof value !== 'string') return '/';
  const url = value.trim();
  if (!url || url.length > URL_MAX) return '/';
  if (url.charAt(0) !== '/') return '/';
  const second = url.charAt(1);
  if (second === '/' || second === '\\') return '/';
  if (url.includes('\\')) return '/';
  if (/[\x00-\x20\x7f]/.test(url)) return '/';
  const path = url.split('#')[0].split('?')[0];
  if (/(^|\/)\.\.?(\/|$)/.test(path)) return '/';
  return url;
}

/** Every option as a real boolean (anything but `true` is false). */
export function normalisePushOptions(options: unknown): Required<PushDisplayOptions> {
  const o = (options && typeof options === 'object' && !Array.isArray(options) ? options : {}) as Record<string, unknown>;
  return {
    requireInteraction: o.requireInteraction === true,
    silent: o.silent === true,
    replacePrevious: o.replacePrevious === true,
    openInApp: o.openInApp === true,
  };
}

/** What the v2 service worker receives. A superset of PushPayload (actions, silent, renotify). */
export interface TestPushPayload {
  title: string;
  body?: string;
  url: string;
  icon?: string;
  tag: string;
  renotify: boolean;
  requireInteraction?: boolean;
  silent?: boolean;
  actions?: { action: string; title: string }[];
  data: { url: string; notificationKey: string };
}

/**
 * The push payload for a test.
 *   replacePrevious ON:  a fixed tag per notification, so a new test replaces
 *                        the last one, and renotify false, so it replaces
 *                        quietly (the "alert once" the lead compared to Android).
 *   replacePrevious OFF: a tag unique to this send, so tests stack the way the
 *                        preview says, with renotify true.
 */
export function buildPushPayload(input: {
  title: string;
  body?: string;
  url: string;
  notificationKey: string;
  options: Required<PushDisplayOptions>;
  icon?: string | null;
  uniqueSuffix: string;
}): TestPushPayload {
  const { options } = input;
  const baseTag = `notif-test-${input.notificationKey}`;
  const payload: TestPushPayload = {
    title: input.title,
    url: input.url,
    tag: options.replacePrevious ? baseTag : `${baseTag}-${input.uniqueSuffix}`,
    renotify: !options.replacePrevious,
    data: { url: input.url, notificationKey: input.notificationKey },
  };
  if (input.body) payload.body = input.body;
  if (typeof input.icon === 'string' && input.icon.startsWith('https://')) payload.icon = input.icon;
  if (options.requireInteraction) payload.requireInteraction = true;
  if (options.silent) payload.silent = true;
  if (options.openInApp) payload.actions = [{ action: 'open', title: 'Open in app' }];
  return payload;
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

export interface EmailTestInput {
  notificationKey: string;
  to: string;
  subject: string;
  bodyHtml: string;
}

/** Validates the email half of NotificationTestRequest. */
export function validateEmailTest(body: Record<string, unknown>, notificationKey: string): Checked<EmailTestInput> {
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!isValidEmailAddress(to)) {
    return fail(400, 'invalid_recipient', 'Enter one email address, like name@example.com.');
  }
  const rawSubject = typeof body.subject === 'string' ? body.subject : '';
  const subject = rawSubject.trim();
  if (!subject) return fail(400, 'invalid_subject', 'Add a subject.');
  if (/[\r\n]/.test(subject)) return fail(400, 'invalid_subject', 'Keep the subject on one line.');
  if (subject.length > EMAIL_SUBJECT_MAX) {
    return fail(400, 'invalid_subject', `Keep the subject to ${EMAIL_SUBJECT_MAX} characters or fewer.`);
  }
  const bodyHtml = typeof body.bodyHtml === 'string' ? body.bodyHtml : '';
  if (new TextEncoder().encode(bodyHtml).length > EMAIL_BODY_MAX_BYTES) {
    return fail(413, 'too_large', 'This email is too long to send as a test.');
  }
  if (!visibleText(sanitizeEmailBodyHtml(bodyHtml))) {
    return fail(400, 'empty_body', 'Add a message to the email.');
  }
  // Other control characters in a subject are never wanted; tabs become spaces.
  return { ok: true, value: { notificationKey, to, subject: subject.replace(/[\x00-\x1f\x7f]/g, ' '), bodyHtml } };
}

export interface PushTestInput {
  notificationKey: string;
  title: string;
  body: string;
  url: string;
  options: Required<PushDisplayOptions>;
}

/** Validates the push half of NotificationTestRequest. Lengths are counted trimmed, like send-push. */
export function validatePushTest(body: Record<string, unknown>, notificationKey: string): Checked<PushTestInput> {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return fail(400, 'invalid_title', 'Add a title.');
  if (title.length > PUSH_TITLE_MAX) {
    return fail(400, 'invalid_title', `Keep the title to ${PUSH_TITLE_MAX} characters or fewer.`);
  }
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (text.length > PUSH_BODY_MAX) {
    return fail(400, 'invalid_body', `Keep the message to ${PUSH_BODY_MAX} characters or fewer.`);
  }
  return {
    ok: true,
    value: { notificationKey, title, body: text, url: safeRelativeUrl(body.url), options: normalisePushOptions(body.pushOptions) },
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* -------------------------------------------------------------------------- */
/* Side effects                                                                */
/* -------------------------------------------------------------------------- */

// deno-lint-ignore no-explicit-any
type Db = any;

/** Writes the one audit/rate-limit row. Never throws: a logging failure must not fail a send that happened. */
async function logTestSend(
  supabase: Db,
  row: {
    tenant_id: string;
    app_user_id: string;
    notification_key: string;
    channel: 'email' | 'push';
    recipient: string | null;
    status: 'sent' | 'failed' | 'no_devices';
    error?: string | null;
  },
): Promise<void> {
  try {
    const { error } = await supabase
      .from('notification_test_sends_v2')
      .insert({ ...row, error: row.error ? String(row.error).slice(0, 1000) : null });
    if (error) {
      if (isMissingRelation(error)) {
        console.warn('[NOTIFICATION-TEST-V2] notification_test_sends_v2 is missing (ops/notifications_v2.sql not applied); send not logged');
      } else {
        console.error('[NOTIFICATION-TEST-V2] Could not log the test send:', error.message);
      }
    }
  } catch (err) {
    console.error('[NOTIFICATION-TEST-V2] Could not log the test send:', err instanceof Error ? err.message : String(err));
  }
}

/** The rolling-hour rate limit. Missing table: allowed (with a warning). Any other read error: refused. */
async function checkRateLimit(supabase: Db, appUserId: string): Promise<Failure | null> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from('notification_test_sends_v2')
    .select('created_at')
    .eq('app_user_id', appUserId)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(RATE_LIMIT);
  if (error) {
    if (isMissingRelation(error)) {
      console.warn('[NOTIFICATION-TEST-V2] notification_test_sends_v2 is missing (ops/notifications_v2.sql not applied); rate limit skipped');
      return null;
    }
    console.error('[NOTIFICATION-TEST-V2] Rate-limit read failed:', error.message);
    return fail(500, 'rate_check_failed', "Couldn't check your recent tests. Try again in a moment.");
  }
  const rows = (data ?? []) as { created_at: string }[];
  if (rows.length < RATE_LIMIT) return null;
  const oldest = Date.parse(rows[0].created_at);
  const waitMs = Number.isFinite(oldest) ? oldest + RATE_WINDOW_MS - Date.now() : RATE_WINDOW_MS;
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  return fail(
    429,
    'rate_limited',
    `You can send ${RATE_LIMIT} tests an hour. Try again in ${plural(minutes, 'minute', 'minutes')}.`,
  );
}

async function sendEmailTest(
  supabase: Db,
  tenant: TenantRow,
  appUserId: string,
  input: EmailTestInput,
): Promise<Response> {
  const log = (status: 'sent' | 'failed', error?: string | null) =>
    logTestSend(supabase, {
      tenant_id: tenant.id,
      app_user_id: appUserId,
      notification_key: input.notificationKey,
      channel: 'email',
      recipient: input.to,
      status,
      error,
    });

  // Sender settings. Unreadable or missing: today's default sender.
  let sender: SenderRow | null = null;
  const { data: senderRow, error: senderError } = await supabase
    .from('tenant_email_sender')
    .select('from_name, from_local_part, reply_to')
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (senderError) {
    if (isMissingRelation(senderError)) {
      console.warn('[NOTIFICATION-TEST-V2] tenant_email_sender is missing; using the default sender');
    } else {
      console.error('[NOTIFICATION-TEST-V2] Could not read the sender settings; using the default sender:', senderError.message);
    }
  } else {
    sender = (senderRow ?? null) as SenderRow | null;
  }
  const from = senderFrom(sender, tenant);

  // The same call the portal preview makes. bodyHtml is passed as received:
  // renderNotificationEmailHtml sanitises it, exactly as in the browser.
  const html = renderNotificationEmailHtml({ bodyHtml: input.bodyHtml, brand: emailBrandFromTenant(tenant) });
  const text = emailBodyToPlainText(input.bodyHtml);
  const subject = `[Test] ${input.subject}`;

  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    // Same rule as _shared/resend-service.ts: only local development may skip
    // the send, and even then the operator is told nothing went out.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const isLocalDev =
      supabaseUrl.includes('localhost') ||
      supabaseUrl.includes('127.0.0.1') ||
      Deno.env.get('EMAIL_SIMULATION_ALLOWED') === 'true';
    await log('failed', 'RESEND_API_KEY is not set');
    if (isLocalDev) {
      return jsonResponse({
        success: true,
        sent: 0,
        message: 'Local development: the email was built but not sent.',
      });
    }
    console.error('[NOTIFICATION-TEST-V2] RESEND_API_KEY is not configured; nothing was sent');
    return errorResponse(fail(500, 'email_not_configured', "Email isn't set up on the server yet, so nothing was sent."));
  }

  const payload: Record<string, unknown> = {
    from: from.header,
    to: [input.to],
    subject,
    html,
    text,
    // A new id per test stops Gmail threading repeated tests under one
    // conversation, where the newest one is easy to miss.
    headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
  };
  if (from.replyTo) payload.reply_to = from.replyTo;

  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[NOTIFICATION-TEST-V2] Resend request failed:', reason);
    await log('failed', reason);
    return errorResponse(fail(502, 'send_failed', "Couldn't reach the email service. Try again in a moment."));
  }

  const result = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok) {
    const reason = typeof result?.message === 'string' && result.message.trim() ? result.message.trim().slice(0, 200) : `HTTP ${response.status}`;
    console.error('[NOTIFICATION-TEST-V2] Resend rejected the email', { status: response.status, reason });
    await log('failed', reason);
    return errorResponse(fail(502, 'send_failed', `The email service didn't accept it: ${reason}`));
  }

  await log('sent');
  console.log(`[NOTIFICATION-TEST-V2] ${tenant.slug} email ${input.notificationKey} sent`);
  return jsonResponse({ success: true, sent: 1, message: `Sent to ${input.to}.` });
}

async function sendPushTest(
  supabase: Db,
  tenant: TenantRow,
  appUserId: string,
  input: PushTestInput,
): Promise<Response> {
  if (tenant.push_notifications_enabled !== true) {
    return errorResponse(fail(403, 'push_disabled', "Push notifications aren't switched on for your account yet."));
  }

  let vapid: ReturnType<typeof getVapidKeys>;
  try {
    vapid = getVapidKeys();
  } catch (err) {
    console.error('[NOTIFICATION-TEST-V2]', err);
    return errorResponse(fail(500, 'vapid_missing', "Push isn't set up on the server yet."));
  }

  // The caller's own devices only: send-push's `self` target.
  const { data: subscriptions, error: subsError } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, audience, failure_count')
    .eq('is_active', true)
    .eq('tenant_id', tenant.id)
    .eq('audience', 'staff')
    .eq('app_user_id', appUserId)
    .limit(50);
  if (subsError) {
    console.error('[NOTIFICATION-TEST-V2] Could not load subscriptions:', subsError.message);
    return errorResponse(fail(500, 'devices_lookup_failed', "Couldn't load your devices. Try again in a moment."));
  }

  const log = (status: 'sent' | 'failed' | 'no_devices', error?: string | null) =>
    logTestSend(supabase, {
      tenant_id: tenant.id,
      app_user_id: appUserId,
      notification_key: input.notificationKey,
      channel: 'push',
      recipient: null,
      status,
      error,
    });

  const recipients = (subscriptions ?? []) as SubscriptionRow[];
  if (recipients.length === 0) {
    await log('no_devices');
    return jsonResponse({
      success: false,
      sent: 0,
      failed: 0,
      code: 'no_devices',
      message: 'Turn on notifications on this device first.',
      error: 'Turn on notifications on this device first.',
    });
  }

  const payload = buildPushPayload({
    title: input.title,
    body: input.body || undefined,
    url: input.url,
    notificationKey: input.notificationKey,
    options: input.options,
    icon: tenant.favicon_url,
    uniqueSuffix: Date.now().toString(36),
  });

  const results = await Promise.all(
    recipients.map(async (sub) => ({
      sub,
      // PushPayload has no actions / silent / renotify; the v2 service worker reads them.
      result: await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload as unknown as PushPayload,
        vapid,
        { ttlSeconds: PUSH_TTL_SECONDS, urgency: 'high' },
      ),
    })),
  );

  // Bookkeeping, as send-push does it, but each write's {error} is checked:
  // supabase-js resolves with {error} instead of throwing.
  const nowIso = new Date().toISOString();
  const succeededIds: string[] = [];
  const expiredIds: string[] = [];
  const failures: { sub: SubscriptionRow; error: string }[] = [];
  for (const { sub, result } of results) {
    if (result.ok) succeededIds.push(sub.id);
    else if (result.expired) expiredIds.push(sub.id);
    else failures.push({ sub, error: result.error ?? 'Unknown error' });
  }

  const logRows = results.map(({ sub, result }) => ({
    tenant_id: tenant.id,
    subscription_id: sub.id,
    endpoint: sub.endpoint,
    audience: sub.audience,
    title: input.title,
    body: input.body || null,
    url: input.url,
    status: result.ok ? 'sent' : result.expired ? 'expired' : 'failed',
    http_status: result.status || null,
    error: result.error ?? null,
    sent_by: appUserId,
    source: PUSH_SOURCE,
  }));

  const writes: { what: string; run: PromiseLike<{ error: { message: string } | null }> }[] = [
    { what: 'push_notification_log insert', run: supabase.from('push_notification_log').insert(logRows) },
  ];
  if (succeededIds.length > 0) {
    writes.push({
      what: 'mark delivered',
      run: supabase
        .from('push_subscriptions')
        .update({ last_success_at: nowIso, last_seen_at: nowIso, failure_count: 0, last_error: null })
        .in('id', succeededIds),
    });
  }
  if (expiredIds.length > 0) {
    // 404/410: the device is gone for good (app deleted, data cleared). Retired, as send-push does.
    writes.push({
      what: 'retire expired',
      run: supabase
        .from('push_subscriptions')
        .update({ is_active: false, revoked_at: nowIso, last_error: 'Subscription expired at push service' })
        .in('id', expiredIds),
    });
  }
  for (const { sub, error } of failures) {
    writes.push({
      what: 'count failure',
      run: supabase
        .from('push_subscriptions')
        .update({ failure_count: sub.failure_count + 1, last_error: error.slice(0, 500) })
        .eq('id', sub.id),
    });
  }
  const settled = await Promise.allSettled(writes.map((w) => w.run));
  settled.forEach((s, i) => {
    const problem = s.status === 'rejected' ? String(s.reason) : s.value?.error?.message;
    if (problem) console.error(`[NOTIFICATION-TEST-V2] Bookkeeping (${writes[i].what}) failed:`, problem);
  });

  const sent = succeededIds.length;
  const failed = recipients.length - sent;
  console.log(`[NOTIFICATION-TEST-V2] ${tenant.slug} push ${input.notificationKey} sent=${sent} failed=${failures.length} expired=${expiredIds.length}`);

  if (sent === 0) {
    const allExpired = expiredIds.length === recipients.length;
    const message = allExpired
      ? 'Notifications on your devices have expired. Turn them off and on again on this device, then try again.'
      : "Your devices didn't accept the test. Try again, or turn notifications off and on again on this device.";
    await log('failed', allExpired ? 'All subscriptions expired' : failures[0]?.error ?? null);
    return jsonResponse({ success: false, sent: 0, failed, code: 'devices_failed', message, error: message });
  }

  await log('sent');
  const message = failed === 0
    ? `Sent to ${plural(sent, 'device', 'devices')}.`
    : `Sent to ${plural(sent, 'device', 'devices')}. ${plural(failed, "device didn't", "devices didn't")} accept it.`;
  return jsonResponse({ success: true, sent, failed, message });
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                     */
/* -------------------------------------------------------------------------- */

export async function handleRequest(req: Request): Promise<Response> {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse(fail(405, 'method_not_allowed', 'Use POST.'));
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return errorResponse(fail(500, 'server_not_configured', "The server isn't set up for this yet."));
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- 1. Who is asking? (send-push, step 1) -------------------------------
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse(fail(401, 'unauthenticated', 'Sign in to send a test.'));
  }
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  const authUser = authData?.user;
  if (authError || !authUser) {
    return errorResponse(fail(401, 'invalid_session', 'Your session has ended. Sign in again.'));
  }

  const { data: appUser, error: appUserError } = await supabase
    .from('app_users')
    .select('id, role, is_active, tenant_id, is_super_admin')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();
  if (appUserError) {
    console.error('[NOTIFICATION-TEST-V2] app_users lookup failed:', appUserError.message);
    return errorResponse(fail(500, 'profile_lookup_failed', "Couldn't check your account. Try again in a moment."));
  }
  if (!appUser) return errorResponse(fail(403, 'no_profile', "This account can't use the portal."));
  if (!appUser.is_active) return errorResponse(fail(403, 'deactivated', 'This account is turned off.'));

  const isSuperAdmin = appUser.is_super_admin === true;
  let allowed = isSuperAdmin || FULL_ACCESS_ROLES.has(appUser.role);
  if (!allowed && appUser.role === 'manager') {
    const { data: perm, error: permError } = await supabase
      .from('manager_permissions')
      .select('access_level')
      .eq('app_user_id', appUser.id)
      .eq('tab_key', MANAGER_TAB_KEY)
      .maybeSingle();
    if (permError) {
      console.error('[NOTIFICATION-TEST-V2] manager_permissions lookup failed:', permError.message);
      return errorResponse(fail(500, 'permission_check_failed', "Couldn't check your access. Try again in a moment."));
    }
    allowed = perm?.access_level === 'editor';
  }
  if (!allowed) {
    return errorResponse(fail(403, 'forbidden', "Your role can't send test notifications. Ask an admin."));
  }

  // ---- 2. Read and check the request --------------------------------------
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > REQUEST_MAX_CHARS) {
      return errorResponse(fail(413, 'too_large', 'This test is too large to send.'));
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return errorResponse(fail(400, 'invalid_json', "The request wasn't readable."));
  }

  const channel = body.channel;
  if (channel !== 'email' && channel !== 'push') {
    return errorResponse(fail(400, 'invalid_channel', 'Choose email or push.'));
  }
  const notificationKey = typeof body.notificationKey === 'string' ? body.notificationKey : '';
  if (!NOTIFICATION_KEY_PATTERN.test(notificationKey)) {
    return errorResponse(fail(400, 'invalid_key', "This notification isn't recognised."));
  }

  // ---- 3. Which tenant? (send-push's rule) ---------------------------------
  // A normal user's tenant is their own app_users row and the body is IGNORED,
  // so nobody can send as another operator by posting a different id. A super
  // admin has tenant_id NULL by design and must name the tenant they are viewing.
  let tenantQuery = supabase.from('tenants').select(TENANT_COLUMNS);
  if (isSuperAdmin) {
    const bodyTenantId = typeof body.tenantId === 'string' && UUID_PATTERN.test(body.tenantId) ? body.tenantId : null;
    const bodyTenantSlug = typeof body.tenantSlug === 'string' && body.tenantSlug.trim() ? body.tenantSlug.trim() : null;
    if (bodyTenantId) tenantQuery = tenantQuery.eq('id', bodyTenantId);
    else if (bodyTenantSlug) tenantQuery = tenantQuery.eq('slug', bodyTenantSlug);
    else if (appUser.tenant_id) tenantQuery = tenantQuery.eq('id', appUser.tenant_id);
    else {
      return errorResponse(fail(
        400,
        'tenant_required',
        "You're signed in as a super admin. Open the portal on the company's own address so we know which company to send as.",
      ));
    }
  } else {
    if (!appUser.tenant_id) {
      return errorResponse(fail(403, 'no_tenant', "Your account isn't linked to a company."));
    }
    tenantQuery = tenantQuery.eq('id', appUser.tenant_id);
  }
  const { data: tenantRow, error: tenantError } = await tenantQuery.maybeSingle();
  if (tenantError) {
    console.error('[NOTIFICATION-TEST-V2] tenant lookup failed:', tenantError.message);
    return errorResponse(fail(500, 'tenant_lookup_failed', "Couldn't load your company details. Try again in a moment."));
  }
  if (!tenantRow) return errorResponse(fail(404, 'unknown_tenant', "We couldn't find this company."));
  const tenant = tenantRow as TenantRow;

  // ---- 4. Validate the channel's fields, then the rate limit ---------------
  const checked = channel === 'email' ? validateEmailTest(body, notificationKey) : validatePushTest(body, notificationKey);
  if (!checked.ok) return errorResponse(checked);

  const limited = await checkRateLimit(supabase, appUser.id);
  if (limited) return errorResponse(limited);

  // ---- 5. Send -------------------------------------------------------------
  try {
    return channel === 'email'
      ? await sendEmailTest(supabase, tenant, appUser.id, checked.value as EmailTestInput)
      : await sendPushTest(supabase, tenant, appUser.id, checked.value as PushTestInput);
  } catch (err) {
    console.error('[NOTIFICATION-TEST-V2] Unexpected error:', err instanceof Error ? err.message : String(err));
    return errorResponse(fail(500, 'unexpected', 'Something went wrong. Try again in a moment.'));
  }
}

Deno.serve(handleRequest);
