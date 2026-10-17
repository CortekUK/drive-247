'use client';
import React from 'react';
import type { HumanTicket, SupportAttachment, SupportInboxState } from './use-support-inbox';
import { readableSize, StatusBadge, StatusSelect } from './inbox-ui';
import { TraxAssistPanel, type TraxAssistState } from './trax-assist';

/**
 * The right-hand panel of the Support workspace: the Details of the ticket
 * selected in the list, in the tenant's Support section and the platform inbox
 * alike.
 *
 * READ-ONLY, AND ONLY WHAT IS STORED: the ticket row the authenticated `detail`
 * action returned. TRAX no longer raises tickets (removed 2026-10-16), so there is
 * no TRAX Summary tab, no "opened from" and no TRAX-linked records here.
 *
 * The platform inbox adds a Trax tab: the agent's own conversation with TRAX
 * about this ticket (trax-assist.tsx). The tenant's Support section has Details only.
 */

export type InfoTab = 'details' | 'trax';

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const humanize = (value: string) => {
  const words = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
};
const valid = (value?: string | null) => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
/** A full stamp for a detail row. */
export const fullStamp = (value?: string | null) =>
  valid(value)?.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) ?? '';

const EMAIL_STATUS: Record<string, string> = { pending: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed — the ticket is saved', review: 'Needs administrator review — the ticket is saved' };

/**
 * Who the tenant side of this ticket is, as the records name them.
 *
 * The name the authenticated `detail` request resolved for the ticket's user id, per
 * ticket, never the company and never whoever happens to be reading. A ticket whose user
 * record holds no usable name says so rather than inventing one or showing an email, which
 * `app_users.name` sometimes carries.
 */
export function participantName(ticket: HumanTicket): string {
  const name = text(ticket.requester);
  if (!name || name === 'Requester' || /\S+@\S+\.\S+/.test(name)) return 'Name unavailable';
  return name;
}

/** How the app links a record reference; without it the id is shown as text. */
export type RecordLink = (ref: { kind: string; id: string; children: React.ReactNode; className: string }) => React.ReactNode;

export function TicketInfoPanel({ inbox, admin, tab = 'details', onTab, assist }: {
  inbox: SupportInboxState; admin: boolean;
  tab?: InfoTab; onTab?: (tab: InfoTab) => void; recordLink?: RecordLink;
  /** The platform inbox: shows the Trax tab. */
  assist?: TraxAssistState;
}) {
  const ticket = inbox.thread?.ticket ?? null;
  const showing: InfoTab = assist && onTab ? tab : 'details';
  return (
    <div data-testid="ticket-info-panel" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {assist && onTab ? (
        <div role="tablist" aria-label="Ticket panel" className="flex shrink-0 items-center gap-1 border-b border-border/70 px-2.5 py-1.5">
          {(['details', 'trax'] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={showing === value} onClick={() => onTab(value)}
              className={`h-8 rounded-lg px-3 text-[13px] font-medium outline-none transition-colors duration-200 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${showing === value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              {value === 'details' ? 'Details' : 'Trax'}
            </button>
          ))}
        </div>
      ) : (
        <div className="shrink-0 border-b border-border/70 px-4 py-2.5">
          <h2 className="text-[13px] font-semibold">Details</h2>
        </div>
      )}
      {showing === 'trax' && assist ? (
        <TraxAssistPanel assist={assist} ticketOpen={!!ticket} />
      ) : (
      /* Keyed by ticket: another ticket starts at the top. */
      <div key={ticket?.id ?? 'none'} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!ticket ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            {inbox.creating ? 'Details appear here once the ticket is sent.' : inbox.id ? 'Loading ticket details…' : 'Select a ticket to see its details.'}
          </p>
        ) : (
          <TicketDetails inbox={inbox} ticket={ticket} admin={admin} />
        )}
      </div>
      )}
    </div>
  );
}

function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return <h3 id={id} className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </>
  );
}

function TicketDetails({ inbox, ticket, admin }: { inbox: SupportInboxState; ticket: HumanTicket; admin: boolean }) {
  return (
    <div className="space-y-5 text-[12.5px] leading-relaxed">
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2.5">
        <Row label="Reference"><span className="font-medium">{ticket.reference}</span></Row>
        <Row label="Subject">{ticket.summary}</Row>
        <Row label="Status">{admin ? <StatusSelect inbox={inbox} ticket={ticket} /> : <StatusBadge status={ticket.status} />}</Row>
        {ticket.tenant_name && <Row label="Company">{ticket.tenant_name}</Row>}
        {ticket.requester && <Row label="Requester">{ticket.requester}</Row>}
        <Row label="Created">{fullStamp(ticket.created_at)}</Row>
        <Row label="Last activity">{fullStamp(ticket.updated_at)}</Row>
        {ticket.status === 'closed' && ticket.closed_at && <Row label="Resolved">{fullStamp(ticket.closed_at)}</Row>}
        {admin && ticket.emailedAt && <Row label="Last emailed">{fullStamp(ticket.emailedAt)}</Row>}
        {admin && ticket.emailStatus && <Row label="Email alert">{EMAIL_STATUS[ticket.emailStatus] ?? humanize(ticket.emailStatus)}</Row>}
      </dl>

      <TicketFiles inbox={inbox} ticket={ticket} admin={admin} />

      {ticket.staff_note && (
        <section>
          <SectionTitle>Earlier update</SectionTitle>
          <p className="whitespace-pre-wrap text-muted-foreground">{ticket.staff_note}</p>
        </section>
      )}
    </div>
  );
}

/**
 * The panel below the width where it fits beside the conversation: a modal drawer
 * from the right. Focus moves in, stays in, Escape and the scrim close it, and
 * focus returns to what opened it. Widening past the breakpoint closes it, since
 * the panel is then on screen anyway.
 */
export function InfoDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const panel = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),select:not([disabled]),textarea,input,summary,[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const wide = window.matchMedia?.('(min-width: 1280px)');
    const onWide = () => { if (wide?.matches) close.current(); };
    document.addEventListener('keydown', onKey);
    wide?.addEventListener('change', onWide);
    return () => { document.removeEventListener('keydown', onKey); wide?.removeEventListener('change', onWide); opener?.focus?.(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden className="absolute inset-0 bg-foreground/20 backdrop-blur-[1px]" onClick={() => close.current()} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-[min(380px,100vw)] flex-col bg-background shadow-2xl outline-none">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/70 pl-4 pr-2">
          <h2 id={titleId} className="text-[13px] font-semibold">{title}</h2>
          <button type="button" aria-label="Close ticket details" onClick={() => close.current()}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4"><path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Every file shared in this conversation, newest first, from both sides — the
 * same authorized list and short-lived links the thread itself shows.
 */
function TicketFiles({ inbox, ticket, admin }: { inbox: SupportInboxState; ticket: HumanTicket; admin: boolean }) {
  const files = [...(inbox.thread?.attachments ?? [])].sort((a, b) => b.seq - a.seq);
  const sentAt = new Map((inbox.thread?.messages ?? []).map((m) => [m.seq, m.created_at]));
  const who = (file: SupportAttachment) => file.authorKind === 'support'
    ? (admin ? 'You' : 'Drive247 Support')
    : (admin ? participantName(ticket) : 'You');
  return (
    <section aria-labelledby="ticket-files">
      <SectionTitle id="ticket-files">Files{files.length ? ` · ${files.length}` : ''}</SectionTitle>
      {!files.length ? (
        <p className="text-muted-foreground">No files shared in this conversation yet.</p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {files.map((file) => {
            const image = file.mime.startsWith('image/');
            const at = sentAt.get(file.seq);
            return (
              <li key={file.id}>
                <a href={file.url ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={file.url ? undefined : true}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${file.url ? 'hover:bg-primary/10' : 'pointer-events-none opacity-60'}`}>
                  {image && file.url ? (
                    <img src={file.url} alt="" loading="lazy" className="size-10 shrink-0 rounded-md border border-border/70 object-cover" />
                  ) : (
                    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[9.5px] font-semibold text-primary">
                      {(file.name.includes('.') ? file.name.split('.').pop() ?? '' : '').slice(0, 4).toUpperCase() || 'FILE'}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{file.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {who(file)}{at ? ` · ${fullStamp(at)}` : ''} · {readableSize(file.size)}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
