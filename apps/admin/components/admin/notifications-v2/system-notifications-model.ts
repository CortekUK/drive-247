/**
 * Notifications v2, SYSTEM set: the admin page's own rules, as pure functions
 * (no React, no Supabase), so the page stays thin and every decision is
 * unit-tested.
 *
 * The twin of apps/portal/src/components/settings-v2/notifications-v2/
 * notifications-page-model.ts, at PLATFORM scope:
 *
 *   - three direction groups instead of two (transcript 07:30–08:30, 16:39):
 *     Drive247 → Operators, Operators → Drive247, Drive247 → Everyone;
 *   - no tenant anywhere, so the drafts and the save diff are keyed by
 *     `${notification_key}:${channel}` alone;
 *   - an item may be `managedElsewhere` (the three broadcast items), which has
 *     no equivalent in the portal: the page links to the screen that already
 *     owns that content instead of offering an editor.
 *
 * Storage rules live in lib/notifications-v2/settings-model (effectiveChannel,
 * rowFromEdit, diffEdits, validateTemplate); this file only composes them.
 */

import {
  SYSTEM_NOTIFICATION_CATEGORIES,
  SYSTEM_NOTIFICATION_DIRECTIONS,
  getSystemNotificationItem,
  systemItemsFor,
  type SystemNotificationCategory,
  type SystemNotificationDirection,
  type SystemNotificationItem,
  type SystemNotificationSide,
} from '@/lib/notifications-v2/catalog';
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
} from '@/lib/notifications-v2/settings-model';
import {
  NOTIFICATION_CHANNELS,
  type ChannelSpec,
  type ChannelTemplate,
  type ChannelTodayStatus,
  type NotificationChannel,
  type PlatformNotificationSettingRow,
  type SystemNotificationItem as TypesNotificationItem,
} from '@/lib/notifications-v2/types';

/* -------------------------------------------------------------------------- */
/* The one seam between catalog.ts and types.ts                                */
/* -------------------------------------------------------------------------- */

/**
 * settings-model's functions are typed against `./types`'s
 * `SystemNotificationItem`, whose `direction` and `side` unions are spelled
 * differently from the catalog's (`platform_to_operator` vs
 * `super_admin_to_admin`; and types' `side` has no `"booking site"` at all, so
 * there is no lossless mapping — the catalog's own report says so). Those two
 * fields are the ONLY difference, and settings-model reads neither: it reads
 * `key`, `channels` and `variables`.
 *
 * So the catalog item is handed over as it is, with its true `side` intact,
 * rather than through a conversion that would have to invent a value for
 * "booking site". The assertion below is the guard: if the three fields
 * settings-model actually reads ever stop matching, this file fails to compile
 * instead of failing at runtime.
 */
type ReadBySettingsModel = 'key' | 'channels' | 'variables';
type _CatalogMatchesTypes = Pick<SystemNotificationItem, ReadBySettingsModel> extends Pick<
  TypesNotificationItem,
  ReadBySettingsModel
>
  ? true
  : never;
/** Fails to compile if `key`, `channels` or `variables` ever diverge. */
const _bridgeIsSound: _CatalogMatchesTypes = true;
void _bridgeIsSound;

