'use client';

/**
 * Dark mode for customer portal v2, as the operator's user menu has it
 * (user-menu-v2.tsx: a "Dark Mode" row with a switch).
 *
 * The operator app runs next-themes; the customer site does not (the public
 * site ships light-only), so this is the small part of it the portal needs:
 * the choice is remembered per browser, and `.dark` goes on <html> only while
 * the portal is mounted — leaving for the website puts the site back to
 * light. The v2 tokens already carry the dark set (shared/portal-v2/tokens.css,
 * keyed on a `.dark` ancestor), so nothing else has to change.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

const THEME_KEY = 'pv2-theme';

export type PortalTheme = 'light' | 'dark';

function readStoredTheme(): PortalTheme {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// Layout effect in the browser so the class lands before paint; plain effect
// on the server, where neither runs.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Applies the stored theme while mounted. Mount once, in the shell. */
export function usePortalThemeRoot(): { theme: PortalTheme; setTheme: (theme: PortalTheme) => void } {
  const [theme, setThemeState] = useState<PortalTheme>('light');

  useIsomorphicLayoutEffect(() => {
    setThemeState(readStoredTheme());
  }, []);

  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    return () => {
      root.classList.remove('dark');
      root.style.colorScheme = '';
    };
  }, [theme]);

  const setTheme = useCallback((next: PortalTheme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* not remembered — harmless */
    }
  }, []);

  return { theme, setTheme };
}
