/**
 * The admin Notifications page's own rules: the three direction groups, the
 * plain-English line, and the edit/diff state the one Save bar writes.
 *
 * Pure functions only — the rendered page has its own suite next door.
 */

import { describe, expect, it } from 'vitest';
import {
  CATALOG_DIRECTION_ORDER,
  SIDE_LABELS,
  SYSTEM_DIRECTION_GROUPS,
  SYSTEM_NOTIFICATIONS_COPY,
  categoryGroups,
  channelSpec,
  currentEdit,
  diffIsEmpty,
  draftList,
  draftProblemMessage,
  firstDraftProblem,
  forSettingsModel,
  indexRows,
  isCustomised,
  isDefaultContent,
  isNotSentYet,
  itemChannels,
  itemMetaLine,
  itemsInPageOrder,
  notApplicableCopy,
  notSentYetCopy,
  pageDiff,
  pendingItemKeys,
  resetEdit,
  storedEdit,
  type ChannelDrafts,
} from '@/components/admin/notifications-v2/system-notifications-model';
import {
  SYSTEM_NOTIFICATION_CATALOG,
  getSystemNotificationItem,
  type SystemNotificationItem,
} from '@/lib/notifications-v2/catalog';
import { settingKey } from '@/lib/notifications-v2/settings-model';
import type { PlatformNotificationSettingRow } from '@/lib/notifications-v2/types';

const item = (key: string): SystemNotificationItem => {
  const found = getSystemNotificationItem(key);
  if (!found) throw new Error(`no catalog item ${key}`);
  return found;
};

/** The first catalog item that offers a given channel and is editable here. */
function firstWith(channel: 'email' | 'push' | 'in_app'): SystemNotificationItem {
  const found = SYSTEM_NOTIFICATION_CATALOG.find((i) => !i.managedElsewhere && !!i.channels[channel]);
  if (!found) throw new Error(`no catalog item offers ${channel}`);
  return found;
}

describe('direction groups', () => {
  it('has the lead’s three groups, in his order', () => {
    expect(SYSTEM_DIRECTION_GROUPS.map((g) => g.direction)).toEqual([
      'super_admin_to_admin',
      'admin_to_super_admin',
      'super_admin_to_everyone',
    ]);
    expect(SYSTEM_DIRECTION_GROUPS.map((g) => g.title)).toEqual([
      'Drive247 → Operators',
      'Operators → Drive247',
      'Drive247 → Everyone',
    ]);
  });

  it('chips each group in the lead’s own words', () => {
    expect(SYSTEM_DIRECTION_GROUPS.map((g) => g.chip)).toEqual([
      'Super admin → Admin',
      'Admin → Super admin',
      'Super admin → Everyone',
    ]);
  });

  it('keeps the catalog’s own direction order', () => {
    expect(SYSTEM_DIRECTION_GROUPS.map((g) => g.direction)).toEqual([...CATALOG_DIRECTION_ORDER]);
  });

  it('reaches every item in the catalog, exactly once', () => {
    const shown = itemsInPageOrder().map((i) => i.key);
    expect(shown.length).toBe(SYSTEM_NOTIFICATION_CATALOG.length);
    expect(new Set(shown).size).toBe(shown.length);
    expect([...shown].sort()).toEqual(SYSTEM_NOTIFICATION_CATALOG.map((i) => i.key).sort());
  });

  it('shows only categories that hold items', () => {
    for (const group of SYSTEM_DIRECTION_GROUPS) {
      for (const { items } of categoryGroups(group.direction)) {
        expect(items.length).toBeGreaterThan(0);
        for (const i of items) expect(i.direction).toBe(group.direction);
      }
    }
  });
});

describe('the "when · where · who" line', () => {
  it('joins the three parts, without the sentence’s full stop', () => {
    const line = itemMetaLine({
      ...item('subscription_link_sent'),
      when: 'When you send a subscription link.',
      side: 'admin dashboard',
      recipient: 'The address you type',
    });
    expect(line).toBe('When you send a subscription link · This dashboard · The address you type');
  });

  it('names every side the catalog actually uses', () => {
    for (const i of SYSTEM_NOTIFICATION_CATALOG) {
      expect(SIDE_LABELS[i.side], `no label for side ${i.side}`).toBeTruthy();
      expect(itemMetaLine(i)).toContain(SIDE_LABELS[i.side]);
    }
  });

  it('starts every item’s line with the word When', () => {
    for (const i of SYSTEM_NOTIFICATION_CATALOG) expect(i.when.trim().startsWith('When')).toBe(true);
  });
});

