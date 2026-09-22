/**
 * Agreements v2 — the browser's calls for INDIVIDUAL agreements, all through
 * the `agreements-v2` Supabase Edge Function. See docs/agreements-v2/build-spec.md.
 *
 * WHY AN EDGE FUNCTION, AND WHY THE PDF IS DRAWN HERE
 * The portal's Next server holds no secrets (not the signing key, not the
 * service role), so the privileged work (auth, credits, the signing provider)
 * lives in the edge function. `supabase.functions.invoke` carries the
 * signed-in user's JWT, and the function takes the tenant from that account,
 * never from anything sent here (D20). The PDF is rendered IN THE BROWSER from
 * the exact final html the Send dialog previews, through the one pipeline in
 * render.ts, so the preview and the PDF cannot drift.
 *
 * Every body is `{ action, … }`:
 *   ready     → { ok, ready: true, mode } | { ok, ready: false, reason, message }
 *   send      → 200 { ok, id, status: 'sent' }
 *               402 { ok: false, id, status: 'credit_failed', error }
 *               502 { ok: false, id, status: 'send_failed', error }
 *               400/401/403/503 { ok: false, error, field? }
 *   sync      → { ok, updated }
 *   document  → { ok, kind: 'pdf', base64, signed } | { ok, kind: 'html', html }
 *
 * Errors are thrown as `Error`s carrying the function's own sentence, which is
 * written to be shown to the operator. One exception, on purpose: a send or
 * resend the function RECORDED but could not deliver (402, 502) resolves with
 * that row's `{ id, status, error }`, because the agreement now exists in the
 * list as Failed and the caller decides what to say about it.
 *
 * NOT DEPLOYED YET. A function that is not there (the request cannot be made,
 * the relay fails, or the gateway answers 404 in its own shape rather than
 * ours) is said in plain words: `ready` reports reason 'service', `sync` quietly
 * does nothing, and `send`/`document` throw `AGREEMENTS_SERVICE_MISSING_V2`.
 */

import { supabase, supabaseUntyped } from '@/integrations/supabase/client';
import { extractFunctionErrorPayload } from '@/lib/edge-error';
import { buildIndividualData, ensureSignatureTag, renderAgreementHtml } from '@/lib/agreements-v2/render';
import { isMissingTableError } from '@/lib/agreements-v2/status';

export const AGREEMENTS_FUNCTION_V2 = 'agreements-v2';

/** What the operator is told while the edge function is not deployed. */
export const AGREEMENTS_SERVICE_MISSING_V2 =
  "Sending isn't switched on yet: the agreements service hasn't been deployed.";

const SESSION_EXPIRED = 'Your session has expired. Sign in again.';

/** The tenant's own details, as the document's company variables. */
export interface AgreementCompanyV2 {
  companyName: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
}

export interface SendAgreementBodyV2 {
  templateId: string | null;
  /**
   * The document AS WRITTEN (the template's wording, or the one-off edit of
   * it), not yet substituted. The client renders it for this recipient.
   */
  contentHtml: string;
  title: string;
  message?: string;
  recipientName: string;
  recipientEmail: string;
  cc: string[];
  /** Fills company_name, company_email, company_phone, company_address. */
  company: AgreementCompanyV2;
  /** The tenant's time zone, for the agreement's date. The browser's when absent. */
  timeZone?: string | null;
}

export interface SendAgreementResultV2 {
  id: string;
  status: string;
  /** Present when the row was recorded but not sent: why. */
  error?: string;
}

export type AgreementDocumentResultV2 =
  | { kind: 'pdf'; base64: string; signed: boolean }
  | { kind: 'html'; html: string };

/* ── transport ─────────────────────────────────────────────────────────── */

type Reply =
  | { kind: 'ok'; data: Record<string, any> }
  | { kind: 'http'; status: number; body: Record<string, any> | null }
  | { kind: 'missing' };

const errorName = (error: unknown) => String((error as { name?: string })?.name ?? '');

