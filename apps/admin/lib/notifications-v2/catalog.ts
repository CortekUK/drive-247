/**
 * Notifications v2, SYSTEM set: every message that crosses the platform
 * boundary between Drive247 and an operator.
 *
 * The operator's own page lists what passes between them and their customers
 * (`apps/portal/src/lib/notifications-v2/catalog.ts`). This is the other half
 * the lead described at 07:30–08:30 and again at 16:39: "exactly the same thing
 * we'll build for ourselves in the super admin dashboard". Three directions:
 *
 *   super_admin_to_admin      we do something, the operator is told
 *   admin_to_super_admin      an operator does something, we are told
 *   super_admin_to_everyone   we broadcast to operators, to their renters, or both
 *
 * THE RULE THAT SHAPED THIS FILE (transcript §3.4): "We must not just prompt
 * Claude and accept whatever makes sense to it. We will make sense of every
 * single place ourselves." So every item below is an event the platform really
 * has today, and each carries `evidence`: the sender's file:line and the
 * trigger's file:line, read in source on this branch. Where an event reaches
 * somebody without a sender at all — a badge, a dialog, a queue page — the
 * evidence says which surface, and `today` says `not_sent` on every channel
 * that genuinely sends nothing. Twenty items, not two hundred: the lead asked
 * for few if there are few.
 *
 * `today` is what the code does NOW, and `defaultEnabled` follows it: a channel
 * that sends today defaults on, a channel that sends nothing defaults off.
 * Exactly one event pushes today (platform activity) and nothing on this page
 * changes sending yet.
 *
 * ---------------------------------------------------------------------------
 * NOT REBUILT, DELIBERATELY
 * ---------------------------------------------------------------------------
 * The three broadcast items carry `managedElsewhere`. Announcements and the
 * maintenance banner are finished products with their own authoring screens,
 * their own targeting and their own dismissal rules; they are listed so a super
 * admin can find them from here, not so this page can re-implement them. Their
 * tooltips say which screen to open.
 *
 * ---------------------------------------------------------------------------
 * LEFT OUT, and why (full write-up in the inventory report)
 * ---------------------------------------------------------------------------
 *  - Everything customer↔operator. That is the portal page's catalogue, and
 *    listing it twice would hand a super admin switches that are not theirs.
 *  - Super-admin actions that send nothing today: admin-force-logout,
 *    signout-tenant-users, admin-delete-tenant, change-subscription-price,
 *    apply-subscription-discount, end-test-subscription, manage-credit-wallet,
 *    create-demo-user, admin-create-sales-agent. Each was checked for a send;
 *    none has one. Candidates for the runtime phase, not entries now.
 *  - Lead and sales CRM (strategy-call emails, lead messages, automations,
 *    offer links, applications): the recipient is a prospect, a third audience
 *    with its own screens.
 *  - Account security: operator sign-up, password and OTP emails. These must
 *    always send; a switch on them is a footgun.
 *  - Content products with no send: welcome pack, setup checklist, first-run
 *    questions, platform legal documents.
 *  - Third-party mail we do not own: Stripe receipts and Connect emails,
 *    BoldSign, Square, Xero/Zoho, INSHUR, Tesla, Turo.
 *  - Internal bookkeeping jobs (reconcile-*, backfill-*, sweep-*, sync-*).
 *    They write audit_logs rows, which is already how `platform_activity_alert`
 *    reaches a phone; listing them would double-count one notification.
 *  - Diagnostics and every sandbox-* function: they send only in simulations.
 *  - SMS and voice: no platform-boundary event uses either today.
 *
 * No React and no Supabase here. Nothing in v1 imports this file.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The shapes shared with the rest of this feature live in `./types`, whose own
 * header says catalog.ts builds the list. Everything identical on both pages is
 * imported from there rather than re-declared, so this app has exactly one
 * `ChannelSpec` and one `EmailTemplate`.
 *
 * TWO VALUES DIVERGE, deliberately and in the open:
 *
 *   direction  This file uses `super_admin_to_admin`, `admin_to_super_admin`
 *              and `super_admin_to_everyone` — the ticket's wording, and the
 *              lead's own at 07:30–08:30. `./types` names the same three after
 *              the two parties (`platform_to_operator`, ...). They mean exactly
 *              the same thing, so `DIRECTION_IN_TYPES` below is a lossless 1:1
 *              bridge. Pick one set before the page is wired and delete the
 *              other; nothing is lost either way.
 *
 *   side       This file also carries `admin dashboard` and `booking site`,
 *              which `./types` does not have. They earn their place: most
 *              Drive247 → Operator items are triggered by a super admin in this
 *              dashboard, and exactly one item is triggered on a booking site
 *              (the renter announcement bell). There is no lossless map onto
 *              three values, so there is deliberately NO bridge — `./types`
 *              needs those two values before one union can serve both files.
 *
 * Nothing here edits `./types`.
 */

import type {
  ChannelSpec,
  ChannelTemplate,
  ChannelTodayStatus,
  EmailTemplate,
  InAppTemplate,
  NotificationCategory,
  PushDisplayOptions,
  PushTemplate,
  SystemNotificationDirection as TypesDirection,
} from "./types";

/**
 * Who is telling whom, from Drive247's point of view.
 * - `super_admin_to_admin`: we act, the operator hears about it.
 * - `admin_to_super_admin`: an operator acts, we hear about it.
 * - `super_admin_to_everyone`: a broadcast — operator staff, their renters, or
 *   both at once.
 */
export type SystemNotificationDirection =
  | "super_admin_to_admin"
  | "admin_to_super_admin"
  | "super_admin_to_everyone";

/** Display order of the three direction groups on the page. */
export const SYSTEM_NOTIFICATION_DIRECTIONS: readonly SystemNotificationDirection[] = [
  "super_admin_to_admin",
  "admin_to_super_admin",
  "super_admin_to_everyone",
] as const;

/** Short headings for the direction groups. */
export const SYSTEM_DIRECTION_LABELS: Record<SystemNotificationDirection, string> = {
  super_admin_to_admin: "Drive247 → Operator",
  admin_to_super_admin: "Operator → Drive247",
  super_admin_to_everyone: "Drive247 → Everyone",
};

/** One sentence under each direction heading. */
export const SYSTEM_DIRECTION_DESCRIPTIONS: Record<SystemNotificationDirection, string> = {
  super_admin_to_admin: "We do something, and the operator is told.",
  admin_to_super_admin: "An operator does something, and we are told.",
  super_admin_to_everyone: "What you broadcast to operators, to their renters, or to both.",
};

