/**
 * agreements-v2 edge function — everything it does, with no Deno APIs and no
 * URL imports, so vitest drives it directly (tests/integrations/agreements-v2).
 * index.ts is only the Deno.serve wrapper that builds the client and passes
 * `fetch` and the environment in.
 *
 * POST, JSON body `{ action, … }`, `Authorization: Bearer <user JWT>`:
 *   ready     → 200 { ok, ready: true, mode } | 200 { ok, ready: false, reason: 'database'|'signing', message }
 *   send      → 200 { ok, id, status: 'sent' }
 *               402 { ok: false, id, status: 'credit_failed', error }
 *               502 { ok: false, id, status: 'send_failed', error }
 *               400 { ok: false, error, field? } · 401/403 { ok: false, error } · 503 { ok: false, error }
 *   sync      → 200 { ok, updated }
 *   document  → 200 { ok, kind: 'pdf', base64, signed } | 200 { ok, kind: 'html', html }
 *
 * Ported from the Next routes it replaces (apps/portal/src/app/api/agreements-v2/
 * {send,sync,document,ready}/route.ts and lib/agreements-v2/server/send.ts),
 * which could never run: the portal's server holds no secrets. The one real
 * change is that the BROWSER now renders the html and the PDF (the same code
 * as its preview) and sends both; this function checks them and never
 * rewrites them.
 *
 * THE SEND ORDER IS THE POINT
 *   1. validate everything (the fields, the PDF, the signature tag, the
 *      resend's original row, the template's owner). Nothing is written.
 *   2. INSERT the row, 'pending', carrying the exact html. If it cannot be
 *      written (the table is not there yet), NOTHING is charged and NOTHING is
 *      sent: a paid, legally binding document with no row is one nobody sees.
 *   3. deduct_credits (category 'esign', reference = the row, reference type
 *      'individual_agreement', test flag per mode). No credits: the row is
 *      credit_failed, 402.
 *   4. send to the provider, which emails the recipient and the CC itself. A
 *      refusal or a network failure refunds with add_credits exactly as
 *      /api/esign does, and marks the row send_failed, 502.
 *   5. success: document_id, boldsign_mode, document_status 'sent', sent_at.
 */

import { authenticateAgreementsV2, type AgreementsContextV2, type DbClient, type Outcome } from './auth.ts';
import { raiseEsignCreditAlert } from './credit-alert.ts';
import { bytesToBase64, decodePdfBase64 } from './pdf-input.ts';
import {
  TERMINAL_DOCUMENT_STATUSES,
  buildSendForm,
  downloadDocument,
  getBoldSignApiKey,
  getDocumentProperties,
  mapDocumentStatus,
  providerErrorMessage,
  sendDocument,
  toIsoTimestamp,
  type EnvReader,
  type FetchLike,
  type ProviderDeps,
} from './provider.ts';
import { INDIVIDUAL_TABLE, isMissingTableError } from './tables.ts';
import { isUuidV2, validateIndividualSendV2 } from './validation.ts';

