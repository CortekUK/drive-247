'use client';

/**
 * Confirm removing an uploaded insurance.
 *
 * The operator's dialog surface (`PvDialogContent`: the gradient wash, the
 * "Close" pill) opened on `PvDialogHeader` — the art top-left, the document's
 * status top-right, the question, one line under it. Two buttons in one row,
 * equal height, the way out first and the destructive action last.
 *
 * The behaviour that matters is kept by hand: the destructive action is not
 * the default focus, and the dialog cannot be dismissed mid-delete.
 */

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2 } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import type { CustomerDocument } from '@nw/hooks/use-customer-documents';
import { PvDialogContent, PvDialogHeader, PvStatus } from '@nw/portal-v2/dialog';

import { Notice } from './_components/kit';

function DocumentStatus({ doc }: { doc: CustomerDocument }) {
  if (doc.expiry === 'expired') return <PvStatus tone="danger">Expired</PvStatus>;
  if (doc.expiry === 'expiring') return <PvStatus tone="warning">Expires soon</PvStatus>;
  return doc.isVerified ? (
    <PvStatus tone="success">Verified</PvStatus>
  ) : (
    <PvStatus tone="neutral">Awaiting review</PvStatus>
  );
}

const FOOTER_BUTTON = 'h-11 w-full px-6 sm:w-auto sm:min-w-[9rem]';

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
    <DialogPrimitive.Root
      open={doc !== null}
      onOpenChange={(next) => {
        if (!next && !isDeleting) onCancel();
      }}
    >
      <PvDialogContent
        showCloseButton={!isDeleting}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="sm:max-w-xl"
      >
        <PvDialogHeader
          title="Remove this insurance?"
          description={
            doc
              ? `“${doc.name}” and the file you uploaded will be deleted. You can upload it again at any time.`
              : undefined
          }
          status={doc ? <DocumentStatus doc={doc} /> : undefined}
        />

        {error ? <Notice tone="danger" lines={[error]} /> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button type="button" variant="brand-ghost" className={FOOTER_BUTTON} disabled={isDeleting} onClick={onCancel}>
            Keep it
          </Button>
          <Button
            type="button"
            variant="brand-ghost"
            // ui-v2's `destructive`: a soft red tint, not a solid red slab.
            className={`${FOOTER_BUTTON} bg-pv-danger-light text-pv-danger hover:bg-pv-danger/15 hover:text-pv-danger focus-visible:ring-pv-danger/25`}
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
            {isDeleting ? 'Removing…' : 'Remove insurance'}
          </Button>
        </div>
      </PvDialogContent>
    </DialogPrimitive.Root>
  );
}
