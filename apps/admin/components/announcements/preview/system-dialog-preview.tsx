'use client';

import { X } from 'lucide-react';
import { SYSTEM_DIALOG_UI, TONE_CLASSES, type AnnouncementTone, type Blocking } from '@/lib/announcements/contract';
import { cn } from '@/lib/utils';
import { HIDDEN_SCROLLBAR } from '../form-field';
import { ToneIcon } from '../tone-icon';

/**
 * The system dialog as the portal renders it (spec §3.3), as a static stage.
 * The leading classes on the panel, title and text stand in for the v1
 * DialogContent / DialogTitle / DialogDescription defaults the portal merges
 * the SYSTEM_DIALOG_UI entries into. The role-dependent helper line is not
 * shown: it depends on who is viewing.
 */
export function SystemDialogPreview({
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
  const hard = blocking === 'hard';
  const cta = ctaVisible ? (
    <button type="button" className={cn(SYSTEM_DIALOG_UI.action, t.dialogAction)}>
      {ctaLabel.trim() || 'Button label'}
    </button>
  ) : null;

  return (
    <>
      <div aria-hidden className={cn('absolute inset-0 z-10', hard ? SYSTEM_DIALOG_UI.overlayHard : SYSTEM_DIALOG_UI.overlaySoft)} />
      <div className="absolute inset-0 z-20 flex items-center justify-center">
        <div
          role={hard ? 'alertdialog' : 'dialog'}
          aria-label={title.trim() || 'Your heading'}
          className={cn('relative grid bg-background shadow-lg', SYSTEM_DIALOG_UI.panel)}
        >
          <div aria-hidden className={cn(SYSTEM_DIALOG_UI.accent, t.dialogAccent)} />
          {!hard && (
            <button type="button" className={SYSTEM_DIALOG_UI.close} aria-label="Close">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
          {/* Appended: the editor dialog around this preview shows no scrollbars. */}
          <div className={cn(SYSTEM_DIALOG_UI.body, HIDDEN_SCROLLBAR)}>
            <div className={cn(SYSTEM_DIALOG_UI.icon, t.dialogIcon)}>
              <ToneIcon tone={tone} className="h-5 w-5" aria-hidden />
            </div>
            <h2 className={cn('text-lg font-semibold leading-none tracking-tight', SYSTEM_DIALOG_UI.title)}>
              {title.trim() || 'Your heading'}
            </h2>
            <p className={cn('text-sm text-muted-foreground', SYSTEM_DIALOG_UI.text)}>{body.trim() || 'Your message'}</p>
          </div>
          <div className={SYSTEM_DIALOG_UI.footer}>
            {hard ? (
              <>
                <button type="button" className={SYSTEM_DIALOG_UI.secondaryButton}>
                  Sign out
                </button>
                {cta}
              </>
            ) : cta ? (
              <>
                <button type="button" className={SYSTEM_DIALOG_UI.secondaryButton}>
                  Not now
                </button>
                {cta}
              </>
            ) : (
              <button type="button" className={cn(SYSTEM_DIALOG_UI.action, t.dialogAction)}>
                Got it
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
