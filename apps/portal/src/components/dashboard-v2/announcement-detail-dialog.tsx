'use client';

import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui-v2/dialog';
import { safeHref } from '@/lib/safe-href';
import type {
  AnnouncementSeverity,
  FeatureAnnouncement,
} from '@/hooks/use-feature-announcements';

/**
 * The announcement detail dialog, shared by the two v2 surfaces that show
 * platform announcements:
 *   - the dashboard carousel (components/dashboard-v2/announcement-carousel.tsx)
 *   - the hero-tab featured deck (components/shared/featured-deck-v2.tsx)
 *
 * Moved here verbatim from the carousel so both open the SAME dialog, with the
 * same "Got it, hide this" going through the same `dismiss` from
 * `useFeatureAnnouncements`. Nothing about the markup or the behaviour changed
 * in the move; the carousel imports it back.
 */

export const SEVERITY_LABEL: Record<AnnouncementSeverity, string> = {
  critical: 'Important',
  major: 'New',
  minor: 'Update',
  info: 'Note',
};

export function DetailDialog({
  announcement,
  onOpenChange,
  onDismiss,
}: {
  announcement: FeatureAnnouncement | null;
  onOpenChange: (open: boolean) => void;
  onDismiss: (id: string) => void;
}) {
  if (!announcement) return null;
  const href = safeHref(announcement.cta_url);
  const isExternal = !!href && /^https?:\/\//i.test(href);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            {SEVERITY_LABEL[announcement.severity]}
          </span>
          <DialogTitle className="text-2xl font-bold tracking-tight">
            {announcement.title}
          </DialogTitle>
          {announcement.summary && (
            <DialogDescription className="text-sm leading-relaxed">
              {announcement.summary}
            </DialogDescription>
          )}
        </DialogHeader>

        {announcement.body_html && (
          /* NOT SANITISED, and that is a standing risk rather than a settled
             decision — recorded here because the audit that found it could not
             close it.

             The reasoning it shipped on is that only super admins can write
             this table (it is one of the tables that DOES have RLS on), so the
             HTML comes from us rather than from a tenant. That reasoning is
             unverifiable from this repository: `feature_announcements` has no
             DDL and no policy definition anywhere in the tree (the table was
             created through the Management API), so nothing here pins the write
             policy to `is_super_admin()`.

             The booking app injects the SAME COLUMN through
             `sanitizeHtml()` (apps/booking/src/lib/sanitize-html.ts, DOMPurify),
             and the super-admin editor's own field label promises "HTML allowed
             — sanitized on render". The portal is the one reader that does
             neither. It is left alone here only because closing it means adding
             `dompurify` to apps/portal/package.json, which this area explicitly
             does not do (see the `PanInfo` note at the top of
             announcement-carousel.tsx), and a hand-rolled half-sanitiser is
             worse than none.

             Styled with explicit child selectors rather than `prose`:
             @tailwindcss/typography is in package.json but is NOT registered in
             tailwind.config.ts — `plugins` there is `[tailwindcss-animate]`
             only — so the prose classes resolve to nothing and paragraphs would
             run together. */
          <div
            className="space-y-3 text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_li]:mt-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: announcement.body_html }}
          />
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              onDismiss(announcement.id);
              onOpenChange(false);
            }}
          >
            Got it, hide this
          </Button>
          {href && (
            <Button asChild>
              <a
                href={href}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noreferrer noopener' : undefined}
              >
                {announcement.cta_label || 'Find out more'}
                <ArrowRight className="ml-1 size-4" />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
