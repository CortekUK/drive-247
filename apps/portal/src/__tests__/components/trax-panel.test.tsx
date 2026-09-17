import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraxPanel } from '@/components/trax/trax-panel';

// Offline: the router, the panel state, the conversation and the thread are mocked.
const mocks = vi.hoisted(() => ({ trax: null as any, workspace: null as any, pathname: '/rentals', push: (_: string) => {} }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/components/trax/trax-provider', () => ({
  useTraxOptional: () => mocks.trax,
  isTraxPath: (p: string | null) => p === '/trax' || !!p?.startsWith('/trax/'),
}));
vi.mock('@/components/trax/support/trax-support-context', () => ({ useTraxSupportOptional: () => mocks.workspace }));
vi.mock('@/components/trax/support/TraxSupportThread', () => ({
  TraxSupportThread: (p: any) => createElement('div', { 'data-testid': 'thread', 'data-support': String(!!p.onOpenSupport) }),
}));
vi.mock('@/components/trax/trax-greeting', () => ({ TraxMark: () => createElement('span', { 'data-testid': 'mark' }) }));
vi.mock('@/components/ui-v2/tooltip', () => ({
  Tooltip: ({ children }: any) => children,
  TooltipTrigger: ({ children }: any) => children,
  TooltipContent: () => null,
}));

const conversation = () => ({
  view: 'conversation', setView: vi.fn(), startNew: vi.fn(), activate: vi.fn(),
  support: { messages: [{ id: 'm1' }], isLoading: false, capabilities: { modelReady: true } },
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
function render() {
  if (!container) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); }
  act(() => root!.render(createElement(TraxPanel)));
}
const panel = () => document.body.querySelector('[data-slot="trax-panel"]');
const button = (label: string) => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The panel arms itself over two frames before it animates in.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  mocks.pathname = '/rentals';
  mocks.push = vi.fn();
  mocks.workspace = conversation();
  mocks.trax = { sheetOpen: true, closeSheet: vi.fn(), openSheet: vi.fn(), toggleSheet: vi.fn(), minimiseToPanel: vi.fn(), leaveFullPage: vi.fn(), returnPath: '/rentals', surface: 'panel' };
});
afterEach(() => {
  act(() => root?.unmount()); root = null; container?.remove(); container = null;
  document.body.replaceChildren(); document.documentElement.removeAttribute('data-trax-panel');
  vi.unstubAllGlobals();
});

describe('the floating Trax panel', () => {
  it('floats above the page: nothing is added to the layout, and it is fixed on the body', () => {
    render();
    // Not in the tree it was mounted in — it is portalled to <body>.
    expect(container!.querySelector('[data-slot="trax-panel"]')).toBeNull();
    const aside = panel()!;
    expect(aside.parentElement).toBe(document.body);
    expect(aside.className).toContain('fixed');
    expect(aside.getAttribute('data-state')).toBe('open');
    // No flow gap, no reserved column: opening Trax cannot narrow the page.
    expect(document.querySelector('[data-slot="trax-gap"]')).toBeNull();
    expect(aside.className).not.toContain('translate-x-full');
    // And no backdrop over the page while it floats.
    expect(document.querySelector('[data-slot="trax-scrim"]')).toBeNull();
    expect(document.documentElement.getAttribute('data-trax-panel')).toBe('open');
  });

  it('expands to the larger overlay and restores, both over the same page', () => {
    render();
    expect(panel()!.getAttribute('data-size')).toBe('floating');
    act(() => button('Expand panel')!.click());
    expect(panel()!.getAttribute('data-size')).toBe('expanded');
    expect(panel()!.className).toContain('--trax-expanded-width');
    expect(document.documentElement.getAttribute('data-trax-size')).toBe('expanded');
    expect(document.querySelector('[data-slot="trax-scrim"]')).not.toBeNull();
    act(() => button('Restore panel size')!.click());
    expect(panel()!.getAttribute('data-size')).toBe('floating');
    expect(document.querySelector('[data-slot="trax-scrim"]')).toBeNull();
    // Restoring is a size, not a route: nothing navigated.
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('keeps the five header controls, Support among them, and leaves for the Support section', () => {
    render();
    for (const label of ['Conversation history', 'New conversation', 'Open Support', 'Expand panel', 'Close Trax']) {
      expect(button(label), label).not.toBeNull();
    }
    act(() => button('Open Support')!.click());
    expect(mocks.push).toHaveBeenCalledWith('/support');
    expect(mocks.trax.closeSheet).toHaveBeenCalled();
    expect(document.querySelector('[data-testid="thread"]')?.getAttribute('data-support')).toBe('true');
  });

  it('keeps the conversation mounted when it closes, and starts a new one only on request', () => {
    render();
    expect(document.querySelector('[data-testid="thread"]')).not.toBeNull();
    mocks.trax = { ...mocks.trax, sheetOpen: false };
    render();
    expect(panel()!.getAttribute('data-state')).toBe('closed');
    // The thread is still mounted: the conversation and an unsent draft survive.
    expect(document.querySelector('[data-testid="thread"]')).not.toBeNull();
    expect(mocks.workspace.support.messages).toHaveLength(1);
    act(() => button('New conversation')!.click());
    expect(mocks.workspace.startNew).toHaveBeenCalledTimes(1);
  });

  it('renders nothing on the full page, where the page itself is the conversation', () => {
    mocks.pathname = '/trax';
    render();
    expect(panel()).toBeNull();
  });
});
