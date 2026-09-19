/**
 * Notifications v2: the catalog of every notification the page lists.
 *
 * The lead (transcript §3.4): "We must not just prompt Claude and accept
 * whatever makes sense to it. We will make sense of every single place
 * ourselves." So every item below is an event the platform sends today (or
 * the customer-facing half of one), and each carries `evidence`: the sender's
 * file:line and the trigger's file:line, re-read in source on this branch.
 *
 * Rules applied to every item:
 *   - Two directions. When one event tells both sides, it is TWO items: one
 *     `customer_to_team` (your team is told) and one `team_to_customer` (the
 *     customer is told). A team item also covers the heads-up your team gets
 *     about its own actions (for example "Rental started"): the team is told.
 *   - `today` is what the code does now, for every tenant. `defaultEnabled`
 *     follows it (D12): a channel that sends today defaults on, a channel that
 *     sends nothing today (every push) defaults off. Settings do not change
 *     sending yet (D18).
 *   - Only channels that make sense for the event are listed.
 *   - "Reachable" means northwind (the v2 canary) can trigger it from the v2
 *     screens. Where the classic screens have an extra path, `when` describes
 *     the reachable one and the channel `note` says what differs.
 *
 * ---------------------------------------------------------------------------
 * LEFT OUT, and why (for the lead to review)
 * ---------------------------------------------------------------------------
 * Not reachable from the v2 screens (classic-only today):
 *   - Booking cancelled (customer email + bell, team bell + email):
 *     notify-booking-cancelled is only called from CancelRentalDialog
 *     (hooks/use-cancel-rental.ts:65). v2 rental detail has no cancel action,
 *     and the dialog mounted on Pending bookings (pending-bookings/page.tsx:507)
 *     is never opened: nothing calls setShowCancelDialog(true).
 *   - Booking renewed (customer + team bells): the Renew button exists only on
 *     the classic rental page (rentals/[id]/page.tsx:3015 → ?renew_from=).
 *   - Team heads-up for "booking approved" / "booking declined": written only
 *     inside notify-booking-approved / notify-booking-rejected, which only the
 *     classic rental page calls (rentals/[id]/page.tsx:7868,
 *     components/rentals/rejection-dialog.tsx:323). The customer halves ARE
 *     listed, because Pending bookings still tells the customer by bell.
 *   - Lockbox code (email + SMS): the manual send is in the classic key
 *     handover section (key-handover-section.tsx:278), and the scheduled send
 *     (send-lockbox-scheduled) waits for rentals.approved_at, which only the
 *     classic Approve button writes (rentals/[id]/page.tsx:7853; Turo imports
 *     also set it). So the Keys category is empty and dropped. Its wording is
 *     still edited on the existing lockbox templates screen.
 *   - Insurance re-upload request (customer bell): classic rental page only
 *     (rentals/[id]/page.tsx:2096).
 * Senders with no caller (dead code):
 *   - notify-payment-failed, notify-fine-recorded, notify-identity-verified,
 *     notify-signing-completed (customer emails for those events), and
 *     notify-pickup-reminder, notify-preauth-expiring, notify-return-due,
 *     generate-insurance-reminders: no caller and no cron in the repo.
 *   - The `return_due` and `payment_failed` customer email templates: editable
 *     today, but nothing sends them.
 *   - send-payment-verification-email (imported, never called),
 *     send-excess-mileage-payment-link, send-stripe-onboarding-email,
 *     send-booking-email, send-cp-enquiry, resend-email, hyper-api,
 *     send-tenant-sms, render-email-template, send-reminder-notifications,
 *     send-installment-failed (legacy webhook only), daily-reminders (its cron
 *     points at another project).
 * Sandbox and diagnostics: diag-resend-delivery, diag-twilio-a2p and every
 *   sandbox-* function. They send only in simulations.
 * Account security: customer sign-in and reset codes (send-verification-otp),
 *   auth emails (custom-auth-email), staff welcome (send-user-welcome-email),
 *   staff password reset, operator sign-up emails (signup-provision,
 *   signup-password-reset) and the customer welcome bell (customer-signup).
 *   These must always send and are not operator-editable.
 * Lead CRM: lead messages and automations (send-lead-message,
 *   automation-execute-step, lead-stale-poll, create-offer-link,
 *   submit-application). They have their own screens under Automations.
 * Chat: customer ↔ team chat bells, chat emails (send-email-message) and chat
 *   SMS (send-sms-message). The text is typed by a person each time.
 * Written by your team each time: fleet quote emails (quotes page via
 *   aws-ses-email) and the manual push broadcast in Settings → Push (send-push).
 * Super admin and system (built later, transcript §3.5): Bonzah onboarding
 *   emails and bells (send-bonzah-form-to-brandon, send-bonzah-active-email,
 *   send-bonzah-update-email), platform activity push, platform-rental-notify,
 *   cancellation requests, feedback, subscription and migration emails,
 *   onboarding digest, TRAX support emails, announcements, marketing emails.
 * Internal alerts: Tesla supercharger charges, Turo imports, INSHUR coverage
 *   and billing bells.
 * Bonzah balance low (bonzah-get-balance): about your insurance account, not a
 *   customer, and it already has its own switch and threshold under
 *   Integrations → Bonzah.
 * Channels this page does not have: SMS copies (booking received, cancelled,
 *   rental started/completed/extended, refunds, return reminders, lockbox) and
 *   WhatsApp (the agreement WhatsApp call targets send-signing-whatsapp, which
 *   does not exist in the repo).
 *
 * No React and no Supabase here. v2 only: nothing in v1 imports this file.
 */

import type {
  ChannelSpec,
  ChannelTemplate,
  ChannelTodayStatus,
  EmailTemplate,
  InAppTemplate,
  NotificationCategory,
  NotificationCategoryId,
  NotificationDirection,
  NotificationItem,
  PushDisplayOptions,
  PushTemplate,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

/** Display order. Keys is left out: nothing in it is reachable yet (see above). */
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  { id: "booking", label: "Booking", description: "New bookings, and your answer to the customer." },
  { id: "rental", label: "Rental", description: "Key handover, extensions, returns and renewals." },
  { id: "payments", label: "Payments", description: "Money in, refunds, payment links and reminders." },
  { id: "agreements", label: "Agreements", description: "Rental agreements sent for signing, and signed." },
  { id: "verification", label: "Verification", description: "ID and licence checks for customers and extra drivers." },
  { id: "fines", label: "Fines", description: "Fines and tolls on a rental." },
  { id: "insurance", label: "Insurance", description: "Insurance that could not be switched on." },
  { id: "enquiries", label: "Enquiries", description: "Questions and messages from your booking site." },
];

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

const PUSH_TEAM_NOTE = "Goes to staff devices that have push turned on.";
const PUSH_CUSTOMER_NOTE = "Customers only get push after turning it on in their customer portal.";
const IN_APP_CUSTOMER_NOTE = "Shows in the customer portal bell, so the customer needs an account on your booking site.";

const OPEN_IN_APP: PushDisplayOptions = { openInApp: true };
const NEEDS_ACTION: PushDisplayOptions = { openInApp: true, requireInteraction: true };

function spec<T extends ChannelTemplate>(
  today: ChannelTodayStatus,
  defaultTemplate: T,
  note?: string,
): ChannelSpec<T> {
  return {
    defaultEnabled: today !== "not_sent",
    defaultTemplate,
    today,
    ...(note ? { note } : {}),
  };
}

function pushSpec(template: PushTemplate, audience: "team" | "customer", options = OPEN_IN_APP): ChannelSpec<PushTemplate> {
  // No event sends push today: only the manual broadcast and the test do.
  return {
    ...spec("not_sent", template, audience === "team" ? PUSH_TEAM_NOTE : PUSH_CUSTOMER_NOTE),
    defaultPushOptions: options,
  };
}

/** Team emails that go through the team email address and its per-type switch. */
function teamEmailNote(typeLabel: string, extra?: string): string {
  return [`Goes to your team email address while team emails for ${typeLabel} are switched on.`, extra]
    .filter(Boolean)
    .join(" ");
}

