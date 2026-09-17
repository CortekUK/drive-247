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

/**
 * The tenant-level half of the same answer, on a sibling context.
 *
 * `onV2` is `tenants.portal_experience === 'v2'`, read from the row once per
 * request; `lean` is that OR'd with the `LEAN_TENANTS` slug list, which is what
 * every lean-area gate actually asks. They ride the same provider as the area
 * flags because they are resolved in the same place, from the same read — and
 * because keeping them on a SEPARATE context from `V2Flags` means `useV2` keeps
 * its exact type and every existing `<V2Provider flags={…}>` in the test suite
 * keeps compiling and behaving as written.
 *
 * Defaults to all-false for the same reason as the flags: a subtree outside the
 * provider is v1, not a crash.
 */
export type PortalExperience = {
  /** `tenants.portal_experience === 'v2'`. */
  onV2: boolean;
  /** Slug list OR `onV2`. The question every lean gate asks. */
  lean: boolean;
};

const PortalExperienceContext = createContext<PortalExperience>({
  onV2: false,
  lean: false,
});

export function V2Provider({
  flags,
  experience = { onV2: false, lean: false },
  children,
}: {
  flags: V2Flags;
  /**
   * Optional so that the ~15 existing `<V2Provider flags={…}>` call sites in
   * the test suite keep working unchanged and keep meaning what they meant:
   * these flags, and a tenant that is not lean and not on the row flag.
   */
  experience?: PortalExperience;
  children: React.ReactNode;
}) {
  return (
    <V2Context.Provider value={flags}>
      <PortalExperienceContext.Provider value={experience}>
        {children}
      </PortalExperienceContext.Provider>
    </V2Context.Provider>
  );
}

/** Is this tenant on v2 for `area`? Falls back to v1 (false) on anything unexpected. */
export function useV2(area: V2Area): boolean {
  return useContext(V2Context)[area] ?? false;
}

/**
 * This request's tenant-level experience, as resolved on the server.
 *
 * Most components want `useIsLean()` / `useIsAreaHidden()` from
 * `lib/lean-context` instead. This is for the call sites a hook cannot reach —
 * a `.filter()` predicate, a callback, a branch inside another expression —
 * where the honest answer is to hoist `onV2` to the top of the component and
 * pass it to the pure function, which is what its third argument is for.
 */
export function usePortalExperience(): PortalExperience {
  return useContext(PortalExperienceContext);
}

/** Shorthand: `tenants.portal_experience === 'v2'` for this request's tenant. */
export function usePortalOnV2(): boolean {
  return useContext(PortalExperienceContext).onV2;
}
