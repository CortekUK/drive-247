/**
 * useAnnouncementBlocked: what an announcement dialog must wait for, answered twice
 * because the two kinds rank differently (team lead + user, Sep 17 2026):
 *
 *   code gates  >  SYSTEM dialogs  >  onboarding that opens by itself  >  FEATURE dialogs
 *
 *   `system`   only what outranks a system dialog: the paywall, the migration blocker
 *              (and its row loading), the first-run handoff reload, the feedback dialog,
 *              any other modal, and an onboarding surface the operator is USING (a
 *              marker without `data-yields-to-system`);
 *   `feature`  all of that, plus every onboarding surface, touched or not, and the
 *              first-run wizard's own state.
 *
 * Each signal is flipped ALONE from an all-clear baseline and must block by itself,
 * so a signal silently dropped from the OR fails exactly one test. The DOM half is
 * driven through the real MutationObserver: tour and wizard markers appearing and
 * disappearing, the yield attribute coming off when the operator touches a surface, and
 * Radix's `data-scroll-locked` layer count, where the threshold moves from 1 to 2 while
 * the host's own dialog holds a lock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import {
  ANNOUNCEMENT_BLOCKING_MARKERS,
  SYSTEM_ANNOUNCEMENT_BLOCKING_MARKERS,
  readAnnouncementDomBlocked,
  useAnnouncementBlocked,
} from '@/hooks/use-announcement-blocked';
import { useFeedbackStore } from '@/stores/feedback-store';

let migration = { migrationPromptShowing: false, isLoading: false };
let wizard = { shouldShow: false, isLoading: false };

vi.mock('@/hooks/use-migration-status', () => ({ useMigrationStatus: () => migration }));
vi.mock('@/hooks/use-first-run-wizard', () => ({ useFirstRunWizard: () => wizard }));

const MARKERS = [
  'data-first-rental-tour',
  'data-tour-transit',
  'data-tour-prompt',
  'data-first-run-wizard',
  'data-first-run-arrival',
];

const CLEAR = { system: false, feature: false };
const BOTH = { system: true, feature: true };
const FEATURE_ONLY = { system: false, feature: true };

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  migration = { migrationPromptShowing: false, isLoading: false };
  wizard = { shouldShow: false, isLoading: false };
  useFeedbackStore.setState({ isOpen: false });
  window.history.replaceState(null, '', '/');
  document.body.removeAttribute('data-scroll-locked');
});

afterEach(() => {
  // Unmount first: clearing the body under a live observer would set state outside act.
  cleanup();
  document.body.innerHTML = '';
  document.body.removeAttribute('data-scroll-locked');
  window.history.replaceState(null, '', '/');
});

const render = (props = { showGate: false, ownDialogOpen: false }) =>
  renderHook((p: { showGate: boolean; ownDialogOpen: boolean }) => useAnnouncementBlocked(p), { initialProps: props });

describe('useAnnouncementBlocked: code gates block BOTH kinds', () => {
  it('is clear when nothing else is on screen', () => {
    expect(render().result.current).toEqual(CLEAR);
  });

  it('the subscription paywall blocks', () => {
    expect(render({ showGate: true, ownDialogOpen: false }).result.current).toEqual(BOTH);
  });

  it('the migration blocker blocks, and so does its row still loading', () => {
    migration = { migrationPromptShowing: true, isLoading: false };
    expect(render().result.current).toEqual(BOTH);
    migration = { migrationPromptShowing: false, isLoading: true };
    expect(render().result.current).toEqual(BOTH);
  });

  it('a first-run handoff reload (?firstrun=1) blocks; any other value does not', () => {
    window.history.replaceState(null, '', '/?firstrun=1&tenant=northwind');
    expect(render().result.current).toEqual(BOTH);
    window.history.replaceState(null, '', '/?firstrun=0');
    expect(render().result.current).toEqual(CLEAR);
  });

  it('the feedback dialog blocks', async () => {
    const { result } = render();
    expect(result.current).toEqual(CLEAR);
    act(() => useFeedbackStore.getState().open({ source: 'forced' }));
    expect(result.current).toEqual(BOTH);
    act(() => useFeedbackStore.getState().close());
    expect(result.current).toEqual(CLEAR);
  });

  it('any other open modal (one scroll lock) blocks when the host has no dialog open', async () => {
    const { result } = render();
    await act(async () => {
      document.body.setAttribute('data-scroll-locked', '1');
    });
    await flush();
    expect(result.current).toEqual(BOTH);
    await act(async () => {
      document.body.removeAttribute('data-scroll-locked');
    });
    await flush();
    expect(result.current).toEqual(CLEAR);
  });

  it("with the host's own dialog open, its one lock is not a blocker, but a second modal is", async () => {
    const { result } = render({ showGate: false, ownDialogOpen: true });
    await act(async () => {
      document.body.setAttribute('data-scroll-locked', '1');
    });
    await flush();
    expect(result.current).toEqual(CLEAR);
    await act(async () => {
      document.body.setAttribute('data-scroll-locked', '2');
    });
    await flush();
    expect(result.current).toEqual(BOTH);
  });

  it('re-reads the DOM when the host dialog closes while a lock is still held', async () => {
    document.body.setAttribute('data-scroll-locked', '1');
    const { result, rerender } = render({ showGate: false, ownDialogOpen: true });
    await flush();
    expect(result.current).toEqual(CLEAR);
    rerender({ showGate: false, ownDialogOpen: false });
    await flush();
    expect(result.current).toEqual(BOTH);
  });
});

describe('useAnnouncementBlocked: onboarding blocks FEATURE dialogs; system dialogs only wait for one in use', () => {
  it('the first-run wizard (and its row still loading) holds features back, never a system dialog', () => {
    wizard = { shouldShow: true, isLoading: false };
    expect(render().result.current).toEqual(FEATURE_ONLY);
    wizard = { shouldShow: false, isLoading: true };
    expect(render().result.current).toEqual(FEATURE_ONLY);
  });

  it.each(MARKERS)('an UNTOUCHED [%s] (it carries data-yields-to-system) holds features back only', async (attr) => {
    const { result } = render();
    const el = document.createElement('div');
    el.setAttribute(attr, '');
    el.setAttribute('data-yields-to-system', '');
    await act(async () => {
      document.body.appendChild(el);
    });
    await flush();
    expect(result.current).toEqual(FEATURE_ONLY);
    await act(async () => {
      el.remove();
    });
    await flush();
    expect(result.current).toEqual(CLEAR);
  });

  it.each(MARKERS)('a [%s] the operator is USING (no yield attribute) blocks both', async (attr) => {
    const { result } = render();
    const el = document.createElement('div');
    el.setAttribute(attr, '');
    await act(async () => {
      document.body.appendChild(el);
    });
    await flush();
    expect(result.current).toEqual(BOTH);
    await act(async () => {
      el.remove();
    });
    await flush();
    expect(result.current).toEqual(CLEAR);
  });

  it('the moment the operator touches a surface (the attribute comes off) it blocks system dialogs too', async () => {
    const { result } = render();
    const el = document.createElement('div');
    el.setAttribute('data-first-run-wizard', '');
    el.setAttribute('data-yields-to-system', '');
    await act(async () => {
      document.body.appendChild(el);
    });
    await flush();
    expect(result.current).toEqual(FEATURE_ONLY);
    await act(async () => {
      el.removeAttribute('data-yields-to-system');
    });
    await flush();
    expect(result.current).toEqual(BOTH);
  });

  it('a nested marker (portalled deep in the tree) counts too', async () => {
    const { result } = render();
    const outer = document.createElement('div');
    await act(async () => {
      document.body.appendChild(outer);
    });
    const inner = document.createElement('div');
    inner.setAttribute('data-first-rental-tour', '');
    await act(async () => {
      outer.appendChild(inner);
    });
    await flush();
    expect(result.current).toEqual(BOTH);
  });
});

describe('readAnnouncementDomBlocked', () => {
  it('lists exactly the five markers, and the system scope skips the ones that yield', () => {
    expect(ANNOUNCEMENT_BLOCKING_MARKERS.split(',').map((s) => s.trim())).toEqual(MARKERS.map((m) => `[${m}]`));
    expect(SYSTEM_ANNOUNCEMENT_BLOCKING_MARKERS.split(',').map((s) => s.trim())).toEqual(
      MARKERS.map((m) => `[${m}]:not([data-yields-to-system])`),
    );
  });

  it('defaults to the strict (feature) scope', () => {
    const el = document.createElement('div');
    el.setAttribute('data-tour-prompt', '');
    el.setAttribute('data-yields-to-system', '');
    document.body.appendChild(el);
    expect(readAnnouncementDomBlocked(false)).toBe(true);
    expect(readAnnouncementDomBlocked(false, 'feature')).toBe(true);
    expect(readAnnouncementDomBlocked(false, 'system')).toBe(false);
  });

  it('counts scroll locks against the threshold, in both scopes', () => {
    for (const scope of ['system', 'feature'] as const) {
      document.body.removeAttribute('data-scroll-locked');
      expect(readAnnouncementDomBlocked(false, scope)).toBe(false);
      document.body.setAttribute('data-scroll-locked', '1');
      expect(readAnnouncementDomBlocked(false, scope)).toBe(true);
      expect(readAnnouncementDomBlocked(true, scope)).toBe(false);
      document.body.setAttribute('data-scroll-locked', '2');
      expect(readAnnouncementDomBlocked(true, scope)).toBe(true);
      document.body.setAttribute('data-scroll-locked', 'junk');
      expect(readAnnouncementDomBlocked(false, scope)).toBe(false);
    }
  });

  it('does not treat a popover (role="dialog") as a blocker', () => {
    const popover = document.createElement('div');
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('data-state', 'open');
    document.body.appendChild(popover);
    expect(readAnnouncementDomBlocked(false)).toBe(false);
    expect(readAnnouncementDomBlocked(false, 'system')).toBe(false);
  });
});
