import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalSupport } from '@/components/support/portal-support';

// Offline: the messaging client, the shared inbox and the TRAX conversation are mocked.
const mocks = vi.hoisted(() => ({ inbox: null as any, trax: null as any }));
vi.mock('@/hooks/use-support-messaging', () => ({
  useSupportMessaging: () => ({ call: vi.fn(), scope: 'scope-a', count: 2, allowed: true, checking: false, errorCode: null, retry: vi.fn() }),
}));
vi.mock('../../../../../shared/trax-support/SupportInbox', () => ({
  SupportInbox: (p: any) => { mocks.inbox = p; return createElement('div', { 'data-testid': 'support-inbox', 'data-initial': String(p.initialId ?? '') }); },
}));
vi.mock('@/components/trax/support/trax-support-context', () => ({ useTraxSupportOptional: () => mocks.trax }));

const issue = { id: 'i1', topic: 'payments', summary: 'Payment missing in Stripe', score: 100, state: 'needs_support', reason: null, checks: 2 };
const conversation = (overrides: Record<string, unknown> = {}) => ({
  activate: vi.fn(),
  support: {
    issues: [issue], isLoading: false,
    capabilities: { modelReady: true, supportStorage: true, supportSubmission: true, managePolicy: true },
    supportRequest: vi.fn(async (type: string) => (type === 'submit_ticket' ? { ticket: { id: 't9' } } : { retentionPolicy: { conversation_days: 90, closed_ticket_days: 180, inactive_open_days: 30, cleanup_enabled: false } })),
    ...overrides,
  },
});

let root: Root | null = null;
function render(props: Record<string, unknown> = {}) {
  const node = document.createElement('div'); document.body.append(node);
  root = createRoot(node);
  act(() => root!.render(createElement(PortalSupport, props as any)));
}
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); mocks.inbox = null; mocks.trax = conversation(); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('the portal Support section', () => {
  it('opens the existing tickets without composing or creating anything', () => {
    render();
    expect(document.querySelector('[data-testid="support-inbox"]')).not.toBeNull();
    expect(mocks.inbox.compose).toBeUndefined();
    expect(mocks.trax.support.supportRequest).not.toHaveBeenCalled();
    expect(mocks.trax.activate).toHaveBeenCalled();
  });
  it('opens the ticket a TRAX handoff or an unread badge points at', () => {
    render({ initialTicketId: 't1' });
    expect(mocks.inbox.initialId).toBe('t1');
    expect(mocks.trax.support.supportRequest).not.toHaveBeenCalled();
  });
  it('composes an escalation from the TRAX issue and submits it with the recorded context', async () => {
    render({ composeIssueId: 'i1' });
    expect(mocks.inbox.compose.summary).toBe('Payment missing in Stripe');
    expect(mocks.trax.support.supportRequest).not.toHaveBeenCalled(); // Opening creates no ticket.
    let created: unknown;
    await act(async () => { created = await mocks.inbox.compose.submit('The payment is still missing.', 'nonce-1', 'Payment missing in Stripe'); });
    expect(mocks.trax.support.supportRequest).toHaveBeenCalledWith('submit_ticket', { issueId: 'i1', ticket: { message: 'The payment is still missing.', nonce: 'nonce-1', subject: 'Payment missing in Stripe' } });
    expect(created).toEqual({ id: 't9' });
  });
  it('says so, and still composes, when the issue is no longer in the conversation', () => {
    mocks.trax = conversation({ issues: [] });
    render({ composeIssueId: 'i1' });
    expect(document.querySelector('[role="status"]')?.textContent).toContain('no longer in the open conversation');
    expect(mocks.inbox.compose).toEqual({ summary: '' });
  });
  it('offers retention only to operators allowed to manage it', async () => {
    mocks.trax = conversation({ capabilities: { modelReady: true, managePolicy: false } });
    render();
    expect(button('Retention')).toBeUndefined();
    act(() => root!.unmount()); document.body.replaceChildren(); root = null;
    mocks.trax = conversation();
    render();
    await act(async () => { button('Retention')!.click(); });
    expect(mocks.trax.support.supportRequest).toHaveBeenCalledWith('retention_policy');
    expect(document.body.textContent).toContain('Support retention');
  });
});