export interface AgreementsDepsV2 {
  /** The service-role client. */
  client: DbClient;
  fetch: FetchLike;
  env: EnvReader;
  now?: () => Date;
  /** Injected so tests do not wait out the 429 back-off. */
  sleep?: (ms: number) => Promise<void>;
  /** Keeps a fire-and-forget call (the auto-refill trigger) alive after the response. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

const reply = (status: number, body: Record<string, unknown>): Outcome => ({ status, body });
const bad = (error: string, field?: string): Outcome => reply(400, field ? { ok: false, error, field } : { ok: false, error });

const NOT_SWITCHED_ON = 'Individual agreements are not switched on yet, so nothing was sent.';
const NOT_FOUND = 'That agreement was not found.';

/** The one entry point. `req` is the incoming request (its method, headers and JSON body). */
export async function handleAgreementsV2(req: Request, deps: AgreementsDepsV2): Promise<Outcome> {
  if (req.method !== 'POST') return reply(405, { ok: false, error: 'Use POST.' });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad('The request could not be read.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('The request could not be read.');

  const action = body.action;
  if (action !== 'ready' && action !== 'send' && action !== 'sync' && action !== 'document') {
    return bad('Unknown action.');
  }

  // `ready` asks "may I send?", so it applies the send gate.
  const auth = await authenticateAgreementsV2(req.headers, deps.client, { write: action === 'send' || action === 'ready' });
  if (!auth.ok || !auth.context) return auth.outcome!;
  const ctx = auth.context;

  try {
    switch (action) {
      case 'ready':
        return await ready(ctx, deps);
      case 'send':
        return await send(ctx, body, deps);
      case 'sync':
        return await sync(ctx, deps);
      case 'document':
        return await documentOf(ctx, body.id, deps);
    }
  } catch (e) {
    console.error(`[agreements-v2/${action}] unexpected error:`, e);
    return reply(500, {
      ok: false,
      error: action === 'send'
        ? 'Something went wrong while sending. Check the agreements list before trying again.'
        : 'Something went wrong. Try again.',
    });
  }
  return bad('Unknown action.');
}

/* ── ready ─────────────────────────────────────────────────────────────── */

/**
 * Can THIS caller send an individual agreement right now? Asked when the send
 * dialog opens. Checks the caller (the send gate, above), the one-time database
 * update, and e-signing for the tenant's mode. Never contacts the provider.
 */
async function ready(ctx: AgreementsContextV2, deps: AgreementsDepsV2): Promise<Outcome> {
  const { error } = await deps.client.from(INDIVIDUAL_TABLE).select('id').eq('tenant_id', ctx.tenant.id).limit(1);
  if (error) {
    if (isMissingTableError(error)) {
      return reply(200, {
        ok: true,
        ready: false,
        reason: 'database',
        message: "Sending agreements that aren't linked to a rental needs a one-time database update that hasn't been applied yet.",
      });
    }
    return reply(500, { ok: false, error: 'Could not check whether sending is available. Try again.' });
  }
  if (!getBoldSignApiKey(deps.env, ctx.boldsignMode)) {
    return reply(200, { ok: true, ready: false, reason: 'signing', message: "E-signing isn't set up on this server yet." });
  }
  return reply(200, { ok: true, ready: true, mode: ctx.boldsignMode });
}

/* ── send ──────────────────────────────────────────────────────────────── */

const ref = (id: string) => id.substring(0, 8).toUpperCase();

async function send(ctx: AgreementsContextV2, body: Record<string, unknown>, deps: AgreementsDepsV2): Promise<Outcome> {
  const { client } = deps;
  const { tenant, caller, boldsignMode } = ctx;
  const now = deps.now ?? (() => new Date());
  const isTestMode = boldsignMode === 'test';

  // ── 1. validate: nothing below writes until every check has passed ──
  const checked = validateIndividualSendV2(body);
  if (!checked.ok || !checked.value) return bad(checked.error ?? 'The agreement could not be sent.', checked.field);
  let value = checked.value;

  // The browser drew the PDF from this html, so the html must carry the
  // customer's signature tag: sig1 is always defined for the provider, and a
  // PDF without it is refused by the provider after the credits are taken.
  if (!value.contentHtml.includes('{{@sig1}}')) {
    return bad('The agreement has no signature field for the recipient.', 'contentHtml');
  }

  const pdf = decodePdfBase64(body.pdfBase64);
  if (!pdf.ok || !pdf.bytes) return bad(pdf.error ?? 'The agreement PDF could not be read.', 'pdfBase64');

  // A resend points back at one of THIS tenant's rows. The old row is only
  // read, never written: "another row is made" (D17).
  let resentFromId: string | null = null;
  if (body.resendOf !== undefined && body.resendOf !== null && body.resendOf !== '') {
    if (!isUuidV2(body.resendOf)) return reply(404, { ok: false, error: NOT_FOUND });
    const { data: old, error } = await client
      .from(INDIVIDUAL_TABLE)
      .select('id')
      .eq('id', body.resendOf)
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) return reply(503, { ok: false, error: NOT_SWITCHED_ON });
      return reply(500, { ok: false, error: 'The agreement could not be loaded. Try again.' });
    }
    if (!old?.id) return reply(404, { ok: false, error: NOT_FOUND });
    resentFromId = String(old.id);
  }

