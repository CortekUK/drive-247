/**
 * agreements-v2 edge function — the signing provider (BoldSign) calls, in one
 * place. PURE: no Deno APIs, no URL imports. `fetch`, the environment and the
 * back-off sleep are passed in, so vitest can drive every call here.
 *
 * Ported from apps/portal/src/lib/agreements-v2/server/provider.ts (the Next
 * implementation this function replaces), which took every call shape from the
 * v1 routes proven in production:
 *  - send:     app/api/esign/route.ts (multipart /v1/document/send,
 *              UseTextTags + TextTagDefinitions for sig1/date1/init1, the 429
 *              retry at 15 s then 30 s);
 *  - status:   app/api/esign/status/route.ts (/v1/document/properties and its
 *              status map);
 *  - download: app/api/esign/view/route.ts (/v1/document/download).
 *
 * What differs for an individual agreement (D12, D13): the title and message
 * are the operator's, the CC list is passed through, and `DisableEmails` is
 * FALSE, because nothing else delivers this agreement.
 */

export type EnvReader = (key: string) => string | undefined;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type BoldSignMode = 'test' | 'live';

export const DEFAULT_BOLDSIGN_BASE_URL = 'https://api.boldsign.com';

export function boldSignBaseUrl(env: EnvReader): string {
  return env('BOLDSIGN_BASE_URL') || DEFAULT_BOLDSIGN_BASE_URL;
}

/**
 * The API key for a mode, with the same fallbacks as `_shared/boldsign-client.ts`
 * and every v1 route — but answering '' instead of throwing, so a missing key
 * is reported in plain words rather than as a 500 stack.
 */
export function getBoldSignApiKey(env: EnvReader, mode: BoldSignMode): string {
  return mode === 'live'
    ? (env('BOLDSIGN_LIVE_API_KEY') || env('BOLDSIGN_API_KEY') || '')
    : (env('BOLDSIGN_TEST_API_KEY') || env('BOLDSIGN_API_KEY') || '');
}

/** Statuses a document never leaves, so a status sync never asks about them again. */
export const TERMINAL_DOCUMENT_STATUSES = ['completed', 'signed', 'declined', 'voided', 'expired', 'revoked', 'send_failed', 'credit_failed'] as const;

/** The provider's document status, as `document_status` stores it: app/api/esign/status/route.ts's map. */
export function mapDocumentStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'WaitingForOthers': 'sent',
    'NeedsSigning': 'sent',
    'InProgress': 'sent',
    'Completed': 'completed',
    'Declined': 'declined',
    'Revoked': 'voided',
    'Expired': 'expired',
    'Draft': 'pending',
  };
  return statusMap[status] || String(status ?? '').toLowerCase();
}

export interface SendFormInput {
  title: string;
  message: string | null;
  brandId: string | null;
  recipientName: string;
  recipientEmail: string;
  cc: string[];
  /** The FINAL html the PDF was drawn from, to decide which text tags to define. */
  html: string;
  pdf: Uint8Array;
  fileName?: string;
}

/**
 * The multipart body for /v1/document/send. The signer and its text-tag
 * definitions are built exactly as route.ts builds them: sig1 always (the html
 * is required to carry it), date1 and init1 only when the document has them.
 */
