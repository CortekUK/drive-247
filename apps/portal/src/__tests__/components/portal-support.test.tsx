import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalSupport } from '@/components/support/portal-support';

// Offline: the messaging client, the inbox hook and the TRAX conversation are mocked.
const mocks = vi.hoisted(() => ({ options: null as any, inbox: null as any, view: null as any, trax: null as any }));
vi.mock('@/hooks/use-support-messaging', () => ({
  useSupportMessaging: () => ({ call: mocks.options?.call ?? (() => {}), scope: 'scope-a', count: 2, allowed: true, checking: false, errorCode: null, retry: vi.fn() }),
}));
vi.mock('../../../../../shared/trax-support/use-support-inbox', () => ({
  useSupportInbox: (options: any) => { mocks.options = options; return mocks.inbox; },
}));
vi.mock('@/components/support/support-inbox', () => ({
  SupportInboxView: (p: any) => { mocks.view = p; return createElement('div', { 'data-testid': 'support-inbox' }); },
}));
vi.mock('@/components/trax/support/trax-support-context', () => ({ useTraxSupportOptional: () => mocks.trax }));

const issue = { id: 'i1', topic: 'payments', summary: 'Payment missing in Stripe', score: 100, state: 'needs_support', reason: null, checks: 2 };
const conversation = (overrides: Record<string, unknown> = {}) => ({
  activate: vi.fn(),
  support: {
    issues: [issue], isLoading: false,
    capabilities: { modelReady: true, supportStorage: true, supportSubmission: true, managePolicy: true },
    supportRequest: vi.fn(async (type: string) => (type === 'submit_ticket'
      ? { ticket: { id: 't9' } }
      : { retentionPolicy: { conversation_days: 90, closed_ticket_days: 180, inactive_open_days: 30, cleanup_enabled: false } })),
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

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mocks.options = null; mocks.view = null;
  mocks.inbox = { busy: false, creating: false, beginNew: vi.fn() };
  mocks.trax = conversation();
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('the portal Support section', () => {
  it('is one header over one workspace, with New ticket as the only compose entry', () => {
    render();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('h1')?.textContent).toBe('Support');
    expect(document.body.textContent).not.toContain('My Tickets');
    expect(document.querySelector('[data-testid="support-inbox"]')).not.toBeNull();
    act(() => button('New ticket')!.click());
    expect(mocks.inbox.beginNew).toHaveBeenCalledTimes(1);
    // Opening the section asks for nothing but the tickets themselves.
    expect(mocks.trax.support.supportRequest).not.toHaveBeenCalled();
  });

  it('opens the ticket a TRAX handoff or an unread badge points at', () => {
    render({ initialTicketId: 't1' });
    expect(mocks.options.initialId).toBe('t1');
    expect(mocks.options.scope).toBe('scope-a');
    expect(mocks.options.compose).toBeUndefined();
    expect(mocks.trax.activate).toHaveBeenCalled();
  });

  it('composes an escalation from the TRAX issue and submits it with the recorded context', async () => {
    render({ composeIssueId: 'i1' });
    expect(mocks.options.compose.summary).toBe('Payment missing in Stripe');
    expect(mocks.trax.support.supportRequest).not.toHaveBeenCalled(); // Opening creates no ticket.
    let created: unknown;
    await act(async () => { created = await mocks.options.compose.submit('The payment is still missing.', 'nonce-1', 'Payment missing in Stripe'); });
    expect(mocks.trax.support.supportRequest).toHaveBeenCalledWith('submit_ticket', { issueId: 'i1', ticket: { message: 'The payment is still missing.', nonce: 'nonce-1', subject: 'Payment missing in Stripe' } });
    expect(created).toEqual({ id: 't9' });
  });

  it('says so, and still composes, when the issue is no longer in the conversation', () => {
    mocks.trax = conversation({ issues: [] });
    render({ composeIssueId: 'i1' });
    expect(document.querySelector('[role="status"]')?.textContent).toContain('no longer in the open conversation');
    expect(mocks.options.compose).toEqual({ summary: '' });
  });

  it('offers retention only to operators allowed to manage it, in a dialog over the workspace', async () => {
    mocks.trax = conversation({ capabilities: { modelReady: true, managePolicy: false } });
    render();
    expect(button('Retention')).toBeUndefined();
    act(() => root!.unmount()); document.body.replaceChildren(); root = null;
    mocks.trax = conversation();
    render();
    await act(async () => { button('Retention')!.click(); });
    expect(mocks.trax.support.supportRequest).toHaveBeenCalledWith('retention_policy');
    expect(document.body.textContent).toContain('Support retention');
    expect(document.body.textContent).toContain('Conversation days after last activity');
  });
});