  // templateId is only PROVENANCE: the content sent is the operator's own
  // approved copy. A template that is not this tenant's (deleted since the
  // dialog opened, or someone else's id) is dropped rather than refusing the
  // send, and another tenant's id is never stored.
  if (value.templateId) {
    const { data: template, error } = await client
      .from('agreement_templates')
      .select('id')
      .eq('id', value.templateId)
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (error) return reply(500, { ok: false, error: 'The template could not be checked. Try again.' });
    if (!template) value = { ...value, templateId: null };
  }

  // ── 2. the row, before anything is charged ──
  const { data: inserted, error: insertError } = await client
    .from(INDIVIDUAL_TABLE)
    .insert({
      tenant_id: tenant.id,
      recipient_name: value.recipientName,
      recipient_email: value.recipientEmail,
      cc_emails: value.cc,
      title: value.title,
      message: value.message,
      template_id: value.templateId,
      content_html: value.contentHtml,
      document_status: 'pending',
      boldsign_mode: boldsignMode,
      resent_from_id: resentFromId,
      created_by: caller.appUserId,
    })
    .select('id')
    .single();
  if (insertError || !inserted?.id) {
    if (isMissingTableError(insertError)) return reply(503, { ok: false, error: NOT_SWITCHED_ON });
    console.error('[agreements-v2/send] insert failed:', insertError);
    return reply(500, { ok: false, error: 'The agreement could not be recorded, so nothing was sent.' });
  }
  const id = String(inserted.id);

  const mark = async (patch: Record<string, unknown>) => {
    const { error } = await client.from(INDIVIDUAL_TABLE).update(patch).eq('id', id).eq('tenant_id', tenant.id);
    if (error) console.error('[agreements-v2/send] could not update row', id, patch.document_status, error);
  };
  const failed = async (status: number, documentStatus: 'send_failed' | 'credit_failed', error: string): Promise<Outcome> => {
    await mark({ document_status: documentStatus, error });
    return reply(status, { ok: false, id, status: documentStatus, error });
  };

  const apiKey = getBoldSignApiKey(deps.env, boldsignMode);
  if (!apiKey) return failed(502, 'send_failed', 'Signing is not configured on this server.');

  // ── 3. credits (exact params as /api/esign, the reference being this row) ──
  const { data: deducted, error: deductError } = await client.rpc('deduct_credits', {
    p_tenant_id: tenant.id,
    p_category: 'esign',
    p_description: `E-sign agreement: ${value.recipientName} (Ref: ${ref(id)})`,
    p_reference_id: id,
    p_reference_type: 'individual_agreement',
    p_is_test_mode: isTestMode,
  });
  if (deductError) {
    console.error('[agreements-v2/send] deduct_credits failed:', deductError.message);
    return failed(502, 'send_failed', 'The e-sign credit check failed, so nothing was sent. Try again.');
  }
  if (deducted?.success === false) {
    await raiseEsignCreditAlert(client, tenant.id, { balance: Number(deducted.balance ?? 0), insufficient: true, isTestMode });
    return failed(402, 'credit_failed', 'There are not enough e-sign credits to send this agreement.');
  }
  await raiseEsignCreditAlert(client, tenant.id, { balance: Number(deducted?.balance_after ?? 0), isTestMode });

  const refund = async () => {
    if (!deducted?.success) return;
    try {
      const { error } = await client.rpc('add_credits', {
        p_tenant_id: tenant.id,
        p_amount: deducted.amount_deducted,
        p_type: 'refund',
        p_description: `Refund: BoldSign send failed (Ref: ${ref(id)})`,
        p_category: 'esign',
        p_is_test_mode: isTestMode,
      });
      if (error) console.error('[agreements-v2/send] refund failed for', id, error);
    } catch (e) {
      console.error('[agreements-v2/send] refund failed for', id, e);
    }
  };

