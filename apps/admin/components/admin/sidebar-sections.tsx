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

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type SidebarSection = {
  /** Matches the page's own tab value. */
  id: string;
  label: string;
};

type Registration = {
  /** The nav item these belong under, e.g. `/admin/promo-codes`. */
  href: string;
  sections: SidebarSection[];
  active: string;
  onSelect: (id: string) => void;
};

type Store = {
  registration: Registration | null;
  register: (r: Registration | null) => void;
};

const SidebarSectionsContext = createContext<Store | null>(null);

export function SidebarSectionsProvider({ children }: { children: ReactNode }) {
  const [registration, register] = useState<Registration | null>(null);
  const value = useMemo(() => ({ registration, register }), [registration]);
  return <SidebarSectionsContext.Provider value={value}>{children}</SidebarSectionsContext.Provider>;
}

/** Read by the sidebar. Null everywhere no page has registered anything. */
export function useSidebarSections(): Registration | null {
  return useContext(SidebarSectionsContext)?.registration ?? null;
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
) {
  const store = useContext(SidebarSectionsContext);
  const key = sections.map((s) => `${s.id}:${s.label}`).join('|');

  useEffect(() => {
    if (!store) return;
    store.register({ href, sections, active, onSelect });
    return () => store.register(null);
    // `key` stands in for `sections`; `onSelect` is a setter, stable in
    // practice, and re-registering on a new one costs nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, href, key, active, onSelect]);
}
