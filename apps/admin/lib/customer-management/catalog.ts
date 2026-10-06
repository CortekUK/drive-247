/**
 * Customer Management Service — the shipped defaults.
 *
 * Content lives here and nowhere else: the three automations' copy, their
 * timelines, and the extra `{{variables}}` these mails need on top of the
 * shared vocabulary. The runner and the UI both read this; neither hard-codes
 * a subject line.
 *
 * The seeds are also what the migration inserts, so the defaults in the
 * database and the defaults in the app are one list rather than two that drift.
 */

import type { AutomationId, CustomerManagementStepSeed } from "./types";

/* -------------------------------------------------------------------------- */
/* The three automations                                                      */
/* -------------------------------------------------------------------------- */

export interface AutomationMeta {
  id: AutomationId;
  /** Sub-tab label in the sidebar. */
  label: string;
  /** One sentence under the heading. */
  description: string;
  /** How the timeline column is headed, given the offset's direction. */
  offsetLabel: string;
  /** Plain English trigger, for the card. */
  trigger: string;
  /**
   * A warning the tab shows above everything else, when there is a reason to
   * think twice before switching this on. Empty for the two that are plainly
   * ours to send.
   */
  caution?: string;
}

export const AUTOMATIONS: readonly AutomationMeta[] = [
  {
    id: "signup",
    label: "Signup Sequences",
    description:
      "A short series of emails after an operator creates their Drive247 account, to get them from signed-up to actually running rentals.",
    offsetLabel: "Days after signup",
    trigger: "When the operator's account is created.",
  },
  {
    id: "renewal",
    label: "Renewal Reminders",
    description:
      "Tells an operator that their subscription is about to renew, before the card is charged rather than after.",
    offsetLabel: "Days before renewal",
    trigger: "Ahead of the next charge on a live subscription.",
    caution:
      "Only sent for subscriptions that will genuinely be charged. An operator who has cancelled but still has paid-up time left, and one who is already past due, are both skipped — the log says which, and why.",
  },
  {
    id: "receipt",
    label: "Billing Receipts",
    description: "A Drive247-branded confirmation that a subscription payment went through.",
    offsetLabel: "Sent on payment",
    trigger: "When a subscription payment succeeds.",
    /*
     * This is the one requirement in the brief that duplicates something the
     * operator already receives, and it ships OFF for that reason. Stripe
     * emails its own receipt on every successful subscription charge, our own
     * subscription-active mail already says so in as many words ("Stripe has
     * emailed your payment receipt separately"), and
     * lib/notifications-v2/catalog.ts lists Stripe receipts under the mail we
     * deliberately do not own. Switching this on means an operator gets two
     * receipts per charge. That may well be what you want — a branded one
     * reads better than Stripe's — but it should be a decision somebody makes,
     * not a default they discover.
     */
    caution:
      "Stripe already emails a receipt for every successful subscription charge, and our subscription-confirmation email says so. Switching this on means the operator receives two receipts per payment: Stripe's and ours. Off by default for that reason.",
  },
] as const;

