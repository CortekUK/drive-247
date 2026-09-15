"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bot, Send } from "lucide-react";
import { ChatMessage } from "@/components/chat";
import { Button } from "@/components/ui-v2/button";
import { useTrax } from "./trax-provider";

/**
 * The Trax conversation itself — message list plus composer.
 *
 * ONE implementation, rendered by both surfaces: the sheet and the full page.
 * They differ only in `density`. That is deliberate: message rendering, the
 * action confirm/reject wiring, auto-scroll and the Enter/Shift+Enter contract
 * are all things that must behave identically in a panel and on a page, and two
 * copies of them drift the first time one is touched.
 *
 * It reads the conversation from `useTrax()`, never from `useChat()` directly —
 * calling the hook here would give this component its own thread and undo the
 * whole point of the provider.
 */

const SUGGESTIONS = [
  "Which rentals have pending extension requests?",
  "Show me this month's revenue breakdown",
  "How do installments work?",
  "Which vehicles are out right now?",
];

export function TraxThread({ density = "page" }: { density?: "sheet" | "page" }) {
  const { chat } = useTrax();
  const { messages, isLoading, sendMessage, confirmAction, rejectAction } = chat;
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const compact = density === "sheet";

  /* Pin to the newest message. `messages.length` rather than `messages`: the
     array identity changes on every action-confirm rewrite too, and scrolling
     on those yanks the view while someone is reading. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isLoading]);

  const submit = () => {
    const text = draft.trim();
    if (!text || isLoading) return;
    setDraft("");
    void sendMessage(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    /* Enter sends, Shift+Enter breaks the line — the convention every operator
       already knows from ChatGPT and Claude. `isComposing` guards IME input:
       without it, committing a character with Enter would send a half-typed
       message for anyone typing a non-Latin script. */
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`no-scrollbar min-h-0 flex-1 overflow-y-auto ${compact ? "px-4 py-4" : "px-6 py-8"}`}>
        {messages.length === 0 ? (
          <div className={`mx-auto flex h-full max-w-2xl flex-col items-center justify-center text-center ${compact ? "gap-4" : "gap-6"}`}>
            <span className="flex size-12 items-center justify-center rounded-4xl bg-primary/10 text-primary">
              <Bot className="size-6" aria-hidden />
            </span>
            <div>
              <p className={`font-semibold ${compact ? "text-base" : "text-xl"}`}>Ask Trax</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Your rentals, customers and money — in plain questions.
              </p>
            </div>
            <div className={`grid w-full gap-2 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void sendMessage(s)}
                  className="rounded-xl border border-border bg-card px-3 py-2.5 text-left text-[13px] text-foreground transition-colors hover:border-primary/40 hover:bg-primary/[0.06]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={`mx-auto flex flex-col gap-4 ${compact ? "max-w-none" : "max-w-3xl"}`}>
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                message={m}
                onConfirmAction={confirmAction}
                onRejectAction={rejectAction}
                /* `onNavigate` is deliberately NOT passed, and that is a
                   behavioural difference from v1 rather than an omission.
                   Despite the name it is a "dismiss me" callback — the cards
                   and the action badge do their own routing, and the v1 dialog
                   supplies `() => setIsOpen(false)` because it is a full-screen
                   overlay you cannot see past.
                   Neither surface here has that problem: the sheet is a side
                   panel, so staying open while the page behind it navigates is
                   the entire reason it is a sheet and not a dialog; and the full
                   page is a route, so there is nothing to dismiss. Leaving it
                   undefined keeps Trax on screen next to whatever it just
                   took you to. */
                isLoading={isLoading}
              />
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                Thinking…
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className={`shrink-0 border-t border-border bg-background/60 ${compact ? "p-3" : "px-6 py-4"}`}>
        <div className={`mx-auto ${compact ? "max-w-none" : "max-w-3xl"}`}>
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 transition-colors focus-within:border-primary/40">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Ask Trax anything…"
              aria-label="Ask Trax"
              className="no-scrollbar max-h-40 min-h-9 w-full flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <Button
              size="icon-sm"
              onClick={submit}
              disabled={!draft.trim() || isLoading}
              aria-label="Send"
              className="mb-0.5 shrink-0"
            >
              <Send />
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Trax can make mistakes — double-check anything that moves money.
            <span className="mx-1.5">·</span>
            Enter to send, Shift+Enter for a new line
          </p>
        </div>
      </div>
    </div>
  );
}
