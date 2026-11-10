'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';

/**
 * v2 operators start in LIGHT mode, whatever their computer is set to, until
 * they pick a theme themselves in the portal.
 *
 * The app-wide ThemeProvider defaults to "system" and is shared with v1, so
 * this sits in the v2 dashboard only. next-themes writes `theme` to
 * localStorage only when someone calls setTheme, so a missing key means
 * "never chosen": that is the only case this touches. Once they choose (light,
 * dark or system) the key exists and this never acts again.
 */
export function LightUntilChosen() {
  const { setTheme } = useTheme();
  useEffect(() => {
    try {
      if (window.localStorage.getItem('theme') === null) setTheme('light');
    } catch {
      /* storage blocked: leave the default alone */
    }
  }, [setTheme]);
  return null;
}