export function buildSendForm(input: SendFormInput): FormData {
  const formData = new FormData();
  formData.append('Title', input.title);
  const message = (input.message ?? '').trim();
  if (message) formData.append('Message', message);
  if (input.brandId) formData.append('BrandId', input.brandId);

  formData.append('Signers[0][Name]', input.recipientName);
  formData.append('Signers[0][EmailAddress]', input.recipientEmail);
  formData.append('Signers[0][SignerType]', 'Signer');

  input.cc.forEach((email, i) => {
    formData.append(`CC[${i}][EmailAddress]`, email);
  });

  // Text tags: the provider finds {{@sig1}}, {{@date1}}, {{@init1}} in the PDF
  formData.append('UseTextTags', 'true');

  const hasDateTag = /\{\{@date1\}\}/.test(input.html);
  const hasInitTag = /\{\{@init1\}\}/.test(input.html);

  let tagIdx = 0;

  // Signature (always present)
  formData.append(`TextTagDefinitions[${tagIdx}][DefinitionId]`, 'sig1');
  formData.append(`TextTagDefinitions[${tagIdx}][Type]`, 'Signature');
  formData.append(`TextTagDefinitions[${tagIdx}][SignerIndex]`, '1');
  formData.append(`TextTagDefinitions[${tagIdx}][IsRequired]`, 'true');
  formData.append(`TextTagDefinitions[${tagIdx}][Size][Width]`, '250');
  formData.append(`TextTagDefinitions[${tagIdx}][Size][Height]`, '50');
  tagIdx++;

  if (hasDateTag) {
    formData.append(`TextTagDefinitions[${tagIdx}][DefinitionId]`, 'date1');
    formData.append(`TextTagDefinitions[${tagIdx}][Type]`, 'DateSigned');
    formData.append(`TextTagDefinitions[${tagIdx}][SignerIndex]`, '1');
    formData.append(`TextTagDefinitions[${tagIdx}][IsRequired]`, 'true');
    formData.append(`TextTagDefinitions[${tagIdx}][Size][Width]`, '150');
    formData.append(`TextTagDefinitions[${tagIdx}][Size][Height]`, '30');
    tagIdx++;
  }

  if (hasInitTag) {
    formData.append(`TextTagDefinitions[${tagIdx}][DefinitionId]`, 'init1');
    formData.append(`TextTagDefinitions[${tagIdx}][Type]`, 'Initial');
    formData.append(`TextTagDefinitions[${tagIdx}][SignerIndex]`, '1');
    formData.append(`TextTagDefinitions[${tagIdx}][IsRequired]`, 'true');
    formData.append(`TextTagDefinitions[${tagIdx}][Size][Width]`, '100');
    formData.append(`TextTagDefinitions[${tagIdx}][Size][Height]`, '40');
    tagIdx++;
  }

  formData.append('EnableSigningOrder', 'false');
  // D13: the provider emails the recipient (and the CC) itself. There is no
  // second delivery channel for an individual agreement.
  formData.append('DisableEmails', 'false');

  const fileBlob = new Blob([new Uint8Array(input.pdf)], { type: 'application/pdf' });
  formData.append('Files', fileBlob, input.fileName || 'Agreement.pdf');
  return formData;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ProviderDeps {
  fetch: FetchLike;
  env: EnvReader;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * POST the document, retrying a 429 twice (15 s, then 30 s), as route.ts does.
 * `sleep` is injectable so a test does not wait 45 seconds.
 */
export async function sendDocument(
  form: FormData,
  apiKey: string,
  deps: ProviderDeps,
  maxAttempts = 3,
): Promise<Response> {
  const sleep = deps.sleep ?? wait;
  let response: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    response = await deps.fetch(`${boldSignBaseUrl(deps.env)}/v1/document/send`, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey },
      body: form,
    });
    if (response.status === 429 && attempt < maxAttempts) {
      await sleep(attempt * 15_000);
      continue;
    }
    break;
  }
  return response!;
}

export function getDocumentProperties(documentId: string, apiKey: string, deps: ProviderDeps): Promise<Response> {
  return deps.fetch(`${boldSignBaseUrl(deps.env)}/v1/document/properties?documentId=${encodeURIComponent(documentId)}`, {
    headers: { 'X-API-KEY': apiKey },
  });
}

export function downloadDocument(documentId: string, apiKey: string, deps: ProviderDeps): Promise<Response> {
  return deps.fetch(`${boldSignBaseUrl(deps.env)}/v1/document/download?documentId=${encodeURIComponent(documentId)}`, {
    headers: { 'X-API-KEY': apiKey },
  });
}

/**
 * Why the provider refused, fit for the agreement's details: the HTTP status,
 * plus the provider's own short reason when it gave one. Never the API key,
 * never a stack, never more than 300 characters.
 */
export function providerErrorMessage(status: number, bodyText: string): string {
  let reason = '';
  try {
    const parsed = JSON.parse(bodyText);
    const candidate = parsed?.error ?? parsed?.message ?? parsed?.title ?? '';
    reason = typeof candidate === 'string' ? candidate : '';
  } catch {
    reason = '';
  }
  reason = reason.replace(/\s+/g, ' ').trim().slice(0, 200);
  const base = `The signing service turned the document down (HTTP ${status}).`;
  return reason ? `${base} ${reason}`.slice(0, 300) : base;
}

/**
 * A provider timestamp as an ISO string Postgres accepts, or null.
 *
 * BoldSign's document properties are not consistent about date shapes: epoch
 * SECONDS in some responses, ISO strings in others, and a bare number arrives
 * as a JSON number or a numeric string. Writing an epoch integer straight into
 * a timestamptz column fails the WHOLE update, and an individual agreement has
 * no webhook to fix it later. Numbers under 1e12 are seconds, larger ones
 * milliseconds; anything unreadable is null so the caller can fall back.
 */
export function toIsoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const asNumber = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  if (Number.isFinite(asNumber)) {
    if (asNumber <= 0) return null;
    const ms = asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
