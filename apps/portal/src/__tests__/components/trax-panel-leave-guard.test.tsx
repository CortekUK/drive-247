/**
 * The floating Trax panel and the v2 leave guard.
 *
 * "Open Support" leaves the page the operator is on. From a v2 Settings page
 * with unsaved edits that has to ask first, and the panel must stay put while
 * it asks — closing it on the way to a dialog the operator may cancel loses the
 * conversation they were reading. With no guard installed (every v1 tenant, and
 * any v2 page with nothing unsaved) it is the plain push and close it was.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLeaveGuard, hasLeaveGuard } from '@/lib/leave-guard';
import { TraxPanel } from '@/components/trax/trax-panel';

// Offline: the router, the panel state, the conversation and the thread are mocked.
const mocks = vi.hoisted(() => ({ trax: null as any, workspace: null as any, pathname: '/settings?tab=locations', push: (_: string) => {} }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/components/trax/trax-provider', () => ({
  useTraxOptional: () => mocks.trax,
  isTraxPath: (p: string | null) => p === '/trax' || !!p?.startsWith('/trax/'),
}));
vi.mock('@/components/trax/support/trax-support-context', () => ({ useTraxSupportOptional: () => mocks.workspace }));
vi.mock('@/components/trax/support/TraxSupportThread', () => ({
  TraxSupportThread: () => createElement('div', { 'data-testid': 'thread' }),
}));
vi.mock('@/components/trax/trax-greeting', () => ({ TraxMark: () => createElement('span', { 'data-testid': 'mark' }) }));
vi.mock('@/components/ui-v2/tooltip', () => ({
  Tooltip: ({ children }: any) => children,
  TooltipTrigger: ({ children }: any) => children,
  TooltipContent: () => null,
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const render = () => {
  if (!container) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); }
  act(() => root!.render(createElement(TraxPanel)));
};
const openSupport = () => act(() => document.body.querySelector<HTMLButtonElement>('button[aria-label="Open Support"]')!.click());

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The panel arms itself over two frames before it animates in.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  mocks.pathname = '/settings?tab=locations';
  mocks.push = vi.fn();
  mocks.workspace = { view: 'conversation', setView: vi.fn(), startNew: vi.fn(), activate: vi.fn(), support: { messages: [], isLoading: false, capabilities: { modelReady: true } } };
  mocks.trax = { sheetOpen: true, closeSheet: vi.fn(), openSheet: vi.fn(), toggleSheet: vi.fn(), minimiseToPanel: vi.fn(), leaveFullPage: vi.fn(), returnPath: '/settings?tab=locations', surface: 'panel' };
});
afterEach(() => {
  act(() => root?.unmount()); root = null; container?.remove(); container = null;
  document.body.replaceChildren(); document.documentElement.removeAttribute('data-trax-panel');
  vi.unstubAllGlobals();
});

describe('Open Support from the floating panel', () => {
  it('asks the leave guard first, and leaves only when it says so', () => {
    const asked: string[] = [];
    let proceed: (() => void) | null = null;
    const dispose = setLeaveGuard((href, run) => { asked.push(href); proceed = run; return true; });
    try {
      render();
      openSupport();
      // The guard has it: nothing navigated, and Trax is still open behind the dialog.
      expect(asked).toEqual(['/support']);
      expect(mocks.push).not.toHaveBeenCalled();
      expect(mocks.trax.closeSheet).not.toHaveBeenCalled();
      // Save or "Don't save": now it goes, and the panel closes with it.
      act(() => proceed!());
      expect(mocks.push).toHaveBeenCalledTimes(1);
      expect(mocks.push).toHaveBeenCalledWith('/support');
      expect(mocks.trax.closeSheet).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('with no guard installed (v1, and a v2 page with nothing unsaved) it goes straight there', () => {
    expect(hasLeaveGuard()).toBe(false);
    render();
    openSupport();
    expect(mocks.push).toHaveBeenCalledWith('/support');
    expect(mocks.trax.closeSheet).toHaveBeenCalledTimes(1);
  });
});
