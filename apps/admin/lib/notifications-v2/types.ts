/**
 * Notifications v2, SYSTEM set: the shared contract for the super admin
 * dashboard.
 *
 * The operator portal already has the main set (customer ↔ the rental
 * company). This is the second set the team lead asked for
 * (docs/notifications-v2/meeting-transcript-en.md §3.5, 07:30–08:30 and
 * 16:39–16:48): "exactly the same thing we'll build for ourselves in the super
 * admin dashboard".
 *
 * Three directions, from Drive247's point of view:
 *   super admin → admin      we do something, the operator is told
 *   admin → super admin      an operator does something, we are told
 *   super admin → everyone   all operators AND all of their customers
 *
 * This file is the admin's own copy of the contract, not an import of the
 * portal's. The two apps are separate Next projects with separate dependency
 * trees and no shared package (`packages/*` is declared but unused — CLAUDE.md),
 * and the shapes differ where the scope differs: settings here are PLATFORM
 * scoped, so the stored row has NO tenant_id.
 *
 * Twins in apps/portal/src/lib/notifications-v2/types.ts where the shape is the
 * same (channels, templates, push options, ChannelSpec). Change one, consider
 * the other.
 *
 * Pure types and constants: no React, no Supabase, no I/O.
 */

/* -------------------------------------------------------------------------- */
/* Channels                                                                    */
/* -------------------------------------------------------------------------- */

/** The three channels the lead asked for (transcript §3.2, §3.7). */
export type NotificationChannel = "email" | "push" | "in_app";

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ["email", "push", "in_app"] as const;

/* -------------------------------------------------------------------------- */
/* Directions and audiences                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Who the notification travels between, from Drive247's point of view.
 * Named for the two parties rather than for "us" and "them", so the value
 * still reads correctly in a log line or a database row.
 *
 * - `platform_to_operator`: we do something (suspend an account, publish a
 *   policy, change a plan) → the rental operator's staff are told.
 * - `operator_to_platform`: an operator does something (subscribes, finishes
 *   Stripe onboarding, raises support) → we are told.
 * - `platform_to_everyone`: a broadcast from us to all operators AND all of
 *   their customers at once (transcript 07:30–08:30, "Super admin → Everyone").
 */
export type SystemNotificationDirection = "platform_to_operator" | "operator_to_platform" | "platform_to_everyone";

/** Display order of the three direction groups on the page. */
export const SYSTEM_NOTIFICATION_DIRECTIONS: readonly SystemNotificationDirection[] = [
  "platform_to_operator",
  "operator_to_platform",
  "platform_to_everyone",
] as const;

/** Who actually receives a notification of a given direction. */
export type SystemAudience = "operators" | "platform" | "everyone";

/**
 * The audience each direction reaches. A pure mapping, derived from the
 * direction's own meaning — not a policy choice, so it lives with the types
 * rather than in the catalog.
 */
export const SYSTEM_DIRECTION_AUDIENCE: Record<SystemNotificationDirection, SystemAudience> = {
  platform_to_operator: "operators",
  operator_to_platform: "platform",
  platform_to_everyone: "everyone",
};

/**
 * The heading for one direction group. The catalog supplies the copy (labels
 * are content, and catalog.ts owns content); this is only its shape.
 */
export interface SystemDirectionGroup {
  id: SystemNotificationDirection;
  /** e.g. "Drive247 → Operators". */
  label: string;
  /** One short sentence under the heading. */
  description: string;
}

/** Where the triggering action happens, in plain words (transcript §3.12). */
export type SystemNotificationSide =
  | "super_admin" // someone on our side does it in this dashboard
  | "portal" // an operator does it in their portal
  | "automatic"; // a scheduled job, Stripe, or another provider does it

/**
 * The shape of a category heading. The ids themselves and their copy live in
 * catalog.ts, so `id` is a plain string here: a catalog that narrows it to its
 * own union still satisfies this.
 */
