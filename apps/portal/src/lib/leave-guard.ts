"use client";

/**
 * v2 leave guard: ONE module-level slot that a page holding unsaved edits fills,
 * so programmatic navigation (router.push from the sidebar's Portal / Website
 * switch, global search, Trax) asks before it leaves.
 *
 * WHY NOT A pushState OVERRIDE. In the installed Next (16.1.x) the app router
 * renders the new route first and only then calls `history.pushState` from a
 * useInsertionEffect. Blocking pushState therefore left the URL stale while
 * the page had already unmounted and dropped the edits. Asking BEFORE
 * `router.push` is the only point where leaving can still be stopped.
 *
 * API
 *   setLeaveGuard(guard) -> dispose
 *     Installs `guard` as the active guard and returns a disposer that clears
 *     the slot only while it still holds that same guard. The v2 hook
 *     (`hooks/use-leave-guard-v2.ts`) is the only caller; a page never calls it
 *     directly.
 *   hasLeaveGuard()
 *     Whether a guard is installed (tests, diagnostics).
 *   runThroughLeaveGuard(href, proceed)
 *     Asks the active guard about `href`. With no guard, or a guard that lets
 *     it through, `proceed()` runs at once. Otherwise the guard keeps `proceed`
 *     and calls it later if the operator chooses Save or Don't save.
 *   useGuardedRouter()
 *     `useRouter()` with `push` routed through the guard. Everything else
 *     (replace, back, refresh, prefetch) is the plain router.
 *
 * v1 SAFETY. Only v2 pages install a guard (the hook is a no-op unless
 * `enabled`), so for the 56 v1 tenants every guarded push is exactly
 * `router.push(href)` (or `router.push(href, options)` when options are given).
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";

/**
 * Returns true when it took the navigation over (it will call `proceed` itself
 * if the operator agrees), false to let the navigation happen now.
 */
export type LeaveGuard = (href: string, proceed: () => void) => boolean;

let activeGuard: LeaveGuard | null = null;

export function setLeaveGuard(guard: LeaveGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

export function hasLeaveGuard(): boolean {
  return activeGuard !== null;
}

export function runThroughLeaveGuard(href: string, proceed: () => void): void {
  const guard = activeGuard;
  if (guard && guard(href, proceed)) return;
  proceed();
}

type AppRouter = ReturnType<typeof useRouter>;

export function useGuardedRouter(): AppRouter {
  const router = useRouter();
  return useMemo(
    () => ({
      ...router,
      push: ((href: string, options?: Parameters<AppRouter["push"]>[1]) =>
        runThroughLeaveGuard(href, () => {
          if (options === undefined) router.push(href);
          else router.push(href, options);
        })) as AppRouter["push"],
    }),
    [router],
  );
}
