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
      "Emails the operator 3 days, 2 days and 1 day before their subscription payment is due, so the payment never takes them by surprise.",
    offsetLabel: "Days before payment",
    trigger: "Checked automatically against every live subscription's next payment date.",
    caution:
      "Only sent for subscriptions that will genuinely be charged. An operator who has cancelled but still has paid-up time left, and one who is already past due, are both skipped — the log says which, and why.",
  },
  {
    id: "receipt",
    label: "Billing Receipts",
    description:
      "Emails the operator a receipt as soon as their subscription payment is paid, with Stripe's invoice number, invoice ID and payment ID, and a link to Stripe's receipt.",
    offsetLabel: "Sent on payment",
    trigger: "Checked automatically: every paid subscription invoice gets one receipt.",
    /*
     * Stripe emails its own receipt on every successful subscription charge
     * too, so an operator receives two: Stripe's and this branded one. That was
     * a deliberate choice (Oct 2026) — this one carries the Stripe references
     * in our own wording — and the note says so rather than letting it be a
     * surprise.
     */
    caution:
      "Stripe also emails its own receipt for every subscription payment, so the operator receives two: Stripe's and this one. This one quotes Stripe's invoice number, invoice ID and payment ID, so the two always match.",
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
 * Only the ones below are genuinely new, and only because nothing on the
 * platform had a per-payment or countdown mail before.
 */
export const CUSTOMER_MANAGEMENT_VARIABLES: readonly {
  key: string;
  label: string;
  example: string;
}[] = [
  { key: "stripe_connect_url", label: "Portal page to connect Stripe", example: "https://northwind.portal.drive-247.com/settings?tab=payments" },
  { key: "bonzah_form_url", label: "Portal page to fill in the Bonzah form", example: "https://northwind.portal.drive-247.com/settings?tab=insurance" },
  { key: "days_until_renewal", label: "Days until payment", example: "3" },
  { key: "days_until_renewal_text", label: "Days until payment, in words", example: "3 days" },
  { key: "receipt_amount", label: "Amount paid", example: "$149.00" },
  { key: "receipt_date", label: "Payment date", example: "06 Oct 2026" },
  { key: "receipt_reference", label: "Receipt number (Stripe invoice number)", example: "PZBCUROM-0001" },
  { key: "stripe_invoice_number", label: "Stripe invoice number", example: "PZBCUROM-0001" },
  { key: "stripe_invoice_id", label: "Stripe invoice ID", example: "in_1UNYdSQxk7lWkIyi" },
  { key: "stripe_payment_id", label: "Stripe payment ID", example: "ch_3UNYdTQxk7lWkIyi" },
  { key: "receipt_url", label: "Link to Stripe's receipt", example: "https://pay.stripe.com/receipts/…" },
  { key: "invoice_pdf_url", label: "Link to the invoice PDF", example: "https://pay.stripe.com/invoice/…/pdf" },
] as const;

/* -------------------------------------------------------------------------- */
/* Default timelines and copy                                                 */
/* -------------------------------------------------------------------------- */

/*
 * The signup sequence is the day-0 welcome plus two setup reminders that
 * repeat until the operator has done the thing they ask for.
 *
 * ── PLAIN TEXT, NOT HTML ────────────────────────────────────────────────────
 *
 * Bodies are ordinary text a super admin can edit without knowing HTML. The
 * runner (customer-management-run/plain-text.ts) turns a blank line into a new
 * paragraph, a line starting "- " into a bullet, and a web address into a
 * link, then wraps the result in Drive247's header and footer. The column is
 * still called `body_html`; it holds whichever the admin wrote.
 */

const lines = (...text: string[]) => text.join("\n");

const SIGNUP_SEEDS: CustomerManagementStepSeed[] = [
  {
    automation: "signup",
    step_key: "signup_day_0_welcome",
    label: "Day 0 — Welcome",
    offset_days: 0,
    enabled: true,
    sort_order: 10,
    subject: "Welcome to Drive247, {{tenant_name}}",
    body_html: lines(
      "Hi {{tenant_admin_name}},",
      "",
      "Welcome to Drive247. Your account for {{tenant_name}} is ready.",
      "",
      "Your portal (where you run your business): {{portal_url}}",
      "",
      "Your website (share it with customers so they can book): {{booking_url}}",
      "",
      "Two things to do first:",
      "- Connect Stripe, so you can take payments from your customers: {{stripe_connect_url}}",
      "- Fill in and submit the Bonzah form, so you can offer insurance on your rentals: {{bonzah_form_url}}",
      "",
      "You sign in with {{sign_in_email}}. If you need help, just reply to this email.",
      "",
      "The Drive247 team",
    ),
  },
  /*
   * Two setup reminders, each sent only while that thing is still not done
   * (`send_if`) and repeated every `repeat_every_days` until it is: day 3, 6,
   * 9, ... The Bonzah one is about the FORM — submitting it is not the same as
   * Bonzah being connected. (The keys still say day_7: a key is fixed once it
   * exists, because the send log is keyed on it.)
   */
  {
    automation: "signup",
    step_key: "signup_day_7_connect_stripe",
    label: "Connect Stripe reminder (until connected)",
    offset_days: 3,
    repeat_every_days: 3,
    enabled: true,
    sort_order: 21,
    send_if: "stripe_not_connected",
    subject: "{{tenant_name}}: connect Stripe to take payments",
    body_html: lines(
      "Hi {{tenant_admin_name}},",
      "",
      "Stripe is not connected to {{tenant_name}} yet.",
      "",
      "Until it is, you cannot take payments from your customers for their bookings.",
      "",
      "Connect Stripe here — it takes a few minutes: {{stripe_connect_url}}",
      "",
      "If you need help, just reply to this email.",
      "",
      "The Drive247 team",
    ),
  },
  {
    automation: "signup",
    step_key: "signup_day_7_bonzah_form",
    label: "Bonzah form reminder (until submitted)",
    offset_days: 3,
    repeat_every_days: 3,
    enabled: true,
    sort_order: 22,
    send_if: "bonzah_form_not_submitted",
    subject: "{{tenant_name}}: submit your Bonzah form",
    body_html: lines(
      "Hi {{tenant_admin_name}},",
      "",
      "We have not received the Bonzah form for {{tenant_name}} yet.",
      "",
      "Bonzah lets you offer insurance to your customers when they book. Once you submit the form, Bonzah reviews it and switches insurance on for you.",
      "",
      "Fill in and submit the form here: {{bonzah_form_url}}",
      "",
      "If you need help, just reply to this email.",
      "",
      "The Drive247 team",
    ),
  },
];

/*
 * A countdown before the subscription payment: one email 3 days before, one 2
 * days before, one the day before. The runner checks every live subscription's
 * next payment date on every tick, and only ever sends the most recent one
 * that is due (see `latestDueIndex`), so nobody gets the whole countdown at
 * once.
 */
const renewalBody = lines(
  "Hi {{tenant_admin_name}},",
  "",
  "You have {{days_until_renewal_text}} left to pay your Drive247 subscription.",
  "",
  "- Plan: {{plan_name}}",
  "- Amount: {{plan_amount}} per {{plan_interval}}",
  "- Payment date: {{renewal_date}}",
  "",
  "The card on file will be charged automatically on that date. If your card has expired or changed, please update it before then so the payment does not fail: {{portal_url}}",
  "",
  "The Drive247 team",
);

const RENEWAL_SEEDS: CustomerManagementStepSeed[] = [
  {
    automation: "renewal",
    step_key: "renewal_3_days_before",
    label: "3 days before payment",
    offset_days: 3,
    enabled: true,
    sort_order: 10,
    subject: "{{days_until_renewal_text}} left to pay your Drive247 subscription",
    body_html: renewalBody,
  },
  {
    automation: "renewal",
    step_key: "renewal_2_days_before",
    label: "2 days before payment",
    offset_days: 2,
    enabled: true,
    sort_order: 20,
    subject: "{{days_until_renewal_text}} left to pay your Drive247 subscription",
    body_html: renewalBody,
  },
  {
    automation: "renewal",
    step_key: "renewal_1_day_before",
    label: "1 day before payment",
    offset_days: 1,
    enabled: true,
    sort_order: 30,
    subject: "{{days_until_renewal_text}} left to pay your Drive247 subscription",
    body_html: renewalBody,
  },
];

const RECEIPT_SEEDS: CustomerManagementStepSeed[] = [
  {
    automation: "receipt",
    step_key: "receipt_payment_succeeded",
    label: "On successful payment",
    offset_days: 0,
    enabled: true,
    sort_order: 10,
    subject: "Payment received — receipt {{receipt_reference}}",
    body_html: lines(
      "Hi {{tenant_admin_name}},",
      "",
      "Thank you. Your Drive247 subscription payment has been received.",
      "",
      "- Amount paid: {{receipt_amount}}",
      "- Date paid: {{receipt_date}}",
      "- Plan: {{plan_name}} ({{plan_amount}} per {{plan_interval}})",
      "- Receipt number: {{stripe_invoice_number}}",
      "- Stripe invoice ID: {{stripe_invoice_id}}",
      "- Stripe payment ID: {{stripe_payment_id}}",
      "- Next payment: {{renewal_date}}",
      "",
      "View your Stripe receipt: {{receipt_url}}",
      "",
      "Download the invoice (PDF): {{invoice_pdf_url}}",
      "",
      "The Drive247 team",
    ),
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
  receipt_enabled: true,
  scope_all_tenants: false,
  scope_tenant_slug: DEFAULT_SCOPE_TENANT_SLUG,
  test_mode: false,
  max_sends_per_run: 50,
} as const;
