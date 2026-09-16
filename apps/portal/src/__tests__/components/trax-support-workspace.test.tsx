import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportWorkspace } from '@/components/trax/support/SupportWorkspace';

// Offline: the messaging client and the shared inbox are mocked; no request is made.
const mocks = vi.hoisted(() => ({ inbox: null as any }));
vi.mock('@/hooks/use-support-messaging', () => ({
  useSupportMessaging: () => ({ call: vi.fn(), scope: 'scope-a', count: 2, allowed: true, checking: false, errorCode: null, retry: vi.fn() }),
}));
vi.mock('../../../../../shared/trax-support/SupportInbox', () => ({
  SupportInbox: (p: any) => { mocks.inbox = p; return createElement('div', { 'data-testid': 'support-inbox', 'data-compact': String(!!p.compact) }); },
}));

const issue = { id: 'i1', topic: 'payments', summary: 'Payment missing in Stripe', score: 100, state: 'needs_support' as const, reason: null, checks: 2 };
const recent = [
  { id: 'c1', lastActivityAt: '2026-09-15T10:00:00Z', summary: 'Which vehicles are out on rent?' },
  { id: 'c2', lastActivityAt: '2026-09-14T09:00:00Z', summary: 'Payment missing in Stripe' },
];

let root: Root | null = null;
const request = vi.fn(async () => ({ ok: true }) as any);
const setView = vi.fn();
function render(props: Record<string, unknown> = {}) {
  const node = document.createElement('div'); document.body.append(node);
  root = createRoot(node);
  act(() => root!.render(createElement(SupportWorkspace, {
    request, capabilities: { modelReady: true, operationalChecks: true, finance: false, supportStorage: true, supportSubmission: true } as any,
    issues: [issue], activeIssueId: 'i1', recent, busy: false, compact: true, view: 'conversation', onView: setView,
    ...props,
  } as any, createElement('div', { 'data-testid': 'conversation' }))));
}
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); mocks.inbox = null; });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('TRAX support workspace views', () => {
  it('shows the conversation with its issue state and no bottom conversation picker', () => {
    render();
    expect(document.querySelector('[data-testid="conversation"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="trax-issue-state"]')).not.toBeNull();
    // The old "Continue a previous issue" select is gone; history has its own view.
    expect(document.querySelector('#trax-resume')).toBeNull();
    expect(document.body.textContent).not.toContain('Continue a previous issue');
  });
  it('opens support tickets inside TRAX, compact, with a way back to the conversation', () => {
    render({ view: 'tickets' });
    expect(document.querySelector('[data-testid="support-inbox"]')?.getAttribute('data-compact')).toBe('true');
    expect(document.querySelector('[data-testid="conversation"]')).toBeNull();
    act(() => button('Conversation')!.click());
    expect(setView).toHaveBeenCalledWith('conversation');
  });
  it('asks the server to reopen a stored conversation from the history view', async () => {
    render({ view: 'history' });
    const rows = [...document.querySelectorAll('[aria-label="Previous TRAX conversations"] button')];
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Which vehicles are out on rent?'), expect.stringContaining('Payment missing in Stripe')]);
    await act(async () => { (rows[1] as HTMLButtonElement).click(); });
    expect(request).toHaveBeenCalledWith('resume', { resumeId: 'c2' });
    expect(setView).toHaveBeenCalledWith('conversation');
  });
  it('states honestly when a reopen fails and when no conversation is stored', async () => {
    request.mockResolvedValueOnce(null as any);
    render({ view: 'history' });
    await act(async () => { (document.querySelector('[aria-label="Previous TRAX conversations"] button') as HTMLButtonElement).click(); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('could not be opened');
    act(() => root!.unmount()); document.body.replaceChildren(); root = null;
    render({ view: 'history', recent: [] });
    expect(document.body.textContent).toContain('No saved conversations yet');
  });
  it('hands the ticket composer the issue summary when support is requested from the issue bar', () => {
    render();
    act(() => button('Communicate with Support')!.click());
    expect(setView).toHaveBeenCalledWith('tickets');
  });
  it('keeps its own row when no header drives it (the standalone dialog)', () => {
    render({ view: undefined, onView: undefined });
    expect(button('My Tickets')).toBeDefined();
    expect(button('History')).toBeDefined();
    act(() => button('History')!.click());
    expect(document.querySelector('[aria-label="Previous TRAX conversations"]')).not.toBeNull();
  });
});
