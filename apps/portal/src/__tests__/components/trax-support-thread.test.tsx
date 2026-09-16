import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraxSupportThread } from '@/components/trax/support/TraxSupportThread';

// Offline: the support conversation, composer, greeting, messages and workspace are mocked.
const mocks = vi.hoisted(() => ({ support: null as any, workspace: null as any, state: null as any }));
vi.mock('@/components/trax/support/trax-support-context', () => ({
  useTraxSupportChat: () => mocks.support,
  useTraxSupportWorkspace: () => mocks.state,
}));
vi.mock('@/components/trax/trax-composer', () => ({
  TraxComposer: (p: any) => createElement('button', { 'data-testid': 'composer', 'data-busy': String(p.busy), 'data-attach': String(!!p.capability), onClick: () => p.onSend('Which cars are free today?', []) }, 'send'),
}));
vi.mock('@/components/trax/trax-greeting', () => ({ TraxGreeting: () => createElement('div', { 'data-testid': 'greeting' }) }));
vi.mock('@/components/trax/support/ChatMessage', () => ({
  ChatMessage: (p: any) => createElement('div', { 'data-testid': 'message', 'data-check-again': String(!!p.onCheckAgain), 'data-navigate': String(!!p.onVerifyNavigation) }),
}));
vi.mock('@/components/trax/support/SupportWorkspace', () => ({
  SupportWorkspace: (p: any) => { mocks.workspace = p; return createElement('div', { 'data-testid': 'workspace' }, p.children); },
}));

const base = () => ({
  messages: [] as any[], isLoading: false, error: null as string | null, conversationId: null,
  sendMessage: vi.fn(async () => {}), confirmAction: vi.fn(async () => {}), rejectAction: vi.fn(), clearChat: vi.fn(),
  navigate: vi.fn(async () => true), checkAgain: vi.fn(async () => {}),
  capabilities: { modelReady: true, operationalChecks: true, finance: false } as any,
  supportRequest: vi.fn(async () => null), issues: [{ id: 'i1', topic: 'payments', summary: 'Payment', score: 100, state: 'needs_support', reason: null, checks: 2 }],
  activeIssueId: 'i1', recentConversations: [], contextKey: 'scope-a',
});

let root: Root | null = null;
function render(density: 'sheet' | 'page' = 'sheet') {
  const node = document.createElement('div'); document.body.append(node);
  root = createRoot(node);
  act(() => root!.render(createElement(TraxSupportThread, { density })));
}
const buttons = (label: string) => [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes(label));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.support = base(); mocks.workspace = null;
  mocks.state = { view: 'conversation', setView: vi.fn(), startNew: vi.fn() };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('TraxSupportThread in the Trax panel', () => {
  it('opens on the greeting with support-capable suggestions that ask TRAX', () => {
    render();
    expect(document.querySelector('[data-testid="greeting"]')).not.toBeNull();
    expect(buttons("Check a rental's payments")).toHaveLength(0);
    act(() => buttons('Vehicles out now')[0].click());
    expect(mocks.support.sendMessage).toHaveBeenCalledWith('Which vehicles are out on rent right now?');
  });
  it('offers the payment check only with the finance capability', () => {
    mocks.support.capabilities.finance = true;
    render('page');
    expect(buttons("Check a rental's payments")).toHaveLength(1);
  });
  it('sends typed questions through the support conversation, text only', () => {
    render();
    const composer = document.querySelector<HTMLButtonElement>('[data-testid="composer"]')!;
    expect(composer.dataset.attach).toBe('false');
    act(() => composer.click());
    expect(mocks.support.sendMessage).toHaveBeenCalledWith('Which cars are free today?');
  });
  it('renders verified messages with navigation and Check again on the latest answer only', () => {
    mocks.support.messages = [
      { id: 'm1', role: 'user', content: 'Show payments for R-1', timestamp: new Date() },
      { id: 'm2', role: 'assistant', content: 'Verified.', timestamp: new Date(), canRecheck: true },
    ];
    render();
    const rendered = [...document.querySelectorAll<HTMLElement>('[data-testid="message"]')];
    expect(rendered.map((m) => m.dataset.checkAgain)).toEqual(['false', 'true']);
    expect(rendered.every((m) => m.dataset.navigate === 'true')).toBe(true);
    expect(document.querySelector('[data-testid="greeting"]')).toBeNull();
  });
  it('passes issues and the support request to the workspace for tickets and handoff', () => {
    render();
    expect(mocks.workspace.request).toBe(mocks.support.supportRequest);
    expect(mocks.workspace.issues).toHaveLength(1);
    expect(mocks.workspace.activeIssueId).toBe('i1');
  });
  it('shows the payment progress line and errors honestly', () => {
    mocks.support.capabilities = { modelReady: true, operationalChecks: true, finance: true };
    mocks.support.messages = [{ id: 'm1', role: 'user', content: 'Check the stripe payment', timestamp: new Date() }];
    mocks.support.isLoading = true;
    mocks.support.error = 'TRAX could not verify access.';
    render();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Verifying with Stripe');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('TRAX could not verify access.');
  });
  it('says plainly when no AI model is configured', () => {
    mocks.support.capabilities = { modelReady: false, operationalChecks: false, finance: false };
    render();
    expect(document.body.textContent).toContain('not connected to an AI model');
  });
  it('hands the workspace the current view so history and tickets open inside TRAX', () => {
    mocks.state.view = 'tickets';
    render();
    expect(mocks.workspace.view).toBe('tickets');
    expect(mocks.workspace.onView).toBe(mocks.state.setView);
  });
  it('renders nothing while the panel is closed and uses the compact ticket layout in the panel', () => {
    const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
    act(() => root!.render(createElement(TraxSupportThread, { density: 'sheet', active: false })));
    expect(document.querySelector('[data-testid="workspace"]')).toBeNull();
    act(() => root!.render(createElement(TraxSupportThread, { density: 'sheet', active: true })));
    expect(mocks.workspace.compact).toBe(true);
    act(() => root!.render(createElement(TraxSupportThread, { density: 'page' })));
    expect(mocks.workspace.compact).toBe(false);
  });
});
