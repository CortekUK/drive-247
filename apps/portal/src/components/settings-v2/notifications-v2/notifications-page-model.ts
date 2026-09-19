/**
 * Notifications v2: the page's own rules, as pure functions (no React, no
 * Supabase), so the page stays thin and every decision is unit-tested.
 *
 *   - the copy the page shows (one place, so tests assert against it);
 *   - the two direction groups and how the catalog fills them;
 *   - the plain-English line under each item ("When … · Portal · Your team");
 *   - the page's edit state: `ChannelDrafts` (one ChannelEdit per edited
 *     item + channel) laid over what is stored, the Save diff, and the first
 *     problem that must block Save.
 *
 * Storage rules live in lib/notifications-v2/settings-model (effectiveChannel,
 * rowFromEdit, diffEdits, validateTemplate); this file only composes them.
 * v2 only: rendered by notifications-page-v2.tsx (northwind canary).
 */

import { NOTIFICATION_CATEGORIES, getNotificationItem, itemsFor } from "@/lib/notifications-v2/catalog";
import {
  diffEdits,
  effectiveChannel,
  normalisePushOptions,
  rowFromEdit,
  settingKey,
  validateTemplate,
  type ChannelDraft,
  type ChannelEdit,
  type PushOptionKey,
  type SettingsDiff,
} from "@/lib/notifications-v2/settings-model";
import {
  NOTIFICATION_CHANNELS,
  type ChannelSpec,
  type ChannelTemplate,
  type ChannelTodayStatus,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationDirection,
  type NotificationItem,
  type NotificationSettingRow,
  type NotificationSide,
  type NotificationTestRequest,
  type NotificationTestResponse,
} from "@/lib/notifications-v2/types";

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/** The key the page registers with the settings page's save bar. */
export const NOTIFICATIONS_SAVE_KEY = "notifications";

export const NOTIFICATIONS_PAGE_COPY = {
  /**
   * D18: settings are stored, sending does not switch over yet. It names the
   * sender too: the Email card changes the From line of test emails only.
   */
  notice:
    "What you save here is kept, and Send test uses it. Live messages still go out as they do today, from today's sender address, until sending switches over.",
  /** Shown instead of the notice while the storage SQL is not applied (`tableMissing`). */
  storageOff: "Saving turns on once notifications storage is switched on.",
  storageOffDetail:
    "Until then you can try changes here, preview them and send tests. Live messages still go out as they do today.",
  /** Shown beside `storageOff` once there are edits that can't be saved yet. */
  storageOffEdits: "Your changes on this page won't be kept when you leave.",
  channelsTitle: "Channels",
  channelsDescription: "How notifications reach people. Set these up once.",
  inAppTitle: "In-app",
  inAppDescription: "The bell. Nothing to set up: it's always on.",
  inAppTeam: "Your team's bell is at the top of this portal. Everyone on your team sees it when they sign in.",
  inAppCustomer:
    "Customers have a bell in their customer portal on your booking site. Only customers with an account there see it.",
  inAppNoTest: "Shows in the bell; there's no test send for in-app.",
  /** On a team item about the team's own action (TEAM_ACTION_ITEM_KEYS). */
  teamAction: "Team action",
  teamActionTooltip:
    "Someone on your team does this, not the customer. This tells the rest of your team it happened.",
  /** The live settings that still decide today's sending (D18), kept on this page. */
  todayTitle: "What's sent today",
  todayDescription:
    "Until sending switches over, these still decide which alerts go out. Each one saves as soon as you change it.",
  pushPhoneNote: "Banner or lock screen is chosen on each phone, not here.",
  loading: "Loading notifications",
  loadThing: "your notification settings",
  close: "Close",
  reset: "Reset to default",
  edited: "Edited",
  unsaved: "Unsaved",
  subject: "Subject",
  message: "Message",
  title: "Title",
  displayOptions: "How it shows",
  noTestForViewer: "View only. Ask an admin to send tests.",
  noTestForRole: "Your role can't send tests. Ask an admin.",
  fixToTest: "Fix the problems above to send a test.",
} as const;

