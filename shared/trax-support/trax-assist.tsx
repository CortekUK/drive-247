'use client';
import React from 'react';
import type { SupportInboxState } from './use-support-inbox';

/**
 * TRAX in the platform support inbox (super admins only).
 *
 * - The Trax tab beside Details: ask TRAX about the open ticket. It has read the
 *   whole conversation and can look things up in the database, read-only
 *   (server: supabase/functions/trax-support/support/assist.ts).
 * - The composer's suggestion: when the tenant spoke last, TRAX drafts ONE next
 *   reply, using the conversation AND what was worked out in the Trax tab, and
 *   types it as grey text into the empty reply box. Tab puts it in the box;
 *   nothing is sent until the agent sends it.
 *
 * Each ticket keeps its own Trax conversation for as long as the page is open.
 */

export interface AssistTurn { role: 'user' | 'assistant'; content: string; checks?: string[] }
const MODEL_TIMEOUT = 120_000;
/** What the server accepts per turn; older turns past this many are not sent. */
const SENT_TURNS = 30;
const wire = (turns: AssistTurn[]) => turns.slice(-SENT_TURNS).map(({ role, content }) => ({ role, content: content.slice(0, 6000) }));

export function useTraxAssist(inbox: SupportInboxState, enabled: boolean) {
  const { call, id, thread, draft } = inbox;
  const store = React.useRef(new Map<string, AssistTurn[]>());
  const [turns, setTurnsState] = React.useState<AssistTurn[]>([]);
  const [asking, setAsking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const live = React.useRef(id);
  live.current = id;

  React.useEffect(() => { setTurnsState(id ? store.current.get(id) ?? [] : []); setError(null); setAsking(false); }, [id]);
  const setTurns = React.useCallback((ticket: string, next: AssistTurn[]) => {
    store.current.set(ticket, next);
    if (live.current === ticket) setTurnsState(next);
  }, []);

  const ask = React.useCallback(async (text: string) => {
    const question = text.trim();
    if (!enabled || !id || !question || asking) return;
    const ticket = id;
    const next: AssistTurn[] = [...(store.current.get(ticket) ?? []), { role: 'user', content: question }];
    setTurns(ticket, next);
    setAsking(true); setError(null);
    try {
      const result = await call('assist', { id: ticket, turns: wire(next) }, { timeout: MODEL_TIMEOUT });
      const answer = typeof result?.answer === 'string' ? result.answer : '';
      setTurns(ticket, [...next, { role: 'assistant', content: answer || 'I could not form an answer. Try rephrasing.', checks: Array.isArray(result?.checks) ? result.checks : [] }]);
    } catch (e) {
      if (live.current === ticket) setError(e instanceof Error ? e.message : 'TRAX could not answer. Try again.');
    } finally { if (live.current === ticket) setAsking(false); }
  }, [asking, call, enabled, id, setTurns]);

  const clear = React.useCallback(() => { if (id) setTurns(id, []); setError(null); }, [id, setTurns]);

  /* ── The suggested reply ──────────────────────────────────────────── */
  const messages = thread?.messages ?? [];
  const lastPerson = [...messages].reverse().find((m) => m.source !== 'trax_handoff');
  const answers = turns.filter((t) => t.role === 'assistant').length;
  /* A new tenant message, or a new TRAX answer, is new context: a new suggestion. */
  const key = id && thread && lastPerson ? `${id}:${lastPerson.seq}:${answers}` : null;
  const tenantSpokeLast = lastPerson?.author_kind === 'tenant';
  const [suggestions, setSuggestions] = React.useState<Record<string, string>>({});
  const [suggesting, setSuggesting] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const [manual, setManual] = React.useState<string | null>(null);
  const requested = React.useRef(new Set<string>());

  const suggest = React.useCallback(async (force = false) => {
    if (!enabled || !key || !id) return;
    if (!force && requested.current.has(key)) return;
    requested.current.add(key);
    const ticket = id, at = key;
    setSuggesting(at);
    try {
      const result = await call('suggest', { id: ticket, notes: wire(store.current.get(ticket) ?? []) }, { timeout: MODEL_TIMEOUT });
      const reply = typeof result?.reply === 'string' ? result.reply.trim() : '';
      if (reply) setSuggestions((old) => ({ ...old, [at]: reply }));
    } catch { requested.current.delete(at); /* no suggestion is fine; the agent can ask again */ }
    finally { setSuggesting((old) => (old === at ? null : old)); }
  }, [call, enabled, id, key]);

  /* Automatic when the tenant is waiting on us, after a short settle so opening
     tickets in quick succession does not draft for each one. */
  React.useEffect(() => {
    if (!enabled || !key || !tenantSpokeLast) return;
    const timer = window.setTimeout(() => void suggest(), 700);
    return () => window.clearTimeout(timer);
  }, [enabled, key, tenantSpokeLast, suggest]);

  const suggestion = key && dismissed !== key && (tenantSpokeLast || manual === key) ? suggestions[key] ?? null : null;
  return {
    enabled, turns, asking, error, ask, clear,
    suggestion, drafting: !!key && suggesting === key && dismissed !== key && !draft.trim(),
    /** Ask for a suggestion when the tenant did not speak last. */
    requestSuggestion: () => { if (!key) return; setManual(key); setDismissed(null); void suggest(true); },
    refreshSuggestion: () => { if (!key) return; setDismissed(null); setSuggestions((old) => { const next = { ...old }; delete next[key]; return next; }); void suggest(true); },
    dismissSuggestion: () => setDismissed(key),
    acceptSuggestion: () => { if (!key || !suggestions[key]) return false; inbox.setDraft(suggestions[key].slice(0, 4000)); setDismissed(key); return true; },
    /** An answer into the reply box: after what is already typed, never over it. */
    insertText: (text: string) => inbox.setDraft((draft.trim() ? `${draft.trimEnd()}\n\n${text}` : text).slice(0, 4000)),
  };
}
export type TraxAssistState = ReturnType<typeof useTraxAssist>;

function Spark({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" strokeLinejoin="round" />
      <path d="M18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * In the reply box's tool group: ask TRAX for a reply when it did not draft one by
 * itself (the agent wrote last). The draft then appears as grey text in the box.
 */
export function SuggestReplyButton({ assist }: { assist: TraxAssistState }) {
  if (!assist.enabled || assist.suggestion) return null;
  return (
    <button type="button" aria-label="Ask TRAX to suggest a reply" onClick={assist.requestSuggestion} disabled={assist.drafting}
      className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
      <Spark className={`size-4 ${assist.drafting ? 'animate-pulse text-primary motion-reduce:animate-none' : ''}`} />
    </button>
  );
}

const STARTERS = ['Summarise this ticket', 'Check this tenant’s account for anything related', 'Draft a reply to the tenant'];

/** The Trax tab: a conversation with TRAX about the open ticket. */
export function TraxAssistPanel({ assist, ticketOpen }: { assist: TraxAssistState; ticketOpen: boolean }) {
  const [text, setText] = React.useState('');
  const [copied, setCopied] = React.useState<number | null>(null);
  const scroll = React.useRef<HTMLDivElement>(null);
  const { turns, asking } = assist;
  React.useEffect(() => { const el = scroll.current; if (el) el.scrollTop = el.scrollHeight; }, [turns.length, asking]);
  const send = () => { const value = text.trim(); if (!value || asking) return; setText(''); void assist.ask(value); };
  const copy = async (index: number, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(index); window.setTimeout(() => setCopied((old) => (old === index ? null : old)), 1500); } catch { /* clipboard blocked: Use in reply still works */ }
  };

  if (!ticketOpen) return <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Select a ticket to ask TRAX about it.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" aria-live="polite">
        {!turns.length && (
          <div className="space-y-3 py-2">
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              I have read this ticket’s conversation and can look things up in the database. Ask me anything about it.
            </p>
            <div className="flex flex-col items-start gap-1.5">
              {STARTERS.map((s) => (
                <button key={s} type="button" disabled={asking} onClick={() => void assist.ask(s)}
                  className="rounded-full border border-border px-3 py-1.5 text-left text-[12px] text-foreground/80 hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn, index) => turn.role === 'user' ? (
          <div key={index} className="flex justify-end animate-in fade-in slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none">
            <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary/10 px-3 py-2 text-[12.5px] leading-relaxed">{turn.content}</p>
          </div>
        ) : (
          <div key={index} className="group/answer animate-in fade-in slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-primary"><Spark /> TRAX</div>
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">{turn.content}</p>
            {!!turn.checks?.length && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">Checked: {turn.checks.join(' · ')}</p>
            )}
            <div className="mt-1.5 flex items-center gap-1">
              <button type="button" onClick={() => void copy(index, turn.content)}
                className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {copied === index ? 'Copied' : 'Copy'}
              </button>
              <button type="button" onClick={() => assist.insertText(turn.content)}
                className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Use in reply
              </button>
            </div>
          </div>
        ))}
        {asking && (
          <div role="status" className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Spark className="size-3.5 animate-pulse text-primary motion-reduce:animate-none" /> Looking into it…
          </div>
        )}
        {assist.error && <p role="alert" className="text-[12px] text-destructive">{assist.error}</p>}
      </div>
      {/* The same field as the portal's main Trax composer (trax-composer.tsx):
          one big rounded card, a soft brand-gradient ring and glow only while
          focused, and the round gradient send arrow. */}
      <form className="shrink-0 px-3 pb-3 pt-1" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <div className="group/composer relative">
          <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-[1.75rem] bg-[linear-gradient(135deg,hsl(var(--chart-2)/0.5),hsl(var(--primary)/0.3),hsl(var(--chart-4)/0.45))] opacity-0 blur-xl transition-opacity duration-500 group-focus-within/composer:opacity-70 motion-reduce:transition-none" />
          <div className="relative rounded-[calc(1.5rem+1.5px)] p-[1.5px]">
            <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(135deg,hsl(var(--chart-2)),hsl(var(--primary)),hsl(var(--chart-4)))] opacity-0 transition-opacity duration-300 group-focus-within/composer:opacity-100 motion-reduce:transition-none" />
            <div className="relative rounded-3xl bg-card shadow-[0_10px_36px_-14px_hsl(var(--primary)/0.35)]">
              <label htmlFor="trax-assist-input" className="sr-only">Ask TRAX about this ticket</label>
              <textarea id="trax-assist-input" value={text} rows={1} maxLength={6000} placeholder="Ask Trax anything…"
                onChange={(e) => { setText(e.target.value); const el = e.target; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; }}
                /* Enter asks; Shift + Enter is a new line. */
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
                className="block max-h-[200px] min-h-10 w-full resize-none overflow-y-auto bg-transparent px-4 pb-1 pt-3 text-[13.5px] leading-6 text-foreground outline-none placeholder:text-muted-foreground" />
              <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
                {!!turns.length && (
                  <button type="button" onClick={assist.clear} disabled={asking}
                    className="rounded-full px-2 py-1 text-[11px] text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground disabled:opacity-50">Clear chat</button>
                )}
                <button type="submit" disabled={asking || !text.trim()} aria-label={asking ? 'Trax is replying' : 'Ask Trax'}
                  className={`ml-auto flex size-8 shrink-0 items-center justify-center rounded-full transition-[filter,background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${!asking && text.trim()
                    ? 'bg-[linear-gradient(135deg,hsl(var(--chart-2)),hsl(var(--primary)))] text-primary-foreground shadow-[0_4px_12px_-4px_hsl(var(--primary)/0.6)] hover:brightness-110'
                    : 'bg-muted text-muted-foreground'}`}>
                  {asking ? (
                    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className="size-4 animate-spin motion-reduce:animate-none"><path d="M21 12a9 9 0 1 1-6.2-8.6" strokeLinecap="round" /></svg>
                  ) : (
                    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className="size-4"><path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