/**
 * The same three directions under the names `./types` uses. Lossless and 1:1 —
 * see the divergence note at the top of this section.
 */
export const DIRECTION_IN_TYPES: Record<SystemNotificationDirection, TypesDirection> = {
  super_admin_to_admin: "platform_to_operator",
  admin_to_super_admin: "operator_to_platform",
  super_admin_to_everyone: "platform_to_everyone",
};

/** Where the triggering action happens, in plain words (transcript 15:25–16:05). */
export type SystemNotificationSide =
  /** A super admin does it here, in this dashboard. */
  | "admin dashboard"
  /** An operator's staff member does it in their portal. */
  | "portal"
  /** A renter does it on an operator's booking site. */
  | "booking site"
  /** A cron job, a database trigger or a payment webhook does it. */
  | "automatic";

/** Stable category ids. Order in `SYSTEM_NOTIFICATION_CATEGORIES` is display order. */
export type SystemNotificationCategoryId =
  | "onboarding"
  | "billing"
  | "migration"
  | "platform_activity"
  | "support"
  | "insurance"
  | "announcements";

/** `NotificationCategory` from `./types`, narrowed to this catalog's own ids. */
export interface SystemNotificationCategory extends NotificationCategory {
  id: SystemNotificationCategoryId;
}

/**
 * A finished product with its own screen. The page links to it instead of
 * offering an editor, because the wording is written per announcement, not once
 * as a template.
 */
export interface SystemManagedElsewhere {
  /** What to call the screen, in words. */
  screen: string;
  /** Route in this dashboard. */
  href: string;
}

/* -------------------------------------------------------------------------- */
/* Catalog items                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One notification in the system set. Structurally the `SystemNotificationItem`
 * of `./types` plus `managedElsewhere`, with `category` narrowed to this file's
 * union and `direction` / `side` on the values documented above.
 */
export interface SystemNotificationItem {
  /** snake_case, matches ^[a-z][a-z0-9_]{2,63}$ (the DB CHECK). Never rename once shipped. */
  key: string;
  category: SystemNotificationCategoryId;
  direction: SystemNotificationDirection;
  /** Short name that makes sense on its own. */
  name: string;
  /** Tooltip: one or two plain sentences. */
  tooltip: string;
  /** Plain English, starting with "When". */
  when: string;
  /** Where the triggering action happens. */
  side: SystemNotificationSide;
  /** Who receives it, in words. */
  recipient: string;
  /** Only the channels this notification can go out on. At least one. */
  channels: Partial<{
    email: ChannelSpec<EmailTemplate>;
    push: ChannelSpec<PushTemplate>;
    in_app: ChannelSpec<InAppTemplate>;
  }>;
  /** Variable keys usable here (all exist in SYSTEM_NOTIFICATION_VARIABLES). */
  variables: string[];
  /** Deep link a push or a bell row opens; may use {{variables}}. */
  link?: string;
  /** Set when the real editing happens on another screen. */
  managedElsewhere?: SystemManagedElsewhere;
  /**
   * Why we believe this event exists: file:line of the sender and of the
   * trigger. Not shown to anyone; kept for review and for the runtime work.
   */
  evidence: string[];
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

/** Display order. Every category holds at least one item. */
export const SYSTEM_NOTIFICATION_CATEGORIES: SystemNotificationCategory[] = [
  {
    id: "onboarding",
    label: "Onboarding",
    description: "A new operator arriving, and how far they have got.",
  },
  {
    id: "billing",
    label: "Billing",
    description: "Subscription links, activations and cancellation requests.",
  },
  {
    id: "migration",
    label: "Migration",
    description: "Moving operators onto a Stripe account they own themselves.",
  },
  {
    id: "platform_activity",
    label: "Platform activity",
    description: "What operators are doing, as it happens.",
  },
  {
    id: "support",
    label: "Support and feedback",
    description: "Tickets and feedback about our software.",
  },
  {
    id: "insurance",
    label: "Insurance partner",
    description: "Bonzah applications, approvals and requests for updates.",
  },
  {
    id: "announcements",
    label: "Announcements",
    description: "What you broadcast to operators and to their renters.",
  },
];

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

const PUSH_PLATFORM_NOTE =
  "Goes to super admin devices enrolled for platform push, and only for the actions that admin ticked.";
const OPERATOR_BELL_NOTE =
  "Shows in the operator's portal bell, for their whole team.";

const OPEN_IN_APP: PushDisplayOptions = { openInApp: true };

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

function pushSpec(
  today: ChannelTodayStatus,
  template: PushTemplate,
  note = PUSH_PLATFORM_NOTE,
  options: PushDisplayOptions = OPEN_IN_APP,
): ChannelSpec<PushTemplate> {
  return { ...spec(today, template, note), defaultPushOptions: options };
}

/* Email body pieces. Only p, h3, ul/ol/li, strong, em, a and one button. */
const p = (html: string) => `<p>${html}</p>`;
const h3 = (text: string) => `<h3>${text}</h3>`;
const ul = (...items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const ol = (...items: string[]) => `<ol>${items.map((i) => `<li>${i}</li>`).join("")}</ol>`;
const button = (hrefVariable: string, label: string) =>
  `<p><a data-email-button href="{{${hrefVariable}}}">${label}</a></p>`;

/** An email TO an operator. Signed by us, because it comes from the platform. */
function operatorEmail(subject: string, ...blocks: string[]): EmailTemplate {
  return {
    subject,
    body: [p("Hi {{tenant_admin_name}},"), ...blocks, p("The Drive247 team")].join(""),
  };
}

/** An email to OURSELVES. No greeting theatre; it is an internal alert. */
function platformEmail(subject: string, ...blocks: string[]): EmailTemplate {
  return {
    subject,
    body: [...blocks, p("<em>Sent by the Drive247 platform.</em>")].join(""),
  };
}

const push = (title: string, body: string): PushTemplate => ({ title, body });
const inApp = (title: string, body: string): InAppTemplate => ({ title, body });

function unique(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat()));
}

/* Variable sets offered in the picker. `tenant_id` is link-only and never offered. */
const TENANT_VARS = ["tenant_name", "tenant_slug", "tenant_contact_email", "tenant_admin_name"];
const PLAN_VARS = ["plan_name", "plan_amount", "plan_interval", "renewal_date"];
const REQUESTER_VARS = ["requester_name", "requester_email", "requester_role"];

