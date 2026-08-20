'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  getDeviceId,
  getPushCapability,
  readEdgeFunctionError,
  registerServiceWorker,
  urlBase64ToUint8Array,
  VAPID_PUBLIC_KEY,
  type PushCapability,
} from '@/lib/push';

export interface PlatformDevice {
  id: string;
  platform: string;
  is_standalone: boolean;
  last_success_at: string | null;
  created_at: string;
}

export interface PlatformActivityPrefs {
  is_enabled: boolean;
  actions: string[];
  include_test_tenants: boolean;
}

export interface SendResult {
  sent: number;
  failed: number;
  expired: number;
  message?: string;
}

const DEFAULT_PREFS: PlatformActivityPrefs = {
  is_enabled: true,
  actions: [],
  include_test_tenants: true,
};

/**
 * Super-admin push: enrol THIS device, and choose which platform-wide actions
 * are worth a notification.
 *
 * The audience is `platform`, whose subscription rows deliberately carry no
 * tenant — a super admin is not scoped to one operator, which is the point.
 *
 * Deliberately plain useState/useEffect rather than React Query: the admin app
 * has the dependency but never mounts a QueryClientProvider, so any useQuery
 * here would throw at runtime.
 */
export function usePlatformPush(appUserId: string | null) {
  const [capability] = useState<PushCapability>(() => getPushCapability());
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [devices, setDevices] = useState<PlatformDevice[]>([]);
  const [prefs, setPrefs] = useState<PlatformActivityPrefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [sending, setSending] = useState(false);

  // Guards state writes after unmount — enabling push is a multi-second round
  // trip the user can easily navigate away from.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ---- What does this browser already have? ------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!capability.supported) {
        if (!cancelled) { setPermission('unsupported'); setIsLoading(false); }
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
        console.error('[platform-push] Could not read subscription:', err);
      } finally {
        if (!cancelled && mounted.current) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [capability.supported]);

  const loadDevices = useCallback(async () => {
    if (!appUserId) return;
    const { data } = await supabase
      .from('push_subscriptions')
      .select('id, platform, is_standalone, last_success_at, created_at')
      .eq('audience', 'platform')
      .eq('app_user_id', appUserId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (mounted.current) setDevices((data ?? []) as PlatformDevice[]);
  }, [appUserId]);

  const loadPrefs = useCallback(async () => {
    if (!appUserId) return;
    const { data } = await supabase
      .from('platform_activity_prefs')
      .select('is_enabled, actions, include_test_tenants')
      .eq('app_user_id', appUserId)
      .maybeSingle();
    if (!mounted.current) return;
    if (data) setPrefs({ ...DEFAULT_PREFS, ...(data as PlatformActivityPrefs) });
    setPrefsLoaded(true);
  }, [appUserId]);

  useEffect(() => {
    void loadDevices();
    void loadPrefs();
  }, [loadDevices, loadPrefs]);

  const savePrefs = useCallback(async (patch: Partial<PlatformActivityPrefs>): Promise<boolean> => {
    if (!appUserId) return false;
    const next = { ...prefs, ...patch };
    // Optimistic: a checkbox that waits on a round trip before moving feels
    // broken when you are ticking a dozen of them.
    setPrefs(next);
    setSavingPrefs(true);
    try {
      const { error: upErr } = await supabase
        .from('platform_activity_prefs')
        .upsert({ app_user_id: appUserId, ...next }, { onConflict: 'app_user_id' });
      if (upErr) throw upErr;
      return true;
    } catch (err) {
      console.error('[platform-push] savePrefs failed:', err);
      // Roll the UI back so it never claims a setting was stored when it wasn't.
      if (mounted.current) setPrefs(prefs);
      return false;
    } finally {
      if (mounted.current) setSavingPrefs(false);
    }
  }, [appUserId, prefs]);

  // ---- Enable / disable on this device ------------------------------------
  const enable = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!capability.supported) {
      setError(capability.needsInstall
        ? 'Add this dashboard to your Home Screen first, then open it from there.'
        : 'This browser does not support push notifications.');
      return false;
    }
    if (!VAPID_PUBLIC_KEY) {
      setError('Push is not configured (NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing).');
      return false;
    }

    setIsBusy(true);
    try {
      // MUST be the first await: iOS only honours a permission prompt raised
      // directly from a user gesture, and awaiting anything first breaks it.
      const result = await Notification.requestPermission();
      if (mounted.current) setPermission(result);
      if (result !== 'granted') {
        if (mounted.current) {
          setError(result === 'denied'
            ? 'Notifications are blocked. Enable them for this site in your browser settings.'
            : 'Notification permission was not granted.');
        }
        return false;
      }

      const registration = await registerServiceWorker();
      if (!registration) throw new Error('Could not start the notification service');

      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }));

      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const { data, error: fnError } = await supabase.functions.invoke('save-push-subscription', {
        body: {
          action: 'subscribe',
          audience: 'platform',
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
      await loadDevices();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not enable notifications';
      console.error('[platform-push] enable failed:', err);
      if (mounted.current) setError(message);
      return false;
    } finally {
      if (mounted.current) setIsBusy(false);
    }
  }, [capability, loadDevices]);

  const disable = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsBusy(true);
    try {
      const registration = await registerServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        // Retire the row BEFORE the browser-side unsubscribe: the other order
        // leaves the backend pushing at a dead endpoint until it 410s.
        await supabase.functions.invoke('save-push-subscription', {
          body: { action: 'unsubscribe', audience: 'platform', endpoint: subscription.endpoint },
        });
        await subscription.unsubscribe();
      }
      if (mounted.current) setIsSubscribed(false);
      await loadDevices();
      return true;
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not turn off notifications');
      return false;
    } finally {
      if (mounted.current) setIsBusy(false);
    }
  }, [loadDevices]);

  // ---- Test send ----------------------------------------------------------
  const sendTest = useCallback(async (): Promise<SendResult> => {
    setSending(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-push', {
        body: {
          target: 'platform',
          title: 'Drive247 Admin · Test',
          body: 'Platform activity notifications are working on this device.',
          url: '/admin/audit-logs',
          source: 'platform_test',
        },
      });
      if (fnError) throw new Error(await readEdgeFunctionError(fnError, 'Send failed'));
      if (data?.error) throw new Error(data.error);
      return data as SendResult;
    } finally {
      if (mounted.current) setSending(false);
    }
  }, []);

  return {
    isSupported: capability.supported,
    needsInstall: capability.needsInstall,
    permission,
    isSubscribed,
    isLoading,
    isBusy,
    error,
    capability,
    enable,
    disable,
    devices,
    prefs,
    prefsLoaded,
    savingPrefs,
    savePrefs,
    sending,
    sendTest,
    reloadDevices: loadDevices,
  };
}
