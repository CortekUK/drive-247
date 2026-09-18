"use client";

/**
 * v2 leave guard hook: asks "Save your changes?" before a page with unsaved
 * edits is left, on EVERY way out. Pair it with `LeaveDialogV2`
 * (components/settings-v2/leave-dialog-v2.tsx).
 *
 *   const guard = useLeaveGuardV2({ enabled: v2Chrome, isDirty, canSave, onSave, onDiscard });
 *   <LeaveDialogV2 {...leaveDialogProps(guard)} error={…} />
 *
 * OPTIONS
 *   enabled    false installs nothing at all (v1 tenants keep their own hook).
 *   isDirty    a GENUINE change is pending (typed-back values do not count).
 *   canSave    every dirty part has a save the page can run. When false the
 *              dialog offers only "Don't save" (and Escape / close to stay).
 *   onSave     saves everything; resolves true when it all saved. On false or a
 *              rejection the dialog stays open and the page stays put.
 *   onDiscard  puts the page's forms back to what is saved, just before leaving.
 *
 * RETURNS
 *   open, saving, canSave   dialog state
 *   save()                  Save, then leave
 *   discard()               Don't save: onDiscard(), then leave
 *   cancel()                stay (Escape, the close button)
 *   requestLeave(proceed)   run an in-page exit through the guard
 *
 * HOW EACH EXIT IS CAUGHT (and why the v1 hook missed them)
 *   1. Links: a capture-phase click listener on `document`, which runs before
 *      Next's <Link> handler. It compares pathname + SEARCH, so the org menu's
 *      /settings link is caught from /settings?tab=general (same pathname).
 *   2. router.push: `lib/leave-guard.ts`. Callers use `useGuardedRouter()` or
 *      `runThroughLeaveGuard()`, which ask this hook first. Blocking
 *      history.pushState (the v1 approach) is too late in Next 16.
 *   3. Back / Forward: while dirty, a same-URL SENTINEL history entry is pushed
 *      (it copies Next's own state, so Next treats popping it as a same-URL
 *      restore and nothing remounts). Back pops the sentinel and we are still
 *      on the page: the dialog opens, and leaving calls history.back() once more.
 *      A sentinel left behind on a clean page is skipped automatically.
 *   4. Reload / close tab: the browser's own beforeunload prompt.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setLeaveGuard } from "@/lib/leave-guard";

export const LEAVE_GUARD_SENTINEL_KEY = "__leaveGuardV2";

/** How long, after an approved exit, the guard stays quiet while the route changes. */
const LEAVING_GRACE_MS = 1500;

export interface UseLeaveGuardV2Options {
  enabled: boolean;
  isDirty: boolean;
  canSave: boolean;
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
}

export interface LeaveGuardV2 {
  open: boolean;
  saving: boolean;
  canSave: boolean;
  save: () => Promise<void>;
  discard: () => void;
  cancel: () => void;
  requestLeave: (proceed: () => void) => void;
}

const currentPathAndSearch = () => window.location.pathname + window.location.search;

/** Would `href` leave the current page? A hash-only jump does not. */
export function isLeavingHref(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  return url.pathname + url.search !== currentPathAndSearch();
}

