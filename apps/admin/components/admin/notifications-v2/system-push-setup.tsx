'use client';

/**
 * Notifications › Setups › Push notifications, for the super admin dashboard.
 *
 * The operator portal's "Push on this device" checklist (push-setup-v2.tsx),
 * drawn the same way — 1 Install the app, 2 Allow notifications, 3 Send a
 * test — and wired to this dashboard's PLATFORM push (usePlatformPush: devices
 * on push_subscriptions with the platform audience, prefs on
 * platform_activity_prefs). Under it, the part only a super admin has: which
 * audit-log events buzz you, from the same ACTION_GROUPS the old Mobile
 * notifications screen used (PlatformPushSettings), so there is one list.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Check, Download, Loader2, Monitor, PlusSquare, Send, Share, Smartphone } from 'lucide-react';
import { ACTION_GROUPS, RECOMMENDED } from '@/components/admin/PlatformPushSettings';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { usePlatformPush } from '@/hooks/use-platform-push';
import { usePwaInstall } from '@/hooks/use-pwa-install';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type SetupPlatform = 'iphone' | 'other';
type AllowState = 'loading' | 'needs-install' | 'unsupported' | 'blocked' | 'off' | 'on';
type TestResult = { kind: 'sent'; sent: number; failed: number } | { kind: 'none' } | { kind: 'error'; message: string };

const SECTION_TITLE = 'text-lg font-semibold text-foreground';

export function SystemPushSetup({ canEdit, className }: { canEdit: boolean; className?: string }) {
  // The hook keys on the app_users row id (push_subscriptions and
  // platform_activity_prefs both do), not the auth user id.
  const [appUserId, setAppUserId] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) return;
      const { data } = await supabase.from('app_users').select('id').eq('auth_user_id', auth.user.id).maybeSingle();
      setAppUserId(data?.id ?? null);
    })();
  }, []);

  const push = usePlatformPush(appUserId);
  const pwa = usePwaInstall();

  const platform: SetupPlatform = push.capability.platform === 'ios' ? 'iphone' : 'other';
  const installed = pwa.isInstalled || push.capability.standalone;
  const install: 'done' | 'required' | 'recommended' = installed ? 'done' : platform === 'iphone' ? 'required' : 'recommended';
  let allow: AllowState;
  if (push.needsInstall) allow = 'needs-install';
  else if (!push.isSupported) allow = platform === 'iphone' && !installed ? 'needs-install' : 'unsupported';
  else if (push.isLoading) allow = 'loading';
  else if (push.permission === 'denied') allow = 'blocked';
  else if (push.isSubscribed) allow = 'on';
  else allow = 'off';
  const canTest = allow === 'on';

  const [showOther, setShowOther] = useState(false);
  const [installNote, setInstallNote] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [arrived, setArrived] = useState<'yes' | 'no' | null>(null);

  const handleInstall = async (): Promise<void> => {
    setInstallNote(null);
    const accepted = await pwa.install();
    setInstallNote(
      accepted
        ? 'Installed. Open it from your Home Screen or app list.'
        : 'Not installed. You can install it later from your browser menu.',
    );
  };

  const handleToggle = async (next: boolean): Promise<void> => {
    setResult(null);
    setArrived(null);
    const ok = next ? await push.enable() : await push.disable();
    // An empty allowlist means nothing would ever arrive, which reads as "it
    // doesn't work". Seed it so the very next real event lands.
    if (ok && next && push.prefs.actions.length === 0) await push.savePrefs({ actions: RECOMMENDED });
  };

  const handleTest = async (): Promise<void> => {
    setResult(null);
    setArrived(null);
    try {
      const response = await push.sendTest();
      setResult(response.sent > 0 ? { kind: 'sent', sent: response.sent, failed: response.failed ?? 0 } : { kind: 'none' });
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error && err.message ? err.message : 'The test wasn’t sent.' });
    }
  };

  const otherPlatform: SetupPlatform = platform === 'iphone' ? 'other' : 'iphone';
  const selected = new Set(push.prefs.actions);
  const toggleAction = (key: string): void => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    void push.savePrefs({ actions: Array.from(next) });
  };

  return (
    <div className={cn('space-y-10', className)}>
      <section aria-labelledby="system-push-title" data-settings-section="push-setup">
        <div className="pb-2">
          <h2 id="system-push-title" className={SECTION_TITLE}>
            Push on this device
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Alerts on this phone or computer, even when the dashboard is closed. Do these steps on each device you
            want alerts on.
          </p>
        </div>

        <ol aria-label="Push setup steps" className="[&>li+li]:border-t [&>li+li]:border-border/70">
          {/* ---- 1. Install ------------------------------------------------ */}
          <Step
            n={1}
            id="install"
            done={install === 'done'}
            title="Install the app"
            tag={install === 'required' ? 'Needed on iPhone' : install === 'recommended' ? 'Recommended' : undefined}
          >
            {install === 'done' ? (
              <p className="text-[13px] text-muted-foreground">Installed. You’re using the app.</p>
            ) : platform === 'iphone' ? (
              <IphoneInstallSteps />
            ) : (
              <OtherInstallSteps canPrompt={pwa.canPrompt} onInstall={() => void handleInstall()} note={installNote} />
            )}
            {install !== 'done' && (
              <div className="space-y-2">
                <button
                  type="button"
                  aria-expanded={showOther}
                  onClick={() => setShowOther((open) => !open)}
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]"
                >
                  {showOther
                    ? otherPlatform === 'iphone'
                      ? 'Hide iPhone steps'
                      : 'Hide Android and computer steps'
                    : otherPlatform === 'iphone'
                      ? 'On an iPhone? Show those steps'
                      : 'On Android or a computer? Show those steps'}
                </button>
                {showOther &&
                  (otherPlatform === 'iphone' ? (
                    <IphoneInstallSteps />
                  ) : (
                    <OtherInstallSteps canPrompt={false} onInstall={() => void handleInstall()} note={null} />
                  ))}
              </div>
            )}
          </Step>

          {/* ---- 2. Allow notifications ------------------------------------ */}
          <Step
            n={2}
            id="allow"
            done={allow === 'on'}
            title="Allow notifications"
            control={
              allow === 'loading' ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Checking this device" />
              ) : allow === 'off' || allow === 'on' || allow === 'blocked' ? (
                <div className="flex items-center gap-2">
                  {push.isBusy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
                  <Switch
                    checked={push.isSubscribed}
                    onCheckedChange={(v) => void handleToggle(v)}
                    disabled={push.isBusy || allow === 'blocked' || !canEdit}
                    aria-label="Push notifications on this device"
                  />
                </div>
              ) : null
            }
          >
            <AllowCopy state={allow} platform={platform} canEdit={canEdit} />
            {push.error && allow !== 'blocked' && (
              <p role="alert" className="text-[13px] text-destructive [overflow-wrap:anywhere]">
                {push.error}
              </p>
            )}
            {push.devices.length > 0 && (
              <ul className="space-y-1 pt-1" aria-label="Your devices">
                {push.devices.map((d) => {
                  const Icon = d.platform === 'desktop' ? Monitor : Smartphone;
                  return (
                    <li key={d.id} className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Icon className="size-3.5" aria-hidden="true" />
                      <span className="capitalize text-foreground">{d.platform}</span>
                      {d.is_standalone && <span>· Installed</span>}
                      <span className="ml-auto">{d.last_success_at ? 'Receiving' : 'No messages yet'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Step>

          {/* ---- 3. Test --------------------------------------------------- */}
          <Step
            n={3}
            id="test"
            done={arrived === 'yes'}
            title="Send a test to this device"
            control={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => void handleTest()}
                disabled={!canTest || !canEdit || push.sending}
                aria-busy={push.sending || undefined}
              >
                {push.sending ? <Loader2 className="animate-spin" /> : <Send />}
                {push.sending ? 'Sending…' : 'Send a test'}
              </Button>
            }
          >
            <p className="text-[13px] text-muted-foreground">
              {canTest
                ? 'Sends a test to your devices that have notifications on, including this one.'
                : 'Turn on notifications in step 2 first.'}
            </p>
            <TestResultView result={result} arrived={arrived} platform={platform} onArrived={setArrived} />
          </Step>
        </ol>

        <p className="pt-3 text-[13px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">How push looks:</span> whether it shows as a banner, on the
          lock screen or with a sound is set on the phone, not here. On iPhone: Settings, then Notifications, then this
          app. On Android: press and hold a notification, then tap the settings icon.
        </p>
      </section>

      {/* ---- What buzzes you -------------------------------------------- */}
      <section aria-labelledby="system-push-events-title" data-settings-section="push-events">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-2">
          <div className="min-w-0">
            <h2 id="system-push-events-title" className={SECTION_TITLE}>
              What should notify you?
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {selected.size === 0
                ? 'Nothing selected, so no notifications will be sent. Events come from the audit log.'
                : `${selected.size} event type${selected.size === 1 ? '' : 's'} selected. Events come from the audit log. Changes save as you make them.`}
            </p>
          </div>
          {canEdit && (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => void push.savePrefs({ actions: RECOMMENDED })}
                disabled={push.savingPrefs}
              >
                Recommended
              </Button>
              {selected.size > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  onClick={() => void push.savePrefs({ actions: [] })}
                  disabled={push.savingPrefs}
                >
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>
        {!push.prefsLoaded ? (
          <Loader2 className="my-4 size-4 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : (
          <div className="divide-y divide-border/70 border-y border-border/70">
            {ACTION_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col gap-3 py-4 md:flex-row md:gap-6">
                <div className="min-w-0 md:w-[304px] md:shrink-0">
                  <p className="text-sm font-medium text-foreground">{group.label}</p>
                  {group.hint && <p className="text-[13px] text-muted-foreground">{group.hint}</p>}
                </div>
                <div className="grid flex-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
                  {group.actions.map((a) => (
                    <div key={a.key} className="flex items-center gap-2">
                      <Checkbox
                        id={`sys-act-${a.key}`}
                        checked={selected.has(a.key)}
                        onCheckedChange={() => toggleAction(a.key)}
                        disabled={!canEdit}
                      />
                      <label htmlFor={`sys-act-${a.key}`} className="cursor-pointer text-[13px] leading-none text-foreground">
                        {a.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-6 py-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Include the test tenant</p>
                <p className="text-[13px] text-muted-foreground">
                  Turn off once you’re done testing. It produces most of the traffic.
                </p>
              </div>
              <Switch
                checked={push.prefs.include_test_tenants}
                onCheckedChange={(v) => void push.savePrefs({ include_test_tenants: v })}
                disabled={!canEdit}
                aria-label="Include the test tenant"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts (the portal's, as push-setup-v2.tsx draws them)                       */
/* -------------------------------------------------------------------------- */

function Step({
  n,
  id,
  done,
  title,
  tag,
  control,
  children,
}: {
  n: number;
  id: string;
  done: boolean;
  title: string;
  tag?: string;
  control?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li data-step={id} data-done={done || undefined} className="flex gap-3 py-4">
      <span
        aria-hidden="true"
        className={cn(
          'mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums',
          done ? 'bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]' : 'bg-muted text-muted-foreground',
        )}
      >
        {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <span className="sr-only">{done ? 'Done: ' : `Step ${n}: `}</span>
            {title}
            {tag && (
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-normal text-muted-foreground">{tag}</span>
            )}
          </h3>
          {control}
        </div>
        {children}
      </div>
    </li>
  );
}

function SubSteps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-1.5 text-[13px] text-muted-foreground">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {String.fromCharCode(97 + i)}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function IphoneInstallSteps() {
  return (
    <div data-install-steps="iphone" className="space-y-1.5">
      <p className="text-[13px] text-muted-foreground">On iPhone and iPad, push only works in the installed app.</p>
      <SubSteps
        items={[
          <>
            In Safari, tap Share <Share className="inline size-3.5 align-[-2px]" aria-hidden="true" />
          </>,
          <>
            Choose <span className="font-medium text-foreground">Add to Home Screen</span>{' '}
            <PlusSquare className="inline size-3.5 align-[-2px]" aria-hidden="true" />
          </>,
          'Open the app from your Home Screen and come back to this page.',
        ]}
      />
    </div>
  );
}

function OtherInstallSteps({ canPrompt, onInstall, note }: { canPrompt: boolean; onInstall: () => void; note: string | null }) {
  return (
    <div data-install-steps="other" className="space-y-2">
      <p className="text-[13px] text-muted-foreground">
        On Android and computers push works in the browser too. Installed, notifications show Drive247 Admin instead of
        the browser’s.
      </p>
      {canPrompt ? (
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onInstall}>
          <Download />
          Install
        </Button>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          If your browser offers it, open its menu and choose <span className="font-medium text-foreground">Install app</span>{' '}
          (on Android it may say Add to Home screen).
        </p>
      )}
      {note && (
        <p role="status" className="text-[13px] text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}

function AllowCopy({ state, platform, canEdit }: { state: AllowState; platform: SetupPlatform; canEdit: boolean }) {
  const muted = 'text-[13px] text-muted-foreground';
  switch (state) {
    case 'loading':
      return <p className={muted}>Checking this device…</p>;
    case 'needs-install':
      return <p className={muted}>Do step 1 first. Then open the app from your Home Screen and turn this on there.</p>;
    case 'unsupported':
      return (
        <p className={muted}>
          This browser can’t get push notifications. Use Chrome or Edge on a computer or Android phone, or Safari on
          iPhone after installing the app.
        </p>
      );
    case 'blocked':
      return (
        <div role="alert" className="space-y-1 text-[13px]">
          <p className="font-medium text-destructive">Notifications are blocked for this site.</p>
          <p className="text-muted-foreground">
            {platform === 'iphone'
              ? 'To unblock: open the Settings app, tap Notifications, find this app and turn on Allow Notifications. Then come back here.'
              : 'To unblock: tap or click the icon to the left of the web address, open the site settings, set Notifications to Allow, then reload this page.'}
          </p>
        </div>
      );
    case 'on':
      return <p className={muted}>On. This device gets a push for every event you pick below.</p>;
    case 'off':
    default:
      return (
        <p className={muted}>
          {canEdit ? 'Turn this on, then tap Allow when your browser asks.' : 'View only: only a super admin can turn this on.'}
        </p>
      );
  }
}

function TestResultView({
  result,
  arrived,
  platform,
  onArrived,
}: {
  result: TestResult | null;
  arrived: 'yes' | 'no' | null;
  platform: SetupPlatform;
  onArrived: (value: 'yes' | 'no') => void;
}) {
  if (!result) return null;
  if (result.kind === 'error') {
    return (
      <p role="alert" className="text-[13px] text-destructive [overflow-wrap:anywhere]">
        Couldn’t send the test. {result.message}
      </p>
    );
  }
  if (result.kind === 'none') {
    return (
      <p role="status" className="text-[13px] text-muted-foreground">
        Nothing was sent: none of your devices have notifications on yet. Finish step 2, then try again.
      </p>
    );
  }
  return (
    <div role="status" className="space-y-2 text-[13px]">
      <p className="text-muted-foreground">
        Sent to {result.sent} of your device{result.sent === 1 ? '' : 's'}
        {result.failed > 0 ? ` (${result.failed} didn’t take it)` : ''}. It should show up within a few seconds.
      </p>
      {arrived === null && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground">Did it show up on this device?</span>
          <Button type="button" variant="outline" size="sm" className="h-7 rounded-full px-3 text-xs" onClick={() => onArrived('yes')}>
            Yes
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-3 text-xs" onClick={() => onArrived('no')}>
            No
          </Button>
        </div>
      )}
      {arrived === 'yes' && <p className="font-medium text-foreground">Push works on this device.</p>}
      {arrived === 'no' && (
        <div className="space-y-1">
          <p className="font-medium text-foreground">Things to check</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Do Not Disturb or Focus is off.</li>
            {platform === 'iphone' && <li>You opened the app from your Home Screen, not from Safari.</li>}
            <li>Notifications for this app are allowed in the phone’s settings.</li>
            <li>Turn step 2 off and on again, then send another test.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
