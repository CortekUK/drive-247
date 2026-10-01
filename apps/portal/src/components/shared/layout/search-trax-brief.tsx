"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, CornerDownRight } from "lucide-react";
import { TraxMark } from "@/components/trax/trax-greeting";
import { SearchEmptyArt } from "@/components/illustrations-v2/empty-scenes";
import { useSearchBrief, type BriefKind } from "@/hooks/use-search-brief";
import type { SearchResult } from "@/lib/search-service";

/**
 * The right-hand side of the v2 ⌘K search: Trax telling you the useful part
 * about the highlighted result, as the opening of a conversation, with a way to
 * carry that conversation on in Trax.
 *
 * v2 only — mounted by global-search-v2.tsx, which only the v2 top bar uses.
 */

/** Arrowing through the list should not read a record per row. */
const SETTLE_MS = 300;
/** How fast the brief appears, as if Trax is typing it. */
const CHARS_PER_TICK = 3;
const TICK_MS = 16;

export const SearchTraxBrief = ({
  result,
  onContinue,
}: {
  result: SearchResult;
  /** Carry a question into Trax. `kind` says whether it is about a record (Trax opens beside it). */
  onContinue: (question: string, kind: BriefKind) => void;
}) => {
  const [settled, setSettled] = useState<SearchResult | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(result), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [result]);

  const current = settled?.url === result.url ? settled : null;
  const { brief, isLoading } = useSearchBrief(current);
  // The first sentence is the headline, typed out in heavy accent; each of the
  // rest is one point of its own, listed under it once the headline is written.
  const headline = brief?.lines[0] ?? "";
  const points = brief?.lines.slice(1) ?? [];
  const shown = useTyped(headline);
  const thinking = !current || isLoading;
  const typed = !!brief && shown.length >= headline.length;
  // Live facts when Trax has them; otherwise what the search knows, minus the bare route.
  const details = brief?.facts ?? (result.details ?? []).filter((d) => d.label !== "Opens");
  // A follow-up about a page carries its name; a record's is asked beside the record.
  const ask = (q: string) => brief && onContinue(brief.kind === "other" ? `${q} (${result.title})` : q, brief.kind);

  return (
    <div className="flex h-full min-h-0 flex-col p-5">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {thinking ? (
          <p className="pr-8 text-sm text-muted-foreground">Looking at {result.title}…</p>
        ) : brief ? (
          <div aria-live="polite">
            {/* Clear of the dialog's close button in the corner. */}
            <p className="pr-8 text-xl font-extrabold leading-snug tracking-tight text-primary">
              {shown}
              {!typed && <Caret />}
            </p>
            {typed && points.length > 0 && (
              <ul className="mt-3 space-y-2">
                {points.map((point, i) => (
                  <li
                    key={i}
                    className="flex animate-in fade-in-0 slide-in-from-bottom-3 gap-2.5 text-sm leading-snug text-foreground duration-200 ease-out fill-mode-both motion-reduce:animate-none"
                    style={{ animationDelay: `${i * 70}ms` }}
                  >
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                    <span><Emphasis text={point} /></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">I could not read {result.title} just now. Open it, or ask me in Trax.</p>
        )}

        {/* What the search already knows about it, once Trax has had its say. */}
        {typed && details.length > 0 && (
          <dl className="mt-4 animate-in fade-in-0 slide-in-from-bottom-3 rounded-lg border border-border/70 bg-background/80 px-3 duration-200 ease-out motion-reduce:animate-none">
            {details.map((d, i) => (
              <div key={`${d.label}-${i}`} className="flex items-baseline justify-between gap-4 border-b border-border/70 py-2 last:border-b-0">
                <dt className="text-xs text-muted-foreground">{d.label}</dt>
                <dd className="max-w-[65%] truncate text-right text-xs font-medium text-foreground">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Follow-ups: each one opens the conversation in Trax with that question. */}
        {typed && brief && (
          <div className="mt-4 animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">Ask Trax</p>
            <div className="flex flex-col items-start gap-1.5">
              {brief.suggestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => ask(q)}
                  className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/80 px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <CornerDownRight className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Into the full conversation with the brief's own question. */}
      <div className="flex justify-end pt-3">
        <TraxLink onClick={() => brief && onContinue(brief.question, brief.kind)} disabled={!brief} thinking={thinking} />
      </div>
    </div>
  );
};

/** Trax's side before anything is picked: the search picture, and the way into the conversation. */
export const SearchTraxIdle = ({ onOpenTrax }: { tenantName?: string | null; onOpenTrax: () => void }) => (
  <div className="flex h-full min-h-0 flex-col p-5">
    {/* Just the picture, its words drawn into it, centred in the pane. */}
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <SearchEmptyArt className="max-w-[420px]" />
    </div>
    <div className="flex justify-end pt-3">
      <TraxLink onClick={onOpenTrax} />
    </div>
  </div>
);

/** The way into the Trax conversation: accent text, not a filled button. */
const TraxLink = ({ onClick, disabled, thinking }: { onClick: () => void; disabled?: boolean; thinking?: boolean }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="group -mb-1.5 -mr-2.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-base font-extrabold tracking-tight text-primary transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-none disabled:opacity-50"
  >
    <TraxMark size="xs" animated={thinking} />
    Trax
    <ArrowUpRight className="h-4 w-4 stroke-[2.5] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
  </button>
);

/** Numbers, amounts and percentages in bold, so a point can be read at a glance. */
const FIGURE = /(?<![\w])((?:[£$€])?\d[\d,]*(?:\.\d+)?%?)(?![\w])/g;
export const Emphasis = ({ text }: { text: string }) => (
  <>
    {text.split(FIGURE).map((part, i) =>
      i % 2 === 1 ? <strong key={i} className="font-bold">{part}</strong> : part,
    )}
  </>
);

export const Caret = () => (
  <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-primary" aria-hidden />
);

/** Reveals `text` a few characters at a time; all at once for reduced motion. */
export function useTyped(text: string): string {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setCount(text.length);
      return;
    }
    setCount(0);
    if (!text) return;
    const timer = window.setInterval(() => {
      setCount((n) => {
        const next = n + CHARS_PER_TICK;
        if (next >= text.length) window.clearInterval(timer);
        return Math.min(next, text.length);
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [text]);
  return text.slice(0, count);
}