/** The catalog item as settings-model's signatures spell it. Nothing is changed. */
export function forSettingsModel(item: SystemNotificationItem): TypesNotificationItem {
  return item as unknown as TypesNotificationItem;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

export const SYSTEM_NOTIFICATIONS_COPY = {
  pageTitle: 'Notifications',
  pageDescription:
    'Every message the platform sends an operator, every message an operator sends us, and what we broadcast to everyone.',
  /**
   * The same honest line the operator portal carries: settings are stored and
   * the previews and Send test use them, but live sending does not switch over
   * with this page.
   */
  notice:
    'What you save here is kept, and Send test uses it. Live messages still go out as they do today, from today’s sender address, until sending switches over.',
  storageOff: 'Saving turns on once platform notification storage is switched on.',
  storageOffDetail:
    'ops/notifications_v2_platform.sql has not been applied yet. Until it is you can try changes here, preview them and send tests — nothing is kept when you leave.',
  storageOffEdits: 'Your changes on this page won’t be kept when you leave.',
  loading: 'Loading platform notifications',
  loadThing: 'the platform notification settings',
  retry: 'Try again',
  close: 'Close',
  reset: 'Reset to default',
  edited: 'Edited',
  unsaved: 'Unsaved',
  notSentYet: 'Not sent yet',
  templateColumn: 'Message to send',
  previewColumn: 'Preview',
  subject: 'Subject',
  message: 'Message',
  title: 'Title',
  displayOptions: 'How it shows',
  save: 'Save changes',
  saving: 'Saving…',
  discard: 'Discard',
  savedToast: 'Platform notifications saved.',
  dirtyLead: 'You have unsaved changes.',
  /** Send test / editing, when the signed-in account is not a super admin. */
  noAccessTitle: 'Super admins only',
  noAccessBody:
    'These are the platform’s own notifications. A sales agent account can see this page, but only a Drive247 super admin can change what we send.',
  readOnly: 'View only',
  noTestForViewer: 'View only. Only a super admin can send tests.',
  fixToTest: 'Fix the problems above to send a test.',
  inAppNoTest: 'Shows in the bell; there’s no test send for in-app.',
  pushPhoneNote: 'Banner or lock screen is chosen on each phone, not here.',
  pushTestNote:
    'Goes to your own devices, the ones you turned on under Settings → Platform push.',
  /** The three announcement items, which already have their own screen. */
  managedElsewhereLead: 'Written per announcement, not once as a template.',
  managedElsewhereAction: 'Open',
} as const;

/* -------------------------------------------------------------------------- */
/* Direction groups                                                            */
/* -------------------------------------------------------------------------- */

export interface SystemNotificationDirectionGroup {
  direction: SystemNotificationDirection;
  /** DOM anchor for the section. */
  anchor: string;
  /** The heading. */
  title: string;
  /** One sentence under it. */
  description: string;
  /** The lead's own words for the direction, shown as a chip on every item. */
  chip: string;
}

/**
 * The three groups in the lead's order (transcript 07:30–08:30).
 *
 * The titles are plural — a group covers every operator, not one — where the
 * catalog's `SYSTEM_DIRECTION_LABELS` name a single relationship in the
 * singular. The chips are the lead's literal words for the three directions,
 * so the row reads the way he said it on the call.
 */
export const SYSTEM_DIRECTION_GROUPS: readonly SystemNotificationDirectionGroup[] = [
  {
    direction: 'super_admin_to_admin',
    anchor: 'system-notifications-to-operators',
    title: 'Drive247 → Operators',
    description: 'We do something, and the operator is told.',
    chip: 'Super admin → Admin',
  },
  {
    direction: 'admin_to_super_admin',
    anchor: 'system-notifications-to-platform',
    title: 'Operators → Drive247',
    description: 'An operator does something, and we are told.',
    chip: 'Admin → Super admin',
  },
  {
    direction: 'super_admin_to_everyone',
    anchor: 'system-notifications-to-everyone',
    title: 'Drive247 → Everyone',
    description: 'What you broadcast to operators, to their renters, or to both.',
    chip: 'Super admin → Everyone',
  },
];

/** The groups in catalog order; a guard so the page can never drop a direction. */
export const SYSTEM_DIRECTION_GROUP_ORDER: readonly SystemNotificationDirection[] =
  SYSTEM_DIRECTION_GROUPS.map((g) => g.direction);

export interface SystemNotificationCategoryGroup {
  category: SystemNotificationCategory;
  items: SystemNotificationItem[];
}

/** The categories of one direction that hold items, in display order. */
export function categoryGroups(direction: SystemNotificationDirection): SystemNotificationCategoryGroup[] {
  return SYSTEM_NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    items: systemItemsFor(direction, category.id),
  })).filter((group) => group.items.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Labels and the plain-English line                                           */
/* -------------------------------------------------------------------------- */

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: 'Email',
  push: 'Push',
  in_app: 'In-app',
};

/** Where the triggering action happens, for the "when · where · who" line. */
export const SIDE_LABELS: Record<SystemNotificationSide, string> = {
  'admin dashboard': 'This dashboard',
  portal: 'Operator portal',
  'booking site': 'Booking site',
  automatic: 'Automatic',
};

/** "When an operator subscribes · Operator portal · Us" (transcript §3.12). */
export function itemMetaLine(item: SystemNotificationItem): string {
  const when = String(item.when ?? '')
    .trim()
    .replace(/[.\s]+$/, '');
  return [when, SIDE_LABELS[item.side], item.recipient].filter(Boolean).join(' · ');
}

export function channelSpec(
  item: SystemNotificationItem,
  channel: NotificationChannel,
): ChannelSpec<ChannelTemplate> | undefined {
  return (item.channels as Partial<Record<NotificationChannel, ChannelSpec<ChannelTemplate>>>)[channel];
}

