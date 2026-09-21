/**
 * Notifications v2, SYSTEM set: the variables a platform notification can use.
 *
 * The operator's page has its own list at
 * `apps/portal/src/lib/notifications-v2/variables.ts`, built around one rental.
 * This one is built around one TENANT, because every message in the system
 * catalogue is about an operator rather than about a booking: who they are,
 * what they pay us, what they just did, and where we go to look at it.
 *
 * Every key below is a value the sending code already has in its hand today.
 * Each one carries a comment naming the file it comes from, so that when
 * sending eventually moves onto these templates the resolver has somewhere to
 * read from. Nothing here is aspirational.
 *
 * The examples describe ONE fictional operator, so every preview reads as the
 * same story: Coastline Car Rentals (slug `coastline`) signed up on 3 October
 * 2026, pays $149 a month on the Growth plan, and Jordan Ellis is the head
 * admin who presses the buttons.
 *
 * No React and no Supabase here. Nothing in v1 imports this file.
 */

import { formatCurrency } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type SystemVariableGroup =
  /** The operator: who they are and how we reach them. */
  | "tenant"
  /** What they pay us, and when. */
  | "billing"
  /** The person on the other end — their staff member, or our super admin. */
  | "person"
  /** What actually happened: the action, the request, the ticket. */
  | "event"
  /** Somewhere to click. */
  | "links";

export interface SystemNotificationVariable {
  /** `{{key}}`. Matches the same `\{\{[A-Za-z0-9_]+\}\}` pattern the server uses. */
  key: string;
  label: string;
  description: string;
  group: SystemVariableGroup;
  /** Example shown in previews and test sends. */
  example: string;
}

/* -------------------------------------------------------------------------- */
/* The example operator                                                        */
/* -------------------------------------------------------------------------- */

/** Amounts in the example, formatted in the currency the viewer asks for. */
const EXAMPLE_AMOUNTS = {
  plan_amount: 149,
} as const;

type AmountKey = keyof typeof EXAMPLE_AMOUNTS;

const EXAMPLE_TENANT = {
  name: "Coastline Car Rentals",
  slug: "coastline",
  email: "hello@coastlinerentals.com",
  adminName: "Jordan Ellis",
  id: "7c1e9a52-3d8b-4f60-9a21-5e4c7b0d8f13",
};

const ADMIN_APP_URL = "https://admin.drive-247.com";

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