const asObject = (value: unknown): Record<string, any> | null => {
  if (value && typeof value === 'object' && !(value instanceof Blob)) return value as Record<string, any>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * One call to the edge function, sorted into: an answer, a non-2xx answer in
 * the function's own shape (`{ ok: false, … }`), or "the function isn't there".
 */
async function call(body: Record<string, unknown>): Promise<Reply> {
  const { data, error } = await supabase.functions.invoke(AGREEMENTS_FUNCTION_V2, { body });
  if (!error) return { kind: 'ok', data: asObject(data) ?? {} };

  const name = errorName(error);
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') return { kind: 'missing' };

  const status = Number((error as { context?: Response })?.context?.status ?? 0);
  const payload = await extractFunctionErrorPayload(error);
  // The gateway's 404 for a function that does not exist is its own shape
  // ({ code: 'NOT_FOUND', message }), never ours ({ ok: false, error }).
  if (status === 404 && payload?.ok !== false) return { kind: 'missing' };
  if (name === 'FunctionsHttpError' || status) return { kind: 'http', status, body: payload };
  throw error instanceof Error ? error : new Error('The agreements service could not be reached.');
}

/** The Error for a non-2xx answer: the function's own sentence when it gave one. */
function failure(status: number, body: Record<string, any> | null): Error {
  if (typeof body?.error === 'string' && body.error.trim()) return new Error(body.error);
  if (status === 401) return new Error(SESSION_EXPIRED);
  return new Error(status ? `The request failed (${status}).` : 'The request failed.');
}

/* ── readiness ─────────────────────────────────────────────────────────── */

/** Whether this caller can send an individual agreement right now, and if not, why (plain words). */
export interface AgreementsReadinessV2 {
  ready: boolean;
  reason?: 'service' | 'database' | 'signing' | 'access';
  message?: string;
}

/**
 * Asked when the send dialog opens, so a missing setup is said up front
 * instead of after three steps. A refusal of the caller (401/403) is reported
 * as not ready with the function's reason, and so is a function that has not
 * been deployed; neither throws.
 */
export async function checkAgreementsReadyV2(): Promise<AgreementsReadinessV2> {
  const reply = await call({ action: 'ready' });
  if (reply.kind === 'missing') return { ready: false, reason: 'service', message: AGREEMENTS_SERVICE_MISSING_V2 };
  if (reply.kind === 'http') {
    if (reply.status === 401 || reply.status === 403) {
      return { ready: false, reason: 'access', message: failure(reply.status, reply.body).message };
    }
    throw failure(reply.status, reply.body);
  }
  const data = reply.data;
  if (data.ready === true) return { ready: true };
  return {
    ready: false,
    reason: data.reason === 'database' || data.reason === 'signing' ? data.reason : undefined,
    message: typeof data.message === 'string' && data.message ? data.message : "Sending isn't available right now.",
  };
}

/* ── the document that is sent ─────────────────────────────────────────── */

const browserTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

/**
 * The two things a send carries, built in ONE place for a send and a resend:
 *
 *   contentHtml  the FINAL html: substituted for this recipient with
 *                renderAgreementHtml(…, { mode: 'send' }) (the pipeline the
 *                preview uses) and `{{@sig1}}` ensured. A resend passes the
 *                stored snapshot, which is final already.
 *   pdfBase64    that html drawn as the PDF, the title as its banner.
 *
 * The signer tags `{{@sig1}}`, `{{@init1}}` and `{{@date1}}` pass through both
 * untouched: the PDF draws them in white for the signing service to find.
 */
export async function prepareAgreementDocumentV2(
  source:
    | { finalHtml: string }
    | {
        content: string;
        company: AgreementCompanyV2;
        recipientName: string;
        recipientEmail: string;
        timeZone?: string | null;
        date?: Date;
      },
  banner: string,
): Promise<{ contentHtml: string; pdfBase64: string }> {
  const contentHtml =
    'finalHtml' in source
      ? ensureSignatureTag(source.finalHtml)
      : ensureSignatureTag(
          renderAgreementHtml(
            source.content,
            buildIndividualData({
              companyName: source.company.companyName ?? '',
              companyEmail: source.company.companyEmail ?? '',
              companyPhone: source.company.companyPhone ?? '',
              companyAddress: source.company.companyAddress ?? '',
              recipientName: source.recipientName,
              recipientEmail: source.recipientEmail,
              date: source.date,
              timeZone: source.timeZone || browserTimeZone(),
            }),
            { mode: 'send' },
          ),
        );
  // Loaded on first send, so pdf-lib is not in the Agreements page's first bundle.
  const { renderAgreementPdfBase64 } = await import('@/lib/agreements-v2/pdf');
  const pdfBase64 = await renderAgreementPdfBase64(contentHtml, { banner });
  return { contentHtml, pdfBase64 };
}

/* ── send / resend ─────────────────────────────────────────────────────── */

/** A recorded outcome: the row exists, whatever became of the send. */
const recorded = (body: Record<string, any> | null): body is SendAgreementResultV2 =>
  !!body && typeof body.id === 'string' && typeof body.status === 'string';

interface DeliveryFieldsV2 {
  templateId: string | null;
  title: string;
  message?: string | null;
  recipientName: string;
  recipientEmail: string;
  cc: string[];
}

async function deliver(
  fields: DeliveryFieldsV2,
  document: { contentHtml: string; pdfBase64: string },
  resendOf: string | null,
): Promise<SendAgreementResultV2> {
  const reply = await call({
    action: 'send',
    templateId: fields.templateId ?? null,
    title: fields.title,
    ...(fields.message ? { message: fields.message } : {}),
    recipientName: fields.recipientName,
    recipientEmail: fields.recipientEmail,
    cc: fields.cc ?? [],
    contentHtml: document.contentHtml,
    pdfBase64: document.pdfBase64,
    resendOf,
  });
  if (reply.kind === 'missing') throw new Error(AGREEMENTS_SERVICE_MISSING_V2);
  const body = reply.kind === 'ok' ? reply.data : reply.body;
  if (recorded(body)) {
    return { id: body.id, status: body.status, ...(typeof body.error === 'string' ? { error: body.error } : {}) };
  }
  if (reply.kind === 'ok') throw new Error('The agreements service did not confirm the send.');
  throw failure(reply.status, reply.body);
}

/** Render the document for this recipient, draw its PDF, and send both. */
export async function sendAgreementV2(body: SendAgreementBodyV2): Promise<SendAgreementResultV2> {
  const document = await prepareAgreementDocumentV2(
    {
      content: body.contentHtml,
      company: body.company,
      recipientName: body.recipientName,
      recipientEmail: body.recipientEmail,
      timeZone: body.timeZone,
    },
    body.title,
  );
  return deliver(body, document, null);
}

export const INDIVIDUAL_AGREEMENTS_TABLE_V2 = 'individual_agreements_v2';

/**
 * A new row copying the old one's content, recipient, CC, title and message;
 * the old row is left alone (D17). The old row is read here, scoped to the
 * tenant, and its stored html (exactly what was sent) is drawn again as the PDF.
 */
export async function resendAgreementV2(id: string, tenantId: string): Promise<SendAgreementResultV2> {
  if (!id || !tenantId) throw new Error('That agreement was not found.');
  const { data: old, error } = await supabaseUntyped
    .from(INDIVIDUAL_AGREEMENTS_TABLE_V2)
    .select('id, recipient_name, recipient_email, cc_emails, title, message, template_id, content_html')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) throw new Error(AGREEMENTS_SERVICE_MISSING_V2);
    throw new Error('The agreement could not be loaded. Try again.');
  }
  if (!old) throw new Error('That agreement was not found.');
  const finalHtml = String(old.content_html ?? '');
  if (!finalHtml.trim()) throw new Error('That agreement has no content to resend.');

  const title = String(old.title ?? '').trim() || 'Agreement';
  const document = await prepareAgreementDocumentV2({ finalHtml }, title);
  return deliver(
    {
      templateId: old.template_id ?? null,
      title,
      message: old.message ?? null,
      recipientName: String(old.recipient_name ?? ''),
      recipientEmail: String(old.recipient_email ?? ''),
      cc: Array.isArray(old.cc_emails) ? old.cc_emails : [],
    },
    document,
    old.id ?? id,
  );
}

/* ── sync / document ───────────────────────────────────────────────────── */

/**
 * Refresh the status of the tenant's individual agreements still out for
 * signature. Before the function is deployed there is nothing to refresh.
 */
export async function syncAgreementsV2(): Promise<{ updated: number }> {
  const reply = await call({ action: 'sync' });
  if (reply.kind === 'missing') return { updated: 0 };
  if (reply.kind === 'http') throw failure(reply.status, reply.body);
  return { updated: Number(reply.data.updated ?? 0) || 0 };
}

/** An individual agreement's document: the provider's PDF, or the html that was recorded. */
export async function fetchAgreementDocumentV2(id: string): Promise<AgreementDocumentResultV2> {
  const reply = await call({ action: 'document', id });
  if (reply.kind === 'missing') throw new Error(AGREEMENTS_SERVICE_MISSING_V2);
  if (reply.kind === 'http') throw failure(reply.status, reply.body);
  const data = reply.data;
  if (data.kind === 'pdf' && typeof data.base64 === 'string') {
    return { kind: 'pdf', base64: data.base64, signed: data.signed === true };
  }
  if (data.kind === 'html' && typeof data.html === 'string') return { kind: 'html', html: data.html };
  throw new Error('No document came back.');
}
