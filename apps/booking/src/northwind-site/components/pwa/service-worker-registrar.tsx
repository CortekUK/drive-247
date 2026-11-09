"use client";

import { useEffect } from "react";

import { useTenant } from "@nw/contexts/TenantContext";
import { capturePwaInstallPrompt, registerServiceWorker } from "@/lib/push";

/**
 * Registers the service worker on the v2 site, the way
 * `components/push/service-worker-registrar.tsx` does for the legacy site.
 *
 * That component reads the legacy TenantContext, which this tree does not
 * mount, so until now Northwind's customers (who get v2 at the normal address)
 * had no worker at all: no offline page, nothing to receive a push, and no
 * `beforeinstallprompt` caught for an Install button. Same rules as the legacy
 * one: a worker takes over navigation for the whole origin, so it is only
 * installed for tenants with push switched on, and only after the first paint.
 *
 * Renders nothing.
 */
export function ServiceWorkerRegistrarV2() {
  const { tenant } = useTenant();
  const pushEnabled = tenant?.push_notifications_enabled === true;

  useEffect(() => {
    if (!pushEnabled) return;
    // Armed at once: Chrome fires `beforeinstallprompt` early and only once.
    return capturePwaInstallPrompt();
  }, [pushEnabled]);

  useEffect(() => {
    if (!pushEnabled) return;
    const timer = window.setTimeout(() => {
      void registerServiceWorker();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [pushEnabled]);

  return null;
}
