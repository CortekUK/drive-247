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

/**
 * The one dynamic thing in an otherwise fixed top bar.
 *
 * The bar is identical on every page — search, messages, notifications,
 * credits, Trax — except for this: a LIST page lends the bar its own search
 * field and its own filter button, because filters are page-specific while the
 * chrome is not. Leave a page without registering and the bar falls back to the
 * global ⌘K pill, which is the right default for a page with nothing to filter.
 *
 * This replaces a search box that each list drew for itself, halfway down the
 * page, under its own heading. Two search fields on one screen is the confusion
 * the top bar exists to remove: one of them searched the whole product and the
 * other searched the list, and nothing on screen said which was which.
 *
 * ---------------------------------------------------------------------------
 * WHY REGISTRATION AND NOT A PATHNAME SWITCH
 *
 * The bar could read the route and decide what to show. It would also then need
 * to know every list's filter shape, its debounce, its active-filter count and
 * where its panel renders — which is the page's business, not the chrome's. A
 * page hands those over and takes them back on unmount; the bar stays ignorant.
 *
 * ---------------------------------------------------------------------------
 * `tourAnchor` IS NOT OPTIONAL DECORATION
 *
 * `tab-tours/rentals.ts:276` and `tab-tours/payments.ts:293` anchor a tour step
 * to `[data-tour="rentals-search"]` / `[data-tour="payments-search"]`, which
 * lived on the search box being removed. An anchor that no longer exists does
 * not fail loudly — `findAnchor` waits out the full `ANCHOR_WAIT_MS` and the
 * step is skipped, and because the wait budget CASCADES, every later step on
 * that route then gets 1500ms instead of 6000. So the page passes its anchor
 * name through and the bar stamps it on the field, keeping the tours pointed at
 * a real element in its new home.
 */

export interface PageFilterRegistration {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Drawn as a badge on the filter button while the panel is SHUT — closed, it
   *  is the only thing telling you the list you are reading is not the whole list. */
  activeCount: number;
}

export interface PageSearchRegistration {
  placeholder: string;
  /** The page's committed search term. Mirrored into the field, so clearing
   *  filters elsewhere empties it too. */
  value: string;
  onChange: (next: string) => void;
  /** `data-tour` to stamp on the field. See the note above — load-bearing. */
  tourAnchor?: string;
  filters?: PageFilterRegistration;
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

/** Read the current registration. For the top bar. */
export function usePageSearchSlot(): PageSearchRegistration | null {
  return useContext(SlotContext)?.registration ?? null;
}

/**
 * Lend the top bar this page's search and filters for as long as it is mounted.
 *
 * Deliberately a no-op when there is no provider: the Messages workspace
 * bypasses part of the layout and v1 never mounts one, so a list that calls
 * this must still render there rather than throwing.
 */
export function usePageSearch(reg: PageSearchRegistration | null) {
  const ctx = useContext(SlotContext);
  const register = ctx?.register;

  /**
   * The callbacks are held in a ref and the registered object calls THROUGH it.
   *
   * A calling page builds `onChange` and `onOpenChange` as fresh closures on
   * every render — they have to, they close over the current filters. Depending
   * on their identity would re-register on every render, and since registering
   * sets state in the provider, that is an infinite loop. Depending on nothing
   * would freeze the first closure and write filters onto a stale object.
   *
   * So identity is stable and the BODY is current: the effect below re-runs only
   * when something the bar actually renders changes.
   */
  const latest = useRef(reg);
  latest.current = reg;

  const onChange = useCallback((next: string) => {
    latest.current?.onChange(next);
  }, []);
  const onOpenChange = useCallback((open: boolean) => {
    latest.current?.filters?.onOpenChange(open);
  }, []);

  const placeholder = reg?.placeholder ?? "";
  const value = reg?.value ?? "";
  const tourAnchor = reg?.tourAnchor;
  const hasFilters = Boolean(reg?.filters);
  const filtersOpen = reg?.filters?.open ?? false;
  const activeCount = reg?.filters?.activeCount ?? 0;
  const present = reg !== null;

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
      tourAnchor,
      filters: hasFilters ? { open: filtersOpen, onOpenChange, activeCount } : undefined,
    });
    /* Handed back on unmount, so navigating to a page with nothing to filter
       returns the bar to the global ⌘K pill rather than leaving a stale field
       pointed at a list that is no longer on screen. */
    return () => register(null);
  }, [
    register,
    present,
    placeholder,
    value,
    tourAnchor,
    hasFilters,
    filtersOpen,
    activeCount,
    onChange,
    onOpenChange,
  ]);
}
