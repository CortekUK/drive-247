"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTraxSupport } from "@/hooks/use-trax-support";
import { TraxProvider, isTraxPath, useTraxOptional } from "@/components/trax/trax-provider";
import type { UseChatReturn } from "@/types/trax-support";

/**
 * The TRAX support conversation behind every v2 Trax surface: the docked panel,
 * the `/trax` page and its rail. Like `TraxProvider`, it sits above the route,
 * so opening the panel, going full screen and coming back is one conversation.
 *
 * It stays idle (no context request) until Trax is first opened — the panel or
 * `/trax` — and then stays active, so closing the panel keeps the thread.
 * `useTraxSupport` still applies its own V2 rollout gate and server checks.
 *
 * The workspace VIEW lives here too, because the panel header switches it
 * (History, New, Support) while the body that renders it is a separate
 * component — and the choice must survive going full screen and back.
 */
export type TraxSupportView = "conversation" | "history" | "tickets" | "retention";

interface TraxSupportValue {
  support: UseChatReturn;
  view: TraxSupportView;
  setView: (view: TraxSupportView) => void;
  /** Fresh thread, back on the conversation view. */
  startNew: () => void;
}

const TraxSupportContext = createContext<TraxSupportValue | null>(null);

export function TraxSupportProvider({ children }: { children: ReactNode }) {
  const trax = useTraxOptional();
  const pathname = usePathname();
  const visible = !!trax?.sheetOpen || isTraxPath(pathname);
  const [activated, setActivated] = useState(false);
  if (!activated && visible) setActivated(true);
  // Access rechecks run only while a surface shows the conversation.
  const support = useTraxSupport(activated, visible);
  const [view, setView] = useState<TraxSupportView>("conversation");

  const startNew = useCallback(() => {
    support.clearChat();
    setView("conversation");
  }, [support]);

  const value = useMemo<TraxSupportValue>(() => ({ support, view, setView, startNew }), [support, view, startNew]);
  return <TraxSupportContext.Provider value={value}>{children}</TraxSupportContext.Provider>;
}

/** v2 Trax: the panel/page state (TraxProvider) with the support conversation inside it. */
export function TraxV2Provider({ children }: { children: ReactNode }) {
  return (
    <TraxProvider>
      <TraxSupportProvider>{children}</TraxSupportProvider>
    </TraxProvider>
  );
}

function useTraxSupportContext(): TraxSupportValue {
  const ctx = useContext(TraxSupportContext);
  if (!ctx) throw new Error("useTraxSupportChat must be used inside <TraxSupportProvider>.");
  return ctx;
}

export function useTraxSupportChat(): UseChatReturn {
  return useTraxSupportContext().support;
}

/** The workspace view and the two actions the panel header drives. */
export function useTraxSupportWorkspace(): Omit<TraxSupportValue, "support"> {
  const { view, setView, startNew } = useTraxSupportContext();
  return { view, setView, startNew };
}

/** Non-throwing variant for chrome that also renders outside v2 (the panel mount). */
export function useTraxSupportOptional(): TraxSupportValue | null {
  return useContext(TraxSupportContext);
}

export function useTraxSupportChatOptional(): UseChatReturn | null {
  return useContext(TraxSupportContext)?.support ?? null;
}
