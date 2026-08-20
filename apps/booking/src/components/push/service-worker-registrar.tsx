'use client';

import { useEffect } from 'react';
import { registerServiceWorker } from '@/lib/push';

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
  useEffect(() => {
    // Off the critical path — the SW brings no first-paint benefit, and fetching
    // it during hydration competes with the page's own requests.
    const timer = window.setTimeout(() => {
      void registerServiceWorker();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