  // ── 4. send ──
  const brandId = (boldsignMode === 'test' ? tenant.boldsign_test_brand_id : tenant.boldsign_live_brand_id) || null;
  const form = buildSendForm({
    title: value.title,
    message: value.message,
    brandId,
    recipientName: value.recipientName,
    recipientEmail: value.recipientEmail,
    cc: value.cc,
    html: value.contentHtml,
    pdf: pdf.bytes,
  });

  const provider: ProviderDeps = { fetch: deps.fetch, env: deps.env, sleep: deps.sleep };
  let response: Response;
  try {
    response = await sendDocument(form, apiKey, provider);
  } catch (e) {
    console.error('[agreements-v2/send] provider unreachable for', id, e);
    await refund();
    return failed(502, 'send_failed', 'The signing service could not be reached. Try again.');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('[agreements-v2/send] provider refused', id, response.status, text.slice(0, 500));
    await refund();
    return failed(502, 'send_failed', providerErrorMessage(response.status, text));
  }

  // deno-lint-ignore no-explicit-any
  const result: any = await response.json().catch(() => null);
  const documentId: string | null = typeof result?.documentId === 'string' ? result.documentId : null;
  if (!documentId) {
    // Accepted with no id: the document may exist, so the credits stand and
    // the row says so rather than claiming a clean failure.
    console.error('[agreements-v2/send] provider answered without a documentId for', id, result);
    return failed(502, 'send_failed', 'The signing service did not confirm the document.');
  }

  // ── 5. success ──
  const { error: updateError } = await client
    .from(INDIVIDUAL_TABLE)
    .update({ document_id: documentId, boldsign_mode: boldsignMode, document_status: 'sent', sent_at: now().toISOString(), error: null })
    .eq('id', id)
    .eq('tenant_id', tenant.id);
  if (updateError) {
    // The document is out and paid for; say where it is so it can be linked by hand.
    console.error('[agreements-v2/send] SENT but could not record document', documentId, 'on row', id, updateError);
  }

