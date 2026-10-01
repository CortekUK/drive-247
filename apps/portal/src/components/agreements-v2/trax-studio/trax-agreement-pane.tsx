"use client";

/**
 * Agreements v2 — the studio's left pane: Trax, specialised in this template.
 *
 * The operator asks, Trax answers, suggests, or makes the change. Changes are
 * typed into the document live (./live-writer) while Trax's words stream in
 * here. Nothing is saved until the operator presses Save template; the latest
 * change can be undone from its message, and Ctrl+Z undoes a whole Trax
 * change in one step.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Check, Lightbulb, Loader2, MessageCircleQuestion, Minus, PenLine, Plus, Square, TriangleAlert, Undo2, Wand2 } from "lucide-react";
import { TraxMark } from "@/components/trax/trax-greeting";
import { TraxComposer } from "@/components/trax/trax-composer";
import { SIDEBAR_HIGHLIGHT_FOCUS, SIDEBAR_HIGHLIGHT_HOVER } from "@/components/ui-v2/sidebar";
import { cn } from "@/lib/utils";
import { TEMPLATE_VARIABLES } from "@/lib/template-variables";
import {
  createTraxStreamParser,
  streamTraxAgreementEdit,
  type TraxTurn,
} from "@/lib/agreements-v2/trax-stream";
import { captureBlocks, restoreDocument, TraxLiveWriter, type TraxActivity } from "./live-writer";

interface Turn {
  id: number;
  role: "user" | "trax";
  text: string;
  activities: TraxActivity[];
  status: "streaming" | "done" | "error" | "stopped";
  before?: PMNode;
  changed?: boolean;
  undone?: boolean;
  warnings?: string[];
}

const KNOWN_KEYS = new Set(TEMPLATE_VARIABLES.map((v) => v.key));
const VARIABLE_TOKEN = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g;

function unknownVariables(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(VARIABLE_TOKEN)) if (!KNOWN_KEYS.has(m[1])) out.add(m[1]);
  return out;
}

const STARTER_ICON: Record<string, typeof PenLine> = { Ask: MessageCircleQuestion, Suggest: Lightbulb, Make: Wand2 };

const STARTERS: { group: string; prompts: string[] }[] = [
  {
    group: "Ask",
    prompts: ["How do I show the security deposit?", "Which variables fill in the customer's licence?"],
  },
  {
    group: "Suggest",
    prompts: ["Review my agreement. What's missing?", "Is anything unclear for a customer?"],
  },
  {
    group: "Make",
    prompts: [
      "Add a late return fee clause",
      "Add no smoking and no pets rules",
      "Make the wording simpler and friendlier",
    ],
  },
];

const ACTIVITY_VERB: Record<TraxActivity["kind"], { writing: string; done: string; icon: typeof PenLine }> = {
  replace: { writing: "Rewriting", done: "Rewrote", icon: PenLine },
  insert: { writing: "Adding", done: "Added", icon: Plus },
  delete: { writing: "Removing", done: "Removed", icon: Minus },
};

/** What Trax remembers of its own turn in the next request: its words and what it changed. */
function turnForHistory(turn: Turn): TraxTurn {
  if (turn.role === "user") return { role: "user", content: turn.text };
  const changes = turn.activities
    .filter((a) => a.state === "done")
    .map((a) => `${ACTIVITY_VERB[a.kind].done} ${a.label || "a block"}`);
  const note = turn.undone ? " (the operator undid these changes)" : "";
  return {
    role: "assistant",
    content: [turn.text, changes.length ? `[Changes made: ${changes.join("; ")}${note}]` : ""].filter(Boolean).join("\n"),
  };
}