export function automationMeta(id: AutomationId): AutomationMeta {
  const found = AUTOMATIONS.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown automation: ${id}`);
  return found;
}

/* -------------------------------------------------------------------------- */
/* Variables this module adds                                                 */
/* -------------------------------------------------------------------------- */

/**
 * EXTENDS the shared list in `lib/notifications-v2/variables.ts` — it does not
 * replace it. `tenant_name`, `tenant_admin_name`, `plan_name`, `plan_amount`,
 * `plan_interval`, `renewal_date`, `portal_url`, `booking_url` and
 * `sign_in_email` all already exist there with example values, and these mails
 * use them under those names so one vocabulary covers the whole platform.
 *
 * Only the four below are genuinely new, and only because nothing on the
 * platform had a per-payment or countdown mail before.
 */
export const CUSTOMER_MANAGEMENT_VARIABLES: readonly {
  key: string;
  label: string;
  example: string;
}[] = [
  { key: "days_until_renewal", label: "Days until renewal", example: "7" },
  { key: "receipt_amount", label: "Amount paid", example: "$149.00" },
  { key: "receipt_date", label: "Payment date", example: "06 Oct 2026" },
  { key: "receipt_reference", label: "Payment reference", example: "in_1P9xKlB2eFJBbbzi" },
] as const;

/* -------------------------------------------------------------------------- */
/* Default timelines and copy                                                 */
/* -------------------------------------------------------------------------- */

/*
 * The signup steps sit on day 0, 7 and 14 — the two named compression anchors
 * plus the immediate one — so a rehearsal exercises the curve at exactly the
 * points it was specified at, and the renewal pair does the same.
 */

const SIGNUP_SEEDS: CustomerManagementStepSeed[] = [
  {
    automation: "signup",
    step_key: "signup_day_0_welcome",
    label: "Day 0 — Welcome",
    offset_days: 0,
    enabled: true,
    sort_order: 10,
    subject: "Welcome to Drive247, {{tenant_name}}",
    body_html: [
      "<p>Hi {{tenant_admin_name}},</p>",
      "<p>Your Drive247 account for <strong>{{tenant_name}}</strong> is live. Everything you need to start taking bookings is already in place — you just need to put your fleet in it.</p>",
      "<h3>Start here</h3>",
      "<ul>",
      "<li>Add your first vehicle, with photos and a daily rate.</li>",
      "<li>Set your pickup locations and opening hours.</li>",
      "<li>Share your booking page: {{booking_url}}</li>",
      "</ul>",
      '<p><a data-email-button href="{{portal_url}}">Open your portal</a></p>',
      "<p>You sign in with {{sign_in_email}}. If anything looks wrong, reply to this email and a person will read it.</p>",
    ].join("\n"),
  },
  {
    automation: "signup",
    step_key: "signup_day_7_checkin",
    label: "Day 7 — Check-in",
    offset_days: 7,
    enabled: true,
    sort_order: 20,
    subject: "A week in — how is {{tenant_name}} getting on?",
    body_html: [
      "<p>Hi {{tenant_admin_name}},</p>",
      "<p>You have had Drive247 for a week. The operators who get the most out of it tend to have done three things by now:</p>",
      "<ul>",
      "<li><strong>Connected payments</strong>, so bookings settle into your own account.</li>",
      "<li><strong>Published the booking page</strong>, so customers can reserve without phoning you.</li>",
      "<li><strong>Loaded the real fleet</strong>, not just one test vehicle.</li>",
      "</ul>",
      "<p>If any of those is still outstanding, the setup checklist in your portal walks through it.</p>",
      '<p><a data-email-button href="{{portal_url}}">Pick up where you left off</a></p>',
    ].join("\n"),
  },
  {
    automation: "signup",
    step_key: "signup_day_14_next_steps",
    label: "Day 14 — Next steps",
    offset_days: 14,
    enabled: true,
    sort_order: 30,
    subject: "{{tenant_name}}: the parts of Drive247 most people miss",
    body_html: [
      "<p>Hi {{tenant_admin_name}},</p>",
      "<p>Two weeks in, here are the features operators tell us they wish they had found sooner:</p>",
      "<ul>",
      "<li><strong>Digital rental agreements</strong> — sent for signature, stored against the booking.</li>",
      "<li><strong>Damage records with photos</strong>, so a dispute is a document rather than an argument.</li>",
      "<li><strong>Maintenance reminders</strong> per vehicle, by mileage or by date.</li>",
      "</ul>",
      '<p><a data-email-button href="{{portal_url}}">Explore your portal</a></p>',
      "<p>You are on the {{plan_name}} plan. If it is no longer the right fit, reply and we will sort it out.</p>",
    ].join("\n"),
  },
];

const RENEWAL_SEEDS: CustomerManagementStepSeed[] = [
  {
    automation: "renewal",
    step_key: "renewal_14_days_before",
    label: "14 days before renewal",
    offset_days: 14,
    enabled: true,
    sort_order: 10,
    subject: "{{tenant_name}}: your Drive247 plan renews on {{renewal_date}}",
    body_html: [
      "<p>Hi {{tenant_admin_name}},</p>",
      "<p>A heads-up rather than a bill: your <strong>{{plan_name}}</strong> plan renews on <strong>{{renewal_date}}</strong>, {{days_until_renewal}} days from now, at {{plan_amount}} per {{plan_interval}}.</p>",
      "<p>No action needed — the card on file will be charged automatically. If you want to change plan or update that card, there is time to do it now.</p>",
      '<p><a data-email-button href="{{portal_url}}">Manage your subscription</a></p>',
    ].join("\n"),
  },
  {
    automation: "renewal",
    step_key: "renewal_7_days_before",
    label: "7 days before renewal",
    offset_days: 7,
    enabled: true,
    sort_order: 20,
    subject: "Renewing in {{days_until_renewal}} days — {{tenant_name}}",
    body_html: [
      "<p>Hi {{tenant_admin_name}},</p>",
      "<p>Your {{plan_name}} plan renews on <strong>{{renewal_date}}</strong> at {{plan_amount}} per {{plan_interval}}.</p>",
      "<p>If the card on file has expired or been replaced, updating it before then saves the renewal failing.</p>",
      '<p><a data-email-button href="{{portal_url}}">Check your payment method</a></p>',
    ].join("\n"),
  },
];

const RECEIPT_SEEDS: CustomerManagementStepSeed[] = [
  {
    automation: "receipt",
    step_key: "receipt_payment_succeeded",
    label: "On successful payment",
    offset_days: 0,
    /* Off by default — see the `caution` on the receipt automation above. */
    enabled: false,
    sort_order: 10,
    subject: "Payment received — {{receipt_amount}} for {{tenant_name}}",
    body_html: [
      "<p>Hi {{tenant_admin_name}},</p>",
      "<p>We have received your payment of <strong>{{receipt_amount}}</strong> on {{receipt_date}} for the {{plan_name}} plan.</p>",
      "<ul>",
      "<li>Plan: {{plan_name}} ({{plan_amount}} per {{plan_interval}})</li>",
      "<li>Reference: {{receipt_reference}}</li>",
      "<li>Next renewal: {{renewal_date}}</li>",
      "</ul>",
      "<p>Stripe has also emailed its own receipt for this charge, which is the one to keep for your records.</p>",
      '<p><a data-email-button href="{{portal_url}}">View your billing history</a></p>',
    ].join("\n"),
  },
];

export const DEFAULT_STEPS: readonly CustomerManagementStepSeed[] = [
  ...SIGNUP_SEEDS,
  ...RENEWAL_SEEDS,
  ...RECEIPT_SEEDS,
] as const;

export function defaultStepsFor(automation: AutomationId): CustomerManagementStepSeed[] {
  return DEFAULT_STEPS.filter((s) => s.automation === automation);
}

/* -------------------------------------------------------------------------- */
/* Defaults for the settings row                                              */
/* -------------------------------------------------------------------------- */

/**
 * The tenant that receives mail while the scope toggle is OFF.
 *
 * The brief named "Morthing Rentals"; there is no tenant by that name, and
 * Northwind Rentals is the rehearsal tenant used for every other feature in
 * this dashboard (it is the one the Developer page's onboarding tools target
 * and the only slug on the Stripe Connect allow-list), so that is what this
 * is. Stored as a SLUG, not an id, for the reason V2_PLAN §2 gives: a uuid
 * here would be unreadable and would rot.
 */
export const DEFAULT_SCOPE_TENANT_SLUG = "northwind";

export const SETTINGS_DEFAULTS = {
  signup_enabled: true,
  renewal_enabled: true,
  /* See the receipt automation's `caution`. */
  receipt_enabled: false,
  scope_all_tenants: false,
  scope_tenant_slug: DEFAULT_SCOPE_TENANT_SLUG,
  test_mode: false,
  max_sends_per_run: 50,
} as const;
