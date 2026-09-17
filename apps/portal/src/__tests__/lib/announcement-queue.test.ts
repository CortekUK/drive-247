/**
 * Which announcement gets the dialog slot and the banner slot (lib/announcements/queue.ts).
 *
 * Every expectation below is written by hand from the rules in the spec (§1
 * priority, §3.3 as changed Sep 17 2026), never computed from the function under test:
 *
 *   code-driven gates win  >  SYSTEM dialogs, ONE pager: hard (drag order) then soft
 *   (drag order)  >  feature (drag order, dashboard only, v2 only)
 *
 * with twists that are easy to get wrong and are each pinned on their own:
 *   - a hard blocker exempt on this route still suppresses soft and feature dialogs;
 *   - a hard blocker is exempt on its own CTA page and below it, and "/" matches only "/";
 *   - system dialogs are no longer one per moment (the pager replaced chaining), but a
 *     FEATURE dialog still waits for the next moment once a soft dialog opened;
 *   - the banner bar holds every due banner, hard first, then soft.
 */

import { describe, it, expect } from 'vitest';

import {
  hasHardSystemDialog,
  pickAnnouncementDialog,
  pickAnnouncementDialogs,
  pickSystemBanner,
  pickSystemBanners,
  pickSystemDialogs,
  type DialogQueueInput,
} from '@/lib/announcements/queue';
import type { PortalAnnouncement } from '@/lib/announcements/contract';

let seq = 0;
function sys(over: Partial<PortalAnnouncement> = {}): PortalAnnouncement {
  seq += 1;
  return {
    id: `s${seq}`,
    kind: 'system',
    title: `System ${seq}`,
    summary: null,
    body: 'Body',
    image_url: null,
    slides: [],
    cta_label: null,
    cta_url: null,
    display: 'dialog',
    blocking: 'soft',
    tone: 'info',
    repeat_after_days: null,
    sort_order: seq * 10,
    revision: 1,
    last_shown_at: null,
    dismissed_at: null,
    dont_show_again_at: null,
    is_due: true,
    ...over,
  };
}

function feat(over: Partial<PortalAnnouncement> = {}): PortalAnnouncement {
  return sys({
    kind: 'feature',
    summary: 'One line',
    body: null,
    display: null,
    tone: null,
    slides: [
      { heading: 'A', body: 'a', image_url: null },
      { heading: 'B', body: 'b', image_url: null },
    ],
    ...over,
  });
}

const input = (over: Partial<DialogQueueInput> = {}): DialogQueueInput => ({
  system: [],
  features: [],
  featuresEnabled: true,
  pathname: '/',
  isSubscriptionPage: false,
  blocked: false,
  softMomentAvailable: true,
  ...over,
});

const pickId = (i: DialogQueueInput) => {
  const p = pickAnnouncementDialog(i);
  return p ? `${p.variant}:${p.announcement.id}` : null;
};

