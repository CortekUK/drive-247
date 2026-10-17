'use client';

/**
 * A list page lends its search (and its Filters toggle) to the TOP BAR, as
 * Northwind's pages do (apps/portal/src/components/shared/layout/
 * page-search-slot.tsx): one field on screen, never two. While a page has
 * registered, the top bar's search pill becomes that page's field ("in Rental
 * companies"); when it unmounts the bar goes back to the global ⌘K pill.
 *
 * `FilterSearch` registers through here, so every list page that used it moved
 * into the bar without being edited. Outside a provider (the standalone
 * preview route) `usePageSearch` reports `false` and the caller draws its own
 * field as before.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface PageSearchRegistration {
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  /** What the field is scoped to, shown as a chip: "in Rental companies". */
  scopeLabel?: string;
  /** The page's Filters panel, toggled from the field. */
  filters?: { open: boolean; onOpenChange: (open: boolean) => void; activeCount: number };
  /** Debounce the bar applies before pushing a term, for pages that query per term. */
  debounceMs?: number;
}

interface SlotContextValue {
  registration: PageSearchRegistration | null;
  register: (r: PageSearchRegistration | null) => void;
}

const SlotContext = createContext<SlotContextValue | null>(null);

export function PageSearchProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<PageSearchRegistration | null>(null);
  const register = useCallback((r: PageSearchRegistration | null) => setRegistration(r), []);
  const value = useMemo(() => ({ registration, register }), [registration, register]);
  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>;
}

/** For the top bar: what the current page has lent it, if anything. */
export function usePageSearchSlot(): PageSearchRegistration | null {
  return useContext(SlotContext)?.registration ?? null;
}

/**
 * For a page: lend the top bar this search. Returns true when it was taken
 * (a provider exists), so the page draws no field of its own.
 */
export function usePageSearch(reg: PageSearchRegistration | null): boolean {
  const ctx = useContext(SlotContext);
  const register = ctx?.register;

  // Handlers go through a ref so a page passing inline arrows does not
  // re-register on every render.
  const latest = useRef(reg);
  latest.current = reg;
  const onChange = useCallback((next: string) => latest.current?.onChange(next), []);
  const onOpenChange = useCallback((open: boolean) => latest.current?.filters?.onOpenChange(open), []);

  const present = reg !== null;
  const placeholder = reg?.placeholder ?? '';
  const value = reg?.value ?? '';
  const scopeLabel = reg?.scopeLabel;
  const debounceMs = reg?.debounceMs;
  const hasFilters = Boolean(reg?.filters);
  const filtersOpen = reg?.filters?.open ?? false;
  const activeCount = reg?.filters?.activeCount ?? 0;

  useEffect(() => {
    if (!register) return;
    if (!present) {
      register(null);
      return;
    }
    register({
      placeholder,
      value,
      onChange,
      scopeLabel,
      debounceMs,
      filters: hasFilters ? { open: filtersOpen, onOpenChange, activeCount } : undefined,
    });
    // Handed back on unmount, so the next page starts with the global pill.
    return () => register(null);
  }, [register, present, placeholder, value, scopeLabel, debounceMs, hasFilters, filtersOpen, activeCount, onChange, onOpenChange]);

  return !!register && present;
}
