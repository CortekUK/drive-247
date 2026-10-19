'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { supabase } from '@/lib/supabase';
import { usePlatformPush } from '@/hooks/use-platform-push';
import { usePwaInstall } from '@/hooks/use-pwa-install';
import { Smartphone, Monitor, Loader2, Download, Share, PlusSquare } from 'lucide-react';
import { SettingsNotice, SettingsRow, SettingsSection } from '@/components/admin/settings/settings-kit';

/**
 * "Notify me when somebody does something" — super-admin mobile alerts.
 *
 * Events come from `audit_logs`, which already records every meaningful action
 * across all tenants. A DB trigger dispatches each new row to the
 * notify-platform-activity function, which pushes to the admins who asked for
 * that action.
 *
 * The picker below is an ALLOWLIST, not a mute list, and it starts empty. About
 * 40% of audit rows are UI telemetry (`*_dialog_shown`, `login_success`); a
 * default of "everything" would make the first day unbearable and train you to
 * swipe the notifications away without reading them.
 */

export interface ActionGroup {
  label: string;
  hint?: string;
  actions: { key: string; label: string }[];
}

/**
 * Curated because 118 distinct actions exist in audit_logs and most are noise.
 * These are the ones where knowing within seconds actually changes what you do.
 */
export const ACTION_GROUPS: ActionGroup[] = [
  {
    label: 'Money',
    hint: 'Recommended — these are the ones worth a buzz',
    actions: [
      { key: 'payment_created', label: 'Payment received' },
      { key: 'payment_refunded', label: 'Refund issued' },
      { key: 'payment_charged_saved_card', label: 'Saved card charged' },
      { key: 'installment_payment_processed', label: 'Installment paid' },
      { key: 'payment_collected_as_credit', label: 'Payment collected as credit' },
    ],
  },
  {
    label: 'Rentals',
    actions: [
      { key: 'rental_created', label: 'New rental' },
      { key: 'rental_extended', label: 'Rental extended' },
      { key: 'rental_cancelled', label: 'Rental cancelled' },
      { key: 'rental_extension_approved', label: 'Extension approved' },
      { key: 'rental_vehicle_swapped', label: 'Vehicle swapped' },
      { key: 'rental_created_without_id_verification', label: 'Rental without ID check' },
    ],
  },
  {
    label: 'Customers & fleet',
    actions: [
      { key: 'customer_created', label: 'New customer' },
      { key: 'customer_blocked', label: 'Customer blocked' },
      { key: 'identity_blocked', label: 'Identity blocked' },
      { key: 'vehicle_created', label: 'Vehicle added' },
      { key: 'fine_created', label: 'Fine raised' },
    ],
  },
  {
    label: 'Platform & billing',
    actions: [
      { key: 'subscription_activated', label: 'Subscription activated' },
      { key: 'subscription_link_expired', label: 'Payment link expired unpaid' },
      { key: 'subscription_invoice_paid', label: 'Subscription invoice paid' },
      { key: 'subscription_checkout_created', label: 'Subscription checkout started' },
      { key: 'stripe_account_created', label: 'Stripe account connected' },
      { key: 'credit_wallet_purchased', label: 'Credits purchased' },
      { key: 'credit_wallet_gifted', label: 'Credits gifted' },
    ],
  },
  {
    label: 'Insurance',
    actions: [
      { key: 'insurance_payment_confirmed', label: 'Insurance confirmed' },
      { key: 'insurance_payment_failed', label: 'Insurance payment failed' },
      { key: 'insurance_payment_insufficient_balance', label: 'Bonzah balance too low' },
    ],
  },
  {
    label: 'Support',
    actions: [
      { key: 'portal_feedback_received', label: 'New feedback' },
    ],
  },
  {
    label: 'Security',
    hint: 'Can be chatty — 292 failed logins on record',
    actions: [
      { key: 'login_failed', label: 'Failed login attempt' },
    ],
  },
];

