'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  isInstallPromptAvailable,
  isStandalone,
  promptPwaInstall,
  subscribeToInstallAvailability,
  detectPlatform,
} from '@/lib/push';

export interface UsePwaInstall {
  /** Already running as an installed app. */
  isInstalled: boolean;
  /** A native install dialog can be shown right now (Chrome/Edge). */
  canPrompt: boolean;
  /** iOS never exposes a prompt — the user must use Share → Add to Home Screen. */
  needsManualInstall: boolean;
  install: () => Promise<boolean>;
}

/**
 * Drives the "Install app" control.
 *
 * Worth doing for push specifically: in a browser tab Android labels every
 * notification with the BROWSER's icon and the site origin, which no payload
 * field can override. Installing produces a WebAPK, and the notification then
 * carries our own icon and name.
 */
export function usePwaInstall(): UsePwaInstall {
  const [installed, setInstalled] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [platform, setPlatform] = useState<string>('unknown');

  useEffect(() => {
    // Read in an effect, not during render: both depend on `window` and would
    // otherwise mismatch between server and client HTML.
    setInstalled(isStandalone());
    setCanPrompt(isInstallPromptAvailable());
    setPlatform(detectPlatform());
    return subscribeToInstallAvailability(setCanPrompt);
  }, []);

  const install = useCallback(async () => {
    const accepted = await promptPwaInstall();
    if (accepted) setInstalled(true);
    return accepted;
  }, []);

  return {
    isInstalled: installed,
    canPrompt: canPrompt && !installed,
    needsManualInstall: platform === 'ios' && !installed,
    install,
  };
}
