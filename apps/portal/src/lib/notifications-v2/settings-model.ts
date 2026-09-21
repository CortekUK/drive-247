/**
 * Notifications v2: pure rules for the per-notification settings.
 *
 * Storage model (table public.tenant_notification_settings, see types.ts):
 * one row per (tenant, notification_key, channel); a NULL column means "use
 * the catalog default"; a missing row means "all defaults"; reset = DELETE.
 * These functions turn stored rows into what the page shows (effectiveChannel),
 * turn an edit back into a row with NULLs wherever it equals the default
 * (rowFromEdit), and work out what Save has to write (diffEdits), so "Reset to
 * default" is simply an edit that equals the default.
 *
 * The catalog item is always passed in (never looked up here), so this file
 * does not depend on catalog.ts. No React, no Supabase. v2 only.
 */

import {
  EMAIL_SENDER_DOMAIN,
  type ChannelSpec,
  type ChannelTemplate,
  type EffectiveChannelState,
  type EmailSenderSettings,
  type NotificationChannel,
  type NotificationItem,
  type NotificationSettingRow,
  type PushDisplayOptions,
} from "./types";
import { unknownVariables } from "./variables";
import { PUSH_BODY_MAX, PUSH_TITLE_MAX } from "./push-display";

/* -------------------------------------------------------------------------- */
/* Limits                                                                      */
/* -------------------------------------------------------------------------- */

export const EMAIL_SUBJECT_MAX = 200;
export const IN_APP_TITLE_MAX = 100;
export const IN_APP_BODY_MAX = 500;
export { PUSH_TITLE_MAX, PUSH_BODY_MAX };

/* -------------------------------------------------------------------------- */
/* Push options                                                                */
/* -------------------------------------------------------------------------- */

export const PUSH_OPTION_KEYS = ["requireInteraction", "silent", "replacePrevious", "openInApp"] as const;
export type PushOptionKey = (typeof PUSH_OPTION_KEYS)[number];

/** Every push option as a real boolean (missing or anything but `true` is false). */
export function normalisePushOptions(options?: PushDisplayOptions | null): Required<PushDisplayOptions> {
  const o = (options && typeof options === "object" ? options : {}) as PushDisplayOptions;
  return {
    requireInteraction: o.requireInteraction === true,
    silent: o.silent === true,
    replacePrevious: o.replacePrevious === true,
    openInApp: o.openInApp === true,
  };
}

