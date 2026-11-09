'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Download, Loader2, Monitor, MoreVertical, Share, Smartphone, SquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePwaInstall } from '@/hooks/use-pwa-install';
import { detectPlatform, type PushPlatform } from '@/lib/push';
import { SettingsNotice, SettingsRow, SettingsSection } from '@/components/admin/settings/settings-kit';
import { cn } from '@/lib/utils';

/**
 * Settings › Install the dashboard (`?tab=install`), Ghulam, Nov 9 2026.
 *
 * Puts Drive247 Admin on a phone or computer as an app. Mobile notifications
 * already had an "Install" row for the push case; this page is the plain
 * install, found from the Settings index. In Chrome and Edge the button opens
 * the browser's own install dialog (`beforeinstallprompt`, parked by the
 * service worker registrar); where there is none (iPhone, Firefox, a prompt
 * dismissed earlier) the steps below are the way, with this device's marked.
 */
export function InstallDashboardSettings() {
  const { isInstalled, canPrompt, install } = usePwaInstall();
  const [platform, setPlatform] = useState<PushPlatform>('unknown');
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Read after mount: the user agent is not known on the server.
    setPlatform(detectPlatform());
  }, []);

  const runInstall = async () => {
    setInstalling(true);
    try {
      await install();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      <SettingsSection title="This device">
        <SettingsRow
          label="Drive247 Admin on this device"
          description={
            isInstalled
              ? 'Installed. It opens full screen from its own icon, and notifications say Drive247 Admin.'
              : canPrompt
                ? 'Not installed: this is a browser tab. Install it to get a full-screen app with its own icon.'
                : 'Not installed: this is a browser tab. Your browser offers no install dialog here, so use the steps for your device below.'
          }
        >
          {isInstalled ? (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-500/10 px-3.5 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="h-4 w-4" aria-hidden="true" /> Installed
            </span>
          ) : canPrompt ? (
            <Button size="sm" onClick={() => void runInstall()} disabled={installing} aria-busy={installing}>
              {installing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              Install app
            </Button>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="How to install" description="Pick your device. Each super admin installs it on their own phone or computer.">
        <StepsRow
          icon={Smartphone}
          label="iPhone or iPad"
          browser="Safari, iOS 16.4 or newer. Push only works from the installed app."
          here={platform === 'ios'}
          steps={[
            <>Open <b>admin.drive-247.com</b> in Safari and sign in.</>,
            <>Tap <b>Share</b> <Share className="inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" /> at the bottom of the screen.</>,
            <>Choose <b>Add to Home Screen</b> <SquarePlus className="inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" />, then <b>Add</b>.</>,
            <>Open <b>Drive247 Admin</b> from your Home Screen.</>,
          ]}
        />
        <StepsRow
          icon={Smartphone}
          label="Android"
          browser="Google Chrome."
          here={platform === 'android'}
          steps={[
            <>Open <b>admin.drive-247.com</b> in Chrome and sign in.</>,
            <>Tap <b>Install app</b> above, or the three dots <MoreVertical className="inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" /> at the top right, then <b>Install app</b> (some phones say <b>Add to Home screen</b>).</>,
            <>Tap <b>Install</b> in the box Android shows.</>,
            <>Open <b>Drive247 Admin</b> from your home screen.</>,
          ]}
        />
        <StepsRow
          icon={Monitor}
          label="Computer"
          browser="Google Chrome or Microsoft Edge."
          here={platform === 'desktop'}
          steps={[
            <>Open <b>admin.drive-247.com</b> and sign in.</>,
            <>Click <b>Install app</b> above, or the install icon at the right end of the address bar.</>,
            <>Click <b>Install</b>. It opens in its own window from then on.</>,
          ]}
        />
      </SettingsSection>

      <SettingsNotice>
        Once installed, open the app from its icon and turn on push under{' '}
        <Link href="/admin/settings?tab=notifications" className="font-medium text-foreground underline underline-offset-2">
          Mobile notifications
        </Link>
        .
      </SettingsNotice>
    </>
  );
}

function StepsRow({
  icon: Icon,
  label,
  browser,
  here,
  steps,
}: {
  icon: typeof Smartphone;
  label: string;
  browser: string;
  here: boolean;
  steps: React.ReactNode[];
}) {
  return (
    <SettingsRow
      label={
        <span className="inline-flex flex-wrap items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {label}
          {here && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary/70" aria-hidden="true" />
              This device
            </span>
          )}
        </span>
      }
      description={browser}
    >
      <ol className={cn('space-y-1.5 text-sm text-foreground', here && 'font-medium')}>
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {i + 1}
            </span>
            <span className="font-normal">{step}</span>
          </li>
        ))}
      </ol>
    </SettingsRow>
  );
}
