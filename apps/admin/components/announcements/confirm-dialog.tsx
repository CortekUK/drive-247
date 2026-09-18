'use client';

import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { QUIET_BUTTON } from './form-field';

/**
 * A small yes/no dialog. It is opened from code, not a DialogTrigger, so Radix
 * has nowhere to return focus: `returnFocusRef` names the control that gets it
 * back when the dialog closes (if that control is still on the page).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  returnFocusRef,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const el = returnFocusRef?.current;
          if (el?.isConnected) el.focus();
        }}
      >
        <DialogHeader className="min-w-0">
          <DialogTitle className="pr-6 leading-snug [overflow-wrap:anywhere]">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" className={QUIET_BUTTON} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
