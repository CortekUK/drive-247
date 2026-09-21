/**
 * Notifications v2: the shared contract.
 *
 * The v2 Settings → Notifications page (northwind canary only) lists every
 * notification the platform sends, grouped by direction and then by category,
 * with per-channel switches (email / push / in-app), a template per channel,
 * previews and a Send test. Every module under `lib/notifications-v2/`, the
 * page under `components/settings-v2/notifications-v2/`, the hooks and the
 * `notification-test-v2` edge function agree on the shapes in this file.
 *
 * Spec: docs/notifications-v2/meeting-transcript-en.md (the team lead's
 * walkthrough) and docs/notifications-v2/build-spec.md (decisions and
 * contracts). v2 only: nothing in v1 imports this file.
 */

/* -------------------------------------------------------------------------- */
/* Channels, directions, categories                                            */
/* -------------------------------------------------------------------------- */

/** The three channels the lead asked for (transcript §3.2). */
export type NotificationChannel = "email" | "push" | "in_app";

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ["email", "push", "in_app"] as const;

/**
 * Who the notification goes to, from the operator's point of view (§3.5).
 * - `customer_to_team`: something a customer did (or an automatic alert about
 *   one of their rentals) → the rental company's staff are told.
 * - `team_to_customer`: the rental company (a staff action, or an automatic
 *   send on the company's behalf) → the customer is told.
 * The system set (super admin ↔ admin, super admin → everyone) comes later and
 * is deliberately NOT a value here yet.
 */
export type NotificationDirection = "customer_to_team" | "team_to_customer";

/** Where the triggering action happens, in plain words for the operator (§3.12). */
export type NotificationSide =
  | "booking_site" // the customer does it on the booking site / customer portal
  | "portal" // a staff member does it in this portal
  | "automatic"; // a scheduled job, payment provider or e-sign callback does it

/** Stable category ids. Order in `NOTIFICATION_CATEGORIES` is display order. */
export type NotificationCategoryId =
  | "booking"
  | "rental"
  | "payments"
  | "agreements"
  | "verification"
  | "keys"
  | "fines"
  | "insurance"
  | "enquiries";

