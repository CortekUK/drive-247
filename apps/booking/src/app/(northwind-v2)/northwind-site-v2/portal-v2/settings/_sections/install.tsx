'use client';

/**
 * Settings → Install app (Ghulam, Nov 9 2026): the customer portal on a phone
 * or computer as an app, from its own icon, full screen.
 *
 * In Chrome and Edge the button opens the browser's own install dialog
 * (`beforeinstallprompt`, parked by `ServiceWorkerRegistrarV2` the moment the
 * page loads, because Chrome fires it once and early). An iPhone never offers
 * that dialog, so the Safari steps are the way there; the steps for the device
 * in hand are marked. Nothing here touches the account, so there is nothing to
 * save.
 */

import { useEffect, useState } from 'react';

import { useTenant } from '@nw/contexts/TenantContext';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';
import {
  detectPlatform,
  isInstallPromptAvailable,
  isStandalone,
  promptPwaInstall,
  subscribeToInstallAvailability,
  type PushPlatform,
} from '@/lib/push';

import { PV_BUTTON_SM } from '../_components/pv-kit';
import { SettingsPageHeader, SettingsRow, SettingsSection, StatusPill } from '../_components/settings-ui';

export function InstallAppSettings() {
  const { tenant } = useTenant();
  const { appName } = useTenantBranding();
  const name = appName || tenant?.company_name || 'this site';

  const [installed, setInstalled] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [platform, setPlatform] = useState<PushPlatform>('unknown');
  const [installing, setInstalling] = useState(false);
  const [host, setHost] = useState('');

  useEffect(() => {
    // All of this depends on `window`: read it after mount so the server's HTML
    // and the first client render agree.
    setInstalled(isStandalone());
    setCanPrompt(isInstallPromptAvailable());
    setPlatform(detectPlatform());
    setHost(window.location.host);
    const unsubscribe = subscribeToInstallAvailability(setCanPrompt);
    const done = () => setInstalled(true);
    window.addEventListener('appinstalled', done);
    return () => {
      unsubscribe();
      window.removeEventListener('appinstalled', done);
    };
  }, []);

  const install = async () => {
    setInstalling(true);
    try {
      if (await promptPwaInstall()) setInstalled(true);
    } finally {
      setInstalling(false);
    }
  };

  const site = host || 'this site';

  return (
    <>
      <SettingsPageHeader
        title="Install app"
        description={`Put ${name} on your phone or computer as an app. It opens full screen from its own icon and can send you notifications about your rentals.`}
      />

      <SettingsSection id="install-device" title="This device">
        <SettingsRow
          label={`${name} on this device`}
          description={
            installed
              ? 'Installed. You are using the app.'
              : canPrompt
                ? 'Not installed: this is a browser tab.'
                : 'Not installed: this is a browser tab. Your browser offers no install dialog here, so follow the steps for your device below.'
          }
          align="end"
        >
          {installed ? (
            <StatusPill tone="positive">Installed</StatusPill>
          ) : canPrompt ? (
            <button type="button" onClick={() => void install()} disabled={installing} aria-busy={installing} className={PV_BUTTON_SM}>
              {installing ? 'Installing…' : 'Install app'}
            </button>
          ) : (
            <StatusPill tone="neutral">Not installed</StatusPill>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="install-steps" title="How to install" description="Pick your device.">
        <Steps
          label="iPhone or iPad"
          browser="Safari, iOS 16.4 or newer."
          here={platform === 'ios'}
          steps={[
            <>Open <b>{site}</b> in Safari and sign in.</>,
            <>Tap <b>Share</b> (the square with an arrow) at the bottom of the screen.</>,
            <>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</>,
            <>Open <b>{name}</b> from your Home Screen.</>,
          ]}
        />
        <Steps
          label="Android"
          browser="Google Chrome."
          here={platform === 'android'}
          steps={[
            <>Open <b>{site}</b> in Chrome and sign in.</>,
            <>Tap <b>Install app</b> above, or the three dots at the top right, then <b>Install app</b> (some phones say <b>Add to Home screen</b>).</>,
            <>Tap <b>Install</b> in the box Android shows.</>,
            <>Open <b>{name}</b> from your home screen.</>,
          ]}
        />
        <Steps
          label="Computer"
          browser="Google Chrome or Microsoft Edge."
          here={platform === 'desktop'}
          steps={[
            <>Open <b>{site}</b> and sign in.</>,
            <>Click <b>Install app</b> above, or the install icon at the right end of the address bar.</>,
            <>Click <b>Install</b>. It opens in its own window from then on.</>,
          ]}
        />
      </SettingsSection>
    </>
  );
}

function Steps({ label, browser, here, steps }: { label: string; browser: string; here: boolean; steps: React.ReactNode[] }) {
  return (
    <SettingsRow
      label={
        <span className="inline-flex flex-wrap items-center gap-2">
          {label}
          {here ? <StatusPill tone="notice">This device</StatusPill> : null}
        </span>
      }
      description={browser}
    >
      <ol className={cn('space-y-2 text-[14px] text-pv-fg', here && 'font-medium')}>
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-pv-primary text-[11px] font-semibold text-pv-primary-fg">
              {i + 1}
            </span>
            <span className="font-normal">{step}</span>
          </li>
        ))}
      </ol>
    </SettingsRow>
  );
}
