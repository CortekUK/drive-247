import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportWorkspace } from '@/components/trax/support/SupportWorkspace';

const issue = { id: 'i1', topic: 'payments', summary: 'Payment missing in Stripe', score: 100, state: 'needs_support' as const, reason: null, checks: 2 };
const recent = [
  { id: 'c1', lastActivityAt: '2026-09-15T10:00:00Z', summary: 'Which vehicles are out on rent?' },
  { id: 'c2', lastActivityAt: '2026-09-14T09:00:00Z', summary: 'Payment missing in Stripe' },
];

let root: Root | null = null;
const request = vi.fn(async () => ({ ok: true }) as any);
const setView = vi.fn();
const onOpenSupport = vi.fn();
function render(props: Record<string, unknown> = {}) {
  const node = document.createElement('div'); document.body.append(node);
  root = createRoot(node);
  act(() => root!.render(createElement(SupportWorkspace, {
    request, capabilities: { modelReady: true, operationalChecks: true, finance: false, supportStorage: true, supportSubmission: true } as any,
    issues: [issue], activeIssueId: 'i1', recent, busy: false, onOpenSupport, view: 'conversation', onView: setView,
    ...props,
  } as any, createElement('div', { 'data-testid': 'conversation' }))));
}
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('TRAX support workspace views', () => {
  it('shows the conversation with its issue state, and no ticket interface inside TRAX', () => {
    render();
    expect(document.querySelector('[data-testid="conversation"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="trax-issue-state"]')).not.toBeNull();
    // Tickets, replies and the old bottom picker all live in the portal's Support section.
    expect(document.querySelector('[data-testid="support-inbox"]')).toBeNull();
    expect(document.querySelector('#trax-resume')).toBeNull();
    expect(document.body.textContent).not.toContain('Continue a previous issue');
    expect(document.body.textContent).not.toContain('My Tickets');
  });
  it('opens the portal Support section for this issue, creating nothing, when support is requested', () => {
    render();
    act(() => button('Communicate with Support')!.click());
    expect(onOpenSupport).toHaveBeenCalledWith({ issueId: 'i1' });
    expect(request).not.toHaveBeenCalled();
    expect(setView).not.toHaveBeenCalled();
  });
  it('opens the existing ticket conversation once the issue has one', () => {
    render({ issues: [{ ...issue, state: 'submitted', ticketId: 't1' }] });
    act(() => button('Open support conversation')!.click());
    expect(onOpenSupport).toHaveBeenCalledWith({ ticketId: 't1' });
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
  it('keeps its own row when no header drives it (the standalone dialog)', () => {
    render({ view: undefined, onView: undefined });
    expect(button('History')).toBeDefined();
    act(() => button('History')!.click());
    expect(document.querySelector('[aria-label="Previous TRAX conversations"]')).not.toBeNull();
    act(() => button('Open Support')!.click());
    expect(onOpenSupport).toHaveBeenCalledWith({});
  });
});
