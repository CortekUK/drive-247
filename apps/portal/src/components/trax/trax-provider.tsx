"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
 * `useState` — no store, no context, no rehydration. So every call site gets
 * its OWN conversation. That was invisible while Trax had exactly one surface,
 * and becomes the central problem the moment it has two: a panel and a full
 * page each calling `useChat()` would be two threads that each forget what the
 * other was told, and "expand to full screen" would silently drop the
 * conversation the operator was in the middle of.
 *
 * Calling it ONCE here and passing it down is what makes the panel and the page
 * the same conversation. The provider is mounted in the dashboard layout, ABOVE
 * `{children}`, and Next's App Router keeps a layout mounted across route
 * changes within its own group — so moving between the panel and `/trax`
 * preserves the thread without persisting anything.
 *
 * ---------------------------------------------------------------------------
 * THE TWO SURFACES, AND THE THREE WAYS BETWEEN THEM
 *
 *   panel — docked beside whatever page is open (trax-panel.tsx).
 *   page  — `/trax`, where the app sidebar becomes the conversation rail
 *           (trax-rail.tsx) and the page is one centred conversation column.
 *
 *   expandToFullPage  panel → page. Closes the panel and pushes `/trax`.
 *   minimiseToPanel   page → panel. Opens the panel and returns to the page the
 *                     operator came from, so they land back beside that record.
 *   leaveFullPage     page → that same page, panel closed (the rail's Back).
 *
 * The two surfaces are mutually exclusive: entering `/trax` by ANY route (the
 * expand button, a featured card linking there, a pasted URL) closes the panel,
 * so a browser Back does not resurrect a docked copy of the conversation the
 * operator was just reading full screen.
 *
 * `returnPath` is where "back" goes: the last in-app location OUTSIDE `/trax`,
 * query string included (a Settings tab, a record section). It is in memory
 * only, so after a hard reload straight onto `/trax` it is `/`.
 *
 * ---------------------------------------------------------------------------
 * WHY v1 IS NOT ROUTED THROUGH THIS
 *
 * `TraxAIDialog` still calls `useChat()` directly and is still mounted in the
 * v1 header for the other tenants. It is deliberately left alone: it owns its
 * own state and its own ⌘J, and the two branches never render together, so
 * there is no shared instance to reconcile. This provider is mounted only under
 * the v2 chrome gate.
 *
 * ---------------------------------------------------------------------------
 * ⌘J LIVES HERE, FOR v2 — ONE OWNER
 *
 * Two listeners on the same chord would toggle twice and cancel out, so the
 * chord is registered once, here. It toggles the panel; on `/trax`, where there
 * is no panel to toggle, it minimises the page back into one.
 */

interface TraxContextValue {
  /** The single conversation. Same object in the panel and on the full page. */
  chat: UseChatReturn;
  /** Past conversations, read back from `chat_messages`. */
  history: ReturnType<typeof useTraxConversations>;
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
  /** ⌘J. Toggles the panel; on `/trax` it is `minimiseToPanel`. */
  toggleSheet: () => void;
  /** Open a stored conversation into the live thread. Throws on a failed read. */
  openConversation: (conversationId: string) => Promise<void>;
  /** Start a fresh thread. Does not delete anything server-side. */
  startNewConversation: () => void;
  /** Last in-app pathname + search outside `/trax`; `/` when there is none. */
  returnPath: string;
  /** Panel → full page, same thread. */
  expandToFullPage: () => void;
  /** Full page → panel, back on the page the operator came from. */
  minimiseToPanel: () => void;
  /** Full page → the page the operator came from, panel closed. */
  leaveFullPage: () => void;
  /** Which surface is showing the conversation right now, if any. */
  surface: "panel" | "page" | null;
}

const TraxContext = createContext<TraxContextValue | null>(null);

/** `/trax` and anything under it. One test, shared with the panel and rail. */
export function isTraxPath(pathname: string | null | undefined): boolean {
  return pathname === "/trax" || !!pathname?.startsWith("/trax/");
}

export function TraxProvider({ children }: { children: ReactNode }) {
  const chat = useChat();
  const history = useTraxConversations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [returnPath, setReturnPath] = useState("/");

  const onTrax = isTraxPath(pathname);

  /* Record where "back" goes. Every location outside `/trax` overwrites it, so
     it is always the page the operator was last on — however they then reached
     the full page. Search params are part of it: Back from Trax should land on
     the Settings tab or record section they left, not its default. */
  const search = searchParams?.toString() ?? "";
  useEffect(() => {
    if (!pathname || isTraxPath(pathname)) return;
    setReturnPath(search ? `${pathname}?${search}` : pathname);
  }, [pathname, search]);

  /* Entering the full page absorbs the panel — see "mutually exclusive" above.
     Keyed on `onTrax` alone: `minimiseToPanel` sets the panel open while still
     on `/trax`, and re-running this on that change would immediately undo it. */
  useEffect(() => {
    if (onTrax) setSheetOpen(false);
  }, [onTrax]);

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const expandToFullPage = useCallback(() => {
    setSheetOpen(false);
    router.push("/trax");
  }, [router]);

  const minimiseToPanel = useCallback(() => {
    setSheetOpen(true);
    router.push(returnPath || "/");
  }, [router, returnPath]);

  const leaveFullPage = useCallback(() => {
    setSheetOpen(false);
    router.push(returnPath || "/");
  }, [router, returnPath]);

  const toggleSheet = useCallback(() => {
    if (onTrax) {
      minimiseToPanel();
      return;
    }
    setSheetOpen((prev) => !prev);
  }, [onTrax, minimiseToPanel]);

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

  /* ⌘J / Ctrl+J. The listener is registered once and reads the latest toggle
     through a ref, so a route change never leaves two listeners attached. */
  const toggleRef = useRef(toggleSheet);
  useEffect(() => {
    toggleRef.current = toggleSheet;
  }, [toggleSheet]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleRef.current();
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

  const surface: TraxContextValue["surface"] = onTrax ? "page" : sheetOpen ? "panel" : null;

  const value = useMemo<TraxContextValue>(
    () => ({
      chat,
      history,
      sheetOpen,
      openSheet,
      closeSheet,
      toggleSheet,
      openConversation,
      startNewConversation,
      returnPath,
      expandToFullPage,
      minimiseToPanel,
      leaveFullPage,
      surface,
    }),
    [
      chat,
      history,
      sheetOpen,
      openSheet,
      closeSheet,
      toggleSheet,
      openConversation,
      startNewConversation,
      returnPath,
      expandToFullPage,
      minimiseToPanel,
      leaveFullPage,
      surface,
    ],
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
