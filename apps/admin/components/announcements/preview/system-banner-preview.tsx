'use client';

import { X } from 'lucide-react';
import { SYSTEM_BANNER_UI, TONE_CLASSES, type AnnouncementTone, type Blocking } from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';
import { ToneIcon } from '../tone-icon';

/**
 * The system banner with the portal's DOM (spec §3.2). The portal pins it with
 * SYSTEM_BANNER_UI.position (fixed, full viewport width); inside the preview
 * canvas it is `relative` and still spans the full canvas width, above the
 * sidebar column and the top bar.
 */
export function SystemBannerPreview({
  tone,
  blocking,
  title,
  body,
  ctaLabel,
  ctaVisible,
}: {
  tone: AnnouncementTone;
  blocking: Blocking;
  title: string;
  body: string;
  ctaLabel: string;
  ctaVisible: boolean;
}) {
  const t = TONE_CLASSES[tone];
  const message = body.replace(/\n+/g, ' ').trim();
  return (
    <div role="region" aria-label="Announcement" className={cn('relative', SYSTEM_BANNER_UI.root, t.banner)}>
      <div className={SYSTEM_BANNER_UI.inner}>
        <ToneIcon tone={tone} className={SYSTEM_BANNER_UI.icon} aria-hidden />
        <p className={SYSTEM_BANNER_UI.text}>
          <strong className={SYSTEM_BANNER_UI.title}>{title.trim() || 'Your heading'}</strong>
          <span className={SYSTEM_BANNER_UI.body}>{message || 'Your message'}</span>
        </p>
        <div className={SYSTEM_BANNER_UI.actions}>
          {ctaVisible && (
            <button type="button" className={cn(SYSTEM_BANNER_UI.action, t.bannerAction)}>
              {ctaLabel.trim() || 'Button label'}
            </button>
          )}
          {blocking === 'soft' && (
            <button type="button" aria-label="Dismiss announcement" className={cn(SYSTEM_BANNER_UI.dismiss, t.bannerDismiss)}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
