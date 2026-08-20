'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import {
  getDeviceId,
  getPushCapability,
  registerServiceWorker,
  urlBase64ToUint8Array,
  VAPID_PUBLIC_KEY,
  type PushCapability,
} from '@/lib/push';

export interface UsePushNotifications {
  /** Push can be turned on right now. */
  isSupported: boolean;
  /** iOS in a browser tab — needs "Add to Home Screen" first. */
  needsInstall: boolean;
  /** The tenant has the feature switched on. */
  isEnabledForTenant: boolean;
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  isLoading: boolean;
  isBusy: boolean;
  error: string | null;
  capability: PushCapability;
  enable: () => Promise<boolean>;
  disable: () => Promise<boolean>;
}

/**
 * Owns the browser side of Web Push for the CUSTOMER app.
 *
 * The subscription is device-scoped, so this hook works signed-out as well as
 * signed-in. When a session exists, `supabase.functions.invoke` forwards its JWT
 * and the backend back-links the device to the customer — which is why enabling
 * notifications before logging in still results in a personalised channel later.
 */
export function usePushNotifications(): UsePushNotifications {
  const { tenant } = useTenant();

  const [capability] = useState<PushCapability>(() => getPushCapability());
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards a state write after the component has gone — enabling push is a
  // multi-second round trip the user can easily navigate away from.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isEnabledForTenant = tenant?.push_notifications_enabled === true;

  const persistSubscription = useCallback(
    async (subscription: PushSubscription) => {
      if (!tenant) throw new Error('No tenant context');
      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };

      const { data, error: fnError } = await supabase.functions.invoke('save-push-subscription', {
        body: {
          action: 'subscribe',
          audience: 'customer',
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          endpoint: json.endpoint,
          keys: json.keys,
          deviceId: getDeviceId(),
          platform: capability.platform,
          isStandalone: capability.standalone,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        },
      });

      if (fnError) throw new Error(fnError.message || 'Could not save subscription');
      if (data?.error) throw new Error(data.error);
      return data;
    },
    [tenant, capability],
  );

  // ---- Reconcile browser state on mount ----------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!capability.supported) {
        if (!cancelled) {
          setPermission('unsupported');
          setIsLoading(false);
        }
        return;
      }

      setPermission(Notification.permission);

      try {
        const registration = await registerServiceWorker();
        const existing = await registration?.pushManager.getSubscription();
        if (!cancelled && mounted.current) {
          // Permission alone is not "subscribed": a user can hold permission
          // while the subscription was dropped (storage cleared, key rotation),
          // and showing "on" then would be a silent lie.
          setIsSubscribed(Boolean(existing) && Notification.permission === 'granted');
        }
      } catch (err) {
        console.error('[push] Could not read existing subscription:', err);
      } finally {
        if (!cancelled && mounted.current) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [capability.supported]);

  // ---- Re-register when the push service rotates keys ---------------------
  useEffect(() => {
    if (!capability.supported || !tenant) return;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'PUSH_SUBSCRIPTION_CHANGED') return;
      const fresh = event.data.subscription;
      if (!fresh?.endpoint) return;

      supabase.functions
        .invoke('save-push-subscription', {
          body: {
            action: 'subscribe',
            audience: 'customer',
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            endpoint: fresh.endpoint,
            keys: fresh.keys,
            deviceId: getDeviceId(),
            platform: capability.platform,
            isStandalone: capability.standalone,
            userAgent: navigator.userAgent,
          },
        })
        .catch((err) => console.error('[push] Re-registration failed:', err));
    };

    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [capability, tenant]);

  // ---- Enable -------------------------------------------------------------
  const enable = useCallback(async (): Promise<boolean> => {
    setError(null);

    if (!capability.supported) {
      setError(
        capability.needsInstall
          ? 'Add this site to your Home Screen first, then open it from there.'
          : 'This browser does not support notifications.',
      );
      return false;
    }
    if (!VAPID_PUBLIC_KEY) {
      setError('Notifications are not configured for this site yet.');
      return false;
    }
    if (!tenant) {
      setError('Still loading — try again in a moment.');
      return false;
    }

    setIsBusy(true);
    try {
      // MUST be the first thing awaited. iOS only honours a permission prompt
      // raised directly from a user gesture; anything awaited before this
      // breaks the gesture chain and the prompt never appears.
      const result = await Notification.requestPermission();
      if (mounted.current) setPermission(result);

      if (result !== 'granted') {
        if (mounted.current) {
          setError(
            result === 'denied'
              ? 'Notifications are blocked. Enable them for this site in your browser settings.'
              : 'Notification permission was not granted.',
          );
        }
        return false;
      }

      const registration = await registerServiceWorker();
      if (!registration) throw new Error('Could not start the notification service');

      // Reuse an existing subscription rather than re-subscribing: on iOS an
      // unsubscribe/subscribe cycle can hand back a fresh endpoint and orphan
      // the old row.
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          // Required to be true by every browser — a silent push is not allowed.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));

      await persistSubscription(subscription);

      if (mounted.current) setIsSubscribed(true);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not enable notifications';
      console.error('[push] enable failed:', err);
      if (mounted.current) setError(message);
      return false;
    } finally {
      if (mounted.current) setIsBusy(false);
    }
  }, [capability, tenant, persistSubscription]);

  // ---- Disable ------------------------------------------------------------
  const disable = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsBusy(true);
    try {
      const registration = await registerServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;
        // Retire the row FIRST. If the browser-side unsubscribe succeeded but
        // the server call then failed, the backend would keep pushing to a dead
        // endpoint until it 410s — this ordering cannot leave that state.
        await supabase.functions.invoke('save-push-subscription', {
          body: { action: 'unsubscribe', audience: 'customer', endpoint },
        });
        await subscription.unsubscribe();
      }

      if (mounted.current) setIsSubscribed(false);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not turn off notifications';
      console.error('[push] disable failed:', err);
      if (mounted.current) setError(message);
      return false;
    } finally {
      if (mounted.current) setIsBusy(false);
    }
  }, []);

  return {
    isSupported: capability.supported,
    needsInstall: capability.needsInstall,
    isEnabledForTenant,
    permission,
    isSubscribed,
    isLoading,
    isBusy,
    error,
    capability,
    enable,
    disable,
  };
}