export const SYSTEM_NOTIFICATION_VARIABLES: SystemNotificationVariable[] = [
  /* Tenant ------------------------------------------------------------------ */
  {
    // tenants.company_name — read by every function in the catalogue.
    key: "tenant_name",
    label: "Operator name",
    description: "The rental company's name, as it appears in your tenant list.",
    group: "tenant",
    example: EXAMPLE_TENANT.name,
  },
  {
    // tenants.slug — used to build their portal and booking-site addresses.
    key: "tenant_slug",
    label: "Operator slug",
    description: "The subdomain the operator was given. It never changes.",
    group: "tenant",
    example: EXAMPLE_TENANT.slug,
  },
  {
    // tenants.contact_email — the fallback recipient in
    // notify-subscription-activated/index.ts:122 and the default the migration
    // composer prefills (send-migration-email/index.ts:104).
    key: "tenant_contact_email",
    label: "Operator contact email",
    description: "The address on file for the company. Where we write when we have nobody better.",
    group: "tenant",
    example: EXAMPLE_TENANT.email,
  },
  {
    // tenants.admin_name — send-migration-email/index.ts:113 greets with it.
    key: "tenant_admin_name",
    label: "Operator head admin",
    description: "The name of the person who owns the account.",
    group: "tenant",
    example: EXAMPLE_TENANT.adminName,
  },
  {
    // tenants.tenant_type === 'test' — platform-rental-notify skips these, and
    // platform_activity_prefs.include_test_tenants filters them.
    key: "tenant_kind",
    label: "Live or test",
    description: "Whether this is a real operator or one of our test tenants.",
    group: "tenant",
    example: "Live",
  },

  /* Billing ----------------------------------------------------------------- */
  {
    // subscription_links.plan_name_snapshot, echoed into the subscription's
    // Stripe metadata — notify-subscription-activated/index.ts:107.
    key: "plan_name",
    label: "Plan name",
    description: "The plan the operator is on, or the one a link was raised for.",
    group: "billing",
    example: "Growth",
  },
  {
    // subscription_links.amount_snapshot, minor units, formatted by money().
    key: "plan_amount",
    label: "Plan amount",
    description: "What the operator pays each billing period.",
    group: "billing",
    example: "$149.00",
  },
  {
    // subscription_links.interval_snapshot.
    key: "plan_interval",
    label: "Billing period",
    description: "month or year.",
    group: "billing",
    example: "month",
  },
  {
    // tenant_subscriptions.current_period_end —
    // notify-subscription-activated/index.ts:96.
    key: "renewal_date",
    label: "Renews on",
    description: "When the subscription bills again.",
    group: "billing",
    example: "3 November 2026",
  },
  {
    // The minted link's plaintext URL. It is unrecoverable after sending, which
    // is why send-subscription-link-email mints a fresh one each time.
    key: "subscription_link_url",
    label: "Subscription link",
    description: "The one-time page where the operator pays. A fresh one is minted on every send.",
    group: "links",
    example: "https://drive-247.com/subscribe/8f21c4a9e07b",
  },
  {
    // _shared/subscription-link.ts LINK_TTL_MS = 24 hours.
    key: "link_expires_in",
    label: "Link valid for",
    description: "How long a subscription link works before it has to be re-sent.",
    group: "billing",
    example: "24 hours",
  },

  /* Person ------------------------------------------------------------------ */
  {
    // tenant_feedback.submitter_name, go_live_requests.requested_by →
    // app_users.name, trax ticket requester.
    key: "requester_name",
    label: "Who asked",
    description: "The operator's staff member behind this request, ticket or note.",
    group: "person",
    example: EXAMPLE_TENANT.adminName,
  },
  {
    // tenant_feedback.submitter_email, and the trax ticket requester address.
    key: "requester_email",
    label: "Their email",
    description: "How to reply to the person who raised it.",
    group: "person",
    example: "jordan@coastlinerentals.com",
  },
  {
    // tenant_feedback.submitter_role.
    key: "requester_role",
    label: "Their role",
    description: "The role they hold in the operator's portal.",
    group: "person",
    example: "Head admin",
  },
  {
    // notify-platform-activity/index.ts:174 — app_users.name, else the email.
    key: "actor_name",
    label: "Who did it",
    description: "The person whose action set off a platform activity alert.",
    group: "person",
    example: EXAMPLE_TENANT.adminName,
  },

  /* Event ------------------------------------------------------------------- */
  {
    // notify-platform-activity/index.ts:59 labelFor(audit_logs.action).
    key: "activity_label",
    label: "What happened",
    description: "The audited action in plain words, for example \"Payment received\".",
    group: "event",
    example: "Payment received",
  },
  {
    // notify-platform-activity/index.ts:182 — reference, amount, entity type.
    key: "activity_detail",
    label: "Activity detail",
    description: "The reference, amount and record type behind the action, when the audit row has them.",
    group: "event",
    example: "R-3F9A2C · 700 · rental",
  },
  {
    // rentals.rental_number — platform-rental-notify/index.ts:91.
    key: "rental_reference",
    label: "Rental reference",
    description: "The booking the platform alert is about.",
    group: "event",
    example: "R-3F9A2C",
  },
  {
    // platform-rental-notify/index.ts:96 — "all systems live", else the first
    // reason in rentals.creation_context.reasons.
    key: "rental_verdict",
    label: "Verdict",
    description: "Whether the operator's integrations were live-ready when this rental was created.",
    group: "event",
    example: "Stripe Connect not live",
  },
  {
    // rentals.health_severity — ok | warning | critical.
    key: "health_severity",
    label: "Severity",
    description: "All systems live, Needs attention, or Action required.",
    group: "event",
    example: "Needs attention",
  },
  {
    // notify-feedback-submission/index.ts CATEGORY_LABELS.
    key: "feedback_category",
    label: "Feedback type",
    description: "Bug, Improvement, Feature request or Note.",
    group: "event",
    example: "Bug",
  },
  {
    // tenant_feedback.message.
    key: "feedback_message",
    label: "What they wrote",
    description: "The feedback itself, as the operator typed it.",
    group: "event",
    example: "The rental list loses my filter every time I open a booking and come back.",
  },
  {
    // go_live_requests.note — the reason a tenant gave for cancelling.
    key: "request_reason",
    label: "Reason given",
    description: "Why the operator asked, when they told us. Often empty.",
    group: "event",
    example: "We're closing the Oakland branch at the end of the quarter.",
  },
  {
    // go_live_requests.integration_type.
    key: "request_type",
    label: "Request type",
    description: "What the operator asked for, for example a go-live or a cancellation.",
    group: "event",
    example: "Subscription cancellation",
  },
  {
    // trax_support_tickets.reference, redacted by emailPreview().
    key: "ticket_reference",
    label: "Ticket number",
    description: "The support ticket's reference.",
    group: "event",
    example: "T-4821",
  },
  {
    // The ticket summary, redacted by emailPreview().
    key: "ticket_subject",
    label: "Ticket subject",
    description: "What the ticket is about, in one line.",
    group: "event",
    example: "Deposit hold released early",
  },
  {
    // The first message, redacted by emailPreview(). Money and identity words
    // are replaced wholesale before the mail leaves — see ticket-email.ts:9.
    key: "ticket_message",
    label: "Ticket message",
    description: "A short, redacted preview. Anything financial is withheld and read inside Support.",
    group: "event",
    example: "[Sensitive details available inside Support]",
  },
  {
    // onboarding-daily-digest/index.ts:72 — pending.length.
    key: "pending_count",
    label: "Operators pending",
    description: "How many operators are still mid-onboarding.",
    group: "event",
    example: "4",
  },
  {
    // onboarding-daily-digest/index.ts:72 — onboardedCount.
    key: "onboarded_count",
    label: "Operators live",
    description: "How many operators have finished every onboarding step.",
    group: "event",
    example: "11",
  },
  {
    // bonzah_onboarding_submissions.partner_message on approve, or
    // reject_reason on reject.
    key: "partner_message",
    label: "Reviewer's note",
    description: "What the Bonzah reviewer wrote when approving or asking for updates.",
    group: "event",
    example: "Please re-upload the certificate of insurance — the copy we have expires next month.",
  },
  {
    // bonzah_onboarding_submissions.business_trade_name.
    key: "application_name",
    label: "Trading name",
    description: "The business name on the operator's Bonzah application.",
    group: "event",
    example: "Coastline Car Rentals LLC",
  },
  {
    // admin_settings.maintenance_banner_message.
    key: "banner_message",
    label: "Banner message",
    description: "The maintenance wording everyone sees.",
    group: "event",
    example: "We're performing scheduled maintenance. Some features may be briefly unavailable.",
  },

  /* Links ------------------------------------------------------------------- */
  {
    // portalBaseUrl(tenants.slug), _shared/subscription-link.ts.
    key: "portal_url",
    label: "Their portal",
    description: "The operator's own portal address.",
    group: "links",
    example: `https://${EXAMPLE_TENANT.slug}.portal.drive-247.com`,
  },
  {
    // signup-provision/index.ts builds this alongside portalUrl.
    key: "booking_url",
    label: "Their booking site",
    description: "The public booking site we gave them.",
    group: "links",
    example: `https://${EXAMPLE_TENANT.slug}.drive-247.com`,
  },
  {
    // The address the new owner signs in with — signup-provision meta.email.
    key: "sign_in_email",
    label: "Their sign-in address",
    description: "The email the account owner signs in with.",
    group: "links",
    example: "jordan@coastlinerentals.com",
  },
  {
    // ADMIN_APP_URL + /admin/rentals/{tenant_id} — the tenant detail page.
    key: "admin_tenant_url",
    label: "Open the operator",
    description: "Opens this operator in your admin dashboard. For us only.",
    group: "links",
    example: `${ADMIN_APP_URL}/admin/rentals/${EXAMPLE_TENANT.id}`,
  },
  {
    // ADMIN_APP_URL + /admin/requests — notify-cancellation-request/index.ts:149.
    key: "admin_requests_url",
    label: "Open Requests",
    description: "The queue where cancellation and go-live requests land.",
    group: "links",
    example: `${ADMIN_APP_URL}/admin/requests`,
  },
  {
    // ADMIN_APP_URL + /admin/feedbacks — notify-feedback-submission/index.ts:116.
    key: "admin_feedback_url",
    label: "Open Feedback",
    description: "Where portal feedback is read and resolved.",
    group: "links",
    example: `${ADMIN_APP_URL}/admin/feedbacks`,
  },
  {
    // TRAX_SUPPORT_ADMIN_ORIGIN + /admin/support?ticket=<id> — ticket-email.ts:19.
    key: "admin_support_url",
    label: "Open the ticket",
    description: "Opens the support ticket so you can reply inside Drive247.",
    group: "links",
    example: `${ADMIN_APP_URL}/admin/support?ticket=8f21c4a9`,
  },
  {
    // notify-platform-activity/index.ts:214 — every platform push deep-links here.
    key: "admin_audit_url",
    label: "Open the audit log",
    description: "The event list a platform activity alert opens.",
    group: "links",
    example: `${ADMIN_APP_URL}/admin/audit-logs`,
  },
  {
    // ADMIN_APP_URL + /admin/onboarding — onboarding-daily-digest/index.ts:97.
    key: "admin_onboarding_url",
    label: "Open Onboarding",
    description: "The onboarding dashboard, and where digest recipients are managed.",
    group: "links",
    example: `${ADMIN_APP_URL}/admin/onboarding`,
  },
  {
    // ADMIN_APP_URL + /admin/platform-rentals?ref=<rental_number> — the link the
    // per-rental verdict email already carries (platform-rental-notify:151).
    key: "admin_platform_rentals_url",
    label: "Open the rental",
    description: "Opens this booking in the platform rentals list.",
    group: "links",
    example: `${ADMIN_APP_URL}/admin/platform-rentals?ref=R-3F9A2C`,
  },
  {
    // The Bonzah reviewer's own console — send-bonzah-form-to-brandon/index.ts:207.
    key: "bonzah_console_url",
    label: "Bonzah console",
    description: "Where the insurance partner reviews an operator's application.",
    group: "links",
    example: "https://bonzah.drive-247.com/dashboard",
  },
];

