import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportInboxView } from '@/components/support/support-inbox';
import { SupportWorkspace } from '../../../../../shared/trax-support/support-workspace';
import type { SupportInboxState } from '../../../../../shared/trax-support/use-support-inbox';

// Offline: the view is given the inbox state directly; nothing is fetched.
// A plain anchor for next/link, whose prefetching needs a real IntersectionObserver.
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => createElement('a', { href, ...props }, children) }));
const ticket = (over: Record<string, unknown> = {}) => ({
  id: 't1', reference: 'TRX-1111', summary: 'Returned vehicle still shows as out on rent',
  status: 'open' as const, tenant_name: 'Northwind', requester: 'Operator',
  created_at: '2026-09-15T09:00:00Z', updated_at: '2026-09-16T09:00:00Z', unread: false, ...over,
});
const message = (seq: number, author: 'tenant' | 'support', body: string, minutesAgo: number, over: Record<string, unknown> = {}) => ({
  seq, author_kind: author, body, created_at: new Date(Date.now() - minutesAgo * 60000).toISOString(), ...over,
});
/** A handoff as support-store.ts writes it for an escalated TRAX issue. */
const traxHandoff = {
  conversationId: 'c1',
  issue: { id: 'i1', topic: 'bookings', summary: 'Which rentals are active', state: 'submitted', score: 100 },
  reportedByUser: [{ content: 'which rentals are active', at: '2026-09-17T10:45:00Z' }],
  verifiedChecks: [{ key: 'k', tool: 'list_account_bookings', status: 'verified', observedAt: '2026-09-17T10:45:19Z', findings: ['10 recorded active rentals; showing 10.'], limitations: [] }],
  recordReferences: [{ kind: 'rental', id: 'r-104' }],
  paymentReferences: [],
  unknowns: ['Out on hire uses the recorded-state rule, not proof of possession.'],
  escalationHistory: [{ key: 'h', reason: 'human_requested', at: '2026-09-17T10:46:00Z', score: 100 }],
  excerpt: [
    { role: 'user', content: 'which rentals are active', at: '2026-09-17T10:45:00Z' },
    { role: 'assistant', content: 'There are 10 active rentals recorded.', at: '2026-09-17T10:45:20Z' },
    { role: 'user', content: 'I need a person to check this', at: '2026-09-17T10:46:00Z' },
  ],
  disclosure: 'User reports and historical system observations are separate.',
};

function state(over: Partial<SupportInboxState> = {}): SupportInboxState {
  return {
    id: null, creating: false, tickets: [], next: null, thread: null, search: '', filter: '',
    draft: '', subject: '', busy: false, loading: false, error: null, notice: '',
    retrying: false, canSend: false, canAttach: false, attachments: [], scrollRef: { current: null },
    setSearch: vi.fn(), setFilter: vi.fn(), setDraft: vi.fn(), setSubject: vi.fn(),
    choose: vi.fn(), clearSelection: vi.fn(), beginNew: vi.fn(), cancelNew: vi.fn(),
    loadMore: vi.fn(), loadOlder: vi.fn(), onThreadScroll: vi.fn(), send: vi.fn(),
    addAttachments: vi.fn(), removeAttachment: vi.fn(), setTicketStatus: vi.fn(async () => true),
    ...over,
  } as unknown as SupportInboxState;
}

let root: Root | null = null;
function render(inbox: SupportInboxState, props: Record<string, unknown> = {}) {
  const node = document.createElement('div'); document.body.append(node);
  root = createRoot(node);
  act(() => root!.render(createElement(SupportInboxView, { inbox, ...props })));
}
function renderWorkspace(props: Record<string, unknown>) {
  const node = document.createElement('div'); document.body.append(node);
  root = createRoot(node);
  act(() => root!.render(createElement(SupportWorkspace, props as never)));
}
function reset() { act(() => root?.unmount()); root = null; document.body.replaceChildren(); }
const text = () => document.body.textContent ?? '';
const bubbles = () => [...document.querySelectorAll('[data-slot="bubble"]')];
const panel = () => document.querySelector('[data-testid="ticket-info"]')!;
const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === name)!;
const selected = (name: string) => tab(name).getAttribute('aria-selected') === 'true';

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); });
afterEach(() => { reset(); vi.unstubAllGlobals(); });

