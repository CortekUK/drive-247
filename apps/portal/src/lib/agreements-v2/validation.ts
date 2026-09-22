/**
 * Agreements v2 — the rules an individual send must meet (D12, D20).
 *
 * PURE, and shared on purpose: the Send agreement dialog checks these before
 * it asks, so the operator hears "that CC address is not valid" in the dialog
 * rather than as a server error. The `agreements-v2` edge function enforces
 * the same rules on its side. Nothing here touches the network, the database
 * or Node APIs.
 *
 * The limits are tighter than the table's CHECKs (ops/agreements_v2.sql),
 * which are generous ceilings.
 */

import { OPERATOR_SIGNATURE_ATTR } from '@/lib/agreements-v2/types';

export const RECIPIENT_NAME_MAX = 200;
export const TITLE_MAX = 200;
export const MESSAGE_MAX = 1000;
export const CC_MAX = 10;
export const EMAIL_MAX = 254;
/** 500 kB of document, not counting the operator's signature image (capped on its own at 500 kB). */
export const CONTENT_MAX_BYTES = 500 * 1024;

/**
 * An email address as a person means one: a local part, an `@`, a domain with
 * a dot and a two-letter-or-longer last label, and none of the characters that
 * would make it a list, a display name or markup. Stricter than the table's
 * CHECK, which it always satisfies.
 */
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;

export function isValidEmailV2(value: string): boolean {
  const email = (value ?? '').trim();
  if (!email || email.length > EMAIL_MAX) return false;
  if (!EMAIL.test(email)) return false;
  const [, domain] = email.split('@');
  return !domain.startsWith('.') && !domain.includes('..');
}

/** Split a typed or pasted run of addresses on commas, semicolons and whitespace. */
export function splitEmailsV2(value: string): string[] {
  return (value ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** The operator-signature `<img>`s' data URLs, which are capped separately and so not counted. */
const SIGNATURE_IMG = new RegExp(`<img\\b[^>]*\\s${OPERATOR_SIGNATURE_ATTR}\\s*=\\s*["']true["'][^>]*>`, 'gi');

/** The size the 500 kB limit applies to: the document without its operator signature images. */
export function contentSizeForLimit(html: string): number {
  return byteLength((html ?? '').replace(SIGNATURE_IMG, ''));
}

export interface IndividualSendInputV2 {
  templateId: string | null;
  contentHtml: string;
  title: string;
  message: string | null;
  recipientName: string;
  recipientEmail: string;
  cc: string[];
}

/** `ok` with the normalised `value`, or not `ok` with the `error` and its `field` (not a union: strictNullChecks is off). */
export interface ValidationResultV2 {
  ok: boolean;
  value?: IndividualSendInputV2;
  error?: string;
  field?: keyof IndividualSendInputV2;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuidV2 = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/**
 * Check and normalise a send. Strings are trimmed; the CC list must be at most
 * ten distinct valid addresses, none of them the recipient (compared without
 * case, as mail servers compare them). `checkContent: false` is for a resend,
 * whose content is the stored snapshot of what was sent before.
 */
export function validateIndividualSendV2(raw: unknown, opts: { checkContent?: boolean } = {}): ValidationResultV2 {
  const body = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const fail = (field: keyof IndividualSendInputV2, error: string): ValidationResultV2 => ({ ok: false, field, error });

  const recipientName = str(body.recipientName);
  if (!recipientName) return fail('recipientName', 'Enter the recipient’s name.');
  if (recipientName.length > RECIPIENT_NAME_MAX) {
    return fail('recipientName', `The recipient’s name can be at most ${RECIPIENT_NAME_MAX} characters.`);
  }

  const recipientEmail = str(body.recipientEmail);
  if (!isValidEmailV2(recipientEmail)) return fail('recipientEmail', 'Enter a valid email address for the recipient.');

  if (body.cc !== undefined && body.cc !== null && !Array.isArray(body.cc)) return fail('cc', 'CC must be a list of email addresses.');
  const ccRaw = Array.isArray(body.cc) ? body.cc : [];
  const cc: string[] = [];
  const seen = new Set<string>();
  for (const entry of ccRaw) {
    const email = str(entry);
    if (!isValidEmailV2(email)) return fail('cc', `${email || 'An empty address'} is not a valid email address.`);
    const key = email.toLowerCase();
    if (key === recipientEmail.toLowerCase()) return fail('cc', `${email} is already the recipient.`);
    if (seen.has(key)) return fail('cc', `${email} is in the CC list twice.`);
    seen.add(key);
    cc.push(email);
  }
  if (cc.length > CC_MAX) return fail('cc', `You can copy in at most ${CC_MAX} people.`);

  const title = str(body.title);
  if (!title) return fail('title', 'Give the document a title.');
  if (title.length > TITLE_MAX) return fail('title', `The title can be at most ${TITLE_MAX} characters.`);

  if (body.message !== undefined && body.message !== null && typeof body.message !== 'string') {
    return fail('message', 'The message must be text.');
  }
  const message = str(body.message);
  if (message.length > MESSAGE_MAX) return fail('message', `The message can be at most ${MESSAGE_MAX} characters.`);

  let templateId: string | null = null;
  if (body.templateId !== undefined && body.templateId !== null && body.templateId !== '') {
    if (!isUuidV2(body.templateId)) return fail('templateId', 'That template was not found.');
    templateId = body.templateId;
  }

  const contentHtml = typeof body.contentHtml === 'string' ? body.contentHtml : '';
  if (opts.checkContent !== false) {
    if (!contentHtml.trim()) return fail('contentHtml', 'The agreement has no content.');
    if (contentSizeForLimit(contentHtml) > CONTENT_MAX_BYTES) {
      return fail('contentHtml', 'The agreement is too large to send. Shorten it and try again.');
    }
  }

  return {
    ok: true,
    value: { templateId, contentHtml, title, message: message || null, recipientName, recipientEmail, cc },
  };
}