describe('pickAnnouncementDialog', () => {
  const hardA = sys({ id: 'hardA', blocking: 'hard' });
  const hardB = sys({ id: 'hardB', blocking: 'hard' });
  const softA = sys({ id: 'softA' });
  const softB = sys({ id: 'softB' });
  const featA = feat({ id: 'featA' });
  const featB = feat({ id: 'featB' });

  it('returns nothing when there is nothing', () => {
    expect(pickId(input())).toBeNull();
  });

  describe('rule 1: blocked', () => {
    it('opens nothing at all while blocked, not even a hard blocker', () => {
      expect(pickId(input({ blocked: true, system: [hardA, softA], features: [featA] }))).toBeNull();
    });
  });

  describe('rule 2: hard system dialogs', () => {
    it('hard beats soft and feature, and the first hard (drag order) wins', () => {
      expect(pickId(input({ system: [hardA, hardB, softA], features: [featA] }))).toBe('system-hard:hardA');
      expect(pickId(input({ system: [hardB, hardA] }))).toBe('system-hard:hardB');
    });

    it('ignores frequency and the soft moment', () => {
      const dismissedHard = sys({ id: 'hardX', blocking: 'hard', is_due: true, dismissed_at: '2026-09-01T00:00:00Z' });
      expect(pickId(input({ system: [dismissedHard], softMomentAvailable: false }))).toBe('system-hard:hardX');
    });

    it('is not shown on the pages the paywall keeps reachable', () => {
      expect(pickId(input({ system: [hardA], isSubscriptionPage: true, pathname: '/settings' }))).toBeNull();
    });

    it('is not shown on its own CTA page or below it; "/" matches only "/"', () => {
      const toSettings = sys({ id: 'toSettings', blocking: 'hard', cta_label: 'Connect', cta_url: '/settings?tab=payments' });
      const toVehicles = sys({ id: 'toVehicles', blocking: 'hard', cta_label: 'Open', cta_url: '/vehicles' });
      const toHome = sys({ id: 'toHome', blocking: 'hard', cta_label: 'Home', cta_url: '/' });

      expect(pickId(input({ system: [toVehicles], pathname: '/vehicles' }))).toBeNull();
      expect(pickId(input({ system: [toVehicles], pathname: '/vehicles/abc' }))).toBeNull();
      expect(pickId(input({ system: [toVehicles], pathname: '/vehicles-archive' }))).toBe('system-hard:toVehicles');
      expect(pickId(input({ system: [toSettings], pathname: '/rentals' }))).toBe('system-hard:toSettings');
      expect(pickId(input({ system: [toHome], pathname: '/' }))).toBeNull();
      expect(pickId(input({ system: [toHome], pathname: '/rentals' }))).toBe('system-hard:toHome');
    });

    it('when the first hard is exempt here, the next hard that is not exempt shows', () => {
      const toVehicles = sys({ id: 'toVehicles', blocking: 'hard', cta_label: 'Open', cta_url: '/vehicles' });
      expect(pickId(input({ system: [toVehicles, hardB], pathname: '/vehicles' }))).toBe('system-hard:hardB');
    });

    it('while any hard applies but is exempt here, NO soft or feature dialog opens either', () => {
      const toVehicles = sys({ id: 'toVehicles', blocking: 'hard', cta_label: 'Open', cta_url: '/vehicles' });
      expect(pickId(input({ system: [toVehicles, softA], pathname: '/vehicles' }))).toBeNull();
      expect(pickId(input({ system: [hardA, softA], features: [featA], isSubscriptionPage: true, pathname: '/' }))).toBeNull();
    });

    it('a hard BANNER does not suppress dialogs (it is a different slot)', () => {
      const hardBanner = sys({ id: 'hardBanner', blocking: 'hard', display: 'banner' });
      expect(pickId(input({ system: [hardBanner, softA] }))).toBe('system-soft:softA');
    });
  });

  describe('rule 3: the moment limits FEATURES only', () => {
    it('a soft system dialog opens even after one opened in this moment (the pager replaced chaining)', () => {
      expect(pickId(input({ system: [softA], features: [featA], softMomentAvailable: false }))).toBe('system-soft:softA');
    });

    it('no feature dialog once a soft dialog opened in this moment', () => {
      expect(pickId(input({ features: [featA], softMomentAvailable: false }))).toBeNull();
    });
  });

  describe('rule 4: soft system dialogs', () => {
    it('the first due soft dialog, in drag order', () => {
      expect(pickId(input({ system: [softA, softB] }))).toBe('system-soft:softA');
      expect(pickId(input({ system: [softB, softA] }))).toBe('system-soft:softB');
    });

    it('skips rows that are not due and banners', () => {
      const notDue = sys({ id: 'notDue', is_due: false });
      const banner = sys({ id: 'banner', display: 'banner' });
      expect(pickId(input({ system: [notDue, banner, softB] }))).toBe('system-soft:softB');
      expect(pickId(input({ system: [notDue, banner] }))).toBeNull();
    });

    it('opens on any route, not only the dashboard', () => {
      expect(pickId(input({ system: [softA], pathname: '/rentals/123' }))).toBe('system-soft:softA');
      expect(pickId(input({ system: [softA], pathname: '/settings', isSubscriptionPage: true }))).toBe('system-soft:softA');
    });

    it('soft system comes before any feature', () => {
      expect(pickId(input({ system: [softA], features: [featA] }))).toBe('system-soft:softA');
    });
  });

  describe('rule 5: features', () => {
    it('the first due feature, in drag order, on the dashboard', () => {
      expect(pickId(input({ features: [featA, featB] }))).toBe('feature:featA');
      expect(pickId(input({ features: [featB, featA] }))).toBe('feature:featB');
    });

    it('only on "/"', () => {
      expect(pickId(input({ features: [featA], pathname: '/rentals' }))).toBeNull();
      expect(pickId(input({ features: [featA], pathname: '/insights' }))).toBeNull();
    });

    it('only where features are enabled (the v2 dashboard canary)', () => {
      expect(pickId(input({ features: [featA], featuresEnabled: false }))).toBeNull();
    });

    it('skips a feature that is not due or that the user asked not to see again', () => {
      const notDue = feat({ id: 'notDue', is_due: false });
      const stopped = feat({ id: 'stopped', is_due: true, dont_show_again_at: '2026-09-15T10:00:00Z' });
      expect(pickId(input({ features: [notDue, stopped, featB] }))).toBe('feature:featB');
      expect(pickId(input({ features: [notDue, stopped] }))).toBeNull();
    });
  });
});