/* -------------------------------------------------------------------------- */
/* Direction groups and categories                                             */
/* -------------------------------------------------------------------------- */

export interface NotificationDirectionGroup {
  direction: NotificationDirection;
  /** Section anchor: the element id is `settings-<anchor>`. */
  anchor: string;
  title: string;
  description: string;
  /** The lead's words for the direction, shown on every item (transcript §3.5, §3.12). */
  chip: string;
}

export const NOTIFICATION_DIRECTION_GROUPS: readonly NotificationDirectionGroup[] = [
  {
    direction: "customer_to_team",
    anchor: "notifications-customer-to-team",
    title: "Customer → Your team",
    description: "What your team is told when customers act, plus alerts about their rentals.",
    chip: "Customer → Admin",
  },
  {
    direction: "team_to_customer",
    anchor: "notifications-team-to-customer",
    title: "Your team → Customer",
    description: "What your customers are told, whether you act or it happens automatically.",
    chip: "Admin → Customer",
  },
];

/** The Channels section and the two setup cards an old `?tab=` opens (settings-shell-state V2_NOTIFICATIONS_SECTIONS). */
export const NOTIFICATIONS_CHANNELS_ANCHOR = "notifications-channels";
export const NOTIFICATIONS_EMAIL_ANCHOR = "notifications-email";
export const NOTIFICATIONS_PUSH_ANCHOR = "notifications-push";
/** "What's sent today": the live team email categories and reminder settings. */
export const NOTIFICATIONS_TODAY_ANCHOR = "notifications-today";

/**
 * "Your team is told" items about something your team itself did (the catalog
 * calls them heads-ups). They sit under "Customer → Your team" with the
 * customer's own actions, so each gets a small "Team action" label. Chosen by
 * hand from the catalog (transcript §3.4), not by a rule: every portal-side
 * team item, plus the refund record, which is almost always a refund someone
 * on your team issued (the payment provider can also issue one).
 */
export const TEAM_ACTION_ITEM_KEYS: ReadonlySet<string> = new Set([
  "booking_added_team",
  "rental_started_team",
  "rental_extended_team",
  "rental_completed_team",
  "refund_processed_team",
  "fine_recorded_team",
]);

export const isTeamActionItem = (item: Pick<NotificationItem, "key">) => TEAM_ACTION_ITEM_KEYS.has(item.key);

/**
 * The "Push on this device" card's Send test: through notification-test-v2 so
 * the test carries the Open in app button (send-push can't send actions). The
 * title, message and link are the card's own (PUSH_SETUP_TEST_MESSAGE).
 */
export const PUSH_SETUP_TEST_KEY = "push_setup_test";

export function pushSetupTestRequest(message: { title: string; body: string; url?: string }): NotificationTestRequest {
  return {
    channel: "push",
    notificationKey: PUSH_SETUP_TEST_KEY,
    title: message.title,
    body: message.body,
    url: message.url,
    pushOptions: { openInApp: true },
  };
}

/**
 * The test function answers "no devices" as success:false with code
 * "no_devices"; the card shows that as its amber "nothing to send to" state
 * (sent: 0), not as a failure.
 */
export function pushSetupTestResponse(response: NotificationTestResponse): NotificationTestResponse {
  if (response && response.success === false && response.code === "no_devices") {
    return { success: true, sent: 0, failed: response.failed ?? 0, message: response.message ?? response.error };
  }
  return response;
}

export interface NotificationCategoryGroup {
  category: NotificationCategory;
  items: NotificationItem[];
}

/** The categories of one direction that have items, in NOTIFICATION_CATEGORIES order. */
export function categoryGroups(direction: NotificationDirection): NotificationCategoryGroup[] {
  return NOTIFICATION_CATEGORIES.map((category) => ({ category, items: itemsFor(direction, category.id) })).filter(
    (group) => group.items.length > 0,
  );
}

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: "Email",
  push: "Push",
  in_app: "In-app",
};