/* -------------------------------------------------------------------------- */
/* The catalog                                                                 */
/* -------------------------------------------------------------------------- */

export const SYSTEM_NOTIFICATION_CATALOG: SystemNotificationItem[] = [
  /* ======================================================================== */
  /* Drive247 → Operator                                                       */
  /* ======================================================================== */
  {
    key: "operator_portal_ready",
    category: "onboarding",
    direction: "super_admin_to_admin",
    name: "Portal is ready",
    tooltip:
      "The first thing a self-serve operator hears from us: their portal address, their booking site and the email they sign in with.",
    when: "When a self-serve signup finishes provisioning and the operator's portal exists.",
    side: "automatic",
    recipient: "The person who signed up, at the address they typed",
    variables: unique(TENANT_VARS, ["plan_name", "portal_url", "booking_url", "sign_in_email"]),
    channels: {
      email: spec(
        "sends_some_paths",
        operatorEmail(
          "Your Drive247 portal is ready — {{tenant_name}}",
          p("{{tenant_name}} is set up on the <strong>{{plan_name}}</strong> plan. Here is everything you need."),
          ul(
            "Your portal: {{portal_url}}",
            "Your booking site: {{booking_url}}",
            "Sign in as: {{sign_in_email}}",
          ),
          p(
            "Sign in with the password you chose during signup. Your web address is fixed and cannot be changed later, so keep this email.",
          ),
          button("portal_url", "Open your portal"),
        ),
        "Only self-serve signups get it. An operator you set up from the Sales tab gets nothing — that flow hands you the login details to paste yourself. Sent best-effort either way: if it fails, provisioning still succeeded and the operator has no other copy of these addresses.",
      ),
      in_app: spec(
        "not_sent",
        inApp("Welcome to Drive247", "Your portal is ready. Start by adding your first vehicle."),
        "Nothing greets them inside the portal today.",
      ),
    },
    evidence: [
      "email sender: supabase/functions/signup-provision/index.ts:1474 (subject :1476)",
      "recipient: meta.email, the address typed during signup (index.ts:1475)",
      "trigger: the same function, once provisioning has succeeded; a send failure is logged and swallowed (index.ts:1480-1484)",
      "the OTHER provisioning path sends nothing: supabase/functions/create-sales-onboarding/index.ts:1497-1500 returns a ready-to-send client message instead of emailing",
      "addresses: portalUrl / bookingUrl are built from tenants.slug earlier in the same function",
    ],
  },
  {
    key: "subscription_link_sent",
    category: "billing",
    direction: "super_admin_to_admin",
    name: "Subscription payment link",
    tooltip:
      "The link an operator pays through. A fresh one is minted on every send, which is what makes \"resend\" work after the last one expired.",
    when: "When you send a subscription link from an operator's Subscription tab.",
    side: "admin dashboard",
    recipient: "The address you type in the composer",
    variables: unique(TENANT_VARS, PLAN_VARS, ["subscription_link_url", "link_expires_in"]),
    channels: {
      email: spec(
        "sends",
        operatorEmail(
          "Activate your Drive247 subscription — {{tenant_name}}",
          p("Here is the secure link to start your {{tenant_name}} subscription."),
          ul(
            "Plan: {{plan_name}}",
            "Amount: {{plan_amount}} per {{plan_interval}}",
          ),
          button("subscription_link_url", "Activate your subscription"),
          p("The link is valid for {{link_expires_in}}. If it expires, ask us for a new one."),
        ),
        "The URL is minted by the sender, never accepted from the composer — the plaintext token cannot be recovered once it is sent.",
      ),
    },
    evidence: [
      "email sender: supabase/functions/send-subscription-link-email/index.ts:145 (subject :147)",
      "trigger: apps/admin/app/admin/(protected)/rentals/[id]/page.tsx:590",
      "the recipient is recorded on the link as sent_to (send-subscription-link-email/index.ts:174)",
      "link lifetime: supabase/functions/_shared/subscription-link.ts:25 (LINK_TTL_MS = 24 hours)",
    ],
  },
  {
    key: "subscription_active_operator",
    category: "billing",
    direction: "super_admin_to_admin",
    name: "Subscription is active",
    tooltip:
      "Confirms the payment landed. An operator who paid through a link never passes the portal's success screen, so without this they get nothing at all.",
    when: "When an operator's subscription link settles and the subscription goes live.",
    side: "automatic",
    recipient: "The address the link was sent to, or the operator's contact email",
    variables: unique(TENANT_VARS, PLAN_VARS, ["portal_url"]),
    channels: {
      email: spec(
        "sends",
        operatorEmail(
          "Your Drive247 subscription is active — {{tenant_name}}",
          p("Thank you — <strong>{{tenant_name}}</strong> is now set up on Drive247."),
          ul(
            "Plan: {{plan_name}}",
            "Amount: {{plan_amount}} per {{plan_interval}}",
            "Renews: {{renewal_date}}",
          ),
          p("There is nothing else you need to do. Sign in whenever you are ready."),
          button("portal_url", "Go to your portal"),
          p("<em>Stripe has emailed your payment receipt separately.</em>"),
        ),
        "Skipped when neither the link address nor the contact email is set — a subscription can go live with nobody to tell.",
      ),
    },
    evidence: [
      "email sender: supabase/functions/notify-subscription-activated/index.ts:125 (subject :127)",
      "recipient: subscription_links.sent_to, else tenants.contact_email (index.ts:122); skipped at :133 when both are null",
      "trigger: supabase/functions/subscription-webhook/index.ts:755 and :1000, fire-and-forget after settle_subscription_link",
      "idempotent: the settler claims the row, so whichever webhook arrives first sends (subscription-webhook/index.ts:996-998)",
    ],
  },
  {
    key: "migration_email_operator",
    category: "migration",
    direction: "super_admin_to_admin",
    name: "Migration email",
    tooltip:
      "The letter asking an operator to connect their own Stripe account. You edit the recipient, subject and body before it goes.",
    when: "When you press Send on the migration composer for an operator.",
    side: "admin dashboard",
    recipient: "The address in the composer, prefilled from their branding or contact email",
    variables: unique(TENANT_VARS, ["portal_url"]),
    channels: {
      email: spec(
        "sends",
        operatorEmail(
          "Action needed: update your payment setup",
          p("We're upgrading how payments work on Drive247."),
          p(
            "Stripe now requires rental platforms in our region to settle payments through a Stripe account that <strong>you</strong> own and control directly — rather than one managed on your behalf.",
          ),
          h3("What this means for you"),
          ol(
            "Open your portal and go to Settings, then Payments.",
            "Connect your own Stripe account. It takes a few minutes.",
            "Payouts then land in your account directly.",
          ),
          button("portal_url", "Open your portal"),
        ),
        "Nothing here is automatic: the composer is prefilled and you edit it before sending.",
      ),
    },
    evidence: [
      "email sender: supabase/functions/send-migration-email/index.ts:142 (default subject :22, default body :24)",
      "trigger: apps/admin/components/admin/operator-prompt-card.tsx:163 (action 'send'); :145 loads the prefill through action 'preview'",
      "default recipient: tenant branding contact email, else tenants.contact_email (send-migration-email/index.ts:104-108)",
      "super-admin only: verifySuperAdmin at send-migration-email/index.ts:12",
    ],
  },
  {
    key: "migration_prompt_operator",
    category: "migration",
    direction: "super_admin_to_admin",
    name: "Migration prompt in their portal",
    tooltip:
      "The dialog an operator meets inside their own portal. Soft lets them put it off for a day; hard blocks them until they connect Stripe.",
    when: "When you set an operator's migration prompt to soft or hard.",
    side: "admin dashboard",
    recipient: "Every staff member of that operator",
    variables: unique(TENANT_VARS, ["portal_url"]),
    link: "/settings?tab=payments",
    channels: {
      in_app: spec(
        "sends",
        inApp(
          "Update your payment setup",
          "Stripe now requires you to settle payments through an account you own. Connect yours in Settings, then Payments.",
        ),
        "There is no email and no push: the prompt only appears when they open their portal. The migration email above is the copy that reaches them elsewhere.",
      ),
    },
    evidence: [
      "state, not a send: tenants.migration_blocker ('off' | 'soft' | 'hard')",
      "set in: apps/admin/components/admin/operator-prompt-card.tsx (blocker selector; the dismissal reset is at :130)",
      "read: apps/portal/src/hooks/use-migration-blocker.ts:31 (MIGRATION_COLUMNS)",
      "rendered: apps/portal/src/app/(dashboard)/layout.tsx:774 (MigrationBlockerDialog)",
      "soft hides for 24h after a dismissal: operator-prompt-card.tsx:186-196",
    ],
  },
  {
    key: "bonzah_approved_operator",
    category: "insurance",
    direction: "super_admin_to_admin",
    name: "Bonzah is active",
    tooltip:
      "Tells an operator their insurance integration went live, by email and in their portal bell.",
    when: "When a Bonzah reviewer approves an operator's application.",
    side: "admin dashboard",
    recipient: "The operator's admin email, and their whole team's portal bell",
    variables: unique(TENANT_VARS, ["partner_message", "application_name", "portal_url"]),
    link: "/settings?tab=insurance",
    channels: {
      email: spec(
        "sends",
        operatorEmail(
          "Bonzah is now active — {{tenant_name}}",
          p("Good news: your Bonzah insurance integration is live."),
          p("{{partner_message}}"),
          p("Customers can now add cover when they book, and you can see policies on each rental."),
          button("portal_url", "Open your insurance settings"),
        ),
      ),
      in_app: spec(
        "sends",
        inApp("Bonzah is active", "Your Bonzah insurance integration is now live."),
        OPERATOR_BELL_NOTE,
      ),
    },
    evidence: [
      "email sender: supabase/functions/send-bonzah-active-email/index.ts:93 (subject :96)",
      "bell sender: supabase/functions/bonzah-partner-review/index.ts:196 (notifications insert; link :202)",
      "trigger: supabase/functions/bonzah-partner-review/index.ts:207 (approve branch), fire-and-forget",
      "recipient: getTenantAdminEmail(tenant), supabase/functions/_shared/resend-service.ts",
      "the bell row carries user_id: null, so the whole team sees it (bonzah-partner-review/index.ts:198)",
    ],
  },
  {
    key: "bonzah_updates_needed_operator",
    category: "insurance",
    direction: "super_admin_to_admin",
    name: "Bonzah needs a few updates",
    tooltip:
      "Asks an operator for the missing pieces on their Bonzah application. Framed as next steps, never as a rejection.",
    when: "When a Bonzah reviewer sends an application back for updates.",
    side: "admin dashboard",
    recipient: "The operator's admin email, and their whole team's portal bell",
    variables: unique(TENANT_VARS, ["partner_message", "application_name", "portal_url"]),
    link: "/settings?tab=insurance",
    channels: {
      email: spec(
        "sends",
        operatorEmail(
          "A quick update to finish your Bonzah setup — {{tenant_name}}",
          p("Your Bonzah application is nearly there. We need a couple of things before it can go live."),
          p("{{partner_message}}"),
          p("Update your application in your portal and we'll pick it straight back up."),
          button("portal_url", "Finish your application"),
        ),
      ),
      in_app: spec(
        "sends",
        inApp("Bonzah application — a few updates needed", "{{partner_message}}"),
        OPERATOR_BELL_NOTE,
      ),
    },
    evidence: [
      "email sender: supabase/functions/send-bonzah-update-email/index.ts:95 (subject :98)",
      "bell sender: supabase/functions/bonzah-partner-review/index.ts:100 (notifications insert; link :106)",
      "trigger: supabase/functions/bonzah-partner-review/index.ts:111 (reject branch), fire-and-forget",
      "the reject reason is the bell message and the email body (bonzah-partner-review/index.ts:104)",
    ],
  },
  {
    key: "support_reply_operator",
    category: "support",
    direction: "super_admin_to_admin",
    name: "Support reply",
    tooltip:
      "What tells an operator we answered their ticket. Today that is only a badge in their sidebar — nothing is emailed or pushed.",
    when: "When you reply to an operator's support ticket.",
    side: "admin dashboard",
    recipient: "The operator who raised the ticket",
    variables: unique(TENANT_VARS, REQUESTER_VARS, ["ticket_reference", "ticket_subject"]),
    link: "/support?ticket={{ticket_reference}}",
    channels: {
      in_app: spec(
        "sends",
        inApp("Drive247 Support replied", "There's a new message on ticket {{ticket_reference}}."),
        "A count on the Support item in their sidebar, refreshed every 10 seconds while their tab is open. They have to be looking.",
      ),
      email: spec(
        "not_sent",
        operatorEmail(
          "We've replied to your support ticket {{ticket_reference}}",
          p("We've answered your ticket about <strong>{{ticket_subject}}</strong>."),
          p("Open Support in your portal to read the reply and carry on the conversation there."),
        ),
        "Nothing is emailed today. An operator who closes the tab does not find out until they come back.",
      ),
      push: pushSpec(
        "not_sent",
        push("Drive247 Support replied", "New message on ticket {{ticket_reference}}."),
        "Operator push exists, but no support reply uses it today.",
      ),
    },
    evidence: [
      "no sender: the reply is a stored message; the operator learns of it from an unread count",
      "counter: shared/trax-support/client.ts:31 (useSupportUnread)",
      "portal hook: apps/portal/src/hooks/use-support-messaging.ts:43 (unreadMessages, 10s poll)",
      "portal surface: apps/portal/src/components/shared/layout/app-sidebar-v2.tsx:280 (Support badge)",
      "the ticket-email worker only ever renders the NEW TICKET alert to us: supabase/functions/trax-support/support/ticket-email.ts:14",
    ],
  },

  /* ======================================================================== */
  /* Operator → Drive247                                                       */
  /* ======================================================================== */
  {
    key: "platform_activity_alert",
    category: "platform_activity",
    direction: "admin_to_super_admin",
    name: "Platform activity",
    tooltip:
      "\"Somebody did something\" on any tenant — payments, rentals, customers, logins. You pick which actions are worth a buzz on Platform push settings.",
    when: "When an audited action is recorded for any operator and a super admin has asked for that action.",
    side: "automatic",
    recipient: "Super admins whose devices are enrolled and who ticked that action",
    variables: unique(TENANT_VARS, ["actor_name", "activity_label", "activity_detail", "tenant_kind", "admin_audit_url"]),
    link: "/admin/audit-logs",
    channels: {
      push: pushSpec(
        "sends",
        push("{{tenant_name}} · {{activity_label}}", "by {{actor_name}} — {{activity_detail}}"),
        "The operator leads the title on purpose: on a lock screen the title is the only part guaranteed not to be cut off.",
        { openInApp: true, replacePrevious: true },
      ),
      email: spec(
        "not_sent",
        platformEmail(
          "{{tenant_name}} · {{activity_label}}",
          p("<strong>{{activity_label}}</strong> at {{tenant_name}}."),
          ul("Who: {{actor_name}}", "Detail: {{activity_detail}}", "Tenant: {{tenant_name}} ({{tenant_kind}})"),
          button("admin_audit_url", "Open the audit log"),
        ),
        "Push only today. An email copy would need its own recipient list and its own allowlist.",
      ),
    },
    evidence: [
      "push sender: supabase/functions/notify-platform-activity/index.ts:223 (sendWebPush); title built :179, body :186",
      "trigger: supabase/migrations/20260820140000_add_platform_activity_push.sql:134 (trg_audit_log_platform_push AFTER INSERT ON audit_logs) → net.http_post :118",
      "allowlist: platform_activity_prefs (same migration :49); filtered in the trigger and again at index.ts:140",
      "test tenants: platform_activity_prefs.include_test_tenants, applied at index.ts:160-165",
      "devices: push_subscriptions where audience='platform' and is_active (index.ts:191-196)",
      "settings screen: apps/admin/components/admin/PlatformPushSettings.tsx (curated action groups from :44)",
      "the allowlist starts EMPTY on purpose — ~40% of audit rows are UI telemetry (migration :56-59)",
    ],
  },
  {
    key: "rental_created_verdict",
    category: "platform_activity",
    direction: "admin_to_super_admin",
    name: "New rental verdict",
    tooltip:
      "A per-rental health check: were that operator's integrations live-ready at the moment the booking was created? One email per rental, across every tenant.",
    when: "When a rental is created for any operator.",
    side: "automatic",
    recipient: "One fixed platform alert address",
    variables: unique(TENANT_VARS, [
      "rental_reference",
      "rental_verdict",
      "health_severity",
      "tenant_kind",
      "admin_platform_rentals_url",
    ]),
    link: "/admin/platform-rentals?ref={{rental_reference}}",
    channels: {
      email: spec(
        "sends",
        platformEmail(
          "[Drive247] {{tenant_name}} · {{rental_reference}} · {{rental_verdict}}",
          p("<strong>{{health_severity}}</strong> — {{rental_verdict}}"),
          ul(
            "Operator: {{tenant_name}} ({{tenant_kind}})",
            "Rental: {{rental_reference}}",
          ),
          button("admin_platform_rentals_url", "Open the rental"),
        ),
        "One email per rental across every tenant, to a single hardcoded address. Volume follows total platform bookings, not your interest in them.",
      ),
      push: pushSpec(
        "not_sent",
        push("{{tenant_name}} · {{rental_reference}}", "{{health_severity}} — {{rental_verdict}}"),
        "Nothing pushes this today. The nearest live alert is Platform activity, which covers rental_created if you tick it.",
      ),
    },
    evidence: [
      "email sender: supabase/functions/platform-rental-notify/index.ts:163 (subject built :98)",
      "recipient: PLATFORM_ALERT_EMAIL, defaulting to one hardcoded address (index.ts:15)",
      "severity and reasons come from rentals.health_severity and rentals.creation_context (index.ts:84-96)",
      "trigger: trg_notify_platform_rental AFTER INSERT ON public.rentals → private.notify_platform_rental()",
      "NO repo migration defines that trigger; its live definition was transcribed at turo-bridge-poc/sql/03-foundation-schema.sql:2337-2343",
      "the test-tenant skip lives in the trigger function, which this repo does not contain (same file, :2344)",
    ],
  },
  {
    key: "subscription_activated_sales",
    category: "billing",
    direction: "admin_to_super_admin",
    name: "Subscription activated",
    tooltip:
      "Tells the sales list that a deal closed, without anyone watching a dashboard. The durable copy of the platform push.",
    when: "When an operator pays their subscription link and the subscription goes live.",
    side: "automatic",
    recipient: "The onboarding digest recipients",
    variables: unique(TENANT_VARS, PLAN_VARS, ["admin_tenant_url"]),
    channels: {
      email: spec(
        "sends",
        platformEmail(
          "Subscription activated — {{tenant_name}}",
          p("<strong>{{tenant_name}}</strong> paid their subscription link."),
          ul(
            "Plan: {{plan_name}}",
            "Amount: {{plan_amount}} per {{plan_interval}}",
            "Renews: {{renewal_date}}",
          ),
          button("admin_tenant_url", "Open the operator"),
        ),
        "Silently skipped when the digest recipient list is empty.",
      ),
      push: pushSpec(
        "not_sent",
        push("Subscription activated", "{{tenant_name}} — {{plan_name}}, {{plan_amount}} per {{plan_interval}}."),
        "Tick subscription_activated on Platform push settings and the audit row pushes it instead.",
      ),
    },
    evidence: [
      "email sender: supabase/functions/notify-subscription-activated/index.ts:161 (subject :163)",
      "recipients: admin_settings.onboarding_digest_emails (index.ts:144-147); skipped when empty (:170)",
      "one invocation emails both sides — the operator copy is the same function at :125",
      "trigger: supabase/functions/subscription-webhook/index.ts:755 and :1000",
      ".limit(1).single() on purpose: admin_settings holds four rows on this project (index.ts:139-142)",
    ],
  },
  {
    key: "cancellation_request_received",
    category: "billing",
    direction: "admin_to_super_admin",
    name: "Cancellation request",
    tooltip:
      "An operator asked to cancel their subscription. There is no self-service cancel button by decision — a person answers.",
    when: "When an operator submits a cancellation request from their billing screen.",
    side: "portal",
    recipient: "The notification email list on your Settings page",
    variables: unique(TENANT_VARS, REQUESTER_VARS, ["request_reason", "request_type", "admin_requests_url"]),
    link: "/admin/requests",
    channels: {
      email: spec(
        "sends",
        platformEmail(
          "Cancellation request — {{tenant_name}}",
          p("<strong>{{tenant_name}}</strong> has asked to cancel their subscription."),
          ul(
            "Asked by: {{requester_name}} ({{requester_email}})",
            "Reason: {{request_reason}}",
          ),
          button("admin_requests_url", "Open Requests"),
        ),
        "Sent once: the request row is stamped so a retry cannot re-mail the list. No recipients configured is a valid state, and the request still sits in the queue.",
      ),
      in_app: spec(
        "not_sent",
        inApp("Cancellation request", "{{tenant_name}} asked to cancel their subscription."),
        "Nothing marks it in this dashboard — it appears on Requests only if you open the page.",
      ),
      push: pushSpec(
        "not_sent",
        push("Cancellation request", "{{tenant_name}} asked to cancel their subscription."),
      ),
    },
    evidence: [
      "email sender: supabase/functions/notify-cancellation-request/index.ts:184 (subject :186)",
      "recipients: admin_settings.notification_emails (index.ts:105-110), edited at apps/admin/app/admin/(protected)/settings/page.tsx:211",
      "trigger: apps/portal/src/hooks/use-cancellation-request.ts:103, from apps/portal/src/components/subscription/cancel-subscription-card.tsx:37",
      "the row: go_live_requests with integration_type='subscription_cancellation' (supabase/migrations/20260907130000_cancellation_requests.sql:7)",
      "send-once: go_live_requests.notified_at (same migration :19); left null when every send failed, so a retry can still reach us",
      "queue screen: apps/admin/app/admin/(protected)/requests/page.tsx:143",
    ],
  },
  {
    key: "portal_feedback_received",
    category: "support",
    direction: "admin_to_super_admin",
    name: "Portal feedback",
    tooltip:
      "A bug, an idea or a note an operator's staff filed about our software from inside their portal.",
    when: "When someone on an operator's team submits feedback from their portal.",
    side: "portal",
    recipient: "The feedback recipient list, which is platform-wide",
    variables: unique(TENANT_VARS, REQUESTER_VARS, [
      "feedback_category",
      "feedback_message",
      "admin_feedback_url",
    ]),
    link: "/admin/feedbacks",
    channels: {
      email: spec(
        "sends",
        platformEmail(
          "[{{feedback_category}}] {{tenant_name}} — portal feedback",
          p("<strong>{{requester_name}}</strong> ({{requester_role}}) at {{tenant_name}} sent feedback."),
          ul("Type: {{feedback_category}}", "Reply to: {{requester_email}}"),
          p("{{feedback_message}}"),
          button("admin_feedback_url", "Open Feedback"),
        ),
        "Sent once per submission and stamped, so a retry or a double-click cannot re-mail the list.",
      ),
      push: pushSpec(
        "not_sent",
        push("{{tenant_name}} · {{feedback_category}}", "{{feedback_message}}"),
      ),
    },
    evidence: [
      "email sender: supabase/functions/notify-feedback-submission/index.ts:155 (subject :157)",
      "recipients: tenant_feedback_recipients — platform-wide, with no tenant column (supabase/migrations/20260803120000_add_tenant_feedback.sql:144)",
      "trigger: apps/portal/src/hooks/use-tenant-feedback.ts:176, from apps/portal/src/components/feedback/feedback-dialog.tsx:219",
      "idempotent on tenant_feedback.notified_at (notify-feedback-submission/index.ts:84), stamped only after a successful send (:167)",
      "review screen: apps/admin/app/admin/(protected)/feedbacks/page.tsx:135",
    ],
  },
  {
    key: "support_ticket_raised",
    category: "support",
    direction: "admin_to_super_admin",
    name: "New support ticket",
    tooltip:
      "An operator escalated to a person. The alert carries a redacted preview only — anything financial or identifying stays inside Support.",
    when: "When an operator submits a support ticket from their portal.",
    side: "portal",
    recipient: "One fixed support address, plus the Support badge in this dashboard",
    variables: unique(TENANT_VARS, REQUESTER_VARS, [
      "ticket_reference",
      "ticket_subject",
      "ticket_message",
      "admin_support_url",
    ]),
    link: "/admin/support?ticket={{ticket_reference}}",
    channels: {
      email: spec(
        "sends_some_paths",
        platformEmail(
          "[Drive247 Support] New ticket #{{ticket_reference}} — {{tenant_name}}",
          p("A new support ticket has been raised."),
          ul(
            "Ticket: {{ticket_reference}}",
            "Operator: {{tenant_name}}",
            "Submitted by: {{requester_name}}",
            "Subject: {{ticket_subject}}",
          ),
          p("{{ticket_message}}"),
          button("admin_support_url", "Open the ticket"),
        ),
        "The preview is redacted before it leaves: money and identity wording is replaced with a pointer back into Support. Delivery is queued, not immediate, and needs both the email worker switched on and its minute-by-minute job scheduled — the job file is still marked not applied. The badge below works either way, and a ticket is never lost: unsent jobs stay queued.",
      ),
      in_app: spec(
        "sends",
        inApp("New support ticket", "{{tenant_name}} raised #{{ticket_reference}} — {{ticket_subject}}."),
        "The Support badge in this dashboard, refreshed every few seconds.",
      ),
      push: pushSpec(
        "not_sent",
        push("New ticket · {{tenant_name}}", "{{ticket_subject}}"),
      ),
    },
    evidence: [
      "email envelope: supabase/functions/trax-support/support/ticket-email.ts:21 (subject, recipient and body)",
      "worker: supabase/functions/trax-support-notifications/index.ts:11 (recipient TRAX_SUPPORT_NOTIFICATION_TO; 503 unless TRAX_SUPPORT_EMAILS='enabled')",
      "queue: trax_support_submit_message (supabase/functions/trax-support/support/support-store.ts:35); claimed at ticket-email.ts:28",
      "schedule: ops/trax-support-notification-schedule.sql:16 (every minute) — that file is marked NOT APPLIED",
      "redaction: ticket-email.ts:9 (emailPreview) withholds anything financial or identifying",
      "trigger: apps/portal/src/components/support/portal-support.tsx:73",
      "admin badge: apps/admin/lib/use-support-messaging.ts:11 (useSupportUnread)",
    ],
  },
  {
    key: "onboarding_digest_daily",
    category: "onboarding",
    direction: "admin_to_super_admin",
    name: "Onboarding digest",
    tooltip:
      "The daily list of operators who are not fully live yet, with every checklist item shown for each of them.",
    when: "When the daily digest runs, or when you press Send now on the Onboarding page.",
    side: "automatic",
    recipient: "The onboarding digest recipients",
    variables: ["pending_count", "onboarded_count", "admin_onboarding_url"],
    link: "/admin/onboarding",
    channels: {
      email: spec(
        "sends",
        platformEmail(
          "Onboarding status — {{pending_count}} operators pending",
          p("<strong>{{pending_count}}</strong> still in onboarding · {{onboarded_count}} fully onboarded."),
          p("The full table, with every checklist item per operator, is in the dashboard."),
          button("admin_onboarding_url", "Open Onboarding"),
        ),
        "The operator table is built by the sender and is not a template field. Returns \"No digest recipients configured\" rather than sending when the list is empty.",
      ),
    },
    evidence: [
      "email sender: supabase/functions/onboarding-daily-digest/index.ts:168 (subject :170)",
      "recipients: admin_settings.onboarding_digest_emails (index.ts:144-150)",
      "trigger: pg_cron job named 'onboarding-daily-digest' (referenced by supabase/migrations/20260813120000_add_tenant_health_scores.sql:1023), or a super-admin JWT for the manual Send now",
      "the body is a built table of every not-yet-onboarded tenant (index.ts:68-101), not editable text",
    ],
  },
  {
    key: "bonzah_application_submitted",
    category: "insurance",
    direction: "admin_to_super_admin",
    name: "Bonzah application submitted",
    tooltip:
      "An operator finished their Bonzah application. The whole form, with links to their uploads, goes to the partner reviewer.",
    when: "When an operator submits their Bonzah onboarding form.",
    side: "portal",
    recipient: "The Bonzah reviewer address set on the Onboarding page",
    variables: unique(TENANT_VARS, ["application_name", "bonzah_console_url"]),
    channels: {
      email: spec(
        "sends",
        platformEmail(
          "Bonzah Application — {{application_name}}",
          p("<strong>{{tenant_name}}</strong> submitted their Bonzah business partner application."),
          p("Every section, with links to the uploaded documents, is below."),
          button("bonzah_console_url", "Review in the Bonzah console"),
        ),
        "The application's own sections are rendered by the sender, not from this template. A missing reviewer address fails the send outright rather than sending nowhere.",
      ),
      in_app: spec(
        "not_sent",
        inApp("Bonzah application submitted", "{{tenant_name}} submitted their Bonzah application."),
        "Nothing marks it here; the submission shows on the Bonzah onboarding screen when you open it.",
      ),
    },
    evidence: [
      "email sender: supabase/functions/send-bonzah-form-to-brandon/index.ts:285 (subject :287)",
      "the email's button goes to the Bonzah console, not to this dashboard (index.ts:207)",
      "recipient: admin_settings.bonzah_brandon_email (index.ts:254-258); a missing address returns 400 (:259)",
      "trigger: apps/portal/src/hooks/use-bonzah-onboarding.ts:152, fire-and-forget on the operator's submit",
      "a super admin may also send it by hand; the tenant's own staff may send their own (index.ts:248-251)",
      "it stamps brandon_sent_at on the onboarding checklist, which the digest then reports",
      "an AI verdict is kicked off alongside it: use-bonzah-onboarding.ts:144 (summarize-bonzah-submission)",
    ],
  },
  {
    key: "go_live_request_received",
    category: "onboarding",
    direction: "admin_to_super_admin",
    name: "Go-live request",
    tooltip:
      "An operator asked to switch an integration to live. Nothing tells us today — the request only appears if someone opens the Requests page.",
    when: "When an operator asks to take an integration live from their dashboard.",
    side: "portal",
    recipient: "Nobody is alerted. It waits on the Requests page.",
    variables: unique(TENANT_VARS, REQUESTER_VARS, ["request_type", "request_reason", "admin_requests_url"]),
    link: "/admin/requests",
    channels: {
      email: spec(
        "not_sent",
        platformEmail(
          "Go-live request — {{tenant_name}}",
          p("<strong>{{tenant_name}}</strong> asked to take {{request_type}} live."),
          ul("Asked by: {{requester_name}} ({{requester_email}})", "Note: {{request_reason}}"),
          button("admin_requests_url", "Open Requests"),
        ),
        "Nothing is sent today. The cancellation request above goes through the same queue and does email — this type does not.",
      ),
      in_app: spec(
        "not_sent",
        inApp("Go-live request", "{{tenant_name}} asked to take {{request_type}} live."),
        "No badge and no count: the row is only visible once you open Requests.",
      ),
      push: pushSpec(
        "not_sent",
        push("Go-live request", "{{tenant_name}} asked to take {{request_type}} live."),
      ),
    },
    evidence: [
      "no sender at all: nothing is emailed, pushed or belled for this request type",
      "trigger: apps/portal/src/hooks/use-go-live-request.ts:52 (INSERT into go_live_requests), from apps/portal/src/components/dashboard/command-center.tsx:276",
      "the only surface: apps/admin/app/admin/(protected)/requests/page.tsx:143",
      "approving or rejecting is silent too: requests/page.tsx:171-177 updates the row and tells the operator nothing",
      "contrast: the same table's 'subscription_cancellation' rows DO email, through notify-cancellation-request",
    ],
  },

  /* ======================================================================== */
  /* Drive247 → Everyone                                                       */
  /* ======================================================================== */
  {
    key: "portal_announcement",
    category: "announcements",
    direction: "super_admin_to_everyone",
    name: "Portal announcement",
    tooltip:
      "Feature cards and system notices inside operators' portals. Write and target them on the Announcements page — they are not edited here.",
    when: "When you publish an announcement and an operator's portal next reads it.",
    side: "admin dashboard",
    recipient: "Portal staff of the operators you target — never their renters",
    variables: [],
    link: "/admin/announcements",
    managedElsewhere: { screen: "Announcements", href: "/admin/announcements" },
    channels: {
      in_app: spec(
        "sends",
        inApp("Announcement", "Written per announcement on the Announcements page."),
        "In-app only: a card on their dashboard, a dialog, or a full-width banner. Nothing is emailed or pushed, and delivery is polling, so a change reaches them within a poll rather than instantly.",
      ),
    },
    evidence: [
      "authored: apps/admin/components/announcements/announcements-page.tsx, saved through admin_save_portal_announcement (apps/admin/lib/announcements/api.ts:255)",
      "read: apps/portal/src/hooks/use-portal-announcements.ts (RPC get_portal_announcements)",
      "schema, targeting and RLS: ops/portal_announcements.sql (applied to production Sep 17 2026)",
      "targeting is all / selected tenants / a live smart filter; the server does it, the portal never re-derives it",
      "renters cannot read these tables at all, by construction (ops/portal_announcements.sql, 'WHO CAN DO WHAT')",
      "delivery is polling, never realtime or cron (use-portal-announcements.ts, 'DELIVERY')",
    ],
  },
  {
    key: "customer_announcement",
    category: "announcements",
    direction: "super_admin_to_everyone",
    name: "Customer announcement",
    tooltip:
      "The bell and pop-up in every operator's customer portal, for renters. Live on the renter side, but this repo has no screen that writes them.",
    when: "When a published customer announcement is active and a renter opens their portal.",
    side: "booking site",
    recipient: "Every signed-in renter of every operator, with no audience filter",
    variables: [],
    managedElsewhere: { screen: "Announcements", href: "/admin/announcements" },
    channels: {
      in_app: spec(
        "sends",
        inApp("Announcement", "Written per announcement, in the row itself."),
        "Reaches renters, not operators. Nothing in this dashboard writes these rows today — see the evidence before promising anyone an announcement.",
      ),
    },
    evidence: [
      "read: apps/booking/src/hooks/use-customer-announcements.ts:55 (feature_announcements, published + active), view state at :64",
      "surfaces: apps/booking/src/components/customer-portal/announcements/AnnouncementsBell.tsx:22 and AnnouncementModalGate.tsx:8 (auto modal for 'major')",
      "realtime: use-customer-announcements.ts:105 subscribes to every change on the table",
      "NO authoring screen: nothing under apps/admin references feature_announcements — only apps/booking, the generated types files, and the portal's removal guard",
      "the portal stopped reading this table on Sep 16 2026: apps/portal/src/__tests__/lib/announcements-legacy-removed.test.ts",
      "left untouched by ops/portal_announcements.sql on purpose, so operator content cannot leak to renters",
    ],
  },
  {
    key: "maintenance_banner",
    category: "announcements",
    direction: "super_admin_to_everyone",
    name: "Maintenance banner",
    tooltip:
      "The one message that reaches both audiences at once: every operator portal and every booking site. Switched on from your Settings page.",
    when: "When you turn the global maintenance banner on.",
    side: "admin dashboard",
    recipient: "Every operator portal and every booking site",
    variables: ["banner_message"],
    link: "/admin/settings",
    managedElsewhere: { screen: "Settings", href: "/admin/settings" },
    channels: {
      in_app: spec(
        "sends",
        inApp("Maintenance", "{{banner_message}}"),
        "A banner, not a bell row. It appears within about a minute of being switched on, and an operator's own banner takes priority over yours.",
      ),
    },
    evidence: [
      "authored: apps/admin/app/admin/(protected)/settings/page.tsx:260 ('across all tenant portals and booking sites')",
      "columns: admin_settings.maintenance_banner_enabled / _message / _type (settings/page.tsx:31-33)",
      "operator side: apps/portal/src/hooks/use-maintenance-banner.ts:24 → apps/portal/src/components/dashboard/maintenance-banner.tsx:7",
      "renter side: apps/booking/src/hooks/use-maintenance-banner.ts:18 → apps/booking/src/components/MaintenanceBanner.tsx:7",
      "polled: staleTime 30s, refetchInterval 60s on both sides",
      "a tenant's own banner wins over the global one (use-maintenance-banner.ts:55)",
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

const ITEM_BY_KEY: ReadonlyMap<string, SystemNotificationItem> = new Map(
  SYSTEM_NOTIFICATION_CATALOG.map((item) => [item.key, item]),
);

/** The catalog item with this key, or undefined. */
export function getSystemNotificationItem(key: string): SystemNotificationItem | undefined {
  return ITEM_BY_KEY.get(key);
}

/** The items of one direction and category, in catalog order. */
export function systemItemsFor(
  direction: SystemNotificationDirection,
  category: SystemNotificationCategoryId,
): SystemNotificationItem[] {
  return SYSTEM_NOTIFICATION_CATALOG.filter(
    (item) => item.direction === direction && item.category === category,
  );
}

/** Every category that holds at least one item in this direction, in display order. */
export function systemCategoriesFor(
  direction: SystemNotificationDirection,
): SystemNotificationCategory[] {
  return SYSTEM_NOTIFICATION_CATEGORIES.filter((category) =>
    SYSTEM_NOTIFICATION_CATALOG.some(
      (item) => item.direction === direction && item.category === category.id,
    ),
  );
}
