'use client';

import { useCallback, useEffect, useState } from 'react';

/** Grid of cards, or wide rows carrying more detail per vehicle. */
export type FleetView = 'grid' | 'list';

const STORAGE_KEY = 'drive247:fleet-view';

function isFleetView(value: string | null): value is FleetView {
  return value === 'grid' || value === 'list';
}

/**
 * The grid/list preference, remembered across visits (v1 persists this too).
 *
 * The stored value is read in an EFFECT, never during render. Reading
 * `localStorage` while rendering would make the server's HTML and the browser's
 * first pass disagree for anyone who last chose "list", which React reports as
 * a hydration error and resolves by throwing the server markup away.
 *
 * Every access is wrapped: Safari in private mode throws on `localStorage`
 * rather than returning null, and a remembered layout is not worth a blank page.
 */
export function useFleetView(): { view: FleetView; setView: (next: FleetView) => void } {
  const [view, setViewState] = useState<FleetView>('grid');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isFleetView(stored)) setViewState(stored);
    } catch {
      // No persistence available — the default stands.
    }
  }, []);

  const setView = useCallback((next: FleetView) => {
    setViewState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ditto: the choice still applies for this session.
    }
  }, []);

  return { view, setView };
}
