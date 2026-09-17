'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AdminAnnouncementRow } from '@/lib/announcements/contract';
import { QUIET_BUTTON } from './form-field';

export function DeleteAnnouncementDialog({
  row,
  deleting,
  onCancel,
  onConfirm,
  onCloseAutoFocus,
}: {
  /** null = closed. */
  row: AdminAnnouncementRow | null;
  deleting: boolean;
  /** Opened from code (no DialogTrigger), so the page says where focus goes on close. */
  onCloseAutoFocus?: (event: Event) => void;
  onCancel: () => void;
  onConfirm: (row: AdminAnnouncementRow) => void;
}) {
  // Keep the last title while the dialog animates closed (row is already null then).
  const [shown, setShown] = useState(row);
  if (row !== null && row !== shown) setShown(row);

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (!open && !deleting) onCancel();
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        {/* overflow-wrap:anywhere (not break-words) also lowers the title's min-content
            width, so one long unbroken word cannot widen the dialog's grid column. */}
        <DialogHeader className="min-w-0">
          <DialogTitle className="pr-6 leading-snug [overflow-wrap:anywhere]">Delete &ldquo;{(row ?? shown)?.title}&rdquo;?</DialogTitle>
          <DialogDescription>
            It disappears for every tenant and its view history is deleted. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" className={QUIET_BUTTON} onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => row && onConfirm(row)} disabled={deleting}>
            {deleting && <Loader2 className="animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
