/**
 * useAnnouncementBlocked: code-driven gates always win over announcement dialogs.
 *
 * Each signal is flipped ALONE from an all-clear baseline and must block by itself,
 * so a signal silently dropped from the OR fails exactly one test. The DOM half is
 * driven through the real MutationObserver: tour and wizard markers appearing and
 * disappearing, and Radix's `data-scroll-locked` layer count, where the threshold
 * moves from 1 to 2 while the host's own dialog holds a lock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import {
  ANNOUNCEMENT_BLOCKING_MARKERS,
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

describe('useAnnouncementBlocked', () => {
  it('is clear when nothing else is on screen', () => {
    expect(render().result.current).toBe(false);
  });

  it('the subscription paywall blocks', () => {
    expect(render({ showGate: true, ownDialogOpen: false }).result.current).toBe(true);
  });

  it('the migration blocker blocks, and so does its row still loading', () => {
    migration = { migrationPromptShowing: true, isLoading: false };
    expect(render().result.current).toBe(true);
    migration = { migrationPromptShowing: false, isLoading: true };
    expect(render().result.current).toBe(true);
  });

  it('the first-run wizard blocks, and so does its row still loading', () => {
    wizard = { shouldShow: true, isLoading: false };
    expect(render().result.current).toBe(true);
    wizard = { shouldShow: false, isLoading: true };
    expect(render().result.current).toBe(true);
  });

  it('a first-run handoff reload (?firstrun=1) blocks; any other value does not', () => {
    window.history.replaceState(null, '', '/?firstrun=1&tenant=northwind');
    expect(render().result.current).toBe(true);
    window.history.replaceState(null, '', '/?firstrun=0');
    expect(render().result.current).toBe(false);
  });

  it('the feedback dialog blocks', async () => {
    const { result } = render();
    expect(result.current).toBe(false);
    act(() => useFeedbackStore.getState().open({ source: 'forced' }));
    expect(result.current).toBe(true);
    act(() => useFeedbackStore.getState().close());
    expect(result.current).toBe(false);
  });

  it.each(MARKERS)('a [%s] element blocks while it is in the document', async (attr) => {
    const { result } = render();
    const el = document.createElement('div');
    el.setAttribute(attr, '');
    await act(async () => {
      document.body.appendChild(el);
    });
    await flush();
    expect(result.current).toBe(true);
    await act(async () => {
      el.remove();
    });
    await flush();
    expect(result.current).toBe(false);
  });

  it('a nested marker (portalled deep in the tree) blocks too', async () => {
    const { result } = render();
    const outer = document.createElement('div');
    await act(async () => {
      document.body.appendChild(outer);
    });
    const inner = document.createElement('div');
    inner.setAttribute('data-tour-prompt', '');
    await act(async () => {
      outer.appendChild(inner);
    });
    await flush();
    expect(result.current).toBe(true);
  });

  it('any other open modal (one scroll lock) blocks when the host has no dialog open', async () => {
    const { result } = render();
    await act(async () => {
      document.body.setAttribute('data-scroll-locked', '1');
    });
    await flush();
    expect(result.current).toBe(true);
    await act(async () => {
      document.body.removeAttribute('data-scroll-locked');
    });
    await flush();
    expect(result.current).toBe(false);
  });

  it("with the host's own dialog open, its one lock is not a blocker, but a second modal is", async () => {
    const { result } = render({ showGate: false, ownDialogOpen: true });
    await act(async () => {
      document.body.setAttribute('data-scroll-locked', '1');
    });
    await flush();
    expect(result.current).toBe(false);
    await act(async () => {
      document.body.setAttribute('data-scroll-locked', '2');
    });
    await flush();
    expect(result.current).toBe(true);
  });

  it('re-reads the DOM when the host dialog closes while a lock is still held', async () => {
    document.body.setAttribute('data-scroll-locked', '1');
    const { result, rerender } = render({ showGate: false, ownDialogOpen: true });
    await flush();
    expect(result.current).toBe(false);
    rerender({ showGate: false, ownDialogOpen: false });
    await flush();
    expect(result.current).toBe(true);
  });
});

describe('readAnnouncementDomBlocked', () => {
  it('lists exactly the five markers', () => {
    expect(ANNOUNCEMENT_BLOCKING_MARKERS.split(',').map((s) => s.trim())).toEqual(MARKERS.map((m) => `[${m}]`));
  });

  it('counts scroll locks against the threshold', () => {
    expect(readAnnouncementDomBlocked(false)).toBe(false);
    document.body.setAttribute('data-scroll-locked', '1');
    expect(readAnnouncementDomBlocked(false)).toBe(true);
    expect(readAnnouncementDomBlocked(true)).toBe(false);
    document.body.setAttribute('data-scroll-locked', '2');
    expect(readAnnouncementDomBlocked(true)).toBe(true);
    document.body.setAttribute('data-scroll-locked', 'junk');
    expect(readAnnouncementDomBlocked(false)).toBe(false);
  });

  it('does not treat a popover (role="dialog") as a blocker', () => {
    const popover = document.createElement('div');
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('data-state', 'open');
    document.body.appendChild(popover);
    expect(readAnnouncementDomBlocked(false)).toBe(false);
  });
});
