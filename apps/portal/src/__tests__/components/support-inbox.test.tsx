import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportInboxView } from '@/components/support/support-inbox';
import type { SupportInboxState } from '../../../../../shared/trax-support/use-support-inbox';

// Offline: the view is given the inbox state directly; nothing is fetched.
const ticket = (over: Record<string, unknown> = {}) => ({
  id: 't1', reference: 'TRX-1111', summary: 'Returned vehicle still shows as out on rent',
  status: 'open' as const, tenant_name: 'Northwind', requester: 'Operator',
  created_at: '2026-09-15T09:00:00Z', updated_at: '2026-09-16T09:00:00Z', unread: false, ...over,
});
const message = (seq: number, author: 'tenant' | 'support', body: string, minutesAgo: number) => ({
  seq, author_kind: author, body, created_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
});

function state(over: Partial<SupportInboxState> = {}): SupportInboxState {
  return {
    id: null, creating: false, tickets: [], next: null, thread: null, search: '', filter: '',
    draft: '', subject: '', status: '', busy: false, loading: false, error: null, notice: '',
    retrying: false, canSend: false, canAttach: false, attachments: [], scrollRef: { current: null },
    setSearch: vi.fn(), setFilter: vi.fn(), setDraft: vi.fn(), setSubject: vi.fn(), setStatus: vi.fn(),
    choose: vi.fn(), clearSelection: vi.fn(), beginNew: vi.fn(), cancelNew: vi.fn(),
    loadMore: vi.fn(), loadOlder: vi.fn(), onThreadScroll: vi.fn(), send: vi.fn(),
    addAttachments: vi.fn(), removeAttachment: vi.fn(),
    ...over,
  } as unknown as SupportInboxState;
}

