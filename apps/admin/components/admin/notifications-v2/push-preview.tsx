'use client';

/**
 * Notifications v2, SYSTEM set: the push preview — a phone card showing where
 * the "…" falls.
 *
 * The admin twin of the portal's `push-preview-phone.tsx`, cut to the two
 * device cards. The geometry and the truncation estimate are NOT guessed here:
 * they come from `lib/notifications-v2/push-display.ts`
 * (PUSH_DEVICE_PROFILES, estimateTruncation), the same module the portal uses
 * and the same module the length hints are counted with, so the preview and
 * the hints can never disagree.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  PUSH_DEVICES,
  PUSH_DEVICE_PROFILES,
  PUSH_PREVIEW_APPROXIMATE_NOTE,
  estimateTruncation,
  type PushDevice,
  type PushDeviceProfile,
} from '@/lib/notifications-v2/push-display';
import type { PushDisplayOptions } from '@/lib/notifications-v2/types';

export interface PushPreviewProps {
  /** Title and body with variables already filled. */
  title: string;
  body: string;
  /** The name the phone shows for the app. */
  appName: string;
  iconUrl?: string | null;
  options: PushDisplayOptions;
  className?: string;
}

function initials(name: string): string {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'D';
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}

function DeviceCard({
  profile,
  title,
  body,
  appName,
  iconUrl,
}: {
  profile: PushDeviceProfile;
  title: string;
  body: string;
  appName: string;
  iconUrl?: string | null;
}) {
  const shownTitle = estimateTruncation(title, profile, profile.title.maxLines.collapsed, 'title');
  const shownBody = estimateTruncation(body, profile, profile.body.maxLines.collapsed, 'body');

  return (
    <div className="space-y-1.5" data-push-device={profile.id}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{profile.label}</p>
      <div
        className="mx-auto w-full max-w-full overflow-hidden bg-neutral-800/90 p-2.5 text-white"
        style={{ borderRadius: profile.cardRadius, fontFamily: profile.fontFamily, maxWidth: profile.cardWidth }}
      >
        <div className="flex items-start gap-2.5">
          <div
            className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/15 text-[11px] font-semibold"
            style={{ width: profile.iconSize, height: profile.iconSize }}
            aria-hidden="true"
          >
            {iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a preview of someone else's icon, not an app asset
              <img src={iconUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(appName)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p
                className="min-w-0 truncate"
                style={{ fontSize: profile.title.fontSize, fontWeight: profile.title.fontWeight, lineHeight: `${profile.title.lineHeight}px` }}
                data-push-title=""
              >
                {shownTitle.shown || 'Title'}
              </p>
              <span className="shrink-0 text-[11px] text-white/60">now</span>
            </div>
            <p
              className="text-white/85 [overflow-wrap:anywhere]"
              style={{ fontSize: profile.body.fontSize, lineHeight: `${profile.body.lineHeight}px` }}
              data-push-body=""
            >
              {shownBody.shown}
            </p>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-white/50">{appName}</p>
          </div>
        </div>
      </div>
      {(shownTitle.truncated || shownBody.truncated) && (
        <p className="text-[11px] text-muted-foreground" data-push-truncated="">
          {shownTitle.truncated && shownBody.truncated
            ? 'The title and the message are both cut here.'
            : shownTitle.truncated
              ? 'The title is cut here.'
              : 'The message is cut here; the rest shows when it is expanded.'}
        </p>
      )}
    </div>
  );
}

export function PushPreview({ title, body, appName, iconUrl, options, className }: PushPreviewProps) {
  const [device, setDevice] = useState<PushDevice>('iphone');
  const profile = PUSH_DEVICE_PROFILES[device];

  const chosen = [
    options.requireInteraction ? 'Stays until dismissed' : null,
    options.silent ? 'Silent' : null,
    options.replacePrevious ? 'Replaces the previous one' : null,
    options.openInApp ? 'Open in app button' : null,
  ].filter(Boolean) as string[];

  return (
    <div className={cn('space-y-3 rounded-xl border border-border bg-card p-4', className)} data-push-preview="">
      <div className="flex items-center gap-1" role="group" aria-label="Preview device">
        {PUSH_DEVICES.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={id === device ? 'secondary' : 'ghost'}
            aria-pressed={id === device}
            onClick={() => setDevice(id)}
            className="h-7 px-2.5 text-xs"
          >
            {PUSH_DEVICE_PROFILES[id].label}
          </Button>
        ))}
      </div>

      <DeviceCard profile={profile} title={title} body={body} appName={appName} iconUrl={iconUrl} />

      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" data-push-chosen-options="">
          {chosen.map((label) => (
            <li
              key={label}
              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {label}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] leading-snug text-muted-foreground">
        {profile.note} {PUSH_PREVIEW_APPROXIMATE_NOTE}
      </p>
    </div>
  );
}

export default PushPreview;