export interface NotificationCategory {
  id: NotificationCategoryId;
  label: string;
  /** One short sentence under the heading. */
  description: string;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Email: subject (plain text with {{variables}}) + body. The body is the HTML
 * the Notion-like editor produces: p, h2, h3, ul/ol/li, blockquote, hr, strong,
 * em, u, a, and `<a data-email-button>` for a call-to-action button. Variables
 * are written as literal `{{key}}` text in the stored HTML (the editor shows
 * them as chips but serialises them back to `{{key}}`).
 */
export interface EmailTemplate {
  subject: string;
  body: string;
}

/** Push: title + body, plain text with {{variables}} (§3.9). */
export interface PushTemplate {
  title: string;
  body: string;
}

/** In-app (bell): title + message, plain text with {{variables}} (§3.2). */
export interface InAppTemplate {
  title: string;
  body: string;
}

export type ChannelTemplate = EmailTemplate | PushTemplate | InAppTemplate;

/**
 * What a push can control on the web (see build-spec §Push display). The OS and
 * the user decide banner vs lock screen; a site can only ask for these.
 */
export interface PushDisplayOptions {
  /** Stays on screen until dismissed (Chromium desktop; ignored on phones). */
  requireInteraction?: boolean;
  /** No sound or vibration. */
  silent?: boolean;
  /** A new one replaces the previous one of the same kind instead of stacking. */
  replacePrevious?: boolean;
  /** Adds an "Open in app" button (Chromium only; tapping the body always opens). */
  openInApp?: boolean;
}

/** What today's code does on a channel, so the page and the runtime plan stay honest. */
export type ChannelTodayStatus =
  | "sends" // sent today by existing code for every tenant
  | "sends_some_paths" // sent today, but not from every path that triggers the event (explain in `todayNote`)
  | "not_sent"; // nothing sends this on this channel today

export interface ChannelSpec<T extends ChannelTemplate = ChannelTemplate> {
  /** Default on/off when the tenant has saved nothing. */
  defaultEnabled: boolean;
  /** The meaningful default the lead asked for (§3.11). */
  defaultTemplate: T;
  /** What happens today (evidence in the catalog item's `evidence`). */
  today: ChannelTodayStatus;
  /** Plain-English caveat shown in the tooltip, e.g. "Customers only get push after turning it on in their portal." */
  note?: string;
  /** Default push display options (push only). */
  defaultPushOptions?: PushDisplayOptions;
}

/* -------------------------------------------------------------------------- */
/* Catalog items                                                               */
/* -------------------------------------------------------------------------- */

export interface NotificationItem {
  /** snake_case, matches ^[a-z][a-z0-9_]{2,63}$ (the DB CHECK). Never rename once shipped. */
  key: string;
  category: NotificationCategoryId;
  direction: NotificationDirection;
  /** Short operator-facing name, e.g. "Booking confirmed". Makes sense on its own (§3.6). */
  name: string;
  /** Tooltip text: one or two plain sentences (§3.6). */
  tooltip: string;
  /** Plain English "when it's sent", starting with "When" — e.g. "When you approve a booking." (§3.12) */
  when: string;
  /** Where the triggering action happens (§3.12). */
  side: NotificationSide;
  /** Who receives it, in words: "The customer" / "Your team". */
  recipient: string;
  /** Only the channels this notification can go out on. At least one. */
  channels: Partial<{
    email: ChannelSpec<EmailTemplate>;
    push: ChannelSpec<PushTemplate>;
    in_app: ChannelSpec<InAppTemplate>;
  }>;
  /** Variable keys usable in this item's templates (must exist in NOTIFICATION_VARIABLES). */
  variables: string[];
  /** Deep link a push / bell opens, relative to the right app, may use {{variables}}. */
  link?: string;
  /**
   * Evidence that this event is real (the lead forbade AI-invented entries,
   * transcript §3.4): file:line of the sender and of the trigger. Not shown to
   * operators; kept for review and for the runtime work.
   */
  evidence: string[];
}

/* -------------------------------------------------------------------------- */
/* Variables                                                                   */
/* -------------------------------------------------------------------------- */

export type NotificationVariableGroup = "customer" | "rental" | "vehicle" | "money" | "company" | "links";

export interface NotificationVariable {
  /** `{{key}}`. Reuse the server's existing keys (email-template-service resolveEmailData) wherever one exists. */
  key: string;
  label: string;
  description: string;
  group: NotificationVariableGroup;
  /** Example shown in previews and test sends (§3.11 "700 USD"). */
  example: string;
}

/* -------------------------------------------------------------------------- */
/* Stored settings (table public.tenant_notification_settings)                 */
/* -------------------------------------------------------------------------- */

/**
 * One row per (tenant, notification_key, channel). A NULL column means "use the
 * catalog default". A missing row means "all defaults". Reset = DELETE the row.
 */
export interface NotificationSettingRow {
  tenant_id: string;
  notification_key: string;
  channel: NotificationChannel;
  enabled: boolean | null;
  /** email only */
  subject: string | null;
  /** push / in_app only */
  title: string | null;
  /** email: HTML body; push / in_app: plain text */
  body: string | null;
  push_options: PushDisplayOptions;
  updated_at?: string;
  updated_by?: string | null;
}

/** The merged, effective state of one channel of one item (stored ⊕ default). */
export interface EffectiveChannelState {
  enabled: boolean;
  template: ChannelTemplate;
  pushOptions: PushDisplayOptions;
  /** True when the template differs from the catalog default. */
  customised: boolean;
}

/** Sender identity (table public.tenant_email_sender). The domain is fixed. */
export interface EmailSenderSettings {
  from_name: string | null;
  /** Local part only; the address is `${from_local_part}@drive-247.com`. */
  from_local_part: string | null;
  reply_to: string | null;
}

export const EMAIL_SENDER_DOMAIN = "drive-247.com";

/* -------------------------------------------------------------------------- */
/* Email branding (what the layout needs)                                      */
/* -------------------------------------------------------------------------- */

export interface EmailBrand {
  companyName: string;
  logoUrl?: string | null;
  /** Header background, #rrggbb. */
  primaryColor?: string | null;
  /** Buttons and links, #rrggbb. */
  accentColor?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Send test (edge function notification-test-v2)                              */
/* -------------------------------------------------------------------------- */

export type NotificationTestRequest =
  | {
      channel: "email";
      notificationKey: string;
      /** Recipient; the UI pre-fills the signed-in operator's email (§3.8). */
      to: string;
      /** Already filled with example values by the client. */
      subject: string;
      /** Body HTML already filled with example values; the server wraps it in the layout and sanitises it. */
      bodyHtml: string;
    }
  | {
      channel: "push";
      notificationKey: string;
      title: string;
      body: string;
      url?: string;
      pushOptions?: PushDisplayOptions;
    };

export interface NotificationTestResponse {
  success: boolean;
  /** push: devices reached; email: 1 on success */
  sent?: number;
  failed?: number;
  /** Operator-facing sentence, e.g. "Sent to jo@example.com." */
  message?: string;
  error?: string;
  code?: string;
}
