'use client';
import React from 'react';
import type { HumanTicket, SupportInboxState, SupportMessage } from './use-support-inbox';
import { StatusBadge, StatusSelect } from './inbox-ui';

/**
 * The right-hand panel of the Support workspace: Details | TRAX Summary for the
 * ticket selected in the list, in the tenant's Support section and the platform
 * inbox alike.
 *
 * READ-ONLY, AND ONLY WHAT IS STORED. Everything here comes from the ticket row the
 * authenticated `detail` action returned — its fields and the handoff TRAX saved
 * when the ticket was created. Nothing is generated when the panel opens, nothing
 * is fetched from a TRAX conversation, and there is no composer: this is context,
 * not another chat. The handoff never carries the escalation score, prompts or raw
 * tool output (support-store.ts writes it), and the SQL replaces it with a
 * disclosure when a reader's record permissions fail, which this panel reports as
 * exactly that rather than as "no TRAX conversation".
 */

export type InfoTab = 'details' | 'trax';

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const items = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : []);
const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const humanize = (value: string) => {
  const words = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
};
const valid = (value?: string | null) => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
/** A full stamp for a detail row. */
export const fullStamp = (value?: string | null) =>
  valid(value)?.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) ?? '';
/** A short one for a message or a check. */
const shortStamp = (value?: string | null) =>
  valid(value)?.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) ?? '';

