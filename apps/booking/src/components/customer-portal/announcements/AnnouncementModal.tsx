'use client';

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import type { AnnouncementWithViewState } from '@/hooks/use-customer-announcements';
import { AnnouncementBody } from './AnnouncementBody';

interface Props {
  announcement: AnnouncementWithViewState;
  open: boolean;
  onDismiss: () => void;
}

export function AnnouncementModal({ announcement, open, onDismiss }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogContent className="max-w-lg p-0 overflow-hidden gap-0">
        {announcement.image_url && (
          <img
            src={announcement.image_url}
            alt=""
            className="w-full h-44 object-cover"
          />
        )}
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-wide">
            <Sparkles className="h-3.5 w-3.5" />
            New feature
          </div>
          <DialogTitle className="text-xl font-semibold leading-tight">
            {announcement.title}
          </DialogTitle>
          {announcement.summary && (
            <DialogDescription className="text-sm">
              {announcement.summary}
            </DialogDescription>
          )}
          <AnnouncementBody html={announcement.body_html} />

          <div className="flex items-center gap-2 pt-2">
            {announcement.cta_label && announcement.cta_url && (
              <Button asChild>
                <a
                  href={announcement.cta_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onDismiss()}
                >
                  {announcement.cta_label}
                </a>
              </Button>
            )}
            <Button
              variant={announcement.cta_label ? 'outline' : 'default'}
              onClick={onDismiss}
            >
              Got it
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
