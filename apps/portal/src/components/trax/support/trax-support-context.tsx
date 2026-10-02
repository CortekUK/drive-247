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
 * (conversation or history) while the body that renders it is a separate
 * component — and the choice must survive going full screen and back. Human
 * support is NOT a view here: it is the portal's own Support section, which
 * TRAX navigates to. `activate()` lets that section load this conversation so
 * an escalation handoff can be submitted with its recorded context.
 */
export type TraxSupportView = "conversation" | "history";

interface TraxSupportValue {
  support: UseChatReturn;
  view: TraxSupportView;
  setView: (view: TraxSupportView) => void;
  /** Fresh thread, back on the conversation view. */
  startNew: () => void;
  /** Load the conversation without opening a TRAX surface (the Support section). */
  activate: () => void;
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
  const activate = useCallback(() => setActivated(true), []);

  const value = useMemo<TraxSupportValue>(() => ({ support, view, setView, startNew, activate }), [support, view, startNew, activate]);
  return <TraxSupportContext.Provider value={value}>{children}</TraxSupportContext.Provider>;
}

/**
 * A SECOND, separate TRAX conversation for one record's own surface — the
 * rental control centre's Trax tab (Oct 2 2026). It provides the same context
 * shape, so `TraxSupportThread` renders inside it unchanged, but it holds its
 * own `useTraxSupport` instance: the floating panel's thread is untouched, and
 * this one starts empty for the record it sits on. The record reaches the
 * server the way the panel's does — `useTraxSupport` sends `pageContext` from
 * the URL (`/rentals/<id>` → `{ kind: "rental", id }`).
 *
 * `active` gates it like the panel's provider: no context request until the
 * surface is first shown, and access rechecks only while it is visible.
 */
export function TraxScopedSupportProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const [activated, setActivated] = useState(false);
  if (!activated && active) setActivated(true);
  const support = useTraxSupport(activated, active);
  const [view, setView] = useState<TraxSupportView>("conversation");
  const startNew = useCallback(() => {
    support.clearChat();
    setView("conversation");
  }, [support]);
  const activate = useCallback(() => setActivated(true), []);
  const value = useMemo<TraxSupportValue>(() => ({ support, view, setView, startNew, activate }), [support, view, startNew, activate]);
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
  const { view, setView, startNew, activate } = useTraxSupportContext();
  return { view, setView, startNew, activate };
}

/** Non-throwing variant for chrome that also renders outside v2 (the panel mount). */
export function useTraxSupportOptional(): TraxSupportValue | null {
  return useContext(TraxSupportContext);
}

export function useTraxSupportChatOptional(): UseChatReturn | null {
  return useContext(TraxSupportContext)?.support ?? null;
}
