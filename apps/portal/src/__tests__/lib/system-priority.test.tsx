/**
 * lib/announcements/system-priority.ts: the one signal that puts SYSTEM announcement
 * dialogs before onboarding that opens by itself (the tour's prompt and autostart, the
 * first-run wizard and its arrival, the setup reminder, the welcome-pack prompt).
 *
 * Pinned:
 *   - the store: idle by default, one notification per real change, mirrored onto
 *     `<html data-system-announcement>` (absent when idle);
 *   - `whenSystemAnnouncementsIdle`: now when idle, otherwise exactly once on the first
 *     return to idle, and cancellable;
 *   - `useYieldToSystemAnnouncements`, the hook the setup reminder and the welcome-pack
 *     prompt use: not shown while a system dialog is pending or open; an untouched
 *     surface that is up steps aside and comes back by itself; one the operator has
 *     touched stays; touching it while it is hidden does nothing; engagement is
 *     forgotten once the surface no longer wants to show.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  SYSTEM_ANNOUNCEMENT_ATTR,
  __resetSystemAnnouncementPriority,
  getSystemAnnouncementPriority,
  setSystemAnnouncementPriority,
  subscribeSystemAnnouncementPriority,
  useSystemAnnouncementPriority,
  useYieldToSystemAnnouncements,
  whenSystemAnnouncementsIdle,
} from '@/lib/announcements/system-priority';

afterEach(() => {
  __resetSystemAnnouncementPriority();
});

describe('the store', () => {
  it('is idle by default, notifies once per real change, and mirrors onto <html>', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSystemAnnouncementPriority(listener);
    expect(getSystemAnnouncementPriority()).toBe('idle');
    expect(document.documentElement.hasAttribute(SYSTEM_ANNOUNCEMENT_ATTR)).toBe(false);

    setSystemAnnouncementPriority('pending');
    setSystemAnnouncementPriority('pending');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(document.documentElement.getAttribute(SYSTEM_ANNOUNCEMENT_ATTR)).toBe('pending');

    setSystemAnnouncementPriority('open');
    expect(document.documentElement.getAttribute(SYSTEM_ANNOUNCEMENT_ATTR)).toBe('open');
    setSystemAnnouncementPriority('idle');
    expect(document.documentElement.hasAttribute(SYSTEM_ANNOUNCEMENT_ATTR)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    setSystemAnnouncementPriority('pending');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('useSystemAnnouncementPriority re-renders with every change', () => {
    const { result } = renderHook(() => useSystemAnnouncementPriority());
    expect(result.current).toBe('idle');
    act(() => setSystemAnnouncementPriority('open'));
    expect(result.current).toBe('open');
  });
});

describe('whenSystemAnnouncementsIdle', () => {
  it('runs now when idle', () => {
    const run = vi.fn();
    whenSystemAnnouncementsIdle(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('otherwise runs exactly once, on the first return to idle', () => {
    setSystemAnnouncementPriority('pending');
    const run = vi.fn();
    whenSystemAnnouncementsIdle(run);
    setSystemAnnouncementPriority('open');
    expect(run).not.toHaveBeenCalled();
    setSystemAnnouncementPriority('idle');
    expect(run).toHaveBeenCalledTimes(1);
    setSystemAnnouncementPriority('pending');
    setSystemAnnouncementPriority('idle');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled', () => {
    setSystemAnnouncementPriority('open');
    const run = vi.fn();
    const cancel = whenSystemAnnouncementsIdle(run);
    cancel();
    setSystemAnnouncementPriority('idle');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('useYieldToSystemAnnouncements (setup reminder, welcome-pack prompt)', () => {
  const render = (wants = true) =>
    renderHook(({ w }: { w: boolean }) => useYieldToSystemAnnouncements(w), { initialProps: { w: wants } });

  it('does not show while a system dialog is pending or open, and shows once it is idle', () => {
    act(() => setSystemAnnouncementPriority('pending'));
    const hook = render();
    expect(hook.result.current.show).toBe(false);
    act(() => setSystemAnnouncementPriority('open'));
    expect(hook.result.current.show).toBe(false);
    act(() => setSystemAnnouncementPriority('idle'));
    expect(hook.result.current.show).toBe(true);
  });

  it('up and untouched: steps aside when one becomes due, and comes back by itself', () => {
    const hook = render();
    expect(hook.result.current.show).toBe(true);
    act(() => setSystemAnnouncementPriority('pending'));
    expect(hook.result.current.show).toBe(false);
    expect(hook.result.current.engaged).toBe(false);
    act(() => setSystemAnnouncementPriority('idle'));
    expect(hook.result.current.show).toBe(true);
  });

  it('touched while showing: it stays, and the system dialog waits', () => {
    const hook = render();
    act(() => hook.result.current.engage());
    expect(hook.result.current.engaged).toBe(true);
    act(() => setSystemAnnouncementPriority('pending'));
    expect(hook.result.current.show).toBe(true);
    act(() => setSystemAnnouncementPriority('open'));
    expect(hook.result.current.show).toBe(true);
  });

  it('a touch while it is hidden does not bring it back', () => {
    act(() => setSystemAnnouncementPriority('pending'));
    const hook = render();
    act(() => hook.result.current.engage());
    expect(hook.result.current.show).toBe(false);
    expect(hook.result.current.engaged).toBe(false);
  });

  it('engagement is forgotten once the surface stops wanting to show', () => {
    const hook = render();
    act(() => hook.result.current.engage());
    act(() => hook.rerender({ w: false }));
    expect(hook.result.current.show).toBe(false);
    act(() => setSystemAnnouncementPriority('pending'));
    act(() => hook.rerender({ w: true }));
    expect(hook.result.current.show).toBe(false);
    expect(hook.result.current.engaged).toBe(false);
  });

  it('never shows what does not want to show', () => {
    const hook = render(false);
    expect(hook.result.current.show).toBe(false);
  });
});