/** The channels this item can go out on, in the page's fixed order. */
export function itemChannels(item: SystemNotificationItem): NotificationChannel[] {
  return NOTIFICATION_CHANNELS.filter((channel) => !!channelSpec(item, channel));
}

/** Why a channel shows a dash instead of a switch. */
export function notApplicableCopy(item: SystemNotificationItem, channel: NotificationChannel): string {
  const what = channel === 'email' ? 'an email' : channel === 'push' ? 'a push notification' : 'an in-app message';
  return `${item.name} is never sent as ${what}.`;
}

/** True when nothing sends this channel today, so the switch changes nothing live. */
export function isNotSentYet(item: SystemNotificationItem, channel: NotificationChannel): boolean {
  return channelSpec(item, channel)?.today === 'not_sent';
}

/** The sentence behind the row's "Not sent yet" marker. */
export function notSentYetCopy(channel: NotificationChannel): string {
  const what = channel === 'email' ? 'No email' : channel === 'push' ? 'No push notification' : 'No in-app message';
  return `${what} is sent for this yet. What you set here is saved, and is used once sending switches over.`;
}

/** What today's code does, for the line above each channel's editor. */
export const TODAY_COPY: Record<ChannelTodayStatus, string> = {
  sends: 'Today: sent every time.',
  sends_some_paths: 'Today: sent on some paths only.',
  not_sent: 'Today: not sent.',
};

export const PUSH_OPTION_COPY: readonly {
  key: PushOptionKey;
  label: string;
  description: string;
  note?: string;
}[] = [
  {
    key: 'requireInteraction',
    label: 'Stay on screen until dismissed',
    description: 'On computers it stays until someone closes it. Phones ignore this.',
  },
  { key: 'silent', label: 'Silent', description: 'No sound or vibration.' },
  {
    key: 'replacePrevious',
    label: 'Replace the previous one',
    description: 'A new one replaces the last one of this kind instead of stacking.',
    /**
     * apps/admin/public/service-worker.js derives `renotify` from the tag
     * rather than honouring the one we send, so a replaced notification
     * re-alerts on an admin device until that worker is updated.
     */
    note: 'On an admin device the replacement still buzzes; the service worker ignores our “don’t re-alert” flag.',
  },
  {
    key: 'openInApp',
    label: 'Open in app button',
    description: 'Adds an Open in app button on Android and computers. Tapping the notification always opens it.',
    /**
     * Only notification-test-v2 builds `actions`; send-push (every real push)
     * does not, and this dashboard's own service worker ignores them too.
     */
    note: 'Test sends only for now — real notifications get it once sending switches over.',
  },
];

/* -------------------------------------------------------------------------- */
/* Edit state                                                                  */
/* -------------------------------------------------------------------------- */

/** The page's unsaved edits: `settingKey(item.key, channel)` → the edited channel. */
export type ChannelDrafts = Readonly<Record<string, ChannelEdit>>;

/** Stored rows by `settingKey`. */
export function indexRows(
  rows: readonly PlatformNotificationSettingRow[] | null | undefined,
): Map<string, PlatformNotificationSettingRow> {
  const map = new Map<string, PlatformNotificationSettingRow>();
  for (const row of rows ?? []) map.set(settingKey(row.notification_key, row.channel), row);
  return map;
}

/** What is stored for one channel of one item, laid over the catalog default. */
export function storedEdit(
  item: SystemNotificationItem,
  channel: NotificationChannel,
  rowsByKey: ReadonlyMap<string, PlatformNotificationSettingRow>,
): ChannelEdit {
  const state = effectiveChannel(
    forSettingsModel(item),
    channel,
    rowsByKey.get(settingKey(item.key, channel)) ?? null,
  );
  return { enabled: state.enabled, template: state.template, pushOptions: state.pushOptions };
}

/** What the page shows for one channel: the unsaved edit, else what is stored. */
export function currentEdit(
  item: SystemNotificationItem,
  channel: NotificationChannel,
  rowsByKey: ReadonlyMap<string, PlatformNotificationSettingRow>,
  drafts: ChannelDrafts,
): ChannelEdit {
  return drafts[settingKey(item.key, channel)] ?? storedEdit(item, channel, rowsByKey);
}

/**
 * The drafts as settings-model's `diffEdits` takes them. A draft for an unknown
 * item, for a channel it does not offer, or for an item whose content lives on
 * another screen is dropped — nothing here can write a row the page does not own.
 */
