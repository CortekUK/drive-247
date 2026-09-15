/**
 * v2 Settings: the pure rules behind the Notifications, Push notifications and
 * Customer messages (templates) states.
 *
 * No React and no Supabase here, so each threshold is unit-tested with values
 * worked out by hand (see `__tests__/components/settings-messages-v2.test.tsx`).
 * v2 only: nothing in v1 imports this file.
 */

import type { EmailTemplateType } from "@/lib/email-template-variables";
import type { TemplateCategory, TemplateType } from "@/hooks/use-agreement-templates";

/* -------------------------------------------------------------------------- */
/* Reminder timing rules                                                       */
/* -------------------------------------------------------------------------- */

export const LEAD_DAYS_MAX = 365;

export type LeadDaysResult = { ok: true; value: number } | { ok: false; message: string };

/**
 * The lead-days input. `<input type="number" min max>` only hints: a typed
 * "-5", "9999" or "1.5" still reaches state, and v1 then silently did nothing
 * (or saved 9999). This says why, so Save can stay disabled with a reason.
 */
export function parseLeadDays(raw: string): LeadDaysResult {
  const text = raw.trim();
  if (text === "") return { ok: false, message: "Enter a number of days (0–365)." };
  if (text.startsWith("-")) return { ok: false, message: "Days can't be negative." };
  if (!/^\d+$/.test(text)) return { ok: false, message: "Use whole days (0–365)." };
  const value = Number(text);
  if (value > LEAD_DAYS_MAX) return { ok: false, message: "Keep it within a year (0–365 days)." };
  return { ok: true, value };
}

const SEVERITY_LABEL: Record<string, string> = { info: "Info", warning: "Warning", critical: "Critical" };

export function severityLabel(severity: string | null | undefined): string {
  if (!severity) return "Info";
  return SEVERITY_LABEL[severity] ?? severity.charAt(0).toUpperCase() + severity.slice(1);
}

export function ruleTiming(rule: { lead_days: number; is_recurring: boolean }): string {
  const n = rule.lead_days;
  if (rule.is_recurring) return n === 1 ? "every day" : `every ${n} days`;
  if (n === 0) return "on the due date";
  return n === 1 ? "1 day before due" : `${n} days before due`;
}

/** "Off · 7 days before due · Warning": what a switched-off rule would do. */
export function ruleSummary(rule: {
  lead_days: number;
  is_recurring: boolean;
  severity: string;
  is_enabled: boolean;
}): string {
  return `${rule.is_enabled ? "On" : "Off"} · ${ruleTiming(rule)} · ${severityLabel(rule.severity)}`;
}

/* -------------------------------------------------------------------------- */
/* Email notification recipient                                                */
/* -------------------------------------------------------------------------- */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string | null | undefined): boolean {
  return EMAIL_PATTERN.test((value ?? "").trim());
}

export type RecipientProblem = "invalid" | "no-address" | null;

/**
 * `invalid`: something typed that is not an address (v1 saved "abc" and
 * toasted "Notifications will be sent to abc."). `no-address`: alerts are on,
 * the field is empty and there is no contact email to fall back to, so every
 * alert email goes nowhere.
 */
