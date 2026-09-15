import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingError, useSupportUnread, type MessagingCall } from '../../../../../shared/trax-support/client';

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const node = document.createElement('div'); document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount()); document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function mount(initialCall: MessagingCall, enabled = true) {
  let call = initialCall;
  const result = { current: undefined as unknown as ReturnType<typeof useSupportUnread> };
  function Harness() { result.current = useSupportUnread(call, enabled); return null; }
  const render = () => act(async () => { root.render(createElement(Harness)); });
  await render();
  return { result, replace: async (next: MessagingCall) => { call = next; await render(); } };
}

describe('support unread readiness', () => {
  it('reports missing setup without inventing zero unread tickets', async () => {
    const { result } = await mount(vi.fn().mockRejectedValue(new MessagingError('Missing configuration', 'local_configuration_required')));
    expect(result.current).toMatchObject({ allowed: false, count: null, checking: false, errorCode: 'local_configuration_required' });
  });
  it('allows an explicit retry to recover after configuration is fixed', async () => {
    const call = vi.fn().mockRejectedValueOnce(new MessagingError('Missing configuration', 'local_configuration_required')).mockResolvedValue({ unread: 2 });
    const { result } = await mount(call);
    await act(async () => { await result.current.retry(); });
    expect(result.current).toMatchObject({ allowed: true, count: 2, checking: false, errorCode: null });
    expect(call).toHaveBeenCalledTimes(2);
  });
  it('keeps a previously authorized inbox available during a temporary outage', async () => {
    const call = vi.fn().mockResolvedValueOnce({ unread: 3 }).mockRejectedValue(new Error('Offline'));
    const { result } = await mount(call);
    await act(async () => { await result.current.retry(); });
    expect(result.current).toMatchObject({ allowed: true, count: null, errorCode: 'unavailable' });
  });
  it('withdraws access after the server rejects a revoked grant', async () => {
    const call = vi.fn().mockResolvedValueOnce({ unread: 3 }).mockRejectedValue(new MessagingError('Access required', 'forbidden'));
    const { result } = await mount(call);
    await act(async () => { await result.current.retry(); });
    expect(result.current).toMatchObject({ allowed: false, count: null, errorCode: 'forbidden' });
  });
  it('does not query support when the viewer is ineligible', async () => {
    const call = vi.fn(); const { result } = await mount(call, false);
    await act(async () => { await result.current.retry(); });
    expect(call).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ allowed: false, count: null, checking: false });
  });
  it('discards a late access result after the account changes', async () => {
    let finish!: (value: { unread: number }) => void;
    const previous = new Promise<{ unread: number }>(resolve => { finish = resolve; });
    const { result, replace } = await mount(() => previous);
    expect(result.current.checking).toBe(true);
    await replace(vi.fn().mockRejectedValue(new MessagingError('Access required', 'forbidden')));
    await act(async () => { finish({ unread: 9 }); });
    expect(result.current).toMatchObject({ allowed: false, count: null, errorCode: 'forbidden' });
  });
});