let root: Root | null = null;
function render(inbox: SupportInboxState) {
  const node = document.createElement('div'); document.body.append(node);
  root = createRoot(node);
  act(() => root!.render(createElement(SupportInboxView, { inbox })));
}
const text = () => document.body.textContent ?? '';
const bubbles = () => [...document.querySelectorAll('[data-slot="bubble"]')];

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('the Support inbox view', () => {
  it('lists tickets with their real status and the server\'s own unread flag', () => {
    const inbox = state({ tickets: [ticket({ unread: true }), ticket({ id: 't2', reference: 'TRX-2222', summary: 'Invoice email bounced', status: 'closed' })] as never });
    render(inbox);
    const rows = document.querySelectorAll('[data-testid="support-ticket-list"] li');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Open');
    expect(rows[0].textContent).toContain('TRX-1111');
    expect(rows[0].textContent).toContain('Unread');
    expect(rows[1].textContent).toContain('Resolved');
    expect(rows[1].textContent).not.toContain('Unread');
    act(() => (rows[1].querySelector('button') as HTMLButtonElement).click());
    expect(inbox.choose).toHaveBeenCalledWith('t2');
  });

  it('asks for the tenant\'s own tickets, and says when a filter matches none', () => {
    render(state({ search: 'refund', filter: 'open' }));
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Search support tickets"]')?.placeholder).toBe('Search your tickets…');
    expect(text()).toContain('No tickets match these filters.');
    render(state());
    expect(text()).toContain('No support tickets yet.');
  });

  it('draws content-sized bubbles: tenant right, support left, grouped by turn and day', () => {
    const inbox = state({
      id: 't1',
      thread: {
        ticket: ticket(),
        messages: [
          message(1, 'tenant', 'The keys are back.', 60),
          message(2, 'support', 'Thanks, checking now.', 40),
          message(3, 'support', 'The rental is still open our side.', 39),
          message(4, 'tenant', 'Understood.', 2),
        ],
        hasOlder: false, latestSeq: 4,
      },
    } as never);
    render(inbox);
    // Four messages, three turns: the two consecutive support replies are one.
    expect(bubbles()).toHaveLength(4);
    expect(document.querySelectorAll('[data-slot="message"]')).toHaveLength(3);
    const aligns = [...document.querySelectorAll('[data-slot="message"]')].map((m) => m.getAttribute('data-align'));
    expect(aligns).toEqual(['end', 'start', 'end']);
    // The tenant's own bubble is the tinted one; support's is the neutral surface.
    expect(bubbles()[0].getAttribute('data-variant')).toBe('tinted');
    expect(bubbles()[1].getAttribute('data-variant')).toBe('muted');
    // A three-word reply is a bubble sized to its content, not a full-width card.
    expect(bubbles()[0].className).toContain('w-fit');
    // Every message keeps its read marker, so acknowledgement stays per message.
    expect(document.querySelectorAll('[data-seq]')).toHaveLength(4);
    expect(document.querySelectorAll('[role="separator"]').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll('[data-slot="message-header"]')[0].textContent).toBe('Drive247 Support');
  });

  it('keeps the subject in the header, the status beside its reference, and no created/updated strip', () => {
    render(state({ id: 't1', thread: { ticket: ticket({ handoff: { disclosure: 'Historical observations only.' } }), messages: [], hasOlder: false, latestSeq: 0 } } as never));
    const header = document.querySelector('[aria-label="Support conversation"] header')!;
    expect(header.querySelector('h2')?.textContent).toContain('Returned vehicle still shows as out on rent');
    expect(header.textContent).toContain('TRX-1111');
    expect(header.querySelector('[data-testid="ticket-status"]')?.textContent).toBe('Open');
    expect(header.textContent).not.toMatch(/Created|Last updated/i);
    // The handoff is a collapsed section in the conversation, not an open block.
    const context = document.querySelector('details');
    expect(context?.open).toBe(false);
    expect(context?.textContent).toContain('TRAX troubleshooting context');
    // Ticket metadata lives behind Issue details.
    act(() => (document.querySelector('[data-slot="collapsible-trigger"]') as HTMLButtonElement).click());
    expect(text()).toContain('Last activity');
  });

  it('shows a failed send once, keeps the draft and offers the retry', () => {
    const inbox = state({
      id: 't1', draft: 'Still waiting on this.', canSend: true, retrying: true,
      error: 'Support could not confirm this request.',
      thread: { ticket: ticket(), messages: [message(1, 'tenant', 'Hello', 5)], hasOlder: false, latestSeq: 1 },
    } as never);
    render(inbox);
    const alerts = document.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain('could not confirm');
    expect(document.querySelector<HTMLTextAreaElement>('#support-message')?.value).toBe('Still waiting on this.');
    const send = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Retry send'))!;
    expect(send).toBeDefined();
    act(() => send.click());
    expect(inbox.send).toHaveBeenCalled();
  });

  it('composes a new ticket with a subject, and cancels without creating one', () => {
    const inbox = state({ creating: true, subject: 'Deposit not released', draft: 'Three days and counting.', canSend: true });
    render(inbox);
    expect(document.querySelector<HTMLInputElement>('#support-subject')?.value).toBe('Deposit not released');
    expect(document.querySelector('label[for="support-message"]')?.textContent).toBe('Your message');
    act(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click());
    expect(inbox.cancelNew).toHaveBeenCalled();
    expect(inbox.send).not.toHaveBeenCalled();
  });

  it('offers the paperclip only with an upload path, shows what is attached, and renders what was sent', () => {
    const sent = { id: 'a1', seq: 1, name: 'shot.png', mime: 'image/png', size: 2048, authorKind: 'tenant' as const, url: 'https://storage.invalid/x' };
    const thread = { ticket: ticket(), messages: [message(1, 'tenant', 'Here it is', 5)], hasOlder: false, latestSeq: 1, attachments: [sent] };
    const inbox = state({ id: 't1', canAttach: true, attachments: [{ key: 'k1', file: {} as File, name: 'later.png', mime: 'image/png', size: 4096 }], thread } as never);
    render(inbox);
    expect(document.querySelector('button[aria-label="Attach a file"]')).not.toBeNull();
    expect(text()).toContain('later.png');
    expect(document.querySelector<HTMLImageElement>('img[alt="shot.png"]')?.getAttribute('src')).toBe('https://storage.invalid/x');
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Remove later.png"]')!.click());
    expect(inbox.removeAttachment).toHaveBeenCalledWith('k1');
    // A file whose URL could not be signed is named, not guessed at.
    act(() => root!.unmount()); document.body.replaceChildren(); root = null;
    render(state({ id: 't1', canAttach: false, thread: { ...thread, attachments: [{ ...sent, url: undefined }] } } as never));
    expect(document.querySelector('button[aria-label="Attach a file"]')).toBeNull();
    expect(document.querySelector('img[alt="shot.png"]')).toBeNull();
    expect(text()).toContain('shot.png');
  });

  it('gives a narrow screen a way back to the list', () => {
    const inbox = state({ id: 't1', thread: { ticket: ticket(), messages: [], hasOlder: false, latestSeq: 0 } } as never);
    render(inbox);
    const back = document.querySelector<HTMLButtonElement>('button[aria-label="Back to tickets"]')!;
    expect(back).toBeDefined();
    // The list is the hidden one while a conversation is open; `md:` shows both.
    expect(document.querySelector('[data-testid="support-ticket-list"]')?.className).toContain('hidden');
    expect(document.querySelector('[aria-label="Support conversation"]')?.className).toContain('flex');
    act(() => back.click());
    expect(inbox.clearSelection).toHaveBeenCalled();
  });
});
