"use client";

import { useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { capturePwaInstallPrompt, registerServiceWorker, registerServiceWorkerV2 } from "@/lib/push";
import { useV2 } from "@/lib/v2-context";

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
  const { tenant } = useTenant();
  // Push is rolled out per tenant. A service worker takes over navigation
  // handling for the ENTIRE origin, so installing one on an operator who has the
  // feature switched off is real risk for zero benefit.
  const pushEnabled = tenant?.push_notifications_enabled === true;
  // v2 chrome (northwind) gets public/service-worker-v2.js at the same scope,
  // which replaces the v1 worker for that tenant only; everyone else keeps
  // /service-worker.js.
  const v2Chrome = useV2("chrome");

  useEffect(() => {
    if (!pushEnabled) return;
    // Armed immediately, NOT on a delay: Chrome fires `beforeinstallprompt` once
    // and early, so a late listener misses it and the install button can never
    // appear.
    return capturePwaInstallPrompt();
  }, [pushEnabled]);

  useEffect(() => {
    if (!pushEnabled) return;
    // Off the critical path — the worker does no caching here, so it brings no
    // first-paint benefit and should not compete with the dashboard's requests.
    const timer = window.setTimeout(() => {
      void (v2Chrome ? registerServiceWorkerV2() : registerServiceWorker());
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [pushEnabled, v2Chrome]);

  return null;
}
