'use client';

import { useEffect } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { capturePwaInstallPrompt, registerServiceWorker } from '@/lib/push';

/**
 * Registers the service worker on every page load.
 *
 * The worker has to already be installed and ACTIVE before a push subscription
 * can be created, and registration is slow enough (fetch + install + activate)
 * that doing it lazily inside the "Enable notifications" click adds a visible
 * stall to the one interaction that must feel instant. Registering here also
 * lights up offline caching for the whole app, which the worker has always
 * supported but nothing ever switched on.
 *
 * Renders nothing.
 */
export function ServiceWorkerRegistrar() {
  const { tenant } = useTenant();
  // Push is rolled out per tenant. A service worker takes over navigation
  // handling for the ENTIRE origin, so installing one on an operator who has the
  // feature switched off is real risk for zero benefit.
  const pushEnabled = tenant?.push_notifications_enabled === true;

  useEffect(() => {
    if (!pushEnabled) return;
    // Armed immediately, NOT on a delay: Chrome fires `beforeinstallprompt` once
    // and early, so a late listener misses it and the install button can never
    // appear.
    return capturePwaInstallPrompt();
  }, [pushEnabled]);

  useEffect(() => {
    if (!pushEnabled) return;
    // Off the critical path — the SW brings no first-paint benefit, and fetching
    // it during hydration competes with the page's own requests.
    const timer = window.setTimeout(() => {
      void registerServiceWorker();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [pushEnabled]);

  return null;
}
