'use client';

/**
 * Notifications v2, SYSTEM set: the in-app preview — one row of a bell.
 *
 * The admin twin of the portal's `inapp-preview.tsx`. Which bell it draws
 * depends on the direction, because at platform scope the three directions
 * reach three different bells:
 *
 *   super_admin_to_admin      the OPERATOR's portal bell (their whole team)
 *   admin_to_super_admin      OUR bell, in this dashboard
 *   super_admin_to_everyone   both, plus the renter's bell on a booking site
 *
 * Saying which bell is the point of the preview: an in-app message that reads
 * correctly to us often reads wrong to an operator, and the direction is the
 * only thing that decides which.
 */

import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SystemNotificationDirection } from '@/lib/notifications-v2/catalog';

export const BELL_COPY: Record<SystemNotificationDirection, { where: string; note: string }> = {
  super_admin_to_admin: {
    where: 'The operator’s portal',
    note: 'Everyone on that operator’s team sees it when they sign in.',
  },
  admin_to_super_admin: {
    where: 'This dashboard',
    note: 'Every Drive247 super admin sees it.',
  },
  super_admin_to_everyone: {
    where: 'Every portal and every booking site',
    note: 'Operator staff and their renters both see it.',
  },
};

export interface InAppPreviewProps {
  /** Title and message with variables already filled. */
  title: string;
  body: string;
  direction: SystemNotificationDirection;
  /** Where the row goes when it is clicked, with variables filled. */
  link?: string | null;
  className?: string;
}

export function InAppPreview({ title, body, direction, link, className }: InAppPreviewProps) {
  const copy = BELL_COPY[direction];
  return (
    <div className={cn('space-y-2 rounded-xl border border-border bg-card p-4', className)} data-inapp-preview={direction}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{copy.where}</p>

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Bell className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="text-xs font-medium text-foreground">Notifications</span>
          <span className="ml-auto rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">1</span>
        </div>
        <div className="flex gap-2.5 bg-primary/5 px-3 py-2.5">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-[13px] font-medium text-foreground [overflow-wrap:anywhere]" data-inapp-title="">
              {title || 'Title'}
            </p>
            {body && (
              <p className="text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]" data-inapp-body="">
                {body}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">Just now</p>
          </div>
        </div>
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        {copy.note}
        {link ? (
          <>
            {' '}
            Opens <code className="font-mono text-[11px] text-foreground [overflow-wrap:anywhere]">{link}</code>.
          </>
        ) : null}
      </p>
    </div>
  );
}

export default InAppPreview;