export const SIDE_LABELS: Record<NotificationSide, string> = {
  booking_site: "Booking site",
  portal: "Portal",
  automatic: "Automatic",
};

/** "When a customer books on your booking site · Booking site · Your team" (§3.12: when, where, who). */
export function itemMetaLine(item: NotificationItem): string {
  const when = String(item.when ?? "").trim().replace(/[.\s]+$/, "");
  return [when, SIDE_LABELS[item.side], item.recipient].filter(Boolean).join(" · ");
}

/** The channels this item can go out on, in the page's fixed order. */
export function itemChannels(item: NotificationItem): NotificationChannel[] {
  return NOTIFICATION_CHANNELS.filter((channel) => !!channelSpec(item, channel));
}

export function channelSpec(item: NotificationItem, channel: NotificationChannel): ChannelSpec<ChannelTemplate> | undefined {
  return (item.channels as Partial<Record<NotificationChannel, ChannelSpec<ChannelTemplate>>>)[channel];
}

/** Why a channel shows a dash instead of a switch. */
export function notApplicableCopy(item: NotificationItem, channel: NotificationChannel): string {
  const what = channel === "email" ? "an email" : channel === "push" ? "a push notification" : "an in-app message";
  return `${item.name} has no ${what}. Nothing is sent this way.`;
}

/** What today's code does, for the line above each channel's editor. */
export const TODAY_COPY: Record<ChannelTodayStatus, string> = {
  sends: "Today: sent every time.",
  sends_some_paths: "Today: sent from some screens only.",
  not_sent: "Today: not sent.",
};

export const PUSH_OPTION_COPY: readonly { key: PushOptionKey; label: string; description: string }[] = [
  {
    key: "requireInteraction",
    label: "Stay on screen until dismissed",
    description: "On computers it stays until someone closes it. Phones ignore this.",
  },
  { key: "silent", label: "Silent", description: "No sound or vibration." },
  {
    key: "replacePrevious",
    label: "Replace the previous one",
    description: "A new one replaces the last one of this kind instead of stacking.",
  },
  {
    key: "openInApp",
    label: "Open in app button",
    description: "Adds an Open in app button on Android and computers. Tapping the notification always opens it.",
  },
];

/* -------------------------------------------------------------------------- */
/* Edit state                                                                  */
/* -------------------------------------------------------------------------- */

/** The page's unsaved edits: `settingKey(item.key, channel)` → the whole edited channel. */
export type ChannelDrafts = Readonly<Record<string, ChannelEdit>>;

/** Stored rows by `settingKey`. Rows for another channel shape are kept as they are; effectiveChannel ignores mismatches. */
export function indexRows(rows: readonly NotificationSettingRow[] | null | undefined): Map<string, NotificationSettingRow> {
  const map = new Map<string, NotificationSettingRow>();
  for (const row of rows ?? []) map.set(settingKey(row.notification_key, row.channel), row);
  return map;
}

/** What is stored for one channel of one item, laid over the catalog default. */
export function storedEdit(
  item: NotificationItem,
  channel: NotificationChannel,
  rowsByKey: ReadonlyMap<string, NotificationSettingRow>,
): ChannelEdit {
  const state = effectiveChannel(item, channel, rowsByKey.get(settingKey(item.key, channel)) ?? null);
  return { enabled: state.enabled, template: state.template, pushOptions: state.pushOptions };
}

/** What the page shows for one channel: the unsaved edit, else what is stored. */
export function currentEdit(
  item: NotificationItem,
  channel: NotificationChannel,
  rowsByKey: ReadonlyMap<string, NotificationSettingRow>,
  drafts: ChannelDrafts,
): ChannelEdit {
  return drafts[settingKey(item.key, channel)] ?? storedEdit(item, channel, rowsByKey);
}

