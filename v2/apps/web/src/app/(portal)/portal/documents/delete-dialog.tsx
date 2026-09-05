'use client';

/**
 * Confirm removing a document.
 *
 * A plain `Dialog`, not shadcn's `AlertDialog` — that primitive has not been
 * generated into `components/ui` in this app, and adding one for a single
 * two-button confirmation would be a new dependency for the whole tree. The
 * behaviour that matters is preserved by hand: the destructive action is not
 * the default focus, and the dialog cannot be dismissed mid-delete.
 */

import { Loader2, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CustomerDocument } from '@/hooks/use-customer-documents';

export function DeleteDocumentDialog({
  document: doc,
  onCancel,
  onConfirm,
  isDeleting,
  error,
}: {
  /** The document awaiting confirmation. Null closes the dialog. */
  document: CustomerDocument | null;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
  error: string | null;
}) {
  return (
    <Dialog
      open={doc !== null}
      onOpenChange={(next) => {
        if (!next && !isDeleting) onCancel();
      }}
    >
      <DialogContent showCloseButton={!isDeleting}>
        <DialogHeader>
          <DialogTitle>Remove this document?</DialogTitle>
          <DialogDescription>
            {doc
              ? `“${doc.name}” will be deleted, along with the file you uploaded. You can upload it again at any time.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div
            role="alert"
            className="flex gap-3 rounded-[14px] border border-danger-subtle/40 bg-danger-light px-4 py-3"
          >
            <TriangleAlert
              aria-hidden
              strokeWidth={1.75}
              className="mt-0.5 size-4 shrink-0 text-danger"
            />
            <p className="min-w-0 text-sm leading-relaxed text-brand-text">{error}</p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="brand-outline"
            className="h-11"
            disabled={isDeleting}
            onClick={onCancel}
          >
            Keep it
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 rounded-full"
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            {isDeleting ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