/** A sane opening set: money, new rentals, and things that went wrong. */
export const RECOMMENDED = [
  'payment_created', 'payment_refunded',
  'rental_created', 'rental_cancelled',
  'customer_created',
  'subscription_activated', 'subscription_invoice_paid',
  'insurance_payment_failed', 'insurance_payment_insufficient_balance',
];

export function PlatformPushSettings() {
  const [appUserId, setAppUserId] = useState<string | null>(null);

  // The hook needs the app_users row id (not the auth user id) because that is
  // what both push_subscriptions and platform_activity_prefs key on.
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) return;
      const { data } = await supabase
        .from('app_users')
        .select('id')
        .eq('auth_user_id', auth.user.id)
        .maybeSingle();
      setAppUserId(data?.id ?? null);
    })();
  }, []);

  const {
    isSupported, needsInstall, permission, isSubscribed, isLoading, isBusy, error,
    capability, enable, disable, devices, prefs, prefsLoaded, savingPrefs, savePrefs,
    sending, sendTest,
  } = usePlatformPush(appUserId);
  const { isInstalled, canPrompt, install } = usePwaInstall();

  const isBlocked = permission === 'denied';
  const selected = new Set(prefs.actions);

  const toggleAction = (key: string) => {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    void savePrefs({ actions: Array.from(next) });
  };

  const handleToggleDevice = async (on: boolean) => {
    const ok = on ? await enable() : await disable();
    if (ok) {
      toast.success(on ? 'Notifications enabled on this device' : 'Notifications turned off');
      // Landing on an empty allowlist means nothing would ever arrive, which
      // reads as "it doesn't work". Seed it so the very next real event lands.
      if (on && prefs.actions.length === 0) {
        await savePrefs({ actions: RECOMMENDED });
        toast.message('Started you on the recommended events', {
          description: 'Adjust the list below any time.',
        });
      }
    }
  };

  const handleTest = async () => {
    try {
      const result = await sendTest();
      if (result.sent === 0) {
        toast.message('Nothing to send to', {
          description: result.message ?? 'Enable notifications on this device first.',
        });
        return;
      }
      toast.success(`Sent to ${result.sent} device${result.sent === 1 ? '' : 's'}`, {
        description: 'Check your lock screen.',
      });
    } catch (err) {
      toast.error('Could not send', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  return (
    <div className="space-y-9">
      <SettingsSection title="This device">
        <SettingsRow
          label="Notifications on this device"
          description={
            isSubscribed
              ? 'On. This device gets a push for every event you pick below.'
              : 'Off. Turn on to get a push here, even when this dashboard is closed.'
          }
          htmlFor="platform-push-device"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : isSupported ? (
            <Switch
              id="platform-push-device"
              checked={isSubscribed}
              onCheckedChange={handleToggleDevice}
              disabled={isBusy || isBlocked}
              aria-label="Toggle notifications on this device"
            />
          ) : null}
        </SettingsRow>

        {/* iOS has no install prompt and no push outside a Home Screen install,
            so it needs the manual steps rather than a dead button. */}
        {needsInstall && (
          <SettingsNotice className="my-2">
            <p className="mb-2 font-medium text-foreground">On iPhone, add this to your Home Screen first</p>
            <ol className="space-y-1">
              <li className="flex items-center gap-2">1. Tap Share <Share className="h-3.5 w-3.5" /> in Safari</li>
              <li className="flex items-center gap-2">2. Choose <strong className="text-foreground">Add to Home Screen</strong> <PlusSquare className="h-3.5 w-3.5" /></li>
              <li>3. Open it from the Home Screen and come back here</li>
            </ol>
          </SettingsNotice>
        )}

        {!isSupported && !needsInstall && (
          <SettingsNotice className="my-2">
            This browser doesn&apos;t support push notifications. Chrome, Edge and Firefox all do,
            on desktop and Android.
          </SettingsNotice>
        )}

        {isBlocked && (
          <SettingsNotice tone="danger" className="my-2">
            Notifications are blocked for this site. Re-enable them in your browser settings, then reload.
          </SettingsNotice>
        )}

        {error && !isBlocked && (
          <SettingsNotice tone="danger" className="my-2">
            {error}
          </SettingsNotice>
        )}

        {/* In a browser tab Android stamps the notification with Chrome's icon
            and the site address; no payload field can override that. Installing
            is the only way to get our own branding on it. */}
        {!needsInstall && (
          <SettingsRow
            label="Install the dashboard"
            description={
              isInstalled
                ? 'Installed. Notifications show Drive247 Admin as the sender.'
                : 'Installed, notifications show Drive247 Admin instead of your browser’s name and icon.'
            }
          >
            {isInstalled ? null : canPrompt ? (
              <Button size="sm" variant="outline" onClick={() => void install()}>
                <Download className="h-4 w-4" /> Install
              </Button>
            ) : (
              <span className="text-[13px] text-muted-foreground">Browser menu → Install app</span>
            )}
          </SettingsRow>
        )}

        {devices.length > 0 && (
          <SettingsRow label="Your devices" description="Every device signed up for these notifications." align="start">
            <div className="w-full space-y-1.5">
              {devices.map((d) => {
                const Icon = d.platform === 'desktop' ? Monitor : Smartphone;
                return (
                  <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="capitalize">{d.platform}</span>
                      {d.is_standalone && <span className="text-[13px] text-muted-foreground">· Installed</span>}
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      {d.last_success_at ? 'Receiving' : 'No messages yet'}
                    </span>
                  </div>
                );
              })}
            </div>
          </SettingsRow>
        )}

        <SettingsRow
          label="Send a test"
          description={
            isSubscribed
              ? 'Sends one notification to every device above.'
              : 'Turn notifications on for this device first.'
          }
        >
          <Button onClick={handleTest} disabled={sending || !isSubscribed} size="sm" variant="outline">
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            {sending ? 'Sending…' : 'Send test notification'}
          </Button>
        </SettingsRow>
      </SettingsSection>

      {/* ---- What to be notified about ---- */}
      <SettingsSection
        title="What should notify you?"
        description={
          selected.size === 0
            ? 'Nothing selected, so no notifications will be sent. Events come from the audit log.'
            : `${selected.size} event type${selected.size === 1 ? '' : 's'} selected. Events come from the audit log.`
        }
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void savePrefs({ actions: RECOMMENDED })}
              disabled={savingPrefs}
            >
              Recommended
            </Button>
            {selected.size > 0 && (
              <Button size="sm" variant="ghost" onClick={() => void savePrefs({ actions: [] })} disabled={savingPrefs}>
                Clear
              </Button>
            )}
          </div>
        }
      >
        {!prefsLoaded ? (
          <Loader2 className="my-4 h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          ACTION_GROUPS.map((group) => (
            <SettingsRow key={group.label} label={group.label} description={group.hint} align="start">
              <div className="grid w-full gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {group.actions.map((a) => (
                  <div key={a.key} className="flex items-center gap-2">
                    <Checkbox
                      id={`act-${a.key}`}
                      checked={selected.has(a.key)}
                      onCheckedChange={() => toggleAction(a.key)}
                    />
                    <label htmlFor={`act-${a.key}`} className="cursor-pointer text-sm leading-none">
                      {a.label}
                    </label>
                  </div>
                ))}
              </div>
            </SettingsRow>
          ))
        )}
        <SettingsRow
          label="Include the test tenant"
          description="Turn off once you’re done testing. It produces most of the traffic."
          htmlFor="include-test"
        >
          <Switch
            id="include-test"
            checked={prefs.include_test_tenants}
            onCheckedChange={(v) => void savePrefs({ include_test_tenants: v })}
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