export function useLeaveGuardV2({ enabled, isDirty, canSave, onSave, onDiscard }: UseLeaveGuardV2Options): LeaveGuardV2 {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sentinelTick, setSentinelTick] = useState(0);

  const active = enabled && isDirty;
  const activeRef = useRef(active);
  activeRef.current = active;
  const openRef = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  const latest = useRef({ onSave, onDiscard, router });
  latest.current = { onSave, onDiscard, router };
  /** The URL of the sentinel entry we are standing on, or null. */
  const sentinelUrl = useRef<string | null>(null);
  /** An approved exit is under way: no dialog, no new sentinel. */
  const leaving = useRef<{ from: string; until: number } | null>(null);

  const isLeaving = () => {
    const l = leaving.current;
    if (!l) return false;
    if (Date.now() > l.until || window.location.href !== l.from) {
      leaving.current = null;
      return false;
    }
    return true;
  };

  const show = useCallback((proceed: () => void) => {
    pending.current = proceed;
    openRef.current = true;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);

  const leave = useCallback(() => {
    const proceed = pending.current;
    pending.current = null;
    leaving.current = { from: window.location.href, until: Date.now() + LEAVING_GRACE_MS };
    close();
    proceed?.();
  }, [close]);

  // Keep track of whether the entry we stand on is a sentinel (after a route
  // change, a Back onto one, or a mount on one).
  useEffect(() => {
    if (!enabled) return;
    const here = window.location.href;
    if (sentinelUrl.current !== null && sentinelUrl.current !== here) sentinelUrl.current = null;
    if (sentinelUrl.current === null && window.history.state?.[LEAVE_GUARD_SENTINEL_KEY]) sentinelUrl.current = here;
  });

  // 3. While dirty, stand on a sentinel so Back can be asked about.
  useEffect(() => {
    if (!active || openRef.current || isLeaving()) return;
    const here = window.location.href;
    if (sentinelUrl.current === here) return;
    window.history.pushState({ ...(window.history.state ?? {}), [LEAVE_GUARD_SENTINEL_KEY]: true }, "", here);
    sentinelUrl.current = here;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sentinelTick]);

  useEffect(() => {
    if (!enabled) return;
    const onPopState = () => {
      const here = window.location.href;
      if (window.history.state?.[LEAVE_GUARD_SENTINEL_KEY]) {
        sentinelUrl.current = here;
        return;
      }
      const wasOnSentinel = sentinelUrl.current === here;
      sentinelUrl.current = null;
      if (!wasOnSentinel || isLeaving()) return;
      // Back popped our sentinel: the operator is still on this page.
      if (!activeRef.current) {
        // Nothing to save any more (saved or reset since): finish their Back.
        window.history.back();
        return;
      }
      if (openRef.current) return;
      show(() => window.history.back());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, show]);

  // 2. Programmatic navigation through lib/leave-guard.
  useEffect(() => {
    if (!enabled) return;
    return setLeaveGuard((href, proceed) => {
      if (!activeRef.current || isLeaving() || !isLeavingHref(href)) return false;
      if (!openRef.current) show(proceed);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, show]);

  // 1. Links, before Next's <Link> sees the click.
  useEffect(() => {
    if (!active) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || openRef.current || isLeaving()) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target && typeof target.closest === "function" ? target.closest("a") : null;
      if (!anchor || !anchor.getAttribute("href")) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      if (!isLeavingHref(anchor.href)) return;
      const url = new URL(anchor.href, window.location.href);
      event.preventDefault();
      event.stopPropagation();
      const href = url.pathname + url.search + url.hash;
      show(() => latest.current.router.push(href));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, show]);

  // 4. Reload and closing the tab.
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  const save = useCallback(async () => {
    if (!canSave || saving) return;
    setSaving(true);
    let ok = false;
    try {
      ok = await latest.current.onSave();
    } catch {
      ok = false;
    } finally {
      setSaving(false);
    }
    if (ok) leave();
  }, [canSave, saving, leave]);

  const discard = useCallback(() => {
    if (saving) return;
    latest.current.onDiscard();
    leave();
  }, [saving, leave]);

  const cancel = useCallback(() => {
    if (saving) return;
    pending.current = null;
    close();
    // A Back that was asked about has already popped the sentinel: put it back.
    setSentinelTick((t) => t + 1);
  }, [saving, close]);

  const requestLeave = useCallback(
    (proceed: () => void) => {
      if (!activeRef.current || isLeaving()) {
        proceed();
        return;
      }
      if (!openRef.current) show(proceed);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [show],
  );

  return { open, saving, canSave, save, discard, cancel, requestLeave };
}
