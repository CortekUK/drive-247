'use client';

/**
 * Confirm removing a document.
 *
 * One dialog screen: the question, one button. Built on the local
 * `ConfirmDialog` (a plain Radix dialog in the operator's ui-v2 skin) rather
 * than an AlertDialog, which this app has not generated. The behaviour that
 * matters is kept by hand: the destructive action is not the default focus,
 * and the dialog cannot be dismissed mid-delete.
 */

import type { CustomerDocument } from '@nw/hooks/use-customer-documents';

import { ConfirmDialog } from './_components/kit';

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
    <ConfirmDialog
      open={doc !== null}
      title="Remove this insurance?"
      description={
        doc
          ? `“${doc.name}” and the file you uploaded will be deleted. You can upload it again at any time.`
          : ''
      }
      confirmLabel="Remove insurance"
      busyLabel="Removing…"
      busy={isDeleting}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