/** Stored push_options reduced to the known keys that hold a boolean. */
function storedPushOptions(value: unknown): PushDisplayOptions {
  const out: PushDisplayOptions = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const v = value as Record<string, unknown>;
  for (const key of PUSH_OPTION_KEYS) {
    if (typeof v[key] === "boolean") out[key] = v[key] as boolean;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

type AnySpec = ChannelSpec<ChannelTemplate>;

function specFor(item: NotificationItem | null | undefined, channel: NotificationChannel): AnySpec | undefined {
  return (item?.channels as Partial<Record<NotificationChannel, AnySpec>> | undefined)?.[channel];
}

/** An empty template of the right shape for a channel. */
export function emptyTemplate(channel: NotificationChannel): ChannelTemplate {
  return channel === "email" ? { subject: "", body: "" } : { title: "", body: "" };
}

interface Fields {
  subject: string;
  title: string;
  body: string;
}

function fieldsOf(template: ChannelTemplate | null | undefined): Fields {
  const t = (template ?? {}) as Partial<Fields>;
  return {
    subject: typeof t.subject === "string" ? t.subject : "",
    title: typeof t.title === "string" ? t.title : "",
    body: typeof t.body === "string" ? t.body : "",
  };
}

/**
 * Two texts count as the same when they differ only in line endings, spaces at
 * the ends, or (email HTML) whitespace between tags, which the editor may
 * reformat on load. Then the default is kept (NULL), so reopening a template
 * does not turn it into a customised copy.
 */
function sameText(a: string, b: string, html: boolean): boolean {
  const norm = (s: string): string => {
    let v = (s ?? "").replace(/\r\n?/g, "\n").trim();
    if (html) v = v.replace(/>\s+</g, "><");
    return v;
  };
  return norm(a) === norm(b);
}

function sameTemplate(channel: NotificationChannel, a: ChannelTemplate, b: ChannelTemplate): boolean {
  const x = fieldsOf(a);
  const y = fieldsOf(b);
  if (channel === "email") return sameText(x.subject, y.subject, false) && sameText(x.body, y.body, true);
  return sameText(x.title, y.title, false) && sameText(x.body, y.body, false);
}

/* -------------------------------------------------------------------------- */
/* Stored -> effective                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The effective state of one channel of one item: the stored row laid over the
 * catalog default, column by column. A row for a different notification or
 * channel is ignored. A channel the item does not offer is off, with an empty
 * template.
 */
export function effectiveChannel(
  item: NotificationItem,
  channel: NotificationChannel,
  row?: NotificationSettingRow | null,
): EffectiveChannelState {
  const spec = specFor(item, channel);
  if (!spec) {
    return {
      enabled: false,
      template: emptyTemplate(channel),
      pushOptions: channel === "push" ? normalisePushOptions() : {},
      customised: false,
    };
  }
  const r = row && row.notification_key === item.key && row.channel === channel ? row : null;
  const def = fieldsOf(spec.defaultTemplate);
  const pick = (stored: string | null | undefined, fallback: string): string =>
    typeof stored === "string" ? stored : fallback;

  const template: ChannelTemplate =
    channel === "email"
      ? { subject: pick(r?.subject, def.subject), body: pick(r?.body, def.body) }
      : { title: pick(r?.title, def.title), body: pick(r?.body, def.body) };

  return {
    enabled: typeof r?.enabled === "boolean" ? r.enabled : spec.defaultEnabled === true,
    template,
    pushOptions:
      channel === "push"
        ? normalisePushOptions({ ...normalisePushOptions(spec.defaultPushOptions), ...storedPushOptions(r?.push_options) })
        : {},
    customised: !sameTemplate(channel, template, spec.defaultTemplate),
  };
}

/* -------------------------------------------------------------------------- */
/* Edit -> row                                                                 */
/* -------------------------------------------------------------------------- */

/** What the page edits for one channel. `EffectiveChannelState` fits as is. */
export interface ChannelEdit {
  enabled: boolean;
  template: ChannelTemplate;
  pushOptions?: PushDisplayOptions | null;
}

/**
 * The row to store for an edit. Each column is NULL when the edit equals the
 * catalog default, and push_options holds only the options that differ from
 * the default ({} when none do, and always {} off the push channel, matching
 * the table's CHECK). A row that comes back all NULL / {} is "all defaults":
 * see `isDefaultRow`, and `diffEdits` deletes it instead of saving it.
 */
export function rowFromEdit(
  tenantId: string,
  key: string,
  channel: NotificationChannel,
  state: ChannelEdit,
  item: NotificationItem,
): NotificationSettingRow {
  const row: NotificationSettingRow = {
    tenant_id: tenantId,
    notification_key: key,
    channel,
    enabled: null,
    subject: null,
    title: null,
    body: null,
    push_options: {},
  };
  const spec = specFor(item, channel);
  if (!spec) return row;

  const def = fieldsOf(spec.defaultTemplate);
  const edit = fieldsOf(state?.template);

  const enabled = state?.enabled === true;
  if (enabled !== (spec.defaultEnabled === true)) row.enabled = enabled;

  if (channel === "email") {
    if (!sameText(edit.subject, def.subject, false)) row.subject = edit.subject;
    if (!sameText(edit.body, def.body, true)) row.body = edit.body;
  } else {
    if (!sameText(edit.title, def.title, false)) row.title = edit.title;
    if (!sameText(edit.body, def.body, false)) row.body = edit.body;
  }

  if (channel === "push") {
    const want = normalisePushOptions(state?.pushOptions);
    const base = normalisePushOptions(spec.defaultPushOptions);
    const diff: PushDisplayOptions = {};
    for (const k of PUSH_OPTION_KEYS) if (want[k] !== base[k]) diff[k] = want[k];
    row.push_options = diff;
  }
  return row;
}

/** True when a row changes nothing (every column NULL, no push option). */
export function isDefaultRow(row: NotificationSettingRow): boolean {
  return (
    row.enabled === null &&
    row.subject === null &&
    row.title === null &&
    row.body === null &&
    Object.keys(storedPushOptions(row.push_options)).length === 0
  );
}

function sameRowValues(a: NotificationSettingRow, b: NotificationSettingRow): boolean {
  const pa = storedPushOptions(a.push_options);
  const pb = storedPushOptions(b.push_options);
  const pushSame =
    Object.keys(pa).length === Object.keys(pb).length && PUSH_OPTION_KEYS.every((k) => pa[k] === pb[k]);
  return (
    (a.enabled ?? null) === (b.enabled ?? null) &&
    (a.subject ?? null) === (b.subject ?? null) &&
    (a.title ?? null) === (b.title ?? null) &&
    (a.body ?? null) === (b.body ?? null) &&
    pushSame
  );
}

/* -------------------------------------------------------------------------- */
/* Save diff                                                                   */
/* -------------------------------------------------------------------------- */

/** `${notification_key}:${channel}`, a handy map key for rows and drafts. */
export function settingKey(notificationKey: string, channel: NotificationChannel): string {
  return notificationKey + ":" + channel;
}

/** One channel of one item as the page holds it when Save is pressed. */
export interface ChannelDraft {
  tenantId: string;
  item: NotificationItem;
  channel: NotificationChannel;
  state: ChannelEdit;
}

/** The primary key of a row, which is all a delete needs. */
export type NotificationSettingKey = Pick<NotificationSettingRow, "tenant_id" | "notification_key" | "channel">;

export interface SettingsDiff {
  /** Rows to insert or update (upsert on tenant_id, notification_key, channel). */
  upserts: NotificationSettingRow[];
  /** Rows to delete: the edit is back to all defaults. */
  deletes: NotificationSettingKey[];
}

/**
 * What Save must write. For each draft: a row that equals the defaults is
 * deleted when one is saved (and skipped when none is); anything else is
 * upserted unless the saved row already holds exactly those values. Saved rows
 * with no draft are left alone. With two drafts for the same channel, the
 * last one wins.
 */
export function diffEdits(
  savedRows: readonly NotificationSettingRow[] | null | undefined,
  draftStates: readonly ChannelDraft[] | null | undefined,
): SettingsDiff {
  const saved = new Map<string, NotificationSettingRow>();
  for (const r of savedRows ?? []) saved.set(r.tenant_id + "|" + settingKey(r.notification_key, r.channel), r);

  const drafts = new Map<string, ChannelDraft>();
  for (const d of draftStates ?? []) drafts.set(d.tenantId + "|" + settingKey(d.item.key, d.channel), d);

  const upserts: NotificationSettingRow[] = [];
  const deletes: NotificationSettingKey[] = [];
  for (const [id, d] of drafts) {
    const next = rowFromEdit(d.tenantId, d.item.key, d.channel, d.state, d.item);
    const prev = saved.get(id);
    if (isDefaultRow(next)) {
      if (prev) deletes.push({ tenant_id: next.tenant_id, notification_key: next.notification_key, channel: next.channel });
      continue;
    }
    if (prev && sameRowValues(prev, next)) continue;
    upserts.push(next);
  }
  return { upserts, deletes };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export type TemplateField = "subject" | "title" | "body";

export interface TemplateIssue {
  field: TemplateField;
  message: string;
}

export interface TemplateValidation {
  ok: boolean;
  /** Operator-facing sentences, in field order. */
  messages: string[];
  /** The same messages with the field they belong to, for inline errors. */
  issues: TemplateIssue[];
  /** `{{keys}}` used that this notification does not offer. */
  unknownVariables: string[];
}

/** The visible text of editor HTML (tags removed, &nbsp; as a space). */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

/**
 * True when the email body has a Button block (`<a data-email-button>`, the
 * editor's call-to-action) with no link: no `href`, or an empty one. The
 * editor stores a button whose link was never set exactly like that, and the
 * sanitiser would then send a button that goes nowhere.
 */
function hasButtonWithoutLink(html: string): boolean {
  const tags: string[] = String(html ?? "").match(/<a\b[^>]*>/gi) ?? [];
  return tags.some((tag: string) => {
    if (!/\sdata-email-button(?=[\s=>/])/i.test(tag)) return false;
    const href = tag.match(/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    return !href || !String(href[1] ?? href[2] ?? href[3] ?? "").trim();
  });
}

/**
 * Checks one channel's template before Save or Send test. Lengths are counted
 * the way `send-push` counts them (trimmed, in UTF-16 units):
 *   email   subject required, one line, <= 200; body must have some text, and
 *           every Button block must have a link
 *   push    title required, <= 100; body <= 300 (optional)
 *   in_app  title required, <= 100; body <= 500 (optional)
 * Every `{{key}}` not in `allowedVars` is reported by name.
 */
export function validateTemplate(
  channel: NotificationChannel,
  template: ChannelTemplate | null | undefined,
  allowedVars: readonly string[],
): TemplateValidation {
  const t = fieldsOf(template);
  const issues: TemplateIssue[] = [];
  const add = (field: TemplateField, message: string): void => {
    issues.push({ field, message });
  };
  const tooLong = (what: string, max: number, n: number): string =>
    `Keep the ${what} to ${max} characters or fewer. It has ${n}.`;

  if (channel === "email") {
    const subject = t.subject.trim();
    if (!subject) add("subject", "Add a subject.");
    else if (/[\r\n]/.test(subject)) add("subject", "Keep the subject on one line.");
    else if (subject.length > EMAIL_SUBJECT_MAX) add("subject", tooLong("subject", EMAIL_SUBJECT_MAX, subject.length));
    if (!visibleText(t.body)) add("body", "Add a message to the email.");
    if (hasButtonWithoutLink(t.body)) add("body", "A button has no link.");
  } else {
    const titleMax = channel === "push" ? PUSH_TITLE_MAX : IN_APP_TITLE_MAX;
    const bodyMax = channel === "push" ? PUSH_BODY_MAX : IN_APP_BODY_MAX;
    const title = t.title.trim();
    const body = t.body.trim();
    if (!title) add("title", "Add a title.");
    else if (title.length > titleMax) add("title", tooLong("title", titleMax, title.length));
    if (body.length > bodyMax) add("body", tooLong("message", bodyMax, body.length));
  }

  const allowed = [...(allowedVars ?? [])];
  const fields: TemplateField[] = channel === "email" ? ["subject", "body"] : ["title", "body"];
  const unknown: string[] = [];
  for (const field of fields) {
    for (const key of unknownVariables(t[field], allowed)) {
      if (unknown.includes(key)) continue;
      unknown.push(key);
      add(field, `{{${key}}} isn't a variable this notification can use.`);
    }
  }

  return {
    ok: issues.length === 0,
    messages: issues.map((i) => i.message),
    issues,
    unknownVariables: unknown,
  };
}

/* -------------------------------------------------------------------------- */
/* Email sender                                                                */
/* -------------------------------------------------------------------------- */

export interface LocalPartCheck {
  ok: boolean;
  /** Why it is not allowed, in plain words; null when it is fine. */
  reason: string | null;
}

/** The DB CHECK on tenant_email_sender.from_local_part. */
export const LOCAL_PART_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Whether `local` may be used before "@drive-247.com" by the tenant with this
 * slug. It must be the slug itself, or start with the slug followed by "." or
 * "_" and something more (coastline, coastline.bookings, coastline_team), so
 * one tenant cannot send as another's address. A "-" may NOT follow the slug:
 * slugs themselves contain dashes (^[a-z0-9-]+$), so tenant "open" could
 * otherwise take "open-bay", which is tenant "open-bay"'s default address.
 * Neither "." nor "_" can appear in a slug, so no two tenants' allowed
 * addresses can overlap. Twins: ops/notifications_v2.sql
 * (tenant_email_sender_guard) and notification-test-v2 (isValidLocalPart).
 * Returns `{ ok, reason }`: check `.ok`, show `.reason`.
 */
export function isValidLocalPart(local: string | null | undefined, slug: string | null | undefined): LocalPartCheck {
  const fail = (reason: string): LocalPartCheck => ({ ok: false, reason });
  const value = String(local ?? "");
  const s = String(slug ?? "").trim().toLowerCase();
  const domain = "@" + EMAIL_SENDER_DOMAIN;

  if (!value.trim()) return fail(`Add the part before ${domain}.`);
  if (!s) return fail("Your account details haven't loaded yet. Try again in a moment.");
  if (/[A-Z]/.test(value)) return fail("Use lowercase letters only.");
  if (value.length > 64) return fail("Keep it to 64 characters or fewer.");
  if (!/^[a-z0-9._-]+$/.test(value)) {
    return fail("Use only lowercase letters, numbers, dots (.), dashes (-) and underscores (_).");
  }
  if (!/^[a-z0-9]/.test(value)) return fail("Start with a letter or a number.");
  if (value.includes("..") || value.endsWith(".")) return fail("A dot can't come last or twice in a row.");
  if (value !== s) {
    const sep = value.charAt(s.length);
    if (!value.startsWith(s)) return fail(`Start it with "${s}", for example ${s} or ${s}.bookings.`);
    if (sep !== "." && sep !== "_") {
      return fail(`After "${s}", use a dot (.) or an underscore (_), for example ${s}.bookings.`);
    }
    if (value.length === s.length + 1) return fail(`Add something after "${value}", or use just "${s}".`);
  }
  if (!LOCAL_PART_PATTERN.test(value)) {
    return fail("Use only lowercase letters, numbers, dots (.), dashes (-) and underscores (_).");
  }
  return { ok: true, reason: null };
}

const EMAIL_PATTERN = /^[^\s@<>"'(),;:\\[\]]+@[^\s@<>"'(),;:\\[\]]+\.[^\s@<>"'(),;:\\[\]]{2,}$/;

/** A plausible single email address (for reply-to and test recipients). */
export function isValidEmail(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  return v.length <= 254 && EMAIL_PATTERN.test(v);
}

export interface SenderAddress {
  /** Display name, e.g. "Coastline Car Rentals". */
  name: string;
  /** e.g. "coastline@drive-247.com". */
  address: string;
  /** For the page: `Coastline Car Rentals <coastline@drive-247.com>`. */
  display: string;
  /** For the From header: the name quoted when it needs quoting. */
  header: string;
  /** A valid reply-to, or null. */
  replyTo: string | null;
  /** True when nothing custom is in use (today's `{company} <{slug}@drive-247.com>`). */
  usesDefault: boolean;
}

/** Removes what cannot sit in a display name (line breaks, <, >, "), squeezes spaces, caps the length. */
function cleanDisplayName(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[\x00-\x1f\x7f<>"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
}

/**
 * Who emails come from. Defaults to today's sender (resend-service.ts):
 * the company name and `{slug}@drive-247.com`. A saved name or local part
 * replaces the default only when it is usable; an invalid local part falls
 * back to the slug rather than failing the send.
 */
export function senderAddress(
  settings: Partial<EmailSenderSettings> | null | undefined,
  tenant: { company_name?: string | null; slug?: string | null } | null | undefined,
): SenderAddress {
  const slug = String(tenant?.slug ?? "").trim().toLowerCase();
  const customName = cleanDisplayName(settings?.from_name);
  const name = customName || cleanDisplayName(tenant?.company_name) || "Drive 247";

  const wanted = String(settings?.from_local_part ?? "").trim();
  const customLocal = wanted && isValidLocalPart(wanted, slug).ok ? wanted : "";
  const local = customLocal || (/^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : "noreply");
  const address = `${local}@${EMAIL_SENDER_DOMAIN}`;

  const atext = /^[A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~]+$/;
  const header = (atext.test(name) ? name : `"${name.replace(/\\/g, "\\\\")}"`) + ` <${address}>`;
  const replyTo = isValidEmail(settings?.reply_to) ? String(settings?.reply_to).trim() : null;

  return {
    name,
    address,
    display: `${name} <${address}>`,
    header,
    replyTo,
    usesDefault: !customName && (!customLocal || customLocal === slug) && !replyTo,
  };
}
