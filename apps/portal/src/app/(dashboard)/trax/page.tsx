"use client";

import { Bot, Minimize2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui-v2/button";
import { TraxThread } from "@/components/trax/trax-thread";
import { useTrax } from "@/components/trax/trax-provider";

/**
 * Trax, full screen — the shape operators already know.
 *
 * Built to read like ChatGPT / Claude on purpose, and that is a design decision
 * rather than an aesthetic one: most of these operators reach us having already
 * used one of those in a browser tab, so the layout is already in their head. A
 * conversation list on the left, the thread on the right, the composer pinned to
 * the bottom. Reinventing it would cost them the one thing they arrive with.
 *
 * ---------------------------------------------------------------------------
 * THE CONVERSATION SURVIVES THE TRIP HERE
 *
 * This page and the docked panel render the SAME thread, because `TraxProvider`
 * is mounted in the dashboard layout — above the route — and Next keeps a layout
 * mounted across navigations inside its own group. So "full screen" from the
 * panel continues the conversation rather than starting a second one, and
 * minimising back to the panel keeps it too. Neither surface calls `useChat()`
 * itself; doing so is what would fork the thread.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE HISTORY COMES FROM, AND WHAT IT CANNOT DO YET
 *
 * The edge function has always written every exchange to `chat_messages`
 * (chat/index.ts:587) — nothing ever read it back, so a refresh emptied the
 * screen while the rows sat in the database. `useTraxConversations` is that
 * read. Two honest limits, both surfaced rather than hidden:
 *
 *   - The list folds a bounded page of recent messages client-side, because
 *     "one row per conversation" is a GROUP BY PostgREST cannot express and the
 *     alternative was adding a view to a production schema. Conversations older
 *     than that window are not listed; the footer says so.
 *   - There is no rename and no delete. Both need endpoints that do not exist,
 *     and a delete that only cleared local state would be a lie.
 */
export default function TraxPage() {
  const router = useRouter();
  const { chat, history, openConversation, startNewConversation, openSheet } = useTrax();

  const active = chat.conversationId;

  /** Back to the docked panel: same thread, smaller frame. */
  const minimise = () => {
    openSheet();
    router.back();
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* Conversation list. Hidden on a phone, where a 260px column beside a
          conversation leaves neither of them readable. */}
      <aside className="hidden w-[264px] shrink-0 flex-col border-r border-border md:flex">
        <div className="shrink-0 p-3">
          <Button
            variant="outline"
            onClick={startNewConversation}
            disabled={chat.messages.length === 0}
            className="w-full justify-start gap-2 text-[13px]"
          >
            <Plus className="size-4" aria-hidden />
            New conversation
          </Button>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {history.isLoading ? (
            <p className="px-2 py-3 text-[12px] text-muted-foreground">Loading…</p>
          ) : history.error ? (
            /* Shown, not swallowed: supabase-js resolves with {error} rather
               than throwing, so a failed read would otherwise render as "no
               conversations yet" and read as data loss. */
            <p className="px-2 py-3 text-[12px] text-destructive">
              Couldn&apos;t load past conversations. {history.error}
            </p>
          ) : history.conversations.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-muted-foreground">
              Past conversations appear here once you&apos;ve asked something.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {history.conversations.map((c) => (
                <li key={c.conversationId}>
                  <button
                    type="button"
                    onClick={() => void openConversation(c.conversationId)}
                    aria-current={c.conversationId === active ? "true" : undefined}
                    className={
                      "w-full truncate rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors " +
                      (c.conversationId === active
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground")
                    }
                    title={c.title}
                  >
                    {c.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {history.conversations.length > 0 && (
          <p className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Showing conversations from your most recent {history.scanLimit} messages.
          </p>
        )}
      </aside>

      {/* The thread. Same 64px header height as the top bar and the panel, so
          the three read as one band. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4 sm:px-6">
          <span className="flex size-7 items-center justify-center rounded-4xl bg-primary/10 text-primary">
            <Bot className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-tight">Trax</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              Ask about rentals, customers and money
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={minimise}
            aria-label="Minimise to side panel"
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <Minimize2 />
          </Button>
        </header>

        <TraxThread density="page" />
      </div>
    </div>
  );
}
