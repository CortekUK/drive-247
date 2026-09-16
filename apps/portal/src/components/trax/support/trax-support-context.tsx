"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
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
 */
const TraxSupportContext = createContext<UseChatReturn | null>(null);

export function TraxSupportProvider({ children }: { children: ReactNode }) {
  const trax = useTraxOptional();
  const pathname = usePathname();
  const visible = !!trax?.sheetOpen || isTraxPath(pathname);
  const [activated, setActivated] = useState(false);
  if (!activated && visible) setActivated(true);
  // Access rechecks run only while a surface shows the conversation.
  const support = useTraxSupport(activated, visible);
  return <TraxSupportContext.Provider value={support}>{children}</TraxSupportContext.Provider>;
}

/** v2 Trax: the panel/page state (TraxProvider) with the support conversation inside it. */
export function TraxV2Provider({ children }: { children: ReactNode }) {
  return (
    <TraxProvider>
      <TraxSupportProvider>{children}</TraxSupportProvider>
    </TraxProvider>
  );
}

export function useTraxSupportChat(): UseChatReturn {
  const ctx = useContext(TraxSupportContext);
  if (!ctx) throw new Error("useTraxSupportChat must be used inside <TraxSupportProvider>.");
  return ctx;
}

/** Non-throwing variant for chrome that also renders outside v2 (the panel mount). */
export function useTraxSupportChatOptional(): UseChatReturn | null {
  return useContext(TraxSupportContext);
}