const BY_KEY: ReadonlyMap<string, SystemNotificationVariable> = new Map(
  SYSTEM_NOTIFICATION_VARIABLES.map((v) => [v.key, v]),
);

/** The variable with this key, or undefined. */
export function getSystemVariable(key: string): SystemNotificationVariable | undefined {
  return BY_KEY.get(key);
}

/* -------------------------------------------------------------------------- */
/* Example values                                                              */
/* -------------------------------------------------------------------------- */

export interface SystemExampleValueOptions {
  /** ISO 4217 code for amounts, e.g. "GBP". Defaults to USD ("$149.00"). */
  currencyCode?: string | null;
  /** Show the example story under a real operator's name and slug. */
  tenantName?: string | null;
  tenantSlug?: string | null;
  /** The admin app's own origin, when it differs from the production one. */
  adminAppUrl?: string | null;
}

/**
 * One value per variable, for previews and test sends. Every key in
 * `SYSTEM_NOTIFICATION_VARIABLES` is present, so a preview never silently drops
 * a placeholder. Passing a real operator re-tells the same story about them.
 */
export function systemExampleValues(opts?: SystemExampleValueOptions): Record<string, string> {
  const currency = (opts?.currencyCode || "USD").toUpperCase();
  const tenantName = opts?.tenantName?.trim() || EXAMPLE_TENANT.name;
  const slug = opts?.tenantSlug?.trim() || EXAMPLE_TENANT.slug;
  const adminUrl = (opts?.adminAppUrl?.trim() || ADMIN_APP_URL).replace(/\/$/, "");

  const values: Record<string, string> = {};
  for (const v of SYSTEM_NOTIFICATION_VARIABLES) values[v.key] = v.example;

  for (const key of Object.keys(EXAMPLE_AMOUNTS) as AmountKey[]) {
    values[key] = formatCurrency(EXAMPLE_AMOUNTS[key], currency);
  }

  values.tenant_name = tenantName;
  values.tenant_slug = slug;
  values.portal_url = `https://${slug}.portal.drive-247.com`;
  values.booking_url = `https://${slug}.drive-247.com`;
  values.admin_tenant_url = `${adminUrl}/admin/rentals/${EXAMPLE_TENANT.id}`;
  values.admin_requests_url = `${adminUrl}/admin/requests`;
  values.admin_feedback_url = `${adminUrl}/admin/feedbacks`;
  values.admin_support_url = `${adminUrl}/admin/support?ticket=8f21c4a9`;
  values.admin_audit_url = `${adminUrl}/admin/audit-logs`;
  values.admin_onboarding_url = `${adminUrl}/admin/onboarding`;
  values.admin_platform_rentals_url = `${adminUrl}/admin/platform-rentals?ref=R-3F9A2C`;
  return values;
}

