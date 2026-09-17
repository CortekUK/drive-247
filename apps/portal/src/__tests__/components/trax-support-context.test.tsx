import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraxSupportProvider, useTraxSupportChat, useTraxSupportChatOptional, useTraxSupportWorkspace } from '@/components/trax/support/trax-support-context';

// Offline: the panel state, router and support hook are mocked; no request is made.
const mocks = vi.hoisted(() => ({ trax: { sheetOpen: false } as { sheetOpen: boolean } | null, pathname: '/', enabled: [] as boolean[], clearChat: (() => {}) as () => void }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('@/components/trax/trax-provider', () => ({
  useTraxOptional: () => mocks.trax,
  isTraxPath: (p: string | null | undefined) => p === '/trax' || !!p?.startsWith('/trax/'),
  TraxProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('@/hooks/use-trax-support', () => ({ useTraxSupport: (enabled: boolean) => { mocks.enabled.push(enabled); return { enabled, messages: [], clearChat: mocks.clearChat }; } }));

let root: Root | null = null;
let seen: unknown = undefined;
function Probe() { seen = useTraxSupportChat(); return null; }
function mount(tree: unknown) {
  if (!root) { const node = document.createElement('div'); document.body.append(node); root = createRoot(node); }
  act(() => root!.render(tree as never));
}
const withProvider = () => createElement(TraxSupportProvider, null, createElement(Probe));

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.trax = { sheetOpen: false }; mocks.pathname = '/'; mocks.enabled = []; mocks.clearChat = vi.fn(); seen = undefined; });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('TraxSupportProvider', () => {
  it('stays idle until Trax is first opened, then keeps the conversation active after closing', () => {
    mount(withProvider());
    expect(mocks.enabled.at(-1)).toBe(false);
    mocks.trax = { sheetOpen: true }; mount(withProvider());
    expect(mocks.enabled.at(-1)).toBe(true);
    mocks.trax = { sheetOpen: false }; mount(withProvider());
    expect(mocks.enabled.at(-1)).toBe(true);
    expect(seen).toMatchObject({ enabled: true });
  });
  it('activates on the /trax full page', () => {
    mocks.pathname = '/trax';
    mount(withProvider());
    expect(mocks.enabled.at(-1)).toBe(true);
  });
  it('keeps the workspace view, and a new conversation clears the thread and returns to it', () => {
    let workspace: ReturnType<typeof useTraxSupportWorkspace> | undefined;
    function Workspace() { workspace = useTraxSupportWorkspace(); return null; }
    mount(createElement(TraxSupportProvider, null, createElement(Workspace)));
    expect(workspace!.view).toBe('conversation');
    act(() => workspace!.setView('history'));
    expect(workspace!.view).toBe('history');
    act(() => workspace!.startNew());
    expect(mocks.clearChat).toHaveBeenCalledTimes(1);
    expect(workspace!.view).toBe('conversation');
  });
  it('activates the conversation for the Support section, without a Trax surface open', () => {
    let workspace: ReturnType<typeof useTraxSupportWorkspace> | undefined;
    function Workspace() { workspace = useTraxSupportWorkspace(); return null; }
    mount(createElement(TraxSupportProvider, null, createElement(Workspace)));
    expect(mocks.enabled.at(-1)).toBe(false);
    act(() => workspace!.activate());
    expect(mocks.enabled.at(-1)).toBe(true);
  });
  it('requires the provider for surfaces that need the conversation, but not for optional chrome', () => {
    let optional: unknown = 'unset';
    function Optional() { optional = useTraxSupportChatOptional(); return null; }
    mount(createElement(Optional));
    expect(optional).toBeNull();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => mount(createElement(Probe))).toThrow(/TraxSupportProvider/);
    spy.mockRestore();
  });
});