/** The drafts as settings-model's `diffEdits` takes them. Drafts for an unknown item or a channel it lacks are dropped. */
export function draftList(drafts: ChannelDrafts, tenantId: string | null | undefined): ChannelDraft[] {
  if (!tenantId) return [];
  const out: ChannelDraft[] = [];
  for (const [key, state] of Object.entries(drafts)) {
    const i = key.lastIndexOf(":");
    if (i <= 0) continue;
    const item = getNotificationItem(key.slice(0, i));
    const channel = key.slice(i + 1) as NotificationChannel;
    if (!item || !channelSpec(item, channel)) continue;
    out.push({ tenantId, item, channel, state });
  }
  return out;
}

/** What Save has to write for these drafts. */
export function pageDiff(
  rows: readonly NotificationSettingRow[] | null | undefined,
  drafts: ChannelDrafts,
  tenantId: string | null | undefined,
): SettingsDiff {
  return diffEdits(rows ?? [], draftList(drafts, tenantId));
}

export const diffIsEmpty = (diff: SettingsDiff) => diff.upserts.length === 0 && diff.deletes.length === 0;

/** Item keys with something to save, for the rows' "Unsaved" marker. */
export function pendingItemKeys(diff: SettingsDiff): Set<string> {
  return new Set([...diff.upserts, ...diff.deletes].map((r) => r.notification_key));
}

/** True when this channel's wording (or push options) differs from the catalog default. */
export function isCustomised(item: NotificationItem, channel: NotificationChannel, edit: ChannelEdit): boolean {
  if (!channelSpec(item, channel)) return false;
  const row = rowFromEdit("-", item.key, channel, edit, item);
  return row.subject !== null || row.title !== null || row.body !== null;
}

/** True when the wording and push options are the catalog default (the on/off switch does not count). */
export function isDefaultContent(item: NotificationItem, channel: NotificationChannel, edit: ChannelEdit): boolean {
  if (!channelSpec(item, channel)) return true;
  const row = rowFromEdit("-", item.key, channel, edit, item);
  return !isCustomised(item, channel, edit) && Object.keys(row.push_options ?? {}).length === 0;
}

/** The edit "Reset to default" puts in the draft: the catalog wording and push options; on/off stays as it is. */
export function resetEdit(item: NotificationItem, channel: NotificationChannel, edit: ChannelEdit): ChannelEdit {
  const spec = channelSpec(item, channel);
  if (!spec) return edit;
  return {
    enabled: edit.enabled,
    template: { ...spec.defaultTemplate },
    pushOptions: channel === "push" ? normalisePushOptions(spec.defaultPushOptions) : {},
  };
}

export interface DraftProblem {
  item: NotificationItem;
  channel: NotificationChannel;
  message: string;
}

/**
 * The first reason Save can't go ahead: a template about to be written that
 * fails `validateTemplate`, in page order (direction, category, item,
 * channel). Only rows Save would write are checked, so a problem in something
 * stored earlier never blocks an unrelated switch.
 */
export function firstDraftProblem(
  rows: readonly NotificationSettingRow[] | null | undefined,
  drafts: ChannelDrafts,
  tenantId: string | null | undefined,
): DraftProblem | null {
  const diff = pageDiff(rows, drafts, tenantId);
  const writing = new Set(diff.upserts.map((r) => settingKey(r.notification_key, r.channel)));
  if (writing.size === 0) return null;
  for (const group of NOTIFICATION_DIRECTION_GROUPS) {
    for (const { items } of categoryGroups(group.direction)) {
      for (const item of items) {
        for (const channel of itemChannels(item)) {
          const key = settingKey(item.key, channel);
          if (!writing.has(key)) continue;
          const edit = drafts[key];
          if (!edit) continue;
          const check = validateTemplate(channel, edit.template, item.variables);
          if (!check.ok) return { item, channel, message: check.messages[0] };
        }
      }
    }
  }
  return null;
}

/** The sentence a blocked Save shows (the page's save bar prints the error's message). */
export function draftProblemMessage(problem: DraftProblem): string {
  const channel = problem.channel === "email" ? "email" : problem.channel === "push" ? "push" : "in-app message";
  return `Check the ${channel} for ${problem.item.name}: ${problem.message}`;
}