/* -------------------------------------------------------------------------- */
/* Filling and checking                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `{{key}}`, exactly as the server's `replaceTemplateVariables` matches it (no
 * spaces inside the braces). Upper-case letters are matched too, so a typo such
 * as `{{Tenant_Name}}` is reported as unknown instead of silently ignored.
 */
const VARIABLE_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/**
 * Replaces every `{{key}}` that has a value. A key with no value (unknown, or
 * simply not supplied) stays visible as `{{key}}`, so a preview shows the
 * mistake instead of hiding it. With `html: true` the values are HTML-escaped —
 * an operator's company name and a ticket subject are both typed by someone
 * else.
 */
export function fillVariables(
  text: string,
  values: Record<string, string>,
  opts?: { html?: boolean },
): string {
  if (!text) return "";
  return text.replace(VARIABLE_PATTERN, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
    const value = values[key] ?? "";
    return opts?.html ? escapeHtml(String(value)) : String(value);
  });
}

/** Every distinct `{{key}}` in the text, in the order they first appear. */
export function extractVariables(text: string): string[] {
  if (!text) return [];
  const seen: string[] = [];
  for (const m of text.matchAll(VARIABLE_PATTERN)) {
    const key = m[1];
    if (key && !seen.includes(key)) seen.push(key);
  }
  return seen;
}

/** The `{{key}}`s in the text that are not in `allowed`, each listed once. */
export function unknownVariables(text: string, allowed: readonly string[]): string[] {
  return extractVariables(text).filter((key) => !allowed.includes(key));
}
