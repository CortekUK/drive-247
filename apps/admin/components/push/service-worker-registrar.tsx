'use client';

import { useEffect } from 'react';
import { capturePwaInstallPrompt, registerServiceWorker } from '@/lib/push';

/**
 * Registers the admin push service worker.
 *
 * Unconditional, unlike the booking and portal registrars which are gated on a
 * per-tenant flag: this app has exactly one audience (super admins) and platform
 * activity push is the reason it exists, so there is no tenant whose preference
 * could switch it off.
 *
 * Renders nothing.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    // Armed immediately: Chrome fires `beforeinstallprompt` once and early, so a
    // listener added when the settings page opens has already missed it.
    return capturePwaInstallPrompt();
  }, []);

  useEffect(() => {
    // Off the critical path — the worker does no caching, so it brings no
    // first-paint benefit and should not compete with the dashboard's requests.
    const timer = window.setTimeout(() => {
      void registerServiceWorker();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
