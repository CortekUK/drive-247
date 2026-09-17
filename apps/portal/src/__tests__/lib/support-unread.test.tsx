import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSupportUnread, type MessagingCall } from '../../../../../shared/trax-support/client';

/* The count behind the sidebar's Support badge: always the server's number, never
   a local increment, and "unknown" (no badge) whenever it cannot be trusted. */
let root: Root | null = null;
let seen: { count: number | null; errorCode: string | null }[] = [];
function Probe({ call, enabled = true }: { call: MessagingCall; enabled?: boolean }) {
  const state = useSupportUnread(call, enabled, { field: 'unreadMessages', interval: 60000 });
  seen.push({ count: state.count, errorCode: state.errorCode });
  return null;
}
const render = async (call: MessagingCall, enabled = true) => {
  if (!root) { const node = document.createElement('div'); document.body.append(node); root = createRoot(node); }
  await act(async () => { root!.render(createElement(Probe, { call, enabled })); });
};
const last = () => seen[seen.length - 1];

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); seen = []; });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('the unread-message count', () => {
  it('shows the server’s number, and follows it down after a read without counting anything itself', async () => {
    let server = 3;
    const call = vi.fn(async () => ({ unread: 2, unreadMessages: server }));
    await render(call);
    expect(last().count).toBe(3);
    server = 1;
    await act(async () => { window.dispatchEvent(new Event('trax-support-read')); });
    expect(last().count).toBe(1);
    // Repeated events re-ask; they never add.
    await act(async () => { for (let i = 0; i < 4; i++) window.dispatchEvent(new Event('trax-support-read')); });
    expect(last().count).toBe(1);
  });

  it('treats a response without the message count as unknown, not as the ticket count or zero', async () => {
    await render(vi.fn(async () => ({ unread: 4 })));
    expect(last().count).toBeNull();
  });

  it('forgets the previous account’s count when the account changes, and has none when signed out', async () => {
    await render(vi.fn(async () => ({ unread: 1, unreadMessages: 5 })));
    expect(last().count).toBe(5);
    let resolve!: (value: unknown) => void;
    const nextAccount = vi.fn(() => new Promise((r) => { resolve = r; })) as unknown as MessagingCall;
    await render(nextAccount);
    // While the new account's count is loading, the old one is not shown.
    expect(last().count).toBeNull();
    await act(async () => { resolve({ unread: 0, unreadMessages: 0 }); });
    expect(last().count).toBe(0);
    await render(vi.fn(async () => ({ unread: 1, unreadMessages: 9 })), false);
    expect(last().count).toBeNull();
  });

  it('does not ask while the tab is hidden, and asks again on return', async () => {
    const call = vi.fn(async () => ({ unread: 1, unreadMessages: 1 }));
    await render(call);
    const calls = call.mock.calls.length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
    expect(call.mock.calls.length).toBe(calls);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(call.mock.calls.length).toBe(calls + 1);
  });
});
