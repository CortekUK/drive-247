'use client';

/**
 * A page's own sections, shown in the sidebar instead of as tabs across it.
 *
 * Asked for Sep 25 2026: "if the page has multiple options like promo codes,
 * shift that to the sidebar". Northwind's rail works this way — a record's
 * stages and a section's sub-pages live in the navigation, not in a strip of
 * tabs above the content — and Promo Codes was carrying five of them in a
 * `TabsList` that wrapped onto two lines on a narrow window.
 *
 * ── Why a context and not a route per tab ─────────────────────────────────
 *
 * The obvious alternative is real routes (`/admin/promo-codes/claims`) or a
 * `?tab=` query. Both change what a URL means, and one of them needs
 * `useSearchParams` inside the sidebar, which drags a Suspense boundary into
 * a component that renders on every page.
 *
 * This changes nothing about navigation. The page keeps the state it already
 * had, keeps every handler, and simply publishes "here are my sections, here
 * is the current one, call this to change it". The sidebar renders that list
 * under whichever nav item matches the page it came from. Nothing is
 * bookmarkable that was not bookmarkable before, and nothing that was has
 * stopped being so.
 *
 * A page that registers nothing gets exactly the sidebar it had.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type SidebarSection = {
  /** Matches the page's own tab value. */
  id: string;
  label: string;
};

/**
 * Something a page lets you DO to the record it is showing, offered in the
 * account menu at the foot of the rail rather than beside the page title.
 *
 * Asked for Sep 26 2026, with an arrow drawn from the buttons to the account
 * row. They are deliberately DATA, not `ReactNode`: the registration lives in
 * a context that a `useEffect` writes to, and a freshly-built element every
 * render would change identity every render and re-register forever. That is
 * not hypothetical — a single memoised context here once did exactly that and
 * took `/admin/promo-codes` down. The sidebar renders these; the page only
 * describes them.
 */
export type SidebarAction = {
  id: string;
  label: string;
  /**
   * `active` marks the choice currently in force (the tenant's live type, say)
   * so a pair of mutually exclusive actions can show which one is on.
   */
  tone?: 'default' | 'active' | 'destructive';
};

type Registration = {
  /** The nav item these belong under, e.g. `/admin/promo-codes`. */
  href: string;
  /**
   * What the rail calls itself. A settings-shaped page can leave this out and
   * take its nav item's name; a RECORD page passes the record's own — the
   * company, not "Rental Companies" — which is what Northwind's customer rail
   * shows and the only way to tell two records apart from the navigation.
   */
  title?: string;
  sections: SidebarSection[];
  active: string;
  onSelect: (id: string) => void;
  /** Empty or absent on a page with nothing to act on. */
  actions?: SidebarAction[];
  /** One dispatcher for all of them, switched on `id`. */
  onAction?: (id: string) => void;
};

/*
 * TWO contexts, not one, and this is the whole reason the file is shaped this
 * way rather than the obvious way.
 *
 * The first version held `{ registration, register }` in a single value
 * memoised on `registration`, and the registering effect depended on that
 * object. Registering changed the value, which changed the object, which
 * re-ran the effect, which registered again: an infinite render loop that took
 * `/admin/promo-codes` down in production with a client-side exception.
 *
 * Nothing caught it. `tsc --noEmit` was clean, the dev server answered 200,
 * and every page in this app redirects to the sign-in without a session — so
 * the component never actually rendered in any check that was run. The guard
 * for it is `__tests__/components/sidebar-sections.test.tsx`, which mounts
 * this for real and counts renders; on the broken version that test hangs.
 *
 * Splitting the contexts fixes it by construction. The dispatch half never
 * changes identity — a `useState` setter is stable for the life of the
 * provider — so an effect can depend on it safely. The value half changes as
 * often as it likes, because only the sidebar reads it and the sidebar never
 * writes back.
 */
const SectionsValue = createContext<Registration | null>(null);
const SectionsDispatch = createContext<((r: Registration | null) => void) | null>(null);

export function SidebarSectionsProvider({ children }: { children: ReactNode }) {
  const [registration, register] = useState<Registration | null>(null);
  return (
    <SectionsDispatch.Provider value={register}>
      <SectionsValue.Provider value={registration}>{children}</SectionsValue.Provider>
    </SectionsDispatch.Provider>
  );
}

/** Read by the sidebar. Null everywhere no page has registered anything. */
export function useSidebarSections(): Registration | null {
  return useContext(SectionsValue);
}

/**
 * Called by a page to put its sections in the sidebar.
 *
 * `sections` is compared by its ids rather than by identity, so a page may
 * build the array inline on every render — which every page does — without
 * this re-registering in a loop. The registration is cleared on unmount, so
 * navigating away takes the sub-list with it.
 */
export function useRegisterSidebarSections(
  href: string,
  sections: SidebarSection[],
  active: string,
  onSelect: (id: string) => void,
  title?: string,
  actions?: SidebarAction[],
  onAction?: (id: string) => void,
) {
  const register = useContext(SectionsDispatch);
  const key = sections.map((s) => `${s.id}:${s.label}`).join('|');
  const actionKey = (actions ?? []).map((a) => `${a.id}:${a.label}:${a.tone ?? ''}`).join('|');

  /*
   * `onAction` is held in a ref and reached through a STABLE wrapper.
   *
   * Pages pass an inline arrow — `(id) => { switch (id) { … } }` — which is a
   * new function on every render. Depending on it the way this depends on
   * `onSelect` (which pages pass as a `useState` setter, so it is stable)
   * would re-register on every render and loop. Going through a ref means the
   * registered function never changes identity while always running the
   * current closure, so the handler cannot go stale either.
   */
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const stableOnAction = useCallback((id: string) => onActionRef.current?.(id), []);

  useEffect(() => {
    if (!register) return;
    register({
      href,
      title,
      sections,
      active,
      onSelect,
      actions,
      onAction: stableOnAction,
    });
    return () => register(null);
    // `key` and `actionKey` stand in for `sections` and `actions`, which every
    // page rebuilds inline on each render. `register` is a `useState` setter
    // and never changes identity — depending on the whole context object here
    // is what caused the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, href, title, key, actionKey, active, onSelect, stableOnAction]);
}