describe('channels on a row', () => {
  it('lists only the channels an item offers, in page order', () => {
    for (const i of SYSTEM_NOTIFICATION_CATALOG) {
      const channels = itemChannels(i);
      expect(channels.length).toBeGreaterThan(0);
      expect(channels).toEqual(channels.filter((c) => !!channelSpec(i, c)));
      // The page's fixed order, never the object key order.
      expect(channels).toEqual(['email', 'push', 'in_app'].filter((c) => channels.includes(c as never)));
    }
  });

  it('explains a dash by naming the notification and the channel', () => {
    const i = item('subscription_link_sent');
    expect(notApplicableCopy(i, 'push')).toBe(`${i.name} is never sent as a push notification.`);
    expect(notApplicableCopy(i, 'in_app')).toBe(`${i.name} is never sent as an in-app message.`);
  });

  it('marks a channel nothing sends today, and says what that means', () => {
    const notSent = SYSTEM_NOTIFICATION_CATALOG.flatMap((i) =>
      itemChannels(i)
        .filter((c) => isNotSentYet(i, c))
        .map((c) => [i.key, c] as const),
    );
    expect(notSent.length).toBeGreaterThan(0);
    for (const [key, channel] of notSent) {
      expect(channelSpec(item(key), channel)?.today).toBe('not_sent');
    }
    expect(notSentYetCopy('email')).toContain('No email is sent for this yet');
    expect(notSentYetCopy('push')).toContain('No push notification');
    expect(notSentYetCopy('in_app')).toContain('No in-app message');
  });
});

describe('edits, and what Save writes', () => {
  const rows: PlatformNotificationSettingRow[] = [];

  it('shows the catalog default when nothing is stored', () => {
    const i = firstWith('email');
    const edit = storedEdit(i, 'email', indexRows(rows));
    expect(edit.enabled).toBe(i.channels.email!.defaultEnabled);
    expect(edit.template).toEqual(i.channels.email!.defaultTemplate);
  });

  it('lays a stored row over the default', () => {
    const i = firstWith('email');
    const stored: PlatformNotificationSettingRow[] = [
      {
        notification_key: i.key,
        channel: 'email',
        enabled: false,
        subject: 'Changed subject',
        title: null,
        body: null,
        push_options: {},
      },
    ];
    const edit = storedEdit(i, 'email', indexRows(stored));
    expect(edit.enabled).toBe(false);
    expect((edit.template as { subject: string }).subject).toBe('Changed subject');
    // The body was NOT stored, so it is still the catalog's.
    expect((edit.template as { body: string }).body).toBe(i.channels.email!.defaultTemplate.body);
  });

  it('a draft wins over what is stored', () => {
    const i = firstWith('email');
    const drafts: ChannelDrafts = {
      [settingKey(i.key, 'email')]: {
        enabled: false,
        template: { subject: 'Draft', body: '<p>Draft</p>' },
      },
    };
    expect(currentEdit(i, 'email', indexRows(rows), drafts).enabled).toBe(false);
    expect(currentEdit(i, 'push', indexRows(rows), drafts)).toEqual(storedEdit(i, 'push', indexRows(rows)));
  });

  it('turning a switch gives Save exactly one row to write', () => {
    const i = firstWith('email');
    const on = i.channels.email!.defaultEnabled;
    const drafts: ChannelDrafts = {
      [settingKey(i.key, 'email')]: {
        enabled: !on,
        template: i.channels.email!.defaultTemplate,
      },
    };
    const diff = pageDiff(rows, drafts);
    expect(diffIsEmpty(diff)).toBe(false);
    expect(diff.upserts).toHaveLength(1);
    expect(diff.upserts[0]).toMatchObject({ notification_key: i.key, channel: 'email', enabled: !on });
    // Only the switch moved, so nothing else is stored.
    expect(diff.upserts[0].subject).toBeNull();
    expect(diff.upserts[0].body).toBeNull();
    expect(pendingItemKeys(diff).has(i.key)).toBe(true);
  });

  it('an edit that equals the default writes nothing when nothing is stored', () => {
    const i = firstWith('email');
    const drafts: ChannelDrafts = {
      [settingKey(i.key, 'email')]: {
        enabled: i.channels.email!.defaultEnabled,
        template: { ...i.channels.email!.defaultTemplate },
      },
    };
    expect(diffIsEmpty(pageDiff(rows, drafts))).toBe(true);
  });

  it('resetting a stored row deletes it instead of saving the defaults again', () => {
    const i = firstWith('email');
    const stored: PlatformNotificationSettingRow[] = [
      {
        notification_key: i.key,
        channel: 'email',
        enabled: null,
        subject: 'Old',
        title: null,
        body: null,
        push_options: {},
      },
    ];
    const edit = storedEdit(i, 'email', indexRows(stored));
    const drafts: ChannelDrafts = { [settingKey(i.key, 'email')]: resetEdit(i, 'email', edit) };
    const diff = pageDiff(stored, drafts);
    expect(diff.upserts).toHaveLength(0);
    expect(diff.deletes).toEqual([{ notification_key: i.key, channel: 'email' }]);
  });

  it('never writes a row for an item whose content lives on another screen', () => {
    const managed = SYSTEM_NOTIFICATION_CATALOG.find((i) => !!i.managedElsewhere);
    expect(managed).toBeTruthy();
    const channel = itemChannels(managed!)[0];
    const drafts: ChannelDrafts = {
      [settingKey(managed!.key, channel)]: {
        enabled: true,
        template: { title: 'x', body: 'y' },
      },
    };
    expect(draftList(drafts)).toHaveLength(0);
    expect(diffIsEmpty(pageDiff(rows, drafts))).toBe(true);
  });

  it('drops a draft for an unknown item or a channel it does not offer', () => {
    const i = firstWith('email');
    const missing = (['email', 'push', 'in_app'] as const).find((c) => !i.channels[c]);
    const drafts: ChannelDrafts = {
      'not_a_real_key:email': { enabled: true, template: { subject: 'x', body: 'y' } },
      ...(missing ? { [settingKey(i.key, missing)]: { enabled: true, template: { title: 'x', body: 'y' } } } : {}),
    };
    expect(draftList(drafts)).toHaveLength(0);
  });

  it('spots a customised template, and a default one', () => {
    const i = firstWith('email');
    const base = storedEdit(i, 'email', indexRows(rows));
    expect(isCustomised(i, 'email', base)).toBe(false);
    expect(isDefaultContent(i, 'email', base)).toBe(true);

    const changed = { ...base, template: { ...(base.template as { subject: string; body: string }), subject: 'New' } };
    expect(isCustomised(i, 'email', changed)).toBe(true);
    expect(isDefaultContent(i, 'email', changed)).toBe(false);

    // Flipping the switch alone is NOT a customised template.
    expect(isCustomised(i, 'email', { ...base, enabled: !base.enabled })).toBe(false);
  });
});