describe('pickSystemDialogs (the system pager\'s pages)', () => {
  const ids = (list: PortalAnnouncement[]) => list.map((a) => a.id);
  const pages = (over: Partial<DialogQueueInput>) => ids(pickSystemDialogs(input(over)));

  it('every hard dialog first, then every due soft one, each in the order given', () => {
    const s1 = sys({ id: 's1' });
    const h1 = sys({ id: 'h1', blocking: 'hard' });
    const s2 = sys({ id: 's2' });
    const h2 = sys({ id: 'h2', blocking: 'hard' });
    expect(pages({ system: [s1, h1, s2, h2] })).toEqual(['h1', 'h2', 's1', 's2']);
    expect(pages({ system: [s2, s1] })).toEqual(['s2', 's1']);
  });

  it('the user\'s case: two soft dialogs due are two pages, a third not due is not one', () => {
    const d1 = sys({ id: 'd1', is_due: false });
    const d2 = sys({ id: 'd2' });
    const d3 = sys({ id: 'd3' });
    expect(pages({ system: [d1, d2, d3] })).toEqual(['d2', 'd3']);
  });

  it('a hard dialog ignores frequency; banners and features are never pages', () => {
    const hardNotDue = sys({ id: 'h', blocking: 'hard', is_due: false });
    const banner = sys({ id: 'banner', display: 'banner' });
    const feature = feat({ id: 'f' });
    expect(pages({ system: [banner, hardNotDue, feature] })).toEqual(['h']);
  });

  it('hard dialogs exempt on this route are left out; when every hard one is exempt, NO pages at all', () => {
    const toVehicles = sys({ id: 'toVehicles', blocking: 'hard', cta_label: 'Open', cta_url: '/vehicles' });
    const hardB = sys({ id: 'hardB', blocking: 'hard' });
    const soft = sys({ id: 'soft' });
    expect(pages({ system: [toVehicles, hardB, soft], pathname: '/vehicles' })).toEqual(['hardB', 'soft']);
    expect(pages({ system: [toVehicles, soft], pathname: '/vehicles' })).toEqual([]);
    expect(pages({ system: [hardB, soft], isSubscriptionPage: true, pathname: '/settings' })).toEqual([]);
    // Soft ones on their own show on the paywall's reachable pages too.
    expect(pages({ system: [soft], isSubscriptionPage: true, pathname: '/settings' })).toEqual(['soft']);
  });

  it('is not limited by the moment, and a repeated id is one page', () => {
    const a = sys({ id: 'a' });
    expect(pages({ system: [a, sys({ id: 'b' }), { ...a }], softMomentAvailable: false })).toEqual(['a', 'b']);
  });

  it('hasHardSystemDialog: any hard DIALOG, exempt here or not; a hard banner is not one', () => {
    expect(hasHardSystemDialog([sys({ id: 'x', blocking: 'hard', cta_url: '/vehicles' })])).toBe(true);
    expect(hasHardSystemDialog([sys({ id: 'b', blocking: 'hard', display: 'banner' }), sys({ id: 's' })])).toBe(false);
  });
});

