"use client";

import { useEffect } from "react";
import { capturePwaInstallPrompt, registerServiceWorker } from "@/lib/push";

/**
 * Registers the portal's push service worker.
 *
 * A push subscription cannot be created until a worker is registered AND active,
 * and that round trip is slow enough that doing it lazily inside the "Enable"
 * click would add a visible stall to the one interaction that must feel instant.
 *
 * Renders nothing.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    // Armed immediately, NOT on a delay: Chrome fires `beforeinstallprompt` once
    // and early, so a late listener misses it and the install button can never
    // appear.
    return capturePwaInstallPrompt();
  }, []);

  useEffect(() => {
    // Off the critical path — the worker does no caching here, so it brings no
    // first-paint benefit and should not compete with the dashboard's requests.
    const timer = window.setTimeout(() => {
      void registerServiceWorker();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