describe('a template Save cannot write', () => {
  it('blocks on an empty subject, and names the notification and the channel', () => {
    const i = firstWith('email');
    const drafts: ChannelDrafts = {
      [settingKey(i.key, 'email')]: {
        enabled: true,
        template: { subject: '', body: '<p>Something</p>' },
      },
    };
    const problem = firstDraftProblem([], drafts);
    expect(problem).toBeTruthy();
    expect(problem!.item.key).toBe(i.key);
    expect(problem!.channel).toBe('email');
    expect(draftProblemMessage(problem!)).toBe(`Check the email for ${i.name}: Add a subject.`);
  });

  it('blocks on a variable this notification cannot use', () => {
    const i = firstWith('email');
    const drafts: ChannelDrafts = {
      [settingKey(i.key, 'email')]: {
        enabled: true,
        template: { subject: 'Hi {{not_a_variable}}', body: '<p>Something</p>' },
      },
    };
    expect(firstDraftProblem([], drafts)?.message).toContain('{{not_a_variable}}');
  });

  it('does not block on a template Save is not writing', () => {
    const i = firstWith('email');
    // A broken row already stored, with no draft over it.
    const stored: PlatformNotificationSettingRow[] = [
      { notification_key: i.key, channel: 'email', enabled: null, subject: '', title: null, body: null, push_options: {} },
    ];
    expect(firstDraftProblem(stored, {})).toBeNull();
  });

  it('names the in-app channel in words, not as in_app', () => {
    const i = firstWith('in_app');
    const drafts: ChannelDrafts = {
      [settingKey(i.key, 'in_app')]: { enabled: true, template: { title: '', body: '' } },
    };
    const problem = firstDraftProblem([], drafts);
    expect(problem).toBeTruthy();
    expect(draftProblemMessage(problem!)).toContain('Check the in-app message for');
  });
});

describe('the seam between catalog.ts and types.ts', () => {
  it('hands settings-model the catalog item unchanged', () => {
    const i = item('subscription_link_sent');
    const bridged = forSettingsModel(i);
    expect(bridged.key).toBe(i.key);
    expect(bridged.channels).toBe(i.channels);
    expect(bridged.variables).toBe(i.variables);
    // Nothing is rewritten — in particular `side` keeps its true value, which
    // types.ts has no name for ("booking site").
    expect((bridged as unknown as { side: string }).side).toBe(i.side);
  });
});

describe('copy', () => {
  it('tells the truth about what saving does, in both states', () => {
    expect(SYSTEM_NOTIFICATIONS_COPY.notice).toContain('Live messages still go out as they do today');
    expect(SYSTEM_NOTIFICATIONS_COPY.storageOff).toContain('storage');
    expect(SYSTEM_NOTIFICATIONS_COPY.storageOffDetail).toContain('notifications_v2_platform.sql');
  });
});