export function recipientProblem({
  draft,
  contactEmail,
  masterEnabled,
}: {
  draft: string;
  contactEmail: string | null | undefined;
  masterEnabled: boolean;
}): RecipientProblem {
  const typed = draft.trim();
  if (typed && !isValidEmail(typed)) return "invalid";
  if (masterEnabled && !typed && !(contactEmail ?? "").trim()) return "no-address";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Push: send form                                                             */
/* -------------------------------------------------------------------------- */

export type PushTarget = "self" | "staff" | "customers" | "all";

/** Devices a target reaches. `null` for "self": this browser, not a count. */
export function pushAudienceCount(target: PushTarget, staff: number, customers: number): number | null {
  switch (target) {
    case "staff":
      return staff;
    case "customers":
      return customers;
    case "all":
      return staff + customers;
    default:
      return null;
  }
}

/** A portal path ("/rentals") or a full https link. Blank is allowed (opens the portal). */
export function isValidPushUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return true;
  if (/\s/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  return /^https:\/\/[^/\s]+\.[^/\s]+/i.test(value);
}

export type PushBlock = "title" | "url" | "browser" | "empty-audience" | null;

/** Why Send is disabled, first reason wins. `null` means it can send. */
export function pushSendBlockReason(input: {
  target: PushTarget;
  title: string;
  url: string;
  isSupported: boolean;
  isBlocked: boolean;
  staffCount: number;
  customerCount: number;
  /** Device counts actually loaded (not loading, not errored). */
  devicesKnown: boolean;
}): PushBlock {
  if (!input.title.trim()) return "title";
  if (!isValidPushUrl(input.url)) return "url";
  if (input.target === "self" && (input.isBlocked || !input.isSupported)) return "browser";
  if (
    input.target !== "self" &&
    input.devicesKnown &&
    pushAudienceCount(input.target, input.staffCount, input.customerCount) === 0
  ) {
    return "empty-audience";
  }
  return null;
}

export const PUSH_BLOCK_COPY: Record<Exclude<PushBlock, null>, string> = {
  title: "Add a title to send.",
  url: "Use a portal path like /rentals, or a full https:// link.",
  browser: "This browser can't receive push notifications. Pick another audience, or fix the permission above.",
  "empty-audience": "No devices in this audience yet, so there is nothing to send to.",
};

/* -------------------------------------------------------------------------- */
/* Lockbox messages                                                            */
/* -------------------------------------------------------------------------- */

export const SMS_SINGLE_LIMIT = 160;
/** A concatenated SMS loses 7 characters per part to its header. */
export const SMS_PART_LIMIT = 153;

export function smsSegments(length: number): number {
  if (!Number.isFinite(length) || length <= 0) return 0;
  return length <= SMS_SINGLE_LIMIT ? 1 : Math.ceil(length / SMS_PART_LIMIT);
}

/** The exact token `notify-lockbox-code` replaces. */
export const LOCKBOX_CODE_VARIABLE = "{{lockbox_code}}";

export function lockboxTemplateIssues({
  channel,
  subject,
  body,
}: {
  channel: "email" | "sms";
  subject?: string | null;
  body: string | null | undefined;
}): { subjectError: string | null; bodyError: string | null; missingCode: boolean } {
  const text = body ?? "";
  return {
    subjectError: channel === "email" && !(subject ?? "").trim() ? "Add a subject line." : null,
    bodyError: !text.trim() ? "Add the message text." : null,
    missingCode: !!text.trim() && !text.includes(LOCKBOX_CODE_VARIABLE),
  };
}

/* -------------------------------------------------------------------------- */
/* Template HTML                                                               */
/* -------------------------------------------------------------------------- */

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
};

export function htmlToPlainText(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** TipTap's empty document is "<p></p>". An image or table alone still counts as content. */
export function isBlankHtml(html: string | null | undefined): boolean {
  return htmlToPlainText(html) === "" && !/<(img|table|hr)\b/i.test(html ?? "");
}

/**
 * A card preview of an agreement. v1 always appended "..." (even to a
 * twelve-word template) and showed an empty grey box for image-only content.
 */
export function agreementPreviewSnippet(html: string | null | undefined, max = 200): string | null {
  const text = htmlToPlainText(html);
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/* -------------------------------------------------------------------------- */
/* Agreement deep links                                                        */
/* -------------------------------------------------------------------------- */

export const AGREEMENT_CATEGORIES: readonly TemplateCategory[] = ["standard", "extension", "payg", "installment"];

export const AGREEMENT_CATEGORY_LABEL: Record<TemplateCategory, string> = {
  standard: "Standard",
  extension: "Extension",
  payg: "Pay As You Go",
  installment: "Installment Plan",
};

/**
 * `?category=` on the agreements list. v1 set the tabs to any value, so
 * `?category=foo` (or `payg` while Pay As You Go is off) showed an empty body.
 */
export function resolveAgreementCategory(
  param: string | null | undefined,
  paygEnabled: boolean,
): { category: TemplateCategory; notice: "payg-off" | "unknown" | null } {
  if (!param) return { category: "standard", notice: null };
  if (param === "payg" && !paygEnabled) return { category: "standard", notice: "payg-off" };
  if ((AGREEMENT_CATEGORIES as readonly string[]).includes(param)) {
    return { category: param as TemplateCategory, notice: null };
  }
  return { category: "standard", notice: "unknown" };
}

/**
 * `?type=&category=` on the agreement editor. `null` when either is unknown:
 * v1 treated `?type=foo` as the custom path and saved with an invalid type.
 */
export function resolveAgreementEditorParams(
  type: string | null | undefined,
  category: string | null | undefined,
): { type: TemplateType; category: TemplateCategory } | null {
  const t = type || "default";
  const c = category || "standard";
  if (t !== "default" && t !== "custom") return null;
  if (!(AGREEMENT_CATEGORIES as readonly string[]).includes(c)) return null;
  return { type: t, category: c as TemplateCategory };
}

/* -------------------------------------------------------------------------- */
/* Email template search                                                       */
/* -------------------------------------------------------------------------- */

export function filterEmailTemplateTypes<T extends Pick<EmailTemplateType, "key" | "name" | "description">>(
  types: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...types];
  return types.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.key.toLowerCase().includes(q),
  );
}
