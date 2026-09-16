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

/**
 * Where Trax is shown — the floating panel or the /trax page — shared by every surface.
 * The conversation itself lives in TraxSupportProvider (components/trax/support/
 * trax-support-context.tsx, driven by useTraxSupport); the notes below explain why
 * one provider above the route is needed.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES, AND WHY IT NEEDS A PROVIDER
 *
 * `useChat` keeps `messages`, `isLoading` and `conversationId` in plain
 * `useState` — no store, no context, no rehydration. So every call site gets
 * its OWN conversation. That was invisible while Trax had exactly one surface,
 * and becomes the central problem the moment it has two: a panel and a full
 * page each calling `useChat()` would be two threads that each forget what the
 * other was told, and moving from one to the other would silently drop the
 * conversation the operator was in the middle of.
 *
 * Calling it ONCE here and passing it down is what makes the panel and the page
 * the same conversation. The provider is mounted in the dashboard layout, ABOVE
 * `{children}`, and Next's App Router keeps a layout mounted across route
 * changes within its own group — so moving between the panel and `/trax`
 * preserves the thread without persisting anything.
 *
 * ---------------------------------------------------------------------------
 * THE TWO SURFACES, AND THE WAYS BETWEEN THEM
 *
 *   panel — floating over whatever page is open (trax-panel.tsx). Its own
 *           Expand control only makes the floating panel bigger; it does not
 *           come here, because the page underneath must not change.
 *   page  — `/trax`, where the app sidebar becomes the conversation rail
 *           (trax-rail.tsx) and the page is one centred conversation column.
 *           Reached by its own URL and by the featured card that links to it.
 *
 *   minimiseToPanel   page → panel. Opens the panel and returns to the page the
 *                     operator came from, so they land back beside that record.
 *   leaveFullPage     page → that same page, panel closed (the rail's Back).
 *
 * The two surfaces are mutually exclusive: entering `/trax` by ANY route (a
 * featured card linking there, a pasted URL) closes the panel, so a browser Back
 * does not resurrect a floating copy of the conversation the operator was just
 * reading full screen.
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
  sheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
  /** ⌘J. Toggles the panel; on `/trax` it is `minimiseToPanel`. */
  toggleSheet: () => void;
  /** Last in-app pathname + search outside `/trax`; `/` when there is none. */
  returnPath: string;
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

  const surface: TraxContextValue["surface"] = onTrax ? "page" : sheetOpen ? "panel" : null;

  const value = useMemo<TraxContextValue>(
    () => ({
      sheetOpen,
      openSheet,
      closeSheet,
      toggleSheet,
      returnPath,
      minimiseToPanel,
      leaveFullPage,
      surface,
    }),
    [
      sheetOpen,
      openSheet,
      closeSheet,
      toggleSheet,
      returnPath,
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
