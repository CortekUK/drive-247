'use client';
import React from 'react';
import type { SupportInboxState } from './use-support-inbox';

/**
 * "Email the tenant" (platform support only): a no-reply email to the ticket's
 * requester with a link back to this conversation. The conversation stays in the
 * app — the email carries no message content, only the way back
 * (server: messaging.ts `notify`, ticket-email.ts `replyNudgeEmail`).
 *
 * Asks once before sending. The server holds a cooldown per ticket, so a double
 * click or a second agent cannot send a burst.
 */
export function EmailTenantButton({ inbox }: { inbox: SupportInboxState }) {
  const ticket = inbox.thread?.ticket;
  const [open, setOpen] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [sentAt, setSentAt] = React.useState<string | null>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const nonce = React.useRef<string>('');

  React.useEffect(() => { setOpen(false); setResult(null); setSentAt(null); }, [ticket?.id]);
  React.useEffect(() => {
    if (!open) return;
    nonce.current = crypto.randomUUID();
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  React.useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(null), 5000);
    return () => window.clearTimeout(timer);
  }, [result]);

  if (!ticket) return null;
  const last = sentAt ?? ticket.emailedAt ?? null;
  const who = ticket.requester && ticket.requester !== 'Requester' ? ticket.requester : 'the requester';

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const r = await inbox.call('notify', { id: ticket.id, nonce: nonce.current });
      setSentAt(typeof r?.sentAt === 'string' ? r.sentAt : new Date().toISOString());
      setResult({ ok: true, text: r?.simulated ? `Email simulated locally for ${r?.to ?? who}.` : `Emailed ${r?.to ?? who}.` });
      setOpen(false);
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'The email could not be sent.' });
      setOpen(false);
    } finally { setSending(false); }
  };

  return (
    <div ref={box} className="relative">
      <button type="button" aria-label="Email the tenant a link to this conversation" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${open ? 'bg-background text-primary' : ''}`}>
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
          <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Email the tenant"
          className="absolute bottom-full left-0 z-30 mb-2 w-[290px] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg animate-in fade-in slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none">
          <p className="text-[13px] font-medium">Email {who}?</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            A no-reply email with a link back to this conversation, so they read and answer here. It includes no message content.
          </p>
          {last && <p className="mt-1.5 text-[11.5px] text-muted-foreground">Last emailed {relative(last)}.</p>}
          <div className="mt-3 flex justify-end gap-1.5">
            <button type="button" onClick={() => setOpen(false)}
              className="h-8 rounded-lg px-3 text-[12px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Cancel</button>
            <button type="button" onClick={() => void send()} disabled={sending}
              className="h-8 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
              {sending ? 'Sending…' : 'Send email'}
            </button>
          </div>
        </div>
      )}
      {result && !open && (
        <p role="status" className={`absolute bottom-full left-0 z-30 mb-2 w-max max-w-[280px] rounded-lg border px-2.5 py-1.5 text-[11.5px] shadow-sm animate-in fade-in duration-200 motion-reduce:animate-none ${result.ok ? 'border-border bg-popover text-foreground' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}

function relative(value: string) {
  const at = new Date(value).getTime();
  if (Number.isNaN(at)) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
