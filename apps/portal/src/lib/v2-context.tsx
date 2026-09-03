'use client';

import { createContext, useContext } from 'react';
import type { V2Area } from '@/lib/v2';

/**
 * v2 gate flags, resolved ONCE on the server and handed to the client tree.
 *
 * Portal is client-heavy — 65 of its 81 dashboard pages are `"use client"`, and
 * `(dashboard)/layout.tsx`, which owns the sidebar and header, is one of them.
 * So a v2 screen that lives inside that layout cannot resolve its own gate the
 * way a server route can.
 *
 * The answer is NOT to look the tenant up again in a client effect. That would
 * paint v1 and swap once the tenant loaded — a visible flash of the old design
 * on precisely the tenants that were switched over, which reads as a broken
 * page. It would also mean every gated component issuing its own query.
 *
 * Instead the root layout (a server component) resolves the tenant once, asks
 * `isV2` for every area, and passes the answers down as plain booleans. This
 * keeps V2_PLAN §3 intact — the gate is still resolved once, on the server, at
 * the entrance — while letting client components read it synchronously with no
 * query, no effect and no flash.
 *
 * Defaults to all-false, so a component rendered outside the provider (a test,
 * a stray subtree) gets v1 rather than throwing.
 */
export type V2Flags = Partial<Record<V2Area, boolean>>;

const V2Context = createContext<V2Flags>({});

export function V2Provider({
  flags,
  children,
}: {
  flags: V2Flags;
  children: React.ReactNode;
}) {
  return <V2Context.Provider value={flags}>{children}</V2Context.Provider>;
}

/** Is this tenant on v2 for `area`? Falls back to v1 (false) on anything unexpected. */
export function useV2(area: V2Area): boolean {
  return useContext(V2Context)[area] ?? false;
}