/* Email body pieces. Only p, h3, ul/ol/li, strong, em, a and one button. */
const p = (html: string) => `<p>${html}</p>`;
const h3 = (text: string) => `<h3>${text}</h3>`;
const ul = (...items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const ol = (...items: string[]) => `<ol>${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
const button = (hrefVariable: string, label: string) =>
  `<p><a data-email-button href="{{${hrefVariable}}}">${label}</a></p>`;

const CONTACT = p("Questions? Email {{company_email}} or call {{company_phone}}.");

function customerEmail(subject: string, ...blocks: string[]): EmailTemplate {
  return {
    subject,
    body: [p("Hi {{customer_name}},"), ...blocks, p("The {{company_name}} team")].join(""),
  };
}

function teamEmail(subject: string, ...blocks: string[]): EmailTemplate {
  return {
    subject,
    body: [p("Hi team,"), ...blocks, p("Sent to the {{company_name}} team.")].join(""),
  };
}

const push = (title: string, body: string): PushTemplate => ({ title, body });
const inApp = (title: string, body: string): InAppTemplate => ({ title, body });

function unique(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat()));
}

/* Variable sets offered in the picker. Link-only keys (rental_id, customer_id)
 * are never offered: they only appear in `link`. */
const CUSTOMER_VARS = ["customer_name", "company_name", "company_email", "company_phone", "customer_portal_url"];
const TEAM_VARS = ["customer_name", "customer_email", "customer_phone", "company_name", "portal_url"];
const BOOKING_VARS = [
  "rental_number",
  "vehicle_make",
  "vehicle_model",
  "vehicle_year",
  "vehicle_reg",
  "rental_start_date",
  "rental_end_date",
];

const TEAM_RENTAL_LINK = "/rentals/{{rental_id}}";

/* -------------------------------------------------------------------------- */
/* The catalog                                                                 */
/* -------------------------------------------------------------------------- */

export const NOTIFICATION_CATALOG: NotificationItem[] = [
  /* ======================================================================== */
  /* Booking                                                                   */
  /* ======================================================================== */
  {
    key: "new_booking_team",
    category: "booking",
    direction: "customer_to_team",
    name: "New booking",
    tooltip: "Tells your team when a customer books on your booking site, so someone can review it.",
    when: "When a customer books on your booking site.",
    side: "booking_site",
    recipient: "Your team",
    variables: unique(TEAM_VARS, BOOKING_VARS, ["rental_amount"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "sends_some_paths",
        teamEmail(
          "New booking: {{customer_name}}, {{vehicle_make}} {{vehicle_model}}",
          p("<strong>{{customer_name}}</strong> just booked on your booking site."),
          ul(
            "Booking: {{rental_number}}",
            "Car: {{vehicle_make}} {{vehicle_model}}",
            "Dates: {{rental_start_date}} to {{rental_end_date}}",
            "Total: {{rental_amount}}",
            "Customer: {{customer_email}}, {{customer_phone}}",
          ),
          button("portal_url", "Review booking"),
        ),
        teamEmailNote(
          "Bookings",
          "Not sent for enquiry bookings taken without a deposit, which only ring the bell.",
        ),
      ),
      push: pushSpec(
        push(
          "New booking: {{customer_name}}",
          "{{vehicle_make}} {{vehicle_model}}, {{rental_start_date}} to {{rental_end_date}}. {{rental_amount}}.",
        ),
        "team",
        NEEDS_ACTION,
      ),
      in_app: spec(
        "sends",
        inApp(
          "New booking",
          "{{customer_name}} booked the {{vehicle_make}} {{vehicle_model}} for {{rental_start_date}} to {{rental_end_date}}.",
        ),
      ),
    },
    evidence: [
      "email sender: supabase/functions/notify-booking-pending/index.ts:292 (team switch :284)",
      "bell sender: supabase/migrations/20260317180000_add_renewal_customer_notification.sql:23 (rentals INSERT trigger)",
      "trigger: apps/booking/src/app/booking-success/page.tsx:471; supabase/functions/stripe-webhook-live/index.ts:878,1254,1560",
      "rental created: apps/booking/src/components/BookingCheckoutStep.tsx:1165",
      "no email: enquiry booking with no deposit skips payment, apps/booking/src/components/BookingCheckoutStep.tsx:754-763",
    ],
  },
  {
    key: "booking_received_customer",
    category: "booking",
    direction: "team_to_customer",
    name: "Booking received",
    tooltip: "Tells the customer their booking came through and what happens next.",
    when: "When a customer books and pays on your booking site.",
    side: "booking_site",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["rental_amount"]),
    link: "/portal/bookings",
    channels: {
      email: spec(
        "sends_some_paths",
        customerEmail(
          "We've received your booking {{rental_number}}",
          p("Thanks for booking with {{company_name}}. We've received your booking and we're checking the details now."),
          h3("Your booking"),
          ul(
            "Reference: {{rental_number}}",
            "Car: {{vehicle_make}} {{vehicle_model}}",
            "Pickup: {{rental_start_date}}",
            "Return: {{rental_end_date}}",
            "Total: {{rental_amount}}",
          ),
          h3("What happens next"),
          ol(
            "We confirm your booking by email.",
            "We send your rental agreement to sign online.",
            "You bring your driving licence when you collect the car.",
          ),
          button("customer_portal_url", "View your booking"),
          CONTACT,
        ),
        "Not sent for enquiry bookings taken without a deposit.",
      ),
      push: pushSpec(
        push("Booking received", "We've got booking {{rental_number}} for the {{vehicle_make}} {{vehicle_model}}. We'll confirm soon."),
        "customer",
      ),
      in_app: spec(
        "not_sent",
        inApp("Booking received", "Your booking {{rental_number}} for the {{vehicle_make}} {{vehicle_model}} is being reviewed."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "email sender: supabase/functions/notify-booking-pending/index.ts:250",
      "trigger: apps/booking/src/app/booking-success/page.tsx:471; supabase/functions/stripe-webhook-live/index.ts:878,1254,1560",
      "no email: apps/booking/src/components/BookingCheckoutStep.tsx:754-763 (enquiry, no deposit)",
    ],
  },
  {
    key: "booking_added_team",
    category: "booking",
    direction: "customer_to_team",
    name: "Booking added by your team",
    tooltip: "A heads-up to your team when a staff member creates a booking in the portal.",
    when: "When someone on your team creates a booking in the portal.",
    side: "portal",
    recipient: "Your team",
    variables: unique(TEAM_VARS, BOOKING_VARS, ["rental_amount"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "sends",
        teamEmail(
          "Booking added: {{customer_name}}, {{vehicle_make}} {{vehicle_model}}",
          p("A booking for <strong>{{customer_name}}</strong> was added in the portal."),
          ul(
            "Booking: {{rental_number}}",
            "Car: {{vehicle_make}} {{vehicle_model}}",
            "Dates: {{rental_start_date}} to {{rental_end_date}}",
            "Total: {{rental_amount}}",
          ),
          button("portal_url", "Open booking"),
        ),
        teamEmailNote("Bookings"),
      ),
      push: pushSpec(
        push("Booking added: {{customer_name}}", "{{vehicle_make}} {{vehicle_model}}, {{rental_start_date}} to {{rental_end_date}}."),
        "team",
      ),
      in_app: spec(
        "sends",
        inApp("Booking added", "A booking for {{customer_name}} ({{vehicle_make}} {{vehicle_model}}) was added in the portal."),
        "Today this bell is worded as if the customer asked for the booking.",
      ),
    },
    evidence: [
      "email sender: supabase/functions/send-booking-notification/index.ts:200 (team switch :193)",
      "bell sender: supabase/migrations/20260317180000_add_renewal_customer_notification.sql:23,31 (rentals INSERT trigger)",
      "trigger: apps/portal/src/components/rentals-v2/rental-create-v2.tsx:2539 → apps/portal/src/lib/notifications.ts:141",
    ],
  },
  {
    key: "booking_confirmed_customer",
    category: "booking",
    direction: "team_to_customer",
    name: "Booking confirmed",
    tooltip: "Tells the customer their booking is confirmed when your team books it for them.",
    when: "When someone on your team creates a booking for a customer in the portal.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["rental_amount", "pickup_location"]),
    link: "/portal/bookings",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Your booking is confirmed: {{rental_number}}",
          p("Good news: your booking with {{company_name}} is confirmed."),
          h3("Your booking"),
          ul(
            "Reference: {{rental_number}}",
            "Car: {{vehicle_make}} {{vehicle_model}}",
            "Pickup: {{rental_start_date}}",
            "Return: {{rental_end_date}}",
            "Total: {{rental_amount}}",
          ),
          p("We'll email your rental agreement to sign online before pickup."),
          button("customer_portal_url", "View your booking"),
          CONTACT,
        ),
      ),
      push: pushSpec(
        push("Booking confirmed", "Your {{vehicle_make}} {{vehicle_model}} is booked for {{rental_start_date}}. Ref {{rental_number}}."),
        "customer",
      ),
      in_app: spec(
        "not_sent",
        inApp("Booking confirmed", "Your booking {{rental_number}} for the {{vehicle_make}} {{vehicle_model}} is confirmed."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "email sender: supabase/functions/send-booking-notification/index.ts:186",
      "trigger: apps/portal/src/components/rentals-v2/rental-create-v2.tsx:2539 → apps/portal/src/lib/notifications.ts:141",
    ],
  },
  {
    key: "booking_approved_customer",
    category: "booking",
    direction: "team_to_customer",
    name: "Booking approved",
    tooltip: "Tells the customer you've accepted their booking and the car is theirs.",
    when: "When you approve a booking in Pending bookings.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["rental_amount", "pickup_location"]),
    link: "/portal/bookings",
    channels: {
      email: spec(
        "sends_some_paths",
        customerEmail(
          "Booking approved: {{rental_number}}",
          p("Great news: {{company_name}} has approved your booking. The car is reserved for you."),
          ul(
            "Reference: {{rental_number}}",
            "Car: {{vehicle_make}} {{vehicle_model}}",
            "Pickup: {{rental_start_date}}",
            "Return: {{rental_end_date}}",
            "Total: {{rental_amount}}",
          ),
          h3("Before pickup"),
          ol(
            "Sign your rental agreement. We'll email it to you.",
            "Bring your driving licence and the card you paid with.",
          ),
          button("customer_portal_url", "View your booking"),
          CONTACT,
        ),
        "Today this email is only sent when a booking is approved from the classic rental page. Approving in Pending bookings sends no email yet.",
      ),
      push: pushSpec(
        push("Booking approved", "Your {{vehicle_make}} {{vehicle_model}} is reserved for {{rental_start_date}}. Ref {{rental_number}}."),
        "customer",
      ),
      in_app: spec(
        "sends",
        inApp("Booking approved", "Your booking {{rental_number}} for the {{vehicle_make}} {{vehicle_model}} has been approved."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: apps/portal/src/app/(dashboard)/pending-bookings/page.tsx:243-256 (v2 table onApprove) → apps/portal/src/hooks/use-booking-approval.ts:36 → supabase/functions/capture-booking-payment/index.ts:251 (rental → Active)",
      "bell sender: supabase/migrations/20260317170000_add_cancel_customer_notification.sql:39-46",
      "email sender (classic page only): apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx:7868 → supabase/functions/notify-booking-approved/index.ts:211",
    ],
  },
  {
    key: "booking_declined_customer",
    category: "booking",
    direction: "team_to_customer",
    name: "Booking declined",
    tooltip: "Tells the customer you couldn't accept their booking and that no payment was taken.",
    when: "When you reject a booking in Pending bookings.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["rejection_reason"]),
    link: "/portal/bookings",
    channels: {
      email: spec(
        "sends_some_paths",
        customerEmail(
          "About your booking {{rental_number}}",
          p("Thank you for booking with {{company_name}}. Unfortunately, we can't accept this booking."),
          p("<strong>Reason:</strong> {{rejection_reason}}"),
          ul(
            "Reference: {{rental_number}}",
            "Car: {{vehicle_make}} {{vehicle_model}}",
            "Dates: {{rental_start_date}} to {{rental_end_date}}",
          ),
          p("No payment has been taken. Any hold on your card is released by your bank, usually within 3 to 5 working days."),
          CONTACT,
        ),
        "Today this email is only sent when a booking is declined from the classic rental page, and only if the email tab was opened. Rejecting in Pending bookings sends no email yet.",
      ),
      push: pushSpec(
        push("Booking not accepted", "Sorry, we can't accept booking {{rental_number}}. No payment has been taken."),
        "customer",
      ),
      in_app: spec(
        "sends",
        inApp("Booking declined", "Sorry, your booking {{rental_number}} for the {{vehicle_make}} {{vehicle_model}} could not be accepted."),
        `${IN_APP_CUSTOMER_NOTE} From Pending bookings, today's bell says the booking was cancelled.`,
      ),
    },
    evidence: [
      "trigger: apps/portal/src/app/(dashboard)/pending-bookings/page.tsx:243-252 (v2 table onReject) → apps/portal/src/hooks/use-booking-approval.ts:110 → supabase/functions/cancel-booking-preauth/index.ts:227-230 (rental → Cancelled)",
      "bell sender: supabase/migrations/20260317170000_add_cancel_customer_notification.sql:82-93 (worded 'Booking Cancelled' on this path), :58-69 ('Booking Rejected' on the classic path)",
      "email sender (classic page only): apps/portal/src/components/rentals/rejection-dialog.tsx:322-323 → supabase/functions/notify-booking-rejected/index.ts:201",
    ],
  },

  /* ======================================================================== */
  /* Rental                                                                    */
  /* ======================================================================== */
  {
    key: "rental_started_customer",
    category: "rental",
    direction: "team_to_customer",
    name: "Rental started",
    tooltip: "Welcomes the customer when they get the keys and reminds them when the car is due back.",
    when: "When your team records the key handover to the customer.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS),
    link: "/portal/bookings",
    channels: {
      email: spec(
        "sends_some_paths",
        customerEmail(
          "Your rental has started: {{rental_number}}",
          p("Enjoy your {{vehicle_make}} {{vehicle_model}}! Your rental with {{company_name}} has started."),
          ul("Reference: {{rental_number}}", "Due back: {{rental_end_date}}"),
          h3("While you have the car"),
          ul(
            "Return it with the same fuel level.",
            "Keep it clean, and please don't smoke in it.",
            "Call us straight away if anything goes wrong.",
          ),
          CONTACT,
        ),
        "Only sent when the booking was approved and paid in full before the keys were handed over.",
      ),
      push: pushSpec(
        push("Your rental has started", "Enjoy the {{vehicle_make}} {{vehicle_model}}. Please return it by {{rental_end_date}}."),
        "customer",
      ),
      in_app: spec(
        "not_sent",
        inApp("Rental started", "Your rental of the {{vehicle_make}} {{vehicle_model}} has started and is due back {{rental_end_date}}."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: apps/portal/src/components/rentals-v2/rental-detail/stage-handover.tsx:81 (useKeyHandover) → apps/portal/src/hooks/use-key-handover.ts:345 (only when approved and paid, :315)",
      "email sender: supabase/functions/notify-rental-started/index.ts:232",
    ],
  },
  {
    key: "rental_started_team",
    category: "rental",
    direction: "customer_to_team",
    name: "Rental started",
    tooltip: "A heads-up to your team when a car goes out with a customer.",
    when: "When your team records the key handover to the customer.",
    side: "portal",
    recipient: "Your team",
    variables: unique(TEAM_VARS, BOOKING_VARS),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "sends_some_paths",
        teamEmail(
          "Rental started: {{rental_number}}, {{customer_name}}",
          p("<strong>{{customer_name}}</strong> has the {{vehicle_make}} {{vehicle_model}}. It's due back {{rental_end_date}}."),
          button("portal_url", "Open booking"),
        ),
        teamEmailNote("Bookings", "Only when the booking was approved and paid in full before the handover."),
      ),
      push: pushSpec(push("Rental started", "{{customer_name}} has the {{vehicle_make}} {{vehicle_model}}. Due back {{rental_end_date}}."), "team"),
      in_app: spec(
        "sends_some_paths",
        inApp("Rental started", "{{customer_name}} has the {{vehicle_make}} {{vehicle_model}}, due back {{rental_end_date}}."),
        "Only when the booking was approved and paid in full before the handover.",
      ),
    },
    evidence: [
      "bell sender: supabase/functions/notify-rental-started/index.ts:255",
      "email: supabase/migrations/20260718050300_add_operator_email_dispatch_trigger.sql:32-37 → supabase/functions/notify-operator-email/index.ts:38 (Bookings)",
      "trigger: apps/portal/src/hooks/use-key-handover.ts:315,345 (from stage-handover.tsx:81)",
    ],
  },
  {
    key: "extension_requested_team",
    category: "rental",
    direction: "customer_to_team",
    name: "Extension requested",
    tooltip: "Tells your team a customer wants to keep the car longer, so you can approve or decline it.",
    when: "When a customer asks for an extension in their customer portal.",
    side: "booking_site",
    recipient: "Your team",
    variables: unique(TEAM_VARS, BOOKING_VARS, ["new_end_date", "extension_amount"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "not_sent",
        teamEmail(
          "Extension request: {{rental_number}}, {{customer_name}}",
          p("<strong>{{customer_name}}</strong> wants to keep the {{vehicle_make}} {{vehicle_model}} for longer."),
          ul(
            "Booking: {{rental_number}}",
            "Due back now: {{rental_end_date}}",
            "Asked for: {{new_end_date}}",
            "Estimated cost: {{extension_amount}}",
          ),
          button("portal_url", "Review request"),
        ),
      ),
      push: pushSpec(
        push("Extension request: {{customer_name}}", "Wants to keep the {{vehicle_make}} {{vehicle_model}} until {{new_end_date}}."),
        "team",
        NEEDS_ACTION,
      ),
      in_app: spec(
        "sends",
        inApp("Extension requested", "{{customer_name}} wants to keep the {{vehicle_make}} {{vehicle_model}} until {{new_end_date}}."),
      ),
    },
    evidence: [
      "bell sender and trigger: apps/booking/src/components/customer-portal/ExtendRentalDialog.tsx:126-134 (written from the customer's browser)",
    ],
  },
  {
    key: "rental_extended_customer",
    category: "rental",
    direction: "team_to_customer",
    name: "Rental extended",
    tooltip: "Confirms the new return date to the customer, with a payment link if the extra days cost money.",
    when: "When you extend a rental, or approve a customer's extension request.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, [
      "previous_end_date",
      "new_end_date",
      "extension_days",
      "extension_amount",
      "payment_url",
    ]),
    link: "/portal/bookings",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Your rental is extended to {{new_end_date}}",
          p("Good news: your rental of the {{vehicle_make}} {{vehicle_model}} has been extended."),
          ul(
            "Reference: {{rental_number}}",
            "Old return date: {{previous_end_date}}",
            "New return date: {{new_end_date}}",
            "Extra days: {{extension_days}}",
            "Cost: {{extension_amount}}",
          ),
          p("Please pay for the extra days using the button below."),
          button("payment_url", "Pay {{extension_amount}}"),
          p("Please bring the car back by {{new_end_date}} to avoid late fees."),
          CONTACT,
        ),
      ),
      push: pushSpec(push("Rental extended", "Your {{vehicle_make}} {{vehicle_model}} is now due back {{new_end_date}}."), "customer"),
      in_app: spec(
        "sends",
        inApp("Rental extended", "Your rental is extended. The new return date is {{new_end_date}}."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: apps/portal/src/components/rentals-v2/rental-detail/rail-extensions.tsx:980,990",
      "email: apps/portal/src/components/rentals/ExtensionRequestDialog.tsx:439, apps/portal/src/components/rentals/AdminExtendRentalDialog.tsx:653 → supabase/functions/notify-rental-extended/index.ts:182",
      "bell: apps/portal/src/components/rentals/ExtensionRequestDialog.tsx:477, apps/portal/src/components/rentals/AdminExtendRentalDialog.tsx:700",
    ],
  },
  {
    key: "rental_extended_team",
    category: "rental",
    direction: "customer_to_team",
    name: "Rental extended",
    tooltip: "A record for your team each time a rental gets a new return date.",
    when: "When you extend a rental, or approve a customer's extension request.",
    side: "portal",
    recipient: "Your team",
    variables: unique(TEAM_VARS, BOOKING_VARS, ["previous_end_date", "new_end_date", "extension_days", "extension_amount"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "sends_some_paths",
        teamEmail(
          "Rental extended: {{rental_number}}, {{customer_name}}",
          p("<strong>{{customer_name}}</strong>'s rental of the {{vehicle_make}} {{vehicle_model}} now ends {{new_end_date}}."),
          ul("Extra days: {{extension_days}}", "Cost: {{extension_amount}}"),
          button("portal_url", "Open booking"),
        ),
        teamEmailNote("Bookings", "Today only the first extension of each rental is emailed."),
      ),
      push: pushSpec(push("Rental extended", "{{customer_name}}'s {{vehicle_make}} {{vehicle_model}} is now due back {{new_end_date}}."), "team"),
      in_app: spec(
        "sends_some_paths",
        inApp("Rental extended", "{{customer_name}}'s rental ({{rental_number}}) now ends {{new_end_date}}."),
        "Approving a customer's request rings the bell only for the first extension of each rental today.",
      ),
    },
    evidence: [
      "bell sender: supabase/functions/notify-rental-extended/index.ts:205 (deduped per rental, :221); apps/portal/src/components/rentals/AdminExtendRentalDialog.tsx:683 (every extension you make)",
      "email: supabase/functions/notify-operator-email/index.ts:40 (Bookings), fired by the rental_extended bell",
      "trigger: apps/portal/src/components/rentals-v2/rental-detail/rail-extensions.tsx:980,990",
    ],
  },
  {
    key: "extension_declined_customer",
    category: "rental",
    direction: "team_to_customer",
    name: "Extension declined",
    tooltip: "Tells the customer you couldn't extend their rental, so they return the car on time.",
    when: "When you decline a customer's extension request.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS),
    link: "/portal/bookings",
    channels: {
      email: spec(
        "not_sent",
        customerEmail(
          "About your extension request",
          p("Sorry, we can't extend your rental of the {{vehicle_make}} {{vehicle_model}} this time."),
          p("Please bring the car back by {{rental_end_date}} as planned."),
          CONTACT,
        ),
      ),
      push: pushSpec(push("Extension declined", "Sorry, we can't extend this rental. Please return the car by {{rental_end_date}}."), "customer"),
      in_app: spec(
        "sends",
        inApp("Extension declined", "Your extension request for the {{vehicle_make}} {{vehicle_model}} could not be approved."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "bell sender: apps/portal/src/components/rentals/ExtensionRequestDialog.tsx:693",
      "trigger: apps/portal/src/components/rentals-v2/rental-detail/rail-extensions.tsx:990",
    ],
  },
  {
    key: "return_reminder_customer",
    category: "rental",
    direction: "team_to_customer",
    name: "Return reminder",
    tooltip: "Reminds the customer when their car is due back, so it comes back on time.",
    when: "When a rental is due back soon, at the time you set for return reminders.",
    side: "automatic",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["due_date"]),
    link: "/portal/bookings",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Reminder: your car is due back {{due_date}}",
          p("Just a reminder that your {{vehicle_make}} {{vehicle_model}} is due back on <strong>{{due_date}}</strong>."),
          h3("Before you return it"),
          ul(
            "Bring it back to the agreed place on time.",
            "Check you have all your belongings.",
            "Tell us about any damage or problems.",
          ),
          p("Need more time? Contact us before the return date: {{company_email}} or {{company_phone}}."),
        ),
        "Only while return reminders are switched on. Sent once per rental.",
      ),
      push: pushSpec(
        push("Car due back {{due_date}}", "Please return the {{vehicle_make}} {{vehicle_model}} on time. Need longer? Contact us."),
        "customer",
      ),
      in_app: spec(
        "not_sent",
        inApp("Return reminder", "Your {{vehicle_make}} {{vehicle_model}} is due back on {{due_date}}."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: supabase/migrations/20260407130000_add_return_reminder_cron_job.sql:20 (every 15 minutes) → supabase/functions/send-return-reminders/index.ts:129 (tenant switch :39)",
      "email sender: supabase/functions/notify-rental-reminder/index.ts:253",
    ],
  },
  {
    key: "rental_due_back_team",
    category: "rental",
    direction: "customer_to_team",
    name: "Rental due back",
    tooltip: "Tells your team a car is due back soon, so you can get ready for the return.",
    when: "When a customer's return reminder goes out.",
    side: "automatic",
    recipient: "Your team",
    variables: unique(TEAM_VARS, BOOKING_VARS, ["due_date"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "not_sent",
        teamEmail(
          "Due back {{due_date}}: {{vehicle_make}} {{vehicle_model}}",
          p("<strong>{{customer_name}}</strong>'s {{vehicle_make}} {{vehicle_model}} ({{rental_number}}) is due back {{due_date}}."),
          button("portal_url", "Open booking"),
        ),
      ),
      push: pushSpec(push("Due back {{due_date}}", "{{customer_name}}'s {{vehicle_make}} {{vehicle_model}} ({{rental_number}})."), "team"),
      in_app: spec(
        "sends",
        inApp("Rental due back", "{{customer_name}}'s {{vehicle_make}} {{vehicle_model}} ({{rental_number}}) is due back {{due_date}}."),
        "Only while return reminders are switched on.",
      ),
    },
    evidence: [
      "bell sender: supabase/functions/notify-rental-reminder/index.ts:297",
      "no team email: rental_reminder is left out of supabase/migrations/20260718050300_add_operator_email_dispatch_trigger.sql:32-37",
      "trigger: supabase/functions/send-return-reminders/index.ts:129 (cron, every 15 minutes)",
    ],
  },
  {
    key: "rental_completed_customer",
    category: "rental",
    direction: "team_to_customer",
    name: "Rental completed",
    tooltip: "Thanks the customer once the car is back and the rental is closed.",
    when: "When your team records the keys coming back.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS),
    link: "/portal/bookings",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Thanks for renting with {{company_name}}",
          p("Thanks for renting the {{vehicle_make}} {{vehicle_model}} with us. Your rental {{rental_number}} is now complete."),
          p("We hope you enjoyed the drive, and we'd love to see you again."),
          button("customer_portal_url", "View your bookings"),
          CONTACT,
        ),
      ),
      push: pushSpec(push("Thanks for renting with us", "Your rental {{rental_number}} is complete. We hope to see you again soon."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Rental completed", "Your rental {{rental_number}} is complete. Thanks for renting with {{company_name}}."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: apps/portal/src/hooks/use-key-handover.ts:451 (keys received, from stage-handover.tsx:81)",
      "email sender: supabase/functions/notify-rental-completed/index.ts:270",
    ],
  },
  {
    key: "rental_completed_team",
    category: "rental",
    direction: "customer_to_team",
    name: "Rental completed",
    tooltip: "A heads-up to your team when a car comes back and the rental closes.",
    when: "When your team records the keys coming back.",
    side: "portal",
    recipient: "Your team",
    variables: unique(TEAM_VARS, BOOKING_VARS),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "sends",
        teamEmail(
          "Rental completed: {{rental_number}}, {{customer_name}}",
          p("<strong>{{customer_name}}</strong> has returned the {{vehicle_make}} {{vehicle_model}}. The rental is closed."),
          button("portal_url", "Open booking"),
        ),
        teamEmailNote("Returns & late"),
      ),
      push: pushSpec(push("Rental completed", "{{customer_name}} returned the {{vehicle_make}} {{vehicle_model}} ({{rental_number}})."), "team"),
      in_app: spec(
        "sends",
        inApp("Rental completed", "{{customer_name}} returned the {{vehicle_make}} {{vehicle_model}} ({{rental_number}})."),
      ),
    },
    evidence: [
      "bell sender: supabase/functions/notify-rental-completed/index.ts:301",
      "email: supabase/functions/notify-operator-email/index.ts:39 (Returns & late)",
      "trigger: apps/portal/src/hooks/use-key-handover.ts:451",
    ],
  },
  {
    key: "renewal_payment_link_customer",
    category: "rental",
    direction: "team_to_customer",
    name: "Renewal payment link",
    tooltip: "Asks the customer to pay for the next period of an auto-extending rental.",
    when: "When an auto-extending rental renews and the customer pays by link.",
    side: "automatic",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["new_end_date", "payment_amount", "payment_url"]),
    link: "/portal/payments",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Renew your rental: {{payment_amount}} due",
          p("Your rental of the {{vehicle_make}} {{vehicle_model}} with {{company_name}} is renewing for another period, until {{new_end_date}}."),
          p("Please pay <strong>{{payment_amount}}</strong> to keep the car."),
          button("payment_url", "Pay {{payment_amount}}"),
          p("If you've already returned the car, you can ignore this email."),
        ),
        "Only for rentals on auto-extension that renew by payment link.",
      ),
      push: pushSpec(push("Time to renew your rental", "Pay {{payment_amount}} to keep the {{vehicle_make}} {{vehicle_model}} until {{new_end_date}}."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Renewal payment due", "Pay {{payment_amount}} to keep the {{vehicle_make}} {{vehicle_model}} until {{new_end_date}}."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: supabase/migrations/20260530120100_add_auto_extend_cron_job.sql:15 (every 15 minutes) → supabase/functions/auto-extend-rentals/index.ts:605 (pay_link mode)",
      "email sender: supabase/functions/auto-extend-rentals/index.ts:909",
    ],
  },
  {
    key: "renewal_payment_reminder_customer",
    category: "rental",
    direction: "team_to_customer",
    name: "Renewal payment reminder",
    tooltip: "Reminds the customer to pay for their renewed rental if they haven't yet.",
    when: "When a renewal payment is still unpaid, on the days set for that rental.",
    side: "automatic",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["payment_amount", "payment_url"]),
    link: "/portal/payments",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Reminder: {{payment_amount}} due for your rental",
          p("A reminder that <strong>{{payment_amount}}</strong> is due to renew your rental of the {{vehicle_make}} {{vehicle_model}}."),
          button("payment_url", "Pay {{payment_amount}}"),
          p("Already paid? Thank you, you can ignore this email."),
        ),
        "Only for rentals with renewal reminders switched on.",
      ),
      push: pushSpec(push("Renewal payment due", "{{payment_amount}} is due to keep the {{vehicle_make}} {{vehicle_model}}."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Renewal payment due", "{{payment_amount}} is due to renew your rental of the {{vehicle_make}} {{vehicle_model}}."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: supabase/migrations/20260603120100_auto_extension_reminder_cron.sql:8 → supabase/functions/send-auto-extension-reminder/index.ts:407 (rental switch)",
      "email sender: supabase/functions/send-auto-extension-reminder/index.ts:318",
    ],
  },

  /* ======================================================================== */
  /* Payments                                                                  */
  /* ======================================================================== */
  {
    key: "payment_received_team",
    category: "payments",
    direction: "customer_to_team",
    name: "Payment received",
    tooltip: "Tells your team whenever money comes in, whether the customer paid online or your team recorded it.",
    when: "When a payment is marked as received.",
    side: "automatic",
    recipient: "Your team",
    variables: unique(TEAM_VARS, ["rental_number", "payment_amount"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "sends",
        teamEmail(
          "Payment received: {{payment_amount}} from {{customer_name}}",
          p("<strong>{{customer_name}}</strong> paid <strong>{{payment_amount}}</strong> for booking {{rental_number}}."),
          button("portal_url", "Open booking"),
        ),
        teamEmailNote("Payments"),
      ),
      push: pushSpec(push("Payment received: {{payment_amount}}", "{{customer_name}} paid {{payment_amount}} for booking {{rental_number}}."), "team"),
      in_app: spec("sends", inApp("Payment received", "{{customer_name}} paid {{payment_amount}} for booking {{rental_number}}.")),
    },
    evidence: [
      "bell sender: supabase/migrations/20260718050000_add_payment_received_notification_trigger.sql:85,109 (payments trigger, every path)",
      "email: supabase/migrations/20260718050300_add_operator_email_dispatch_trigger.sql:32-37 → supabase/functions/notify-operator-email/index.ts:29 (Payments)",
    ],
  },
  {
    key: "payment_failed_team",
    category: "payments",
    direction: "customer_to_team",
    name: "Card payment failed",
    tooltip: "Warns your team when a customer's card payment fails, so you can follow up.",
    when: "When a customer's card payment is declined.",
    side: "automatic",
    recipient: "Your team",
    variables: unique(TEAM_VARS, ["rental_number", "payment_amount"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "sends",
        teamEmail(
          "Payment failed: {{payment_amount}} from {{customer_name}}",
          p("A card payment of <strong>{{payment_amount}}</strong> from <strong>{{customer_name}}</strong> failed (booking {{rental_number}})."),
          p("You may want to contact them or send a new payment link."),
          button("portal_url", "Open booking"),
        ),
        teamEmailNote("Payments"),
      ),
      push: pushSpec(push("Payment failed: {{payment_amount}}", "{{customer_name}}'s card payment for booking {{rental_number}} failed."), "team", NEEDS_ACTION),
      in_app: spec(
        "sends",
        inApp("Payment failed", "A card payment of {{payment_amount}} from {{customer_name}} failed (booking {{rental_number}})."),
      ),
    },
    evidence: [
      "bell sender: supabase/functions/stripe-webhook-live/index.ts:1868,1889 (payment_intent.payment_failed); test mode supabase/functions/stripe-webhook-test/index.ts:1830",
      "email: supabase/functions/notify-operator-email/index.ts:30 (Payments), fired by the bell",
    ],
  },
  {
    key: "refund_issued_customer",
    category: "payments",
    direction: "team_to_customer",
    name: "Refund issued",
    tooltip: "Tells the customer a refund is on its way and how long it takes to arrive.",
    when: "When your team refunds a payment.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, ["rental_number", "refund_amount"]),
    link: "/portal/payments",
    channels: {
      email: spec(
        "sends_some_paths",
        customerEmail(
          "Your refund of {{refund_amount}} is on its way",
          p("We've refunded <strong>{{refund_amount}}</strong> for booking {{rental_number}}."),
          p("It goes back to the card you paid with. Banks usually take 5 to 10 working days to show it."),
          CONTACT,
        ),
        "Not sent when refunding a fine.",
      ),
      push: pushSpec(push("Refund on its way", "We've refunded {{refund_amount}} for booking {{rental_number}}. Allow 5 to 10 working days."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Refund issued", "We've refunded {{refund_amount}} for booking {{rental_number}}."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: apps/portal/src/components/rentals-v2/rental-detail/payments-actions.tsx:59 (RefundDialog) → apps/portal/src/components/shared/dialogs/refund-dialog.tsx:197 → supabase/functions/process-refund/index.ts:883",
      "email sender: supabase/functions/notify-refund-processed/index.ts:305",
      "no email: fine refunds write a ledger row only, apps/portal/src/components/shared/dialogs/refund-dialog.tsx:145-192",
    ],
  },
  {
    key: "refund_processed_team",
    category: "payments",
    direction: "customer_to_team",
    name: "Refund processed",
    tooltip: "A record for your team each time money goes back to a customer.",
    when: "When a payment is refunded, from the portal or by your payment provider.",
    side: "automatic",
    recipient: "Your team",
    variables: unique(TEAM_VARS, ["rental_number", "refund_amount"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "sends",
        teamEmail(
          "Refund processed: {{refund_amount}} to {{customer_name}}",
          p("<strong>{{refund_amount}}</strong> was refunded to <strong>{{customer_name}}</strong> for booking {{rental_number}}."),
          button("portal_url", "Open booking"),
        ),
        teamEmailNote("Payments"),
      ),
      push: pushSpec(push("Refund processed: {{refund_amount}}", "Refunded to {{customer_name}} for booking {{rental_number}}."), "team"),
      in_app: spec("sends", inApp("Refund processed", "{{refund_amount}} was refunded to {{customer_name}} for booking {{rental_number}}.")),
    },
    evidence: [
      "bell sender: supabase/migrations/20260719130000_suppress_void_refund_notification.sql:67 (payments trigger); supabase/functions/notify-refund-processed/index.ts:337",
      "email: supabase/functions/notify-operator-email/index.ts:31 (Payments), fired by the bell",
    ],
  },
  {
    key: "payment_link_customer",
    category: "payments",
    direction: "team_to_customer",
    name: "Payment link",
    tooltip: "Sends the customer a secure link to pay an invoice or an amount you choose.",
    when: "When your team emails a customer a payment link or an invoice.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["payment_amount", "invoice_ref", "payment_url"]),
    link: "/portal/payments",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Payment request from {{company_name}}: {{payment_amount}}",
          p("Here's your payment request for booking {{rental_number}}."),
          ul("Car: {{vehicle_make}} {{vehicle_model}}", "Amount due: <strong>{{payment_amount}}</strong>"),
          button("payment_url", "Pay {{payment_amount}}"),
          p("The button opens a secure payment page."),
          CONTACT,
        ),
      ),
      push: pushSpec(push("Payment request: {{payment_amount}}", "{{company_name}} has sent you a payment link for booking {{rental_number}}."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Payment request", "{{company_name}} has sent you a payment request for {{payment_amount}}."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: apps/portal/src/components/shared/dialogs/add-payment-dialog.tsx:1209 (used by rentals-v2 payments-actions.tsx); apps/portal/src/components/customers/collect-payment-dialog.tsx:246; apps/portal/src/components/invoices/send-invoice-email-dialog.tsx:99",
      "email sender: supabase/functions/send-invoice-email/index.ts:413",
    ],
  },
  {
    key: "deposit_hold_request_customer",
    category: "payments",
    direction: "team_to_customer",
    name: "Deposit hold request",
    tooltip: "Asks the customer to place a security deposit hold on their card. It's a hold, not a charge.",
    when: "When your team emails a customer a link to place a deposit hold.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["deposit_amount", "payment_url"]),
    link: "/portal/payments",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Please place your {{deposit_amount}} deposit hold",
          p("To secure your rental of the {{vehicle_make}} {{vehicle_model}}, please place a security deposit hold of <strong>{{deposit_amount}}</strong> on your card."),
          p("This is a hold, not a charge."),
          button("payment_url", "Place deposit hold"),
          CONTACT,
        ),
      ),
      push: pushSpec(push("Deposit hold needed", "Please place a {{deposit_amount}} hold on your card for booking {{rental_number}}."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Deposit hold needed", "Please place a {{deposit_amount}} deposit hold for booking {{rental_number}}."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: apps/portal/src/components/shared/dialogs/add-hold-dialog.tsx:248 (used by rentals-v2 payments-actions.tsx)",
      "email sender: supabase/functions/send-invoice-email/index.ts:413",
    ],
  },
  {
    key: "payment_rejected_customer",
    category: "payments",
    direction: "team_to_customer",
    name: "Payment not accepted",
    tooltip: "Tells the customer a payment couldn't be accepted, and why.",
    when: "When your team rejects a payment on the Payments page.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, ["payment_amount", "rejection_reason", "vehicle_reg"]),
    link: "/portal/payments",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "We couldn't accept your payment of {{payment_amount}}",
          p("We couldn't accept your payment of <strong>{{payment_amount}}</strong>."),
          p("<strong>Reason:</strong> {{rejection_reason}}"),
          p("Please get in touch so we can sort it out: {{company_email}} or {{company_phone}}."),
        ),
      ),
      push: pushSpec(push("Payment not accepted", "We couldn't accept your payment of {{payment_amount}}. Please contact us."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Payment not accepted", "We couldn't accept your payment of {{payment_amount}}. Please contact us."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: apps/portal/src/app/(dashboard)/payments/page.tsx:707 (v2 list reject) → apps/portal/src/hooks/use-payment-verification.ts:175 → apps/portal/src/lib/notifications.ts:82",
      "email sender: supabase/functions/send-payment-rejection-email/index.ts:134",
    ],
  },
  {
    key: "instalment_due_customer",
    category: "payments",
    direction: "team_to_customer",
    name: "Instalment payment due",
    tooltip: "Tells the customer an instalment couldn't be charged and gives them a link to pay.",
    when: "When an automatic instalment charge fails.",
    side: "automatic",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, ["rental_number", "outstanding_amount", "payment_url"]),
    link: "/portal/payments",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Payment due: {{outstanding_amount}} for your rental",
          p("We couldn't take your latest instalment for booking {{rental_number}}, so <strong>{{outstanding_amount}}</strong> is now due."),
          button("payment_url", "Pay {{outstanding_amount}}"),
          CONTACT,
        ),
      ),
      push: pushSpec(push("Payment due: {{outstanding_amount}}", "We couldn't take your instalment for booking {{rental_number}}. Tap to pay."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Instalment payment due", "{{outstanding_amount}} is due for booking {{rental_number}}."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: supabase/functions/sim-control/cron-manifest.json:4 (process-installment-payment, daily 06:00) → supabase/functions/process-installment-payment/index.ts:267 (failed charge)",
      "email sender: supabase/functions/send-installment-reminders/index.ts:207",
    ],
  },
  {
    key: "instalment_receipt_customer",
    category: "payments",
    direction: "team_to_customer",
    name: "Instalment receipt",
    tooltip: "A receipt for the customer when they pay an instalment early.",
    when: "When a customer pays an instalment early in their customer portal.",
    side: "booking_site",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, ["rental_number", "payment_amount"]),
    link: "/portal/payments",
    channels: {
      email: spec(
        "sends_some_paths",
        customerEmail(
          "Payment received: {{payment_amount}}",
          p("Thank you. We've received your payment of <strong>{{payment_amount}}</strong> for booking {{rental_number}}."),
          p("You can see what's left to pay in your customer portal."),
          button("customer_portal_url", "View your payments"),
        ),
        "Scheduled instalment charges don't send a receipt today.",
      ),
      push: pushSpec(push("Payment received", "Thanks, we've received {{payment_amount}} for booking {{rental_number}}."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Payment received", "Thanks, we've received {{payment_amount}} for booking {{rental_number}}."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: apps/booking/src/hooks/use-payment-actions.ts:171,211,252 → supabase/functions/pay-installment-early/index.ts:324",
      "email sender: supabase/functions/send-installment-receipt/index.ts:208",
    ],
  },
  {
    key: "payg_reminder_customer",
    category: "payments",
    direction: "team_to_customer",
    name: "Pay-as-you-go balance reminder",
    tooltip: "Reminds a pay-as-you-go customer what they owe so far, with a link to pay.",
    when: "When a pay-as-you-go rental has an unpaid balance, on your reminder schedule.",
    side: "automatic",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["outstanding_amount", "invoice_ref", "days_active", "payment_url"]),
    link: "/portal/payments",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Payment reminder: {{outstanding_amount}} owed on {{rental_number}}",
          p("Your pay-as-you-go rental of the {{vehicle_make}} {{vehicle_model}} has been running for {{days_active}} days, and <strong>{{outstanding_amount}}</strong> is unpaid."),
          ul("Booking: {{rental_number}}", "Latest invoice: {{invoice_ref}}", "Amount owed: {{outstanding_amount}}"),
          button("payment_url", "Pay {{outstanding_amount}}"),
          p("Charges add up each day you have the car, so paying now keeps the balance small."),
          p("Already paid? Thank you, you can ignore this email."),
        ),
        "Only while automatic pay-as-you-go reminders are switched on.",
      ),
      push: pushSpec(push("Balance due: {{outstanding_amount}}", "Your pay-as-you-go rental {{rental_number}} has an unpaid balance. Tap to pay."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Balance due", "Your pay-as-you-go rental {{rental_number}} has {{outstanding_amount}} unpaid."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: supabase/migrations/20260415120000_fix_payg_audit_issues.sql:71 (cron) → supabase/functions/send-payg-reminders/index.ts",
      "email sender: supabase/functions/send-payg-reminders/index.ts:680",
    ],
  },
  {
    key: "deposit_hold_problem_team",
    category: "payments",
    direction: "customer_to_team",
    name: "Deposit hold problem",
    tooltip: "Warns your team when a customer's deposit hold couldn't be renewed or recorded.",
    when: "When a deposit hold fails to renew or can't be recorded.",
    side: "automatic",
    recipient: "Your team",
    variables: unique(TEAM_VARS, ["rental_number", "deposit_amount"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "not_sent",
        teamEmail(
          "Deposit hold problem on {{rental_number}}",
          p("The {{deposit_amount}} deposit hold on booking {{rental_number}} ({{customer_name}}) needs checking."),
          button("portal_url", "Open booking"),
        ),
      ),
      push: pushSpec(push("Deposit hold problem", "The deposit hold on booking {{rental_number}} needs checking."), "team", NEEDS_ACTION),
      in_app: spec("sends", inApp("Deposit hold problem", "The deposit hold on booking {{rental_number}} for {{customer_name}} needs checking.")),
    },
    evidence: [
      "bell sender: supabase/functions/_shared/deposit-hold-notify.ts:520,613,707,876",
      "trigger: supabase/functions/refresh-deposit-holds/index.ts:443 (cron-manifest.json:8, daily 03:00); supabase/functions/stripe-webhook-live/index.ts:556 (hold not recorded)",
    ],
  },

  /* ======================================================================== */
  /* Agreements                                                                */
  /* ======================================================================== */
  {
    key: "agreement_to_sign_customer",
    category: "agreements",
    direction: "team_to_customer",
    name: "Agreement ready to sign",
    tooltip: "Sends the customer their rental agreement to sign online. It's the only way the agreement reaches them.",
    when: "When your team sends a rental agreement, or when a customer books on your booking site.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["signing_url"]),
    link: "/portal/agreements",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Please sign your rental agreement: {{rental_number}}",
          p("Your rental agreement with {{company_name}} for the {{vehicle_make}} {{vehicle_model}} is ready."),
          p("Please read it and sign online before pickup. It only takes a few minutes."),
          button("signing_url", "Review and sign"),
          CONTACT,
        ),
      ),
      push: pushSpec(push("Agreement ready to sign", "Please sign your rental agreement for booking {{rental_number}} before pickup."), "customer"),
      in_app: spec(
        "sends",
        inApp("Agreement ready to sign", "{{company_name}} has sent you a rental agreement to sign."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "email: apps/portal/src/app/api/esign/route.ts:1997 → supabase/functions/send-signing-email/index.ts:109; apps/booking/src/app/api/esign/route.ts:1007",
      "bell: apps/portal/src/app/api/esign/route.ts:2109; apps/booking/src/app/api/esign/route.ts:1092",
      "trigger: apps/portal/src/components/rentals-v2/rental-detail/stage-agreement.tsx:493; apps/portal/src/components/rentals-v2/rental-create-v2.tsx:2571; apps/booking/src/components/BookingCheckoutStep.tsx:713",
    ],
  },
  {
    key: "agreement_signed_team",
    category: "agreements",
    direction: "customer_to_team",
    name: "Agreement signed",
    tooltip: "Tells your team the customer has signed, so the booking can move on.",
    when: "When a customer signs their rental agreement.",
    side: "automatic",
    recipient: "Your team",
    variables: unique(TEAM_VARS, ["rental_number"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "sends",
        teamEmail(
          "Agreement signed: {{rental_number}}, {{customer_name}}",
          p("<strong>{{customer_name}}</strong> has signed the rental agreement for booking {{rental_number}}."),
          button("portal_url", "Open booking"),
        ),
        teamEmailNote("Verification"),
      ),
      push: pushSpec(push("Agreement signed", "{{customer_name}} signed the agreement for booking {{rental_number}}."), "team"),
      in_app: spec("sends", inApp("Agreement signed", "{{customer_name}} signed the rental agreement for booking {{rental_number}}.")),
    },
    evidence: [
      "bell sender: supabase/migrations/20260718050200_add_signing_and_identity_notification_triggers.sql:48,64 (rental_agreements → completed)",
      "email: supabase/functions/notify-operator-email/index.ts:33 (Verification)",
      "trigger: supabase/functions/boldsign-webhook/index.ts:162,177-180 (rental_agreements.document_status → completed)",
    ],
  },
  {
    key: "agreement_signed_customer",
    category: "agreements",
    direction: "team_to_customer",
    name: "Agreement signed",
    tooltip: "Confirms to the customer that their agreement is signed and where to find a copy.",
    when: "When a customer signs their rental agreement.",
    side: "automatic",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, ["rental_number"]),
    link: "/portal/agreements",
    channels: {
      email: spec(
        "not_sent",
        customerEmail(
          "Your rental agreement is signed",
          p("Thanks for signing your rental agreement for booking {{rental_number}}."),
          p("You can view and download it any time in your customer portal."),
          button("customer_portal_url", "Open your customer portal"),
        ),
      ),
      push: pushSpec(push("Agreement signed", "Thanks for signing. Your agreement for booking {{rental_number}} is saved."), "customer"),
      in_app: spec(
        "sends",
        inApp("Agreement signed", "Your rental agreement with {{company_name}} is signed. You can download it any time."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: ["bell sender: supabase/functions/boldsign-webhook/index.ts:298"],
  },

  /* ======================================================================== */
  /* Verification                                                              */
  /* ======================================================================== */
  {
    key: "id_check_result_team",
    category: "verification",
    direction: "customer_to_team",
    name: "ID check result",
    tooltip: "Tells your team when a customer's ID check passes, fails or needs new documents.",
    when: "When a customer's ID check finishes.",
    side: "automatic",
    recipient: "Your team",
    variables: unique(TEAM_VARS, ["verification_result"]),
    link: "/customers/{{customer_id}}",
    channels: {
      email: spec(
        "sends",
        teamEmail(
          "ID check for {{customer_name}}: {{verification_result}}",
          p("<strong>{{customer_name}}</strong>'s ID check has finished. Result: <strong>{{verification_result}}</strong>."),
        ),
        teamEmailNote("Verification"),
      ),
      push: pushSpec(push("ID check: {{verification_result}}", "{{customer_name}}'s ID check has finished."), "team"),
      in_app: spec("sends", inApp("ID check: {{verification_result}}", "{{customer_name}}'s ID check result: {{verification_result}}.")),
    },
    evidence: [
      "bell sender: supabase/migrations/20260718050200_add_signing_and_identity_notification_triggers.sql:109-123,134 (identity_verifications → completed/approved)",
      "email: supabase/functions/notify-operator-email/index.ts:34 (Verification)",
    ],
  },
  {
    key: "driver_invite_customer",
    category: "verification",
    direction: "team_to_customer",
    name: "Additional driver invite",
    tooltip: "Asks an extra driver on the rental to verify their driving licence online.",
    when: "When your team adds an additional driver to a rental.",
    side: "portal",
    recipient: "The additional driver",
    variables: ["driver_name", "customer_name", "company_name", "company_email", "company_phone", "verification_url"],
    channels: {
      // Email only: the extra driver has no customer account or device of ours,
      // and the greeting is the driver's name, not the renter's.
      email: spec("sends", {
        subject: "Please verify your driving licence",
        body: [
          p("Hi {{driver_name}},"),
          p("You've been added as a driver on {{customer_name}}'s rental with {{company_name}}."),
          p("Please verify your driving licence using the secure link below. It works on your phone or computer."),
          button("verification_url", "Verify my licence"),
          p("The link expires after 3 hours. If it runs out, ask us to send a new one."),
          p("The {{company_name}} team"),
        ].join(""),
      }),
    },
    evidence: [
      "trigger: apps/portal/src/components/rentals-v2/rental-create-v2.tsx:1965; apps/portal/src/components/rentals-v2/rental-detail/stage-extras.tsx:253",
      "email sender: supabase/functions/send-additional-driver-invite/index.ts:188",
    ],
  },
  {
    key: "licence_check_link_customer",
    category: "verification",
    direction: "team_to_customer",
    name: "Licence check link",
    tooltip: "Sends the customer a secure link to check their driving licence.",
    when: "When your team starts a licence check or sends the link again.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, ["verification_url"]),
    link: "/portal/verification",
    channels: {
      email: spec(
        "sends_some_paths",
        customerEmail(
          "Please verify your driving licence",
          p("{{company_name}} needs to check your driving licence before your rental. It only takes a couple of minutes."),
          button("verification_url", "Verify my licence"),
          p("The link works for about 7 days."),
        ),
        "Only when your team picks email as a way to send the link.",
      ),
      push: pushSpec(push("Verify your licence", "{{company_name}} needs to check your driving licence. It takes 2 minutes."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Verify your licence", "{{company_name}} needs to check your driving licence before your rental."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: apps/portal/src/components/rentals-v2/rental-detail/stage-customer.tsx:59 (StartCmdVerificationDialog) → apps/portal/src/hooks/use-cmd-verification.ts:174; apps/portal/src/components/customers-v2/customer-detail/section-verification.tsx:82 (resend) → apps/portal/src/hooks/use-cmd-verification.ts:202",
      "email sender: supabase/functions/cmd-create-verification/index.ts:108; supabase/functions/cmd-resend-link/index.ts:72",
    ],
  },

  /* ======================================================================== */
  /* Fines                                                                     */
  /* ======================================================================== */
  {
    key: "fine_recorded_team",
    category: "fines",
    direction: "customer_to_team",
    name: "Fine recorded",
    tooltip: "Tells your team a fine or penalty was added to a rental.",
    when: "When a fine is added to a rental.",
    side: "portal",
    recipient: "Your team",
    variables: unique(TEAM_VARS, ["rental_number", "fine_amount"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "sends",
        teamEmail(
          "Fine recorded: {{fine_amount}} on {{rental_number}}",
          p("A fine of <strong>{{fine_amount}}</strong> was added to booking {{rental_number}} ({{customer_name}})."),
          button("portal_url", "Open booking"),
        ),
        teamEmailNote("Fines"),
      ),
      push: pushSpec(push("Fine recorded: {{fine_amount}}", "Added to booking {{rental_number}} ({{customer_name}})."), "team"),
      in_app: spec("sends", inApp("Fine recorded", "A fine of {{fine_amount}} was added to booking {{rental_number}}.")),
    },
    evidence: [
      "bell sender: supabase/migrations/20260718050100_add_refund_and_fine_notification_triggers.sql:128,144 (fines INSERT, every path)",
      "email: supabase/functions/notify-operator-email/index.ts:32 (Fines)",
      "trigger: apps/portal/src/components/rentals-v2/rental-detail/payments-actions.tsx:63 (AddFineDialog); any other path that inserts a fine",
    ],
  },
  {
    key: "toll_statement_customer",
    category: "fines",
    direction: "team_to_customer",
    name: "Toll statement",
    tooltip: "Sends the customer the tolls from their rental with a link to pay them.",
    when: "When your team emails a toll statement from the Fines page.",
    side: "portal",
    recipient: "The customer",
    variables: unique(CUSTOMER_VARS, BOOKING_VARS, ["toll_total", "payment_url"]),
    link: "/portal/payments",
    channels: {
      email: spec(
        "sends",
        customerEmail(
          "Your toll charges: {{toll_total}} due",
          p("Here are the tolls from your rental of the {{vehicle_make}} {{vehicle_model}} ({{rental_number}}). The total due is <strong>{{toll_total}}</strong>."),
          button("payment_url", "Pay {{toll_total}}"),
          CONTACT,
        ),
        "Today's email also lists each toll. This template can't list them yet.",
      ),
      push: pushSpec(push("Toll charges: {{toll_total}}", "Tolls from your rental {{rental_number}} are ready to pay."), "customer"),
      in_app: spec(
        "not_sent",
        inApp("Toll charges", "Tolls of {{toll_total}} from your rental {{rental_number}} are ready to pay."),
        IN_APP_CUSTOMER_NOTE,
      ),
    },
    evidence: [
      "trigger: apps/portal/src/app/(dashboard)/fines/page.tsx:788 (v2 BulkActionBar) → apps/portal/src/components/fines/bulk-action-bar.tsx:222",
      "email sender: supabase/functions/send-toll-report/index.ts:152",
    ],
  },

  /* ======================================================================== */
  /* Insurance                                                                 */
  /* ======================================================================== */
  {
    key: "insurance_on_hold_team",
    category: "insurance",
    direction: "customer_to_team",
    name: "Insurance couldn't start",
    tooltip: "Warns your admins when a customer's insurance couldn't be switched on because your Bonzah balance is too low.",
    when: "When a booking's insurance can't be switched on because your Bonzah balance is too low.",
    side: "automatic",
    recipient: "Your admins",
    variables: unique(TEAM_VARS, ["rental_number", "insurance_premium", "insurance_balance"]),
    link: TEAM_RENTAL_LINK,
    channels: {
      email: spec(
        "sends",
        teamEmail(
          "Action needed: insurance on hold for {{rental_number}}",
          p("Insurance for <strong>{{customer_name}}</strong> (booking {{rental_number}}) couldn't be switched on because your Bonzah balance is too low."),
          ul("Premium: {{insurance_premium}}", "Your Bonzah balance: {{insurance_balance}}"),
          p("Top up your Bonzah balance, then switch the policy on from the booking."),
          button("portal_url", "Open booking"),
        ),
        "Goes to every admin and head admin's own email address.",
      ),
      push: pushSpec(push("Insurance on hold", "{{customer_name}}'s insurance couldn't start. Top up your Bonzah balance."), "team", NEEDS_ACTION),
      in_app: spec(
        "sends",
        inApp("Insurance on hold", "Insurance for {{customer_name}} ({{rental_number}}) couldn't start. Your Bonzah balance is too low."),
        "Shown to admins and head admins only.",
      ),
    },
    evidence: [
      "bell sender: supabase/functions/bonzah-confirm-payment/index.ts:420 (admins and head admins)",
      "email sender: supabase/functions/bonzah-confirm-payment/index.ts:473",
      "trigger: apps/booking/src/app/booking-success/page.tsx:545; apps/portal/src/components/rentals-v2/rental-create-v2.tsx:2092",
    ],
  },

  /* ======================================================================== */
  /* Enquiries                                                                 */
  /* ======================================================================== */
  {
    key: "enquiry_received_team",
    category: "enquiries",
    direction: "customer_to_team",
    name: "New enquiry",
    tooltip: "Tells your team when someone sends a question from your booking site.",
    when: "When someone sends an enquiry from your booking site.",
    side: "booking_site",
    recipient: "Your team",
    variables: ["customer_name", "customer_email", "customer_phone", "company_name", "rental_start_date", "rental_end_date", "enquiry_message"],
    link: "/enquiries",
    channels: {
      email: spec(
        "sends",
        teamEmail(
          "New enquiry from {{customer_name}}",
          p("<strong>{{customer_name}}</strong> sent an enquiry from your booking site."),
          ul(
            "Email: {{customer_email}}",
            "Phone: {{customer_phone}}",
            "Dates: {{rental_start_date}} to {{rental_end_date}}",
          ),
          p("<strong>Message:</strong> {{enquiry_message}}"),
        ),
        "Goes to your admin email address.",
      ),
      push: pushSpec(push("New enquiry: {{customer_name}}", "{{enquiry_message}}"), "team"),
      in_app: spec("sends", inApp("New enquiry from {{customer_name}}", "{{enquiry_message}}")),
    },
    evidence: [
      "trigger: apps/booking/src/components/enquiry/enquiry-modal.tsx:98; apps/booking/src/components/custom-booking-page/enquiry-dialog.tsx:93",
      "email sender: supabase/functions/submit-enquiry/index.ts:174 (to tenants.admin_email, :159)",
      "bell sender: supabase/functions/submit-enquiry/index.ts:238,365",
    ],
  },
  {
    key: "contact_message_team",
    category: "enquiries",
    direction: "customer_to_team",
    name: "Contact form message",
    tooltip: "Passes on messages sent through the contact form on your booking site.",
    when: "When someone sends a message through your booking site's contact form.",
    side: "booking_site",
    recipient: "Your team",
    variables: ["customer_name", "customer_email", "customer_phone", "company_name", "contact_subject", "contact_message"],
    channels: {
      email: spec(
        "sends",
        teamEmail(
          "Contact form: {{contact_subject}}",
          p("<strong>{{customer_name}}</strong> sent a message from your booking site's contact form."),
          ul("Email: {{customer_email}}", "Phone: {{customer_phone}}", "Subject: {{contact_subject}}"),
          p("{{contact_message}}"),
        ),
        "Goes to the contact email shown on your booking site.",
      ),
      push: pushSpec(push("Website message: {{customer_name}}", "{{contact_subject}}"), "team"),
      in_app: spec("not_sent", inApp("Website message from {{customer_name}}", "{{contact_subject}}")),
    },
    evidence: [
      "trigger: apps/booking/src/app/contact/page.tsx:157 (recipient is the site's contact email, :164)",
      "email sender: supabase/functions/send-contact-email/index.ts:105",
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

const ITEM_BY_KEY: ReadonlyMap<string, NotificationItem> = new Map(NOTIFICATION_CATALOG.map((item) => [item.key, item]));

/** The catalog item with this key, or undefined. */
export function getNotificationItem(key: string): NotificationItem | undefined {
  return ITEM_BY_KEY.get(key);
}

/** The items of one direction and category, in catalog order. */
export function itemsFor(direction: NotificationDirection, category: NotificationCategoryId): NotificationItem[] {
  return NOTIFICATION_CATALOG.filter((item) => item.direction === direction && item.category === category);
}