describe('pickAnnouncementDialogs (the slot)', () => {
  it('blocked: nothing', () => {
    expect(pickAnnouncementDialogs(input({ blocked: true, system: [sys({ id: 's' })] }))).toBeNull();
  });

  it('system dialogs due: ONE pick holding every page, and never a feature with them', () => {
    const pick = pickAnnouncementDialogs(
      input({ system: [sys({ id: 's1' }), sys({ id: 'h', blocking: 'hard' }), sys({ id: 's2' })], features: [feat({ id: 'f' })] }),
    );
    expect(pick?.variant).toBe('system');
    expect(pick && pick.variant === 'system' ? pick.items.map((a) => a.id) : null).toEqual(['h', 's1', 's2']);
  });

  it('no system dialog: the first due feature on the dashboard, alone', () => {
    const pick = pickAnnouncementDialogs(input({ features: [feat({ id: 'f1' }), feat({ id: 'f2' })] }));
    expect(pick).toEqual({ variant: 'feature', announcement: expect.objectContaining({ id: 'f1' }) });
  });

  it('pickAnnouncementDialog is its first page', () => {
    const rows = [sys({ id: 's1' }), sys({ id: 'h', blocking: 'hard' })];
    expect(pickId(input({ system: rows }))).toBe('system-hard:h');
    expect(pickId(input({ system: [sys({ id: 's1' }), sys({ id: 's2' })] }))).toBe('system-soft:s1');
  });
});

describe('pickSystemBanner', () => {
  it('nothing without banner rows', () => {
    expect(pickSystemBanner([])).toBeNull();
    expect(pickSystemBanner([sys({ display: 'dialog' }), sys({ display: 'dialog', blocking: 'hard' })])).toBeNull();
  });

  it('takes the first banner in the order given (the server puts hard first)', () => {
    const hard = sys({ id: 'hardBanner', display: 'banner', blocking: 'hard' });
    const soft = sys({ id: 'softBanner', display: 'banner' });
    expect(pickSystemBanner([hard, soft])?.id).toBe('hardBanner');
    expect(pickSystemBanner([soft, hard])?.id).toBe('softBanner');
  });

  it('a hard banner shows even when marked not due; a soft one only when due', () => {
    const hardNotDue = sys({ id: 'hardNotDue', display: 'banner', blocking: 'hard', is_due: false });
    const softNotDue = sys({ id: 'softNotDue', display: 'banner', is_due: false });
    const softDue = sys({ id: 'softDue', display: 'banner' });
    expect(pickSystemBanner([softNotDue, hardNotDue])?.id).toBe('hardNotDue');
    expect(pickSystemBanner([softNotDue, softDue])?.id).toBe('softDue');
    expect(pickSystemBanner([softNotDue])).toBeNull();
  });

  it('ignores dialogs and features in the list', () => {
    const dialog = sys({ id: 'dialog' });
    const feature = feat({ id: 'feature', display: 'banner' as never });
    const banner = sys({ id: 'banner', display: 'banner' });
    expect(pickSystemBanner([dialog, feature, banner])?.id).toBe('banner');
  });
});

