/**
 * Which announcement gets the dialog slot and the banner slot (lib/announcements/queue.ts).
 *
 * Every expectation below is written by hand from the rules in the spec (§1
 * priority, §3.3 rules 1-6), never computed from the function under test:
 *
 *   code-driven gates win  >  system HARD (drag order)  >  system SOFT (drag order)
 *   >  feature (drag order, dashboard only, v2 only)
 *
 * with three twists that are easy to get wrong and are each pinned on their own:
 *   - a hard blocker exempt on this route still suppresses soft and feature dialogs;
 *   - a hard blocker is exempt on its own CTA page and below it, and "/" matches only "/";
 *   - once a soft dialog opened in this moment, no second soft dialog opens.
 */

import { describe, it, expect } from 'vitest';

import { pickAnnouncementDialog, pickSystemBanner, type DialogQueueInput } from '@/lib/announcements/queue';
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

  describe('rule 3: one soft dialog per moment', () => {
    it('no soft system or feature dialog once one opened in this moment', () => {
      expect(pickId(input({ system: [softA], features: [featA], softMomentAvailable: false }))).toBeNull();
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