export interface NotificationCategory {
  id: string;
  label: string;
  /** One short sentence under the heading. */
  description: string;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Email: subject (plain text with {{variables}}) + body. The body is HTML from
 * the editor: p, h2, h3, ul/ol/li, blockquote, hr, strong, em, u, a, and
 * `<a data-email-button>` for a call-to-action button. Variables are literal
 * `{{key}}` text in the stored HTML.
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
 * What a push can control on the web (build-spec §Push display). The OS and the
 * user decide banner vs lock screen; a site can only ask for these. `send-push`
 * reads requireInteraction and silent directly, collapses repeats through its
 * `tag`, and adds the "Open in app" action.
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
  | "sends" // sent today by existing code
  | "sends_some_paths" // sent today, but not from every path that triggers the event (explain in `note`)
  | "not_sent"; // nothing sends this on this channel today

export interface ChannelSpec<T extends ChannelTemplate = ChannelTemplate> {
  /** Default on/off when nothing has been saved. */
  defaultEnabled: boolean;
  /** The meaningful default the lead asked for (§3.11). */
  defaultTemplate: T;
  /** What happens today (evidence in the catalog item's `evidence`). */
  today: ChannelTodayStatus;
  /** Plain-English caveat shown in the tooltip. */
  note?: string;
  /** Default push display options (push only). */
  defaultPushOptions?: PushDisplayOptions;
}

/* -------------------------------------------------------------------------- */
/* Catalog items                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One notification in the system set. catalog.ts (another engineer) builds the
 * list; every module here only reads this shape, so the catalog may narrow
 * `category` to its own union and still fit.
 */
export interface SystemNotificationItem {
  /** snake_case, matches ^[a-z][a-z0-9_]{2,63}$ (the DB CHECK). Never rename once shipped. */
  key: string;
  /** A category id from catalog.ts. */
  category: string;
  direction: SystemNotificationDirection;
  /** Short name that makes sense on its own, e.g. "Account suspended" (§3.6). */
  name: string;
  /** Tooltip text: one or two plain sentences (§3.6). */
  tooltip: string;
  /** Plain English "when it's sent", starting with "When" (§3.12). */
  when: string;
  /** Where the triggering action happens (§3.12). */
  side: SystemNotificationSide;
  /** Who receives it, in words: "The operator's team" / "Us" / "Everyone". */
  recipient: string;
  /** Only the channels this notification can go out on. At least one. */
  channels: Partial<{
    email: ChannelSpec<EmailTemplate>;
    push: ChannelSpec<PushTemplate>;
    in_app: ChannelSpec<InAppTemplate>;
  }>;
  /** Variable keys usable in this item's templates (must exist in SYSTEM_NOTIFICATION_VARIABLES). */
  variables: string[];
  /** Deep link a push / bell opens, relative to the right app, may use {{variables}}. */
  link?: string;
  /**
   * Evidence that this event is real (the lead forbade AI-invented entries,
   * transcript §3.4): file:line of the sender and of the trigger. Not shown in
   * the UI; kept for review and for the runtime work.
   */
  evidence: string[];
}

/* -------------------------------------------------------------------------- */
/* Variables                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately NOT here. `SystemNotificationVariable`, `SystemVariableGroup`
 * and the `{{key}}` scanner live in ./variables.ts, which owns the whole list
 * and its example values. A second copy of those shapes in this file would be
 * a second answer to "what groups are there", so there is none.
 */

/* -------------------------------------------------------------------------- */
/* Stored settings (table public.platform_notification_settings)               */
/* -------------------------------------------------------------------------- */

/**
 * One row per (notification_key, channel) — PLATFORM scope, so unlike the
 * portal's tenant_notification_settings there is NO tenant_id: these settings
 * are Drive247's own, the same for every tenant, and the primary key is
 * (notification_key, channel).
 *
 * A NULL column means "use the catalog default". A missing row means "all
 * defaults". Reset = DELETE the row. Same NULL-means-default model as the
 * portal's table, so settings-model.ts reads almost identically.
 *
 * The table itself is the backend engineer's (additive, ops/*.sql, NOT
 * APPLIED). Nothing here writes to a database.
 */
export interface PlatformNotificationSettingRow {
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

/* -------------------------------------------------------------------------- */
/* Sender identity                                                             */
/* -------------------------------------------------------------------------- */

export const EMAIL_SENDER_DOMAIN = "drive-247.com";

/**
 * An override of who platform email comes from. Optional in every field: with
 * nothing saved, the default in settings-model.ts (today's real platform
 * sender) is what sends. Where this is stored — if anywhere — is the backend
 * engineer's call; the shape is here so the page and the model agree.
 */
export interface PlatformEmailSender {
  from_name: string | null;
  /** Local part only; the address is `${from_local_part}@drive-247.com`. */
  from_local_part: string | null;
  reply_to: string | null;
}

/* -------------------------------------------------------------------------- */
/* Email branding (what the layout needs)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Structurally identical to `EmailLayoutBrand` in email-layout.ts, which may
 * not import anything because the same file has to run in Deno.
 */
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
      /** Recipient; the UI pre-fills the signed-in super admin's email (§3.8). */
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