  if (deducted?.auto_refill_needed) {
    const url = deps.env('SUPABASE_URL');
    const key = deps.env('SUPABASE_SERVICE_ROLE_KEY');
    if (url && key) {
      const refill = deps
        .fetch(`${url}/functions/v1/manage-credit-wallet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ action: 'auto_refill', tenantId: tenant.id }),
        })
        .catch((e) => console.warn('[agreements-v2/send] auto-refill trigger error:', e));
      deps.waitUntil?.(refill);
    }
  }

  return reply(200, { ok: true, id, status: 'sent' });
}

/* ── sync ──────────────────────────────────────────────────────────────── */

/**
 * Bring the tenant's individual agreements up to date with the provider.
 * Individual agreements are deliberately NOT on the shared BoldSign webhook
 * (D4), so this is how a signature reaches the list. Bounded:
 *  - only rows with a provider document and a non-terminal status;
 *  - only rows not touched in the last 60 seconds;
 *  - at most 50 per call, oldest first. A row asked about and unchanged is
 *    still touched, so the next call moves on to the next 50.
 * Each row is read with the key of the mode it was CREATED in, else the
 * tenant's (lean-gated) mode: a sandbox document read with the live key 404s.
 */
const STALE_AFTER_MS = 60_000;
const MAX_PER_CALL = 50;
const CONCURRENCY = 5;

interface SyncRow {
  id: string;
  document_id: string;
  boldsign_mode: string | null;
  document_status: string | null;
}

const rowMode = (mode: string | null | undefined, fallback: 'test' | 'live'): 'test' | 'live' =>
  mode === 'live' || mode === 'test' ? mode : fallback;

async function sync(ctx: AgreementsContextV2, deps: AgreementsDepsV2): Promise<Outcome> {
  const { client } = deps;
  const { tenant, boldsignMode } = ctx;
  const now = deps.now ?? (() => new Date());
  const cutoff = new Date(now().getTime() - STALE_AFTER_MS).toISOString();

  const { data, error } = await client
    .from(INDIVIDUAL_TABLE)
    .select('id, document_id, boldsign_mode, document_status')
    .eq('tenant_id', tenant.id)
    .not('document_id', 'is', null)
    .not('document_status', 'in', `(${TERMINAL_DOCUMENT_STATUSES.join(',')})`)
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(MAX_PER_CALL);
  if (error) {
    if (isMissingTableError(error)) return reply(200, { ok: true, updated: 0 });
    return reply(500, { ok: false, error: 'The agreements could not be loaded.' });
  }

  const rows = (data ?? []) as SyncRow[];
  const provider: ProviderDeps = { fetch: deps.fetch, env: deps.env };
  let updated = 0;

  const syncOne = async (row: SyncRow) => {
    const apiKey = getBoldSignApiKey(deps.env, rowMode(row.boldsign_mode, boldsignMode));
    if (!apiKey || !row.document_id) return;
    // deno-lint-ignore no-explicit-any
    let props: any = null;
    try {
      const response = await getDocumentProperties(row.document_id, apiKey, provider);
      if (!response.ok) return;
      props = await response.json();
    } catch {
      return;
    }
    if (!props?.status) return;

    const next = mapDocumentStatus(String(props.status));
    const changed = next !== row.document_status;
    const patch: Record<string, unknown> = { document_status: next, updated_at: now().toISOString() };
    if (changed && (next === 'completed' || next === 'signed')) {
      patch.completed_at = toIsoTimestamp(props.completedDate) ?? toIsoTimestamp(props.activityDate) ?? now().toISOString();
    }
    const { error: updateError } = await client.from(INDIVIDUAL_TABLE).update(patch).eq('id', row.id).eq('tenant_id', tenant.id);
    if (!updateError && changed) updated += 1;
  };

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(syncOne));
  }
  return reply(200, { ok: true, updated });
}

/* ── document ──────────────────────────────────────────────────────────── */

/**
 * The document behind one of the tenant's individual agreements (D17).
 *  - With a provider document: its PDF as `{ kind: 'pdf', base64, signed }`.
 *    For a row NOT signed, a provider that cannot produce it (a sandbox
 *    document is deleted after 14 days) falls back to the snapshot below; for a
 *    signed row that is an error instead, so an unsigned copy is never passed
 *    off as the signed one.
 *  - Without one (the send failed, or has not gone out): the exact html that
 *    was recorded, as `{ kind: 'html', html }`.
 */
const SIGNED = new Set(['completed', 'signed']);

async function documentOf(ctx: AgreementsContextV2, rawId: unknown, deps: AgreementsDepsV2): Promise<Outcome> {
  const { client } = deps;
  const { tenant, boldsignMode } = ctx;
  if (!isUuidV2(rawId)) return reply(404, { ok: false, error: NOT_FOUND });

  const { data: row, error } = await client
    .from(INDIVIDUAL_TABLE)
    .select('id, document_id, boldsign_mode, document_status, content_html')
    .eq('id', rawId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (error && !isMissingTableError(error)) {
    return reply(500, { ok: false, error: 'The agreement could not be loaded. Try again.' });
  }
  if (!row) return reply(404, { ok: false, error: NOT_FOUND });

  const html = String(row.content_html ?? '');
  const signed = SIGNED.has(String(row.document_status ?? '').toLowerCase());
  const snapshot = () => reply(200, { ok: true, kind: 'html', html });

  if (!row.document_id) return snapshot();

  const apiKey = getBoldSignApiKey(deps.env, rowMode(row.boldsign_mode, boldsignMode));
  if (!apiKey) {
    if (!signed && html) return snapshot();
    return reply(500, { ok: false, error: 'Signing is not configured on this server.' });
  }

  let response: Response | null = null;
  try {
    response = await downloadDocument(String(row.document_id), apiKey, { fetch: deps.fetch, env: deps.env });
  } catch {
    response = null;
  }
  if (!response || !response.ok) {
    if (!signed && html) return snapshot();
    return reply(502, { ok: false, error: 'The signing service did not return the document. Try again shortly.' });
  }

  const base64 = bytesToBase64(new Uint8Array(await response.arrayBuffer()));
  return reply(200, { ok: true, kind: 'pdf', base64, signed });
}