describe('pickSystemBanners (the rotating bar)', () => {
  const ids = (list: PortalAnnouncement[]) => list.map((a) => a.id);
  const soft = (id: string, over: Partial<PortalAnnouncement> = {}) => sys({ id, display: 'banner', ...over });
  const hard = (id: string, over: Partial<PortalAnnouncement> = {}) => sys({ id, display: 'banner', blocking: 'hard', ...over });

  it('nothing without banner rows', () => {
    expect(pickSystemBanners([])).toEqual([]);
    expect(pickSystemBanners([sys({ display: 'dialog' }), sys({ display: 'dialog', blocking: 'hard' })])).toEqual([]);
  });

  it('every due soft banner, in the order given; the ones not due wait', () => {
    expect(ids(pickSystemBanners([soft('a'), soft('old', { is_due: false }), soft('b'), soft('c')]))).toEqual(['a', 'b', 'c']);
    expect(ids(pickSystemBanners([soft('c'), soft('a')]))).toEqual(['c', 'a']);
    expect(pickSystemBanners([soft('old', { is_due: false })])).toEqual([]);
  });

  it('one due banner is a list of one (the bar shows no slider controls for it)', () => {
    expect(ids(pickSystemBanners([soft('only'), soft('old', { is_due: false })]))).toEqual(['only']);
  });

  it('a hard banner does NOT hide the soft ones: every hard one first, then every due soft one', () => {
    expect(ids(pickSystemBanners([hard('h1'), soft('s1'), soft('s2')]))).toEqual(['h1', 's1', 's2']);
    expect(ids(pickSystemBanners([hard('h1'), hard('h2'), soft('s1')]))).toEqual(['h1', 'h2', 's1']);
  });

  it('hard first does not depend on the server putting hard first; each group keeps the order given', () => {
    expect(ids(pickSystemBanners([soft('s1'), hard('h1'), soft('s2'), hard('h2')]))).toEqual(['h1', 'h2', 's1', 's2']);
  });

  it('a hard banner ignores frequency: it is in the list even when marked not due; a soft one is not', () => {
    expect(ids(pickSystemBanners([hard('h1', { is_due: false }), soft('s1'), soft('s0', { is_due: false })]))).toEqual([
      'h1',
      's1',
    ]);
  });

  it('the user\'s case: "maintenanec" and "ban 2", both soft and due, are both in the bar', () => {
    const rows = [soft('maintenanec'), sys({ id: 'd1', is_due: false }), soft('ban 2')];
    expect(ids(pickSystemBanners(rows))).toEqual(['maintenanec', 'ban 2']);
  });

  it('ignores dialogs (hard ones too) and features', () => {
    const hardDialog = sys({ id: 'hardDialog', blocking: 'hard' });
    const feature = feat({ id: 'feature', display: 'banner' as never });
    expect(ids(pickSystemBanners([hardDialog, feature, soft('s1'), soft('s2')]))).toEqual(['s1', 's2']);
  });

  it('a repeated id is one slide, in its first place', () => {
    expect(ids(pickSystemBanners([soft('a'), soft('b'), soft('a', { title: 'again' })]))).toEqual(['a', 'b']);
  });

  it('never mutates or re-orders the input', () => {
    const rows = [soft('b'), hard('h'), soft('a')];
    const before = rows.map((r) => ({ ...r }));
    pickSystemBanners(rows);
    expect(rows).toEqual(before);
  });

  it('agrees with pickSystemBanner on its first row for lists in server order (hard first)', () => {
    const lists = [
      [hard('h1'), hard('h2'), soft('s1')],
      [soft('old', { is_due: false }), soft('s1'), soft('s2')],
      [hard('h1', { is_due: false }), soft('s1')],
      [sys({ id: 'd' }), soft('s1')],
      [soft('old', { is_due: false })],
    ];
    for (const list of lists) expect(pickSystemBanners(list)[0] ?? null).toBe(pickSystemBanner(list));
  });
});