export function draftList(drafts: ChannelDrafts): ChannelDraft[] {
  const out: ChannelDraft[] = [];
  for (const [key, state] of Object.entries(drafts)) {
    const i = key.lastIndexOf(':');
    if (i <= 0) continue;
    const item = getSystemNotificationItem(key.slice(0, i));
    const channel = key.slice(i + 1) as NotificationChannel;
    if (!item || item.managedElsewhere || !channelSpec(item, channel)) continue;
    out.push({ item: forSettingsModel(item), channel, state });
  }
  return out;
}

/** What Save has to write for these drafts. */
export function pageDiff(
  rows: readonly PlatformNotificationSettingRow[] | null | undefined,
  drafts: ChannelDrafts,
): SettingsDiff {
  return diffEdits(rows ?? [], draftList(drafts));
}

export const diffIsEmpty = (diff: SettingsDiff): boolean =>
  diff.upserts.length === 0 && diff.deletes.length === 0;

/** Item keys with something to save, for the rows' "Unsaved" marker. */
export function pendingItemKeys(diff: SettingsDiff): Set<string> {
  return new Set([...diff.upserts, ...diff.deletes].map((r) => r.notification_key));
}

/** True when this channel's wording differs from the catalog default. */
export function isCustomised(
  item: SystemNotificationItem,
  channel: NotificationChannel,
  edit: ChannelEdit,
): boolean {
  if (!channelSpec(item, channel)) return false;
  const row = rowFromEdit(item.key, channel, edit, forSettingsModel(item));
  return row.subject !== null || row.title !== null || row.body !== null;
}

/** True when the wording AND the push options are the catalog default (on/off does not count). */
export function isDefaultContent(
  item: SystemNotificationItem,
  channel: NotificationChannel,
  edit: ChannelEdit,
): boolean {
  if (!channelSpec(item, channel)) return true;
  const row = rowFromEdit(item.key, channel, edit, forSettingsModel(item));
  return !isCustomised(item, channel, edit) && Object.keys(row.push_options ?? {}).length === 0;
}

/** "Reset to default": the catalog wording and push options; on/off stays as it is. */
export function resetEdit(
  item: SystemNotificationItem,
  channel: NotificationChannel,
  edit: ChannelEdit,
): ChannelEdit {
  const spec = channelSpec(item, channel);
  if (!spec) return edit;
  return {
    enabled: edit.enabled,
    template: { ...spec.defaultTemplate },
    pushOptions: channel === 'push' ? normalisePushOptions(spec.defaultPushOptions) : {},
  };
}

export interface DraftProblem {
  item: SystemNotificationItem;
  channel: NotificationChannel;
  message: string;
}

/**
 * The first reason Save cannot go ahead: a template about to be written that
 * fails `validateTemplate`, in page order (direction, category, item, channel).
 * Only rows Save would write are checked, so a problem in something stored
 * earlier never blocks an unrelated switch.
 */
export function firstDraftProblem(
  rows: readonly PlatformNotificationSettingRow[] | null | undefined,
  drafts: ChannelDrafts,
): DraftProblem | null {
  const diff = pageDiff(rows, drafts);
  const writing = new Set(diff.upserts.map((r) => settingKey(r.notification_key, r.channel)));
  if (writing.size === 0) return null;
  for (const group of SYSTEM_DIRECTION_GROUPS) {
    for (const { items } of categoryGroups(group.direction)) {
      for (const item of items) {
        for (const channel of itemChannels(item)) {
          const key = settingKey(item.key, channel);
          if (!writing.has(key)) continue;
          const edit = drafts[key];
          if (!edit) continue;
          const check = validateTemplate(channel, edit.template, item.variables);
          if (!check.ok) return { item, channel, message: check.messages[0] ?? 'Check this message.' };
        }
      }
    }
  }
  return null;
}

/** The sentence a blocked Save shows. */
export function draftProblemMessage(problem: DraftProblem): string {
  const channel =
    problem.channel === 'email' ? 'email' : problem.channel === 'push' ? 'push' : 'in-app message';
  return `Check the ${channel} for ${problem.item.name}: ${problem.message}`;
}

/* -------------------------------------------------------------------------- */
/* Sanity: the page's groups cover the catalog                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every item the catalog holds, in the order the page draws it. The page does
 * not use this (it renders group by group); the tests do, to prove no item is
 * unreachable.
 */
export function itemsInPageOrder(): SystemNotificationItem[] {
  const out: SystemNotificationItem[] = [];
  for (const group of SYSTEM_DIRECTION_GROUPS) {
    for (const { items } of categoryGroups(group.direction)) out.push(...items);
  }
  return out;
}

/** The catalog's own direction order, for a test that the page still matches it. */
export const CATALOG_DIRECTION_ORDER = SYSTEM_NOTIFICATION_DIRECTIONS;
