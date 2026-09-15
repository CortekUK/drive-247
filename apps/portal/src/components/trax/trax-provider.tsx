"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useChat } from "@/hooks/use-chat";
import { useTraxConversations } from "@/hooks/use-trax-conversations";
import type { UseChatReturn } from "@/types/chat";

/**
 * One Trax conversation, shared by every surface that shows it.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES, AND WHY IT NEEDS A PROVIDER
 *
 * `useChat` keeps `messages`, `isLoading` and `conversationId` in plain
 * `useState` (hooks/use-chat.ts:14-17) — no store, no context, no rehydration.
 * So every call site gets its OWN conversation. That was invisible while Trax
 * had exactly one surface, and becomes the central problem the moment it has
 * two: a sheet and a full page each calling `useChat()` would be two threads
 * that each forget what the other was told, and "expand to full screen" would
 * silently drop the conversation the operator was in the middle of.
 *
 * Calling it ONCE here and passing it down is what makes the sheet and the page
 * the same conversation. The provider is mounted in the dashboard layout, ABOVE
 * `{children}`, and Next's App Router keeps a layout mounted across route
 * changes within its own group — so navigating from the sheet to `/trax` and
 * back preserves the thread without persisting anything.
 *
 * ---------------------------------------------------------------------------
 * WHY v1 IS NOT ROUTED THROUGH THIS
 *
 * `TraxAIDialog` still calls `useChat()` directly and is still mounted in the
 * v1 header for the other 56 tenants. It is deliberately left alone: it owns
 * its own state and its own ⌘J, and the two branches never render together, so
 * there is no shared instance to reconcile. This provider is mounted only under
 * the v2 chrome gate.
 *
 * ---------------------------------------------------------------------------
 * ⌘J LIVES HERE NOW, FOR v2
 *
 * `TraxAIDialog` registers the chord itself. Under v2 that component is no
 * longer mounted — the sheet replaces it — so the chord would simply have
 * stopped working. It is registered here instead, which also keeps it to ONE
 * owner: two listeners on the same chord would toggle twice and cancel out.
 */

interface TraxContextValue {
  /** The single conversation. Same object in the sheet and on the full page. */
  chat: UseChatReturn;
  /** Past conversations, read back from `chat_messages`. */
  history: ReturnType<typeof useTraxConversations>;
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
  /** Open a stored conversation into the live thread. */
  openConversation: (conversationId: string) => Promise<void>;
  /** Start a fresh thread. Does not delete anything server-side. */
  startNewConversation: () => void;
}

const TraxContext = createContext<TraxContextValue | null>(null);

export function TraxProvider({ children }: { children: ReactNode }) {
  const chat = useChat();
  const history = useTraxConversations();
  const [sheetOpen, setSheetOpen] = useState(false);

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const openConversation = useCallback(
    async (conversationId: string) => {
      const messages = await history.loadMessages(conversationId);
      /* Both, together: `sendMessage` threads `conversationId` back to the edge
         function, so loading the messages without the id would make the next
         reply fork a new conversation that reads as a continuation. */
      chat.loadConversation(conversationId, messages);
    },
    [chat, history],
  );

  const startNewConversation = useCallback(() => {
    chat.clearChat();
  }, [chat]);

  /* ⌘J / Ctrl+J toggles the sheet. One owner only — see the note above. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setSheetOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  /* Keep the conversation list honest: a brand-new thread only exists in the
     database once the first reply has landed, which is when `conversationId`
     first becomes non-null. */
  useEffect(() => {
    if (chat.conversationId) history.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.conversationId]);

  const value = useMemo<TraxContextValue>(
    () => ({
      chat,
      history,
      sheetOpen,
      openSheet,
      closeSheet,
      openConversation,
      startNewConversation,
    }),
    [chat, history, sheetOpen, openSheet, closeSheet, openConversation, startNewConversation],
  );

  return <TraxContext.Provider value={value}>{children}</TraxContext.Provider>;
}

/**
 * Read the shared conversation.
 *
 * Throws rather than returning null on purpose: a surface rendered outside the
 * provider would otherwise fall back to its own state and look like it worked,
 * which is exactly the two-conversation bug this file exists to prevent.
 */
export function useTrax(): TraxContextValue {
  const ctx = useContext(TraxContext);
  if (!ctx) {
    throw new Error(
      "useTrax must be used inside <TraxProvider>. A Trax surface outside the " +
        "provider would create a SECOND conversation rather than sharing the one " +
        "on screen — see components/trax/trax-provider.tsx.",
    );
  }
  return ctx;
}

/**
 * Non-throwing variant, for chrome that may render on a route without the
 * provider (the Messages workspace bypasses parts of the layout).
 */
export function useTraxOptional(): TraxContextValue | null {
  return useContext(TraxContext);
}