describe('the Support workspace — tickets, conversation, details', () => {
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

  it('shows each ticket\'s unread messages as a pill on the reference line, apart from the status', () => {
    const inbox = state({ id: 't2', tickets: [
      ticket({ unread: true, unreadMessages: 2 }),
      ticket({ id: 't2', reference: 'TRX-2222', summary: 'Invoice email bounced', unread: true, unreadMessages: 1 }),
      // The ticket-level flag alone (a status note, say) is not an unread message.
      ticket({ id: 't3', reference: 'TRX-3333', summary: 'Widget price', unread: true, unreadMessages: 0 }),
    ] as never });
    render(inbox);
    const rows = [...document.querySelectorAll('[data-testid="support-ticket-list"] li')];
    const pill = (row: Element) => row.querySelector('[data-testid="ticket-unread"]');
    expect(pill(rows[0])?.textContent).toBe('2');
    expect(pill(rows[0])?.getAttribute('aria-hidden')).toBe('true');
    expect(rows[0].textContent).toContain('2 unread messages');
    expect(rows[1].textContent).toContain('1 unread message');
    // The pill sits with the reference, not the status badge, and uses the accent.
    expect(pill(rows[0])?.parentElement?.textContent).toContain('TRX-1111');
    expect(pill(rows[0])?.className).toContain('bg-primary');
    expect(pill(rows[0])?.className).toContain('text-primary-foreground');
    expect(rows[0].querySelector('[data-testid="ticket-status"]')?.contains(pill(rows[0]))).toBe(false);
    // Selected rows keep it.
    expect(rows[1].querySelector('button')?.getAttribute('aria-current')).toBe('true');
    expect(pill(rows[1])?.textContent).toBe('1');
    // Zero: no pill, no "0", no bold subject.
    expect(pill(rows[2])).toBeNull();
    expect(rows[2].querySelector('span.line-clamp-2')?.className).toContain('font-medium');
    expect(rows[2].textContent).not.toMatch(/unread/i);
    expect(rows[0].querySelector('span.line-clamp-2')?.className).toContain('font-semibold');
  });

  it('asks for the tenant\'s own tickets, and says when a filter matches none', () => {
    render(state({ search: 'refund', filter: 'open' }));
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Search support tickets"]')?.placeholder).toBe('Search your tickets…');
    expect(text()).toContain('No tickets match these filters.');
    reset();
    render(state());
    expect(text()).toContain('No support tickets yet.');
  });

  it('leaves the list to the rail when the rail shows it: no second list, no Back', () => {
    const thread = { ticket: ticket(), messages: [message(1, 'tenant', 'Hello', 5)], hasOlder: false, latestSeq: 1 };
    render(state({ id: 't1', tickets: [ticket()] as never, thread } as never), { listInRail: true, listHeader: createElement('h1', null, 'Support') });
    expect(document.querySelector('[data-testid="support-ticket-list"]')).toBeNull();
    expect(document.querySelector('h1')).toBeNull();
    expect(document.querySelector('button[aria-label="Back to tickets"]')).toBeNull();
    // Centre and right are both there, for the same ticket.
    expect(document.querySelector('[aria-label="Support conversation"] h2')?.textContent).toContain('Returned vehicle');
    expect(panel().textContent).toContain('TRX-1111');
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
    expect(bubbles()).toHaveLength(4);
    expect(document.querySelectorAll('[data-slot="message"]')).toHaveLength(3);
    const aligns = [...document.querySelectorAll('[data-slot="message"]')].map((m) => m.getAttribute('data-align'));
    expect(aligns).toEqual(['end', 'start', 'end']);
    expect(bubbles()[0].getAttribute('data-variant')).toBe('tinted');
    expect(bubbles()[1].getAttribute('data-variant')).toBe('muted');
    expect(bubbles()[0].className).toContain('w-fit');
    expect(document.querySelectorAll('[data-seq]')).toHaveLength(4);
    expect(document.querySelectorAll('[role="separator"]').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll('[data-slot="message-header"]')[0].textContent).toBe('Drive247 Support');
  });

  it('keeps the header to subject, reference and status, with no TRAX strip or Issue details button in the conversation', () => {
    render(state({ id: 't1', thread: { ticket: ticket({ handoff: traxHandoff, conversation_id: 'c1' }), messages: [], hasOlder: false, latestSeq: 0 } } as never));
    const header = document.querySelector('[aria-label="Support conversation"] header')!;
    expect(header.querySelector('h2')?.textContent).toContain('Returned vehicle still shows as out on rent');
    expect(header.textContent).toContain('TRX-1111');
    expect(header.querySelector('[data-testid="ticket-status"]')?.textContent).toBe('Open');
    expect(header.textContent).not.toMatch(/Created|Last updated|Issue details/i);
    const conversation = document.querySelector('[aria-label="Support conversation"]')!;
    expect(conversation.textContent).not.toContain('TRAX troubleshooting context');
    expect(conversation.querySelector('details')).toBeNull();
  });

  it('shows Details for the selected ticket: status read-only for a tenant, dates as ordinary fields, linked records as links', () => {
    render(state({ id: 't1', thread: { ticket: ticket({ handoff: traxHandoff, conversation_id: 'c1', traxLinked: true }), messages: [], hasOlder: false, latestSeq: 0 } } as never));
    expect(selected('Details')).toBe(true);
    const details = panel().textContent ?? '';
    for (const expected of ['TRX-1111', 'Returned vehicle still shows as out on rent', 'Northwind', 'Operator', 'TRAX escalation', 'Bookings', 'Created', 'Last activity']) expect(details).toContain(expected);
    expect(panel().querySelector('[data-testid="ticket-status"]')?.textContent).toBe('Open');
    expect(panel().querySelector('select')).toBeNull();
    const link = panel().querySelector<HTMLAnchorElement>('a[href="/rentals/r-104"]');
    expect(link?.textContent).toBe('r-104');
  });

  it('shows what TRAX did in TRAX Summary: the summary, then the saved conversation with sender labels — never the score', () => {
    render(state({ id: 't1', thread: { ticket: ticket({ handoff: traxHandoff, conversation_id: 'c1', traxLinked: true }), messages: [], hasOlder: false, latestSeq: 0 } } as never));
    act(() => tab('TRAX Summary').click());
    expect(selected('TRAX Summary')).toBe(true);
    const summary = panel().textContent ?? '';
    for (const expected of ['Troubleshooting summary', 'Generated by TRAX', 'Which rentals are active', 'List account bookings', '10 recorded active rentals', 'The tenant asked for a person', 'Out on hire uses the recorded-state rule', 'TRAX conversation']) expect(summary).toContain(expected);
    const turns = [...panel().querySelectorAll('[data-slot="trax-turn"]')];
    expect(turns.map((t) => t.getAttribute('data-role'))).toEqual(['user', 'assistant', 'user']);
    // The person whose conversation it was, from the ticket's own requester — not "Tenant".
    expect(turns[0].textContent).toContain('Operator');
    expect(turns[0].textContent).not.toContain('Tenant');
    expect(turns[1].textContent).toContain('TRAX');
    expect(turns[1].querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-17T10:45:20Z');
    expect(summary).not.toMatch(/score|100/i);
    // Context, not another chat.
    expect(panel().querySelector('textarea, input')).toBeNull();
  });

  it('names each ticket’s own participant, and says so rather than guessing or showing an email', () => {
    const show = (over: Record<string, unknown>) => {
      reset();
      render(state({ id: 't1', thread: { ticket: ticket({ handoff: traxHandoff, traxLinked: true, ...over }), messages: [], hasOlder: false, latestSeq: 0 } } as never));
      act(() => tab('TRAX Summary').click());
      return [...panel().querySelectorAll('[data-slot="trax-turn"]')].map((t) => t.querySelector('span')?.textContent);
    };
    expect(show({ requester: 'Ayesha Malik' })).toEqual(['Ayesha Malik', 'TRAX', 'Ayesha Malik']);
    // Another tenant's ticket resolves its own name, never the last one's.
    expect(show({ requester: 'Daniel Okoro', tenant_name: 'Second rental' })).toEqual(['Daniel Okoro', 'TRAX', 'Daniel Okoro']);
    // Nothing usable: a neutral fallback, never the company, an email or an invention.
    for (const requester of [undefined, '', '  ', 'Requester', 'owner@example.invalid']) {
      const labels = show({ requester });
      expect(labels).toEqual(['Name unavailable', 'TRAX', 'Name unavailable']);
      expect(labels.join(' ')).not.toContain('@');
      expect(labels.join(' ')).not.toContain('Northwind');
    }
  });

  it('says plainly when there is no TRAX conversation, when only a summary survived, and when access hides it', () => {
    const show = (over: Record<string, unknown>) => {
      reset();
      render(state({ id: 't1', thread: { ticket: ticket(over), messages: [], hasOlder: false, latestSeq: 0 } } as never));
      act(() => tab('TRAX Summary').click());
      return panel().textContent ?? '';
    };
    expect(show({ handoff: { disclosure: 'Reported directly by the requester. No TRAX checks were performed.' }, conversation_id: null, traxLinked: false }))
      .toContain('No TRAX conversation is linked to this ticket.');
    expect(show({ handoff: { ...traxHandoff, excerpt: [] }, traxLinked: true }))
      .toContain('The original TRAX conversation wasn’t retained with this ticket. Only the summary above is available.');
    const hidden = show({ handoff: { disclosure: 'Diagnostic context is unavailable with your current record permissions.' }, traxLinked: true });
    expect(hidden).toContain('TRAX context for this ticket isn’t available with your current access.');
    expect(hidden).not.toContain('No TRAX conversation is linked');
    act(() => tab('Details').click());
    expect(panel().textContent).toContain('Linked records aren’t available with your current access.');
  });

  it('draws the message TRAX wrote as an event, not a bubble, keeps its read marker, and links to TRAX Summary', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const summaryBody = 'TRAX troubleshooting summary — generated by TRAX for this issue.';
    render(state({
      id: 't1',
      thread: {
        ticket: ticket({ handoff: traxHandoff, traxLinked: true }),
        messages: [
          message(1, 'tenant', summaryBody, 30, { source: 'trax_handoff' }),
          message(2, 'support', 'Looking at it now.', 10),
          // Words about TRAX in a person's own message do not make it TRAX's.
          message(3, 'tenant', 'TRAX troubleshooting summary said 10 rentals, is that right?', 5),
        ],
        hasOlder: false, latestSeq: 3,
      },
    } as never));
    const conversation = document.querySelector('[aria-label="Support conversation"]')!;
    const event = conversation.querySelector('[data-slot="system-event"]')!;
    expect(event.textContent).toContain('TRAX created this ticket');
    expect(event.querySelector('[data-seq="1"]')).not.toBeNull();
    expect(bubbles().map((b) => b.textContent)).not.toContain(expect.stringContaining('generated by TRAX for this issue'));
    expect(bubbles()).toHaveLength(2);
    expect(bubbles()[1].textContent).toContain('is that right?');
    act(() => [...event.querySelectorAll('button')].find((b) => b.textContent === 'View TRAX Summary')!.click());
    expect(selected('TRAX Summary')).toBe(true);
    // The stored words are still there, on request.
    expect(panel().querySelector('details')?.textContent).toContain(summaryBody);
  });

  it('opens Details in a drawer where the panel does not fit, and closes it with Escape', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(state({ id: 't1', thread: { ticket: ticket({ handoff: traxHandoff, traxLinked: true }), messages: [], hasOlder: false, latestSeq: 0 } } as never));
    const opener = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Details' && b.getAttribute('aria-haspopup') === 'dialog')!;
    act(() => opener.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('TRX-1111');
    // One panel at a time: the side column gives its copy to the drawer.
    expect(document.querySelectorAll('[data-testid="ticket-info-panel"]')).toHaveLength(1);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('gives platform support the status selector in Details, and the tenant identity in the header', async () => {
    const inbox = state({ id: 't1', thread: { ticket: ticket({ status: 'in_progress', emailStatus: 'sent' }), messages: [], hasOlder: false, latestSeq: 0 } } as never);
    renderWorkspace({ inbox, viewer: 'support' });
    expect(document.querySelector('[data-testid="ticket-tenant"]')?.textContent).toBe('Northwind');
    const select = panel().querySelector<HTMLSelectElement>('select[aria-label="Ticket status"]')!;
    expect(select.value).toBe('in_progress');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Open', 'In progress', 'Resolved']);
    expect(panel().textContent).toContain('Email alert');
    await act(async () => { select.value = 'closed'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(inbox.setTicketStatus).toHaveBeenCalledWith('closed', 'Support marked this ticket as Resolved.');
  });

  it('labels the requester’s own messages with their name in the platform inbox', () => {
    const thread = (requester?: string) => ({ ticket: ticket({ requester }), messages: [message(1, 'tenant', 'The keys are back.', 30)], hasOlder: false, latestSeq: 1 });
    renderWorkspace({ inbox: state({ id: 't1', thread: thread('Ayesha Malik') } as never), viewer: 'support' });
    expect(document.querySelector('[data-slot="message-header"]')?.textContent).toBe('Ayesha Malik');
    reset();
    renderWorkspace({ inbox: state({ id: 't1', thread: thread(undefined) } as never), viewer: 'support' });
    expect(document.querySelector('[data-slot="message-header"]')?.textContent).toBe('Name unavailable');
    // The tenant's own view still says "You" for their own messages.
    reset();
    render(state({ id: 't1', thread: thread('Ayesha Malik') } as never));
    expect(document.querySelectorAll('[data-slot="message-header"]').length).toBe(0);
  });

  it('never shows a ticket before it is loaded: the centre and both tabs wait together', () => {
    render(state({ id: 't2', thread: null, tickets: [ticket()] as never }));
    expect(text()).toContain('Loading conversation…');
    expect(panel().textContent).toContain('Loading ticket details…');
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
    act(() => send.click());
    expect(inbox.send).toHaveBeenCalled();
  });

  it('composes a new ticket with a subject, and cancels without creating one', () => {
    const inbox = state({ creating: true, subject: 'Deposit not released', draft: 'Three days and counting.', canSend: true });
    render(inbox);
    expect(document.querySelector<HTMLInputElement>('#support-subject')?.value).toBe('Deposit not released');
    expect(document.querySelector('label[for="support-message"]')?.textContent).toBe('Your message');
    expect(panel().textContent).toContain('Details appear here once the ticket is sent.');
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
    reset();
    render(state({ id: 't1', canAttach: false, thread: { ...thread, attachments: [{ ...sent, url: undefined }] } } as never));
    expect(document.querySelector('button[aria-label="Attach a file"]')).toBeNull();
    expect(document.querySelector('img[alt="shot.png"]')).toBeNull();
    expect(text()).toContain('shot.png');
  });

  it('gives a narrow screen a way back to the list', () => {
    const inbox = state({ id: 't1', thread: { ticket: ticket(), messages: [], hasOlder: false, latestSeq: 0 } } as never);
    render(inbox);
    const back = document.querySelector<HTMLButtonElement>('button[aria-label="Back to tickets"]')!;
    expect(back).not.toBeNull();
    // The list is the hidden one while a conversation is open; `md:` shows both.
    expect(document.querySelector('[data-testid="support-ticket-list"]')?.parentElement?.className).toContain('hidden');
    expect(document.querySelector('[aria-label="Support conversation"]')?.className).toContain('flex');
    act(() => back.click());
    expect(inbox.clearSelection).toHaveBeenCalled();
  });
});