export function TraxAgreementPane({
  editor,
  templateName,
  scrollHost,
  onWritingChange,
  header,
}: {
  /** Replaces the pane's own "Trax" heading (the studio puts the template's name here). */
  header?: ReactNode;
  editor: Editor | null;
  templateName: string;
  /** The scroll container of the document being written, so Trax keeps its line in view. */
  scrollHost: () => HTMLElement | null;
  /** True while Trax is typing into the document. */
  onWritingChange: (writing: boolean) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const writerRef = useRef<TraxLiveWriter | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  // Stay pinned to the newest message while it streams.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  // Leaving mid-run: stop the request and hand the document back.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      writerRef.current?.stop();
    },
    [],
  );

  const patchTurn = useCallback((id: number, patch: (t: Turn) => Turn) => {
    setTurns((all) => all.map((t) => (t.id === id ? patch(t) : t)));
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy || !editor) return;
      setDraft("");
      setBusy(true);

      const userTurn: Turn = { id: nextId.current++, role: "user", text, activities: [], status: "done" };
      const traxTurn: Turn = { id: nextId.current++, role: "trax", text: "", activities: [], status: "streaming" };
      const history = [...turnsRef.current.filter((t) => t.status !== "error"), userTurn].map(turnForHistory);
      setTurns((all) => [...all, userTurn, traxTurn]);

      const blocks = captureBlocks(editor);
      const unknownBefore = unknownVariables(editor.getHTML());
      const controller = new AbortController();
      abortRef.current = controller;
      const writer = new TraxLiveWriter({
        editor,
        blocks,
        scrollHost,
        onActivity: (activity) =>
          patchTurn(traxTurn.id, (t) => {
            const others = t.activities.filter((a) => a.id !== activity.id);
            return { ...t, activities: [...others, activity].sort((a, b) => a.id - b.id) };
          }),
      });
      writerRef.current = writer;

      let sayOpen = false;
      let wroteOnce = false;
      // Once Trax has started writing, its words wait their turn behind the
      // typing, so "Done" never appears while the page is still being written.
      const inOrder = (fn: () => void) => (wroteOnce ? writer.after(fn) : fn());
      const parser = createTraxStreamParser({
        onSayStart: () =>
          inOrder(() => {
            sayOpen = true;
            patchTurn(traxTurn.id, (t) => ({ ...t, text: t.text ? `${t.text.trimEnd()}\n\n` : "" }));
          }),
        onSayText: (chunk) =>
          inOrder(() =>
            patchTurn(traxTurn.id, (t) => ({ ...t, text: t.text + (sayOpen && !t.text.trim() ? chunk.trimStart() : chunk) })),
          ),
        onSayEnd: () =>
          inOrder(() => {
            sayOpen = false;
          }),
        onOpStart: (op) => {
          if (!wroteOnce) {
            wroteOnce = true;
            onWritingChange(true);
          }
          writer.opStart(op);
        },
        onOpText: (html) => writer.opText(html),
        onOpEnd: () => writer.opEnd(),
      });

      let status: Turn["status"] = "done";
      let errorText: string | null = null;
      try {
        await streamTraxAgreementEdit({ name: templateName, blocks, messages: history }, (chunk) => parser.push(chunk), controller.signal);
        parser.end();
      } catch (e) {
        parser.end();
        if ((e as Error)?.name === "AbortError") status = "stopped";
        else {
          status = "error";
          errorText = e instanceof Error && e.message ? e.message : "I couldn't answer just now. Try again in a moment.";
        }
      }
      if (status === "stopped") writer.stop();
      await writer.finish();
      writerRef.current = null;
      abortRef.current = null;
      onWritingChange(false);

      const introduced = [...unknownVariables(editor.getHTML())].filter((k) => !unknownBefore.has(k));
      const warnings = introduced.length
        ? [`${introduced.map((k) => `{{${k}}}`).join(", ")} ${introduced.length === 1 ? "isn't a variable" : "aren't variables"}, so ${introduced.length === 1 ? "it prints" : "they print"} blank. Ask me to swap ${introduced.length === 1 ? "it" : "them"} for fixed text.`]
        : undefined;

      patchTurn(traxTurn.id, (t) => ({
        ...t,
        status: status === "error" && writer.didChange ? "done" : status,
        text: status === "error" ? (t.text ? `${t.text}\n\n${errorText}` : errorText ?? "") : t.text || (status === "stopped" ? "Stopped." : t.text),
        before: writer.didChange ? writer.before : undefined,
        changed: writer.didChange,
        warnings,
      }));
      setBusy(false);
    },
    [busy, editor, onWritingChange, patchTurn, scrollHost, templateName],
  );

  const stop = () => {
    abortRef.current?.abort();
  };

  const undo = (turn: Turn) => {
    if (!editor || !turn.before) return;
    restoreDocument(editor, turn.before);
    patchTurn(turn.id, (t) => ({ ...t, undone: true }));
  };

  const lastChangedId = [...turns].reverse().find((t) => t.role === "trax" && t.changed)?.id;

  return (
    <section aria-label="Trax" className="flex min-h-0 flex-1 flex-col">
      {/* `null` means "no heading at all"; only an omitted prop falls back to Trax's own. */}
      {header !== undefined ? header : (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <TraxMark size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Trax</p>
            <p className="truncate text-xs text-muted-foreground">Writes this agreement with you</p>
          </div>
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 pt-[19px] pb-4" aria-live="polite">
        {turns.length === 0 ? (
          // The starters below are plain rows that tint on hover like the main
          // sidebar's items. No boxes, no borders.
          // Its own opening, not the main panel's greeting: the Trax mark and a
          // line about THIS job, left-aligned with the rows below it.
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3 px-3">
              <TraxMark size="sm" className="mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Write it with Trax</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Ask about a variable, get a review, or tell me what to change. I edit the page as we go; nothing is kept until you save.
                </p>
              </div>
            </div>
            {STARTERS.map((group) => {
              const GroupIcon = STARTER_ICON[group.group];
              return (
                <div key={group.group} className="space-y-0.5">
                  <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{group.group}</p>
                  {group.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={!editor}
                      onClick={() => void send(prompt)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-foreground transition-colors duration-200 ease-out focus-visible:outline-none disabled:opacity-50 motion-reduce:transition-none",
                        SIDEBAR_HIGHLIGHT_HOVER,
                        SIDEBAR_HIGHLIGHT_FOCUS,
                      )}
                    >
                      <GroupIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0">{prompt}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {turns.map((turn) => (
              <li
                key={turn.id}
                className="animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none"
              >
                {turn.role === "user" ? (
                  <div className="ml-8 rounded-2xl rounded-br-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-foreground">
                    {turn.text}
                  </div>
                ) : (
                  <TraxMessage turn={turn} canUndo={turn.id === lastChangedId && !turn.undone && !busy} onUndo={() => undo(turn)} />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* The regular Trax composer (components/trax/trax-composer.tsx). */}
      <div className="px-3 pt-1 pb-3">
        {busy && (
          <div className="mb-2 flex justify-center">
            <button
              type="button"
              onClick={stop}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors duration-200 ease-out motion-reduce:transition-none",
                SIDEBAR_HIGHLIGHT_HOVER,
              )}
            >
              <Square className="size-3 fill-current" aria-hidden="true" />
              Stop Trax
            </button>
          </div>
        )}
        <TraxComposer
          density="sheet"
          busy={busy}
          capability={null}
          capabilityResolved
          placeholder="Ask Trax to change something…"
          onSend={(text) => void send(text)}
        />
      </div>
    </section>
  );
}

/** Past this many, a turn's changes fold to the latest few (the one being written always shows). */
const COLLAPSE_AT = 5;

function visibleActivities(all: TraxActivity[], expanded: boolean): TraxActivity[] {
  if (expanded || all.length <= COLLAPSE_AT) return all;
  return all.slice(-3);
}

function TraxMessage({ turn, canUndo, onUndo }: { turn: Turn; canUndo: boolean; onUndo: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const streaming = turn.status === "streaming";
  return (
    <div className="flex gap-2.5">
      <TraxMark size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2">
        {turn.text || streaming ? (
          <p className={cn("text-sm whitespace-pre-wrap text-foreground", turn.status === "error" && "text-destructive")}>
            {turn.text}
            {streaming && <span className="trax-chat-caret" aria-hidden="true" />}
          </p>
        ) : null}

        {turn.activities.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-primary/5 p-2 dark:bg-[hsl(var(--v2-hover,var(--muted)))]">
            {visibleActivities(turn.activities, expanded).map((a) => {
              const verb = ACTIVITY_VERB[a.kind];
              const Icon = verb.icon;
              return (
                <li key={a.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  {a.state === "writing" ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden="true" />
                  ) : (
                    <Icon className="size-3.5 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden="true" />
                  )}
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-foreground">{a.state === "writing" ? verb.writing : verb.done}</span>
                    {a.label ? ` ${a.label}` : ""}
                  </span>
                  {a.state === "done" && <Check className="ml-auto size-3.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />}
                </li>
              );
            })}
            {turn.activities.length > COLLAPSE_AT && (
              <li>
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="text-xs font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] hover:underline"
                >
                  {expanded ? "Show less" : `Show all ${turn.activities.length} changes`}
                </button>
              </li>
            )}
          </ul>
        )}

        {turn.warnings?.map((w) => (
          <p key={w} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>{w}</span>
          </p>
        ))}

        {turn.undone ? (
          <p className="text-xs text-muted-foreground">Undone. The document is back to how it was.</p>
        ) : canUndo ? (
          <button
            type="button"
            onClick={onUndo}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-foreground transition-colors duration-200 ease-out motion-reduce:transition-none",
              SIDEBAR_HIGHLIGHT_HOVER,
            )}
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            Undo these changes
          </button>
        ) : null}
      </div>
    </div>
  );
}
