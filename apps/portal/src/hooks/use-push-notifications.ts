'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import {
  getDeviceId,
  getPushCapability,
  registerServiceWorker,
  urlBase64ToUint8Array,
  readEdgeFunctionError,
  VAPID_PUBLIC_KEY,
  type PushCapability,
} from '@/lib/push';

export interface PushDeviceRow {
  id: string;
  audience: 'customer' | 'staff';
  platform: string;
  is_standalone: boolean;
  device_id: string;
  user_agent: string | null;
  last_success_at: string | null;
  last_seen_at: string;
  created_at: string;
}

export interface SendPushInput {
  target: 'self' | 'staff' | 'customers' | 'all';
  title: string;
  body?: string;
  url?: string;
}

export interface SendPushResult {
  success: boolean;
  sent: number;
  failed: number;
  expired: number;
  total?: number;
  message?: string;
  errors?: string[];
}

/**
 * Operator-side Web Push: enrolling THIS device, and sending.
 *
 * Staff subscriptions are a separate audience from customers' and live on a
 * different origin (`*.portal.drive-247.com` vs `*.drive-247.com`), so a
 * browser's subscription for one is meaningless to the other. That separation is
 * what stops an internal alert reaching a customer's lock screen.
 */
export function usePushNotifications() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const [capability] = useState<PushCapability>(() => getPushCapability());
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isEnabledForTenant = tenant?.push_notifications_enabled === true;

  // ---- Enrolled devices for this tenant ----------------------------------
  const devicesQuery = useQuery({
    queryKey: ['push-devices', tenant?.id],
    queryFn: async (): Promise<PushDeviceRow[]> => {
      const { data, error: qErr } = await supabase
        .from('push_subscriptions')
        .select('id, audience, platform, is_standalone, device_id, user_agent, last_success_at, last_seen_at, created_at')
        .eq('tenant_id', tenant!.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (qErr) throw qErr;
      return (data ?? []) as PushDeviceRow[];
    },
    enabled: !!tenant && isEnabledForTenant,
  });

  // ---- Reconcile this browser's state ------------------------------------
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
          // Permission alone is not "subscribed" — a subscription can be dropped
          // while permission survives, and showing "on" then would be a lie.
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

  // ---- Enable on this device ----------------------------------------------
  const enable = useCallback(async (): Promise<boolean> => {
    setError(null);

    if (!capability.supported) {
      setError(
        capability.needsInstall
          ? 'Add the portal to your Home Screen first, then open it from there.'
          : 'This browser does not support push notifications.',
      );
      return false;
    }
    if (!VAPID_PUBLIC_KEY) {
      setError('Push is not configured (NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing).');
      return false;
    }
    if (!tenant) {
      setError('Still loading — try again in a moment.');
      return false;
    }

    setIsBusy(true);
    try {
      // MUST be the first await. iOS only honours a permission prompt raised
      // directly from a user gesture; awaiting anything first breaks the chain
      // and the prompt silently never appears.
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

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));

      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

      const { data, error: fnError } = await supabase.functions.invoke('save-push-subscription', {
        body: {
          action: 'subscribe',
          audience: 'staff',
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          endpoint: json.endpoint,
          keys: json.keys,
          deviceId: getDeviceId(),
          platform: capability.platform,
          isStandalone: capability.standalone,
          userAgent: navigator.userAgent,
        },
      });

      if (fnError) throw new Error(await readEdgeFunctionError(fnError, 'Could not save subscription'));
      if (data?.error) throw new Error(data.error);

      if (mounted.current) setIsSubscribed(true);
      void queryClient.invalidateQueries({ queryKey: ['push-devices', tenant.id] });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not enable notifications';
      console.error('[push] enable failed:', err);
      if (mounted.current) setError(message);
      return false;
    } finally {
      if (mounted.current) setIsBusy(false);
    }
  }, [capability, tenant, queryClient]);

  // ---- Disable on this device --------------------------------------------
  const disable = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsBusy(true);
    try {
      const registration = await registerServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        // Retire the row BEFORE the browser-side unsubscribe: reversing this
        // leaves the backend pushing at a dead endpoint until it 410s.
        await supabase.functions.invoke('save-push-subscription', {
          body: { action: 'unsubscribe', audience: 'staff', endpoint: subscription.endpoint },
        });
        await subscription.unsubscribe();
      }

      if (mounted.current) setIsSubscribed(false);
      void queryClient.invalidateQueries({ queryKey: ['push-devices', tenant?.id] });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not turn off notifications';
      console.error('[push] disable failed:', err);
      if (mounted.current) setError(message);
      return false;
    } finally {
      if (mounted.current) setIsBusy(false);
    }
  }, [tenant?.id, queryClient]);

  // ---- Send ---------------------------------------------------------------
  const sendPush = useMutation({
    mutationFn: async (input: SendPushInput): Promise<SendPushResult> => {
      const { data, error: fnError } = await supabase.functions.invoke('send-push', {
        body: {
          ...input,
          source: 'manual_test',
          // Always sent. A SUPER ADMIN has tenant_id = NULL by design, so the
          // backend has no implicit tenant for them and cannot resolve one —
          // without this every super-admin send fails. It is ignored server-side
          // for normal operators, so it cannot be used to cross tenants.
          tenantId: tenant?.id,
          tenantSlug: tenant?.slug,
        },
      });
      if (fnError) throw new Error(await readEdgeFunctionError(fnError, 'Send failed'));
      if (data?.error) throw new Error(data.error);
      return data as SendPushResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['push-devices', tenant?.id] });
      void queryClient.invalidateQueries({ queryKey: ['push-log', tenant?.id] });
    },
  });

  const devices = devicesQuery.data ?? [];

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
    devices,
    staffDevices: devices.filter((d) => d.audience === 'staff'),
    customerDevices: devices.filter((d) => d.audience === 'customer'),
    devicesLoading: devicesQuery.isLoading,
    refetchDevices: devicesQuery.refetch,
    sendPush,
  };
}

/** Recent delivery attempts — the only evidence a send happened, since iOS gives no receipt. */
export function usePushLog(limit = 20) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ['push-log', tenant?.id, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('push_notification_log')
        .select('id, title, body, status, audience, http_status, error, created_at')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!tenant && tenant.push_notifications_enabled === true,
  });
}