/** Why TRAX handed an issue to people, in the words a reader needs. Scores are never read. */
const REASON: Record<string, string> = {
  missing_context: 'Information TRAX needed was missing',
  guidance_missing: 'No documented guidance covered it',
  evidence_conflict: 'The records disagreed with each other',
  tool_failure: 'A check could not be completed',
  persistent_tool_failure: 'Checks kept failing',
  diagnostics_exhausted: 'TRAX had no further checks to run',
  unsupported_finance: 'The payment question needs a person',
  human_requested: 'The tenant asked for a person',
};
const CHECK_STATUS: Record<string, string> = { verified: 'Verified', needs_input: 'Needed more information', error: 'Could not complete', partial: 'Partly verified' };
const EMAIL_STATUS: Record<string, string> = { pending: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed — the ticket is saved', review: 'Needs administrator review — the ticket is saved' };

export interface TraxTurn { role: 'user' | 'assistant'; content: string; at: string }

/** The stored handoff, read defensively: older tickets carry fewer fields. */
export function readHandoff(ticket: HumanTicket) {
  const handoff = record(ticket.handoff);
  const issue = record(handoff.issue);
  const excerpt = items(handoff.excerpt).map(record)
    .map((turn) => ({ role: turn.role === 'assistant' ? 'assistant' : turn.role === 'user' ? 'user' : '', content: text(turn.content), at: text(turn.at) }))
    .filter((turn): turn is TraxTurn => !!turn.role && !!turn.content);
  const reports = items(handoff.reportedByUser).map(record).map((report) => text(report.content)).filter(Boolean);
  const checks = items(handoff.verifiedChecks).map(record).map((check) => ({
    tool: text(check.tool), status: text(check.status), observedAt: text(check.observedAt),
    findings: items(check.findings).map(text).filter(Boolean),
  }));
  const reasons = [...new Set([
    ...items(handoff.escalationHistory).map(record).map((event) => text(event.reason)),
    text(issue.reason),
  ].filter((reason) => reason && reason !== 'verified_progress' && reason !== 'user_resolved'))];
  const records = items(handoff.recordReferences).map(record).map((ref) => ({ kind: text(ref.kind), id: text(ref.id) })).filter((ref) => ref.kind && ref.id);
  const payments = items(handoff.paymentReferences).map(record).map((ref) => text(ref.paymentId)).filter(Boolean);
  /* A handoff TRAX wrote has these; the two SQL disclosures ("reported directly",
     "unavailable with your current record permissions") have none of them. */
  const structured = !!(text(handoff.conversationId) || Object.keys(issue).length || excerpt.length || reports.length || checks.length);
  const linked = ticket.traxLinked ?? (structured || !!ticket.conversation_id);
  return {
    disclosure: text(handoff.disclosure), summary: text(issue.summary), topic: text(issue.topic),
    excerpt, reports, checks, reasons, unknowns: items(handoff.unknowns).map(text).filter(Boolean), records, payments,
    structured, linked, hidden: linked && !structured,
  };
}

/**
 * Who the tenant side of this ticket is, as the records name them.
 *
 * A TRAX conversation belongs to ONE signed-in person (`trax_support_conversations.user_id`,
 * which is also the ticket's `user_id`), so every tenant-side turn saved with this ticket
 * is theirs — the name the authenticated `detail` request resolved for that user id, per
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

export function TicketInfoPanel({ inbox, admin, tab, onTab, generated, recordLink }: {
  inbox: SupportInboxState; admin: boolean; tab: InfoTab; onTab: (tab: InfoTab) => void;
  /** The summary message TRAX posted, when it is among the loaded messages. */
  generated?: SupportMessage;
  recordLink?: RecordLink;
}) {
  const ticket = inbox.thread?.ticket ?? null;
  const base = React.useId();
  const tabs: { key: InfoTab; label: string }[] = [{ key: 'details', label: 'Details' }, { key: 'trax', label: 'TRAX Summary' }];
  const tabId = (key: InfoTab) => `${base}-${key}-tab`;
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next: InfoTab = event.key === 'Home' ? 'details' : event.key === 'End' ? 'trax' : tab === 'details' ? 'trax' : 'details';
    onTab(next);
    document.getElementById(tabId(next))?.focus();
  };
  return (
    <div data-testid="ticket-info-panel" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div role="tablist" aria-label="Ticket information" onKeyDown={onKeyDown} className="flex shrink-0 items-end gap-1 border-b border-border/70 px-3 pt-2">
        {tabs.map(({ key, label }) => {
          const selected = tab === key;
          return (
            <button key={key} id={tabId(key)} type="button" role="tab" aria-selected={selected} aria-controls={`${base}-panel`} tabIndex={selected ? 0 : -1}
              onClick={() => onTab(key)}
              className={`-mb-px rounded-t-md border-b-2 px-2.5 pb-2 pt-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {label}
            </button>
          );
        })}
      </div>
      {/* Keyed by ticket and tab: another ticket starts at the top, never mid-way
          down the last one's history. */}
      <div key={`${ticket?.id ?? 'none'}:${tab}`} role="tabpanel" id={`${base}-panel`} aria-labelledby={tabId(tab)} tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40">
        {!ticket ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground">
            {inbox.creating ? 'Details appear here once the ticket is sent.' : inbox.id ? 'Loading ticket details…' : 'Select a ticket to see its details.'}
          </p>
        ) : tab === 'details' ? (
          <TicketDetails inbox={inbox} ticket={ticket} admin={admin} recordLink={recordLink} />
        ) : (
          <TraxSummary ticket={ticket} generated={generated} />
        )}
      </div>
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

function TicketDetails({ inbox, ticket, admin, recordLink }: { inbox: SupportInboxState; ticket: HumanTicket; admin: boolean; recordLink?: RecordLink }) {
  const handoff = readHandoff(ticket);
  const refs = [...handoff.records, ...handoff.payments.map((id) => ({ kind: 'payment', id }))];
  const linkClass = 'break-all font-mono text-[11.5px] text-primary hover:underline';
  return (
    <div className="space-y-5 text-[12.5px] leading-relaxed">
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2.5">
        <Row label="Reference"><span className="font-medium">{ticket.reference}</span></Row>
        <Row label="Subject">{ticket.summary}</Row>
        <Row label="Status">{admin ? <StatusSelect inbox={inbox} ticket={ticket} /> : <StatusBadge status={ticket.status} />}</Row>
        {ticket.tenant_name && <Row label="Company">{ticket.tenant_name}</Row>}
        {ticket.requester && <Row label="Requester">{ticket.requester}</Row>}
        <Row label="Opened from">{handoff.linked ? 'TRAX escalation' : 'Support section'}</Row>
        {handoff.topic && <Row label="Topic">{humanize(handoff.topic)}</Row>}
        <Row label="Created">{fullStamp(ticket.created_at)}</Row>
        <Row label="Last activity">{fullStamp(ticket.updated_at)}</Row>
        {ticket.status === 'closed' && ticket.closed_at && <Row label="Resolved">{fullStamp(ticket.closed_at)}</Row>}
        {admin && ticket.emailStatus && <Row label="Email alert">{EMAIL_STATUS[ticket.emailStatus] ?? humanize(ticket.emailStatus)}</Row>}
      </dl>

      <section>
        <SectionTitle>Linked records</SectionTitle>
        {handoff.hidden ? (
          <p className="text-muted-foreground">Linked records aren’t available with your current access.</p>
        ) : refs.length ? (
          <ul className="space-y-1.5">
            {refs.map((ref) => (
              <li key={`${ref.kind}:${ref.id}`} className="flex items-baseline gap-2">
                <span className="w-16 shrink-0 text-muted-foreground">{humanize(ref.kind)}</span>
                {(ref.kind !== 'payment' && recordLink?.({ kind: ref.kind, id: ref.id, children: ref.id, className: linkClass }))
                  || <span className="break-all font-mono text-[11.5px]">{ref.id}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No rental, vehicle, customer or payment is linked to this ticket.</p>
        )}
      </section>

      {ticket.staff_note && (
        <section>
          <SectionTitle>Earlier update</SectionTitle>
          <p className="whitespace-pre-wrap text-muted-foreground">{ticket.staff_note}</p>
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11.5px] font-medium text-foreground">{label}</p>
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[12.5px] text-muted-foreground">{children}</p>;
}

export function TraxSummary({ ticket, generated }: { ticket: HumanTicket; generated?: SupportMessage }) {
  const handoff = readHandoff(ticket);
  const summaryId = React.useId(), conversationId = React.useId();
  if (!handoff.linked) return <Notice>No TRAX conversation is linked to this ticket.</Notice>;
  if (handoff.hidden) return <Notice>TRAX context for this ticket isn’t available with your current access.</Notice>;

  const question = handoff.reports[0];
  const problem = handoff.summary || question || ticket.summary;
  return (
    <div className="space-y-6 text-[12.5px] leading-relaxed">
      <section aria-labelledby={summaryId} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={summaryId} className="text-[13px] font-semibold text-foreground">Troubleshooting summary</h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary">Generated by TRAX</span>
        </div>
        <p className="text-[11.5px] text-muted-foreground">Saved with this ticket when it was created{ticket.created_at ? `, ${fullStamp(ticket.created_at)}` : ''}.</p>
        <Field label="Reported problem"><p className="text-foreground">{problem}</p></Field>
        {question && question.toLowerCase() !== problem.toLowerCase() && <Field label="What the tenant asked"><p>{question}</p></Field>}
        <Field label="Checks TRAX ran">
          {handoff.checks.length ? (
            <ul className="space-y-2">
              {handoff.checks.map((check, index) => (
                <li key={index} className="rounded-lg border border-border/70 bg-card/60 px-2.5 py-2">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium text-foreground">{humanize(check.tool) || 'Check'}</span>
                    <span className="text-[11px]">{[CHECK_STATUS[check.status] ?? humanize(check.status), shortStamp(check.observedAt)].filter(Boolean).join(' · ')}</span>
                  </p>
                  {check.findings.slice(0, 4).map((finding, i) => <p key={i} className="mt-1">{finding}</p>)}
                </li>
              ))}
            </ul>
          ) : <p>None were available for this issue.</p>}
        </Field>
        {handoff.reasons.length > 0 && (
          <Field label="Why TRAX passed it to support">
            <ul className="list-disc space-y-0.5 pl-4">{handoff.reasons.map((reason) => <li key={reason}>{REASON[reason] ?? humanize(reason)}</li>)}</ul>
          </Field>
        )}
        <Field label="Still unresolved">
          {handoff.unknowns.length
            ? <ul className="list-disc space-y-0.5 pl-4">{handoff.unknowns.map((unknown, i) => <li key={i}>{unknown}</li>)}</ul>
            : <p>Nothing was recorded as unresolved.</p>}
        </Field>
        {handoff.disclosure && <p className="text-[11px] text-muted-foreground">{handoff.disclosure}</p>}
        {generated && (
          <details className="rounded-lg border border-border/70 px-2.5 py-2">
            <summary className="cursor-pointer text-[11.5px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Summary as posted to the ticket</summary>
            <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]">{generated.body}</p>
          </details>
        )}
      </section>

      <section aria-labelledby={conversationId} className="space-y-2">
        <h3 id={conversationId} className="text-[13px] font-semibold text-foreground">TRAX conversation</h3>
        {handoff.excerpt.length ? (
          <>
            <p className="text-[11.5px] text-muted-foreground">
              {handoff.excerpt.length === 1 ? 'The message' : `The ${handoff.excerpt.length} messages`} from {participantName(ticket)}’s TRAX conversation about this issue that were saved with the ticket. Read-only.
            </p>
            <ol aria-labelledby={conversationId} className="space-y-2">
              {handoff.excerpt.map((turn, index) => (
                <li key={index} data-slot="trax-turn" data-role={turn.role}
                  className={`rounded-xl px-3 py-2 ${turn.role === 'user' ? 'bg-primary/10 dark:bg-primary/20' : 'bg-muted/70'}`}>
                  <p className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="font-semibold text-foreground">{turn.role === 'user' ? participantName(ticket) : 'TRAX'}</span>
                    {turn.at && <time dateTime={turn.at} className="text-muted-foreground">{shortStamp(turn.at)}</time>}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-foreground [overflow-wrap:anywhere]">{turn.content}</p>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <Notice>The original TRAX conversation wasn’t retained with this ticket. Only the summary above is available.</Notice>
        )}
      </section>
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
