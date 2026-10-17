'use client';

/**
 * Light / dark for the super-admin dashboard.
 *
 * The app's tokens already carry a `.dark` set (app/globals.css); what was
 * missing was a switch. This is that switch, without a theme library: the
 * choice is one class on <html> and one key in localStorage — a per-browser
 * convenience, like Northwind's toggle, not account data.
 *
 * `THEME_SCRIPT` (lib/theme-script.ts) runs inline in <head> before first paint, so a dark-mode
 * user never sees a white flash while React loads.
 */

import { useCallback, useEffect, useState } from 'react';
import { THEME_KEY } from './theme-script';

function readDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

export function useThemeMode() {
  const [isDark, setIsDark] = useState(false);

  // Follow the class, so every toggle on the page stays in step.
  useEffect(() => {
    setIsDark(readDark());
    const observer = new MutationObserver(() => setIsDark(readDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const setDark = useCallback((dark: boolean) => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      /* Private window or blocked storage: the switch still works for this visit. */
    }
  }, []);

  return { isDark, setDark };
}
