'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@drive247/ui';
import {
  RequiredDocumentType,
  REQUIRED_DOCUMENT_TYPE_LABELS,
} from '@drive247/shared-types';
import { idVerificationApi } from '@/lib/api';
import { VerificationQrModal } from './verification-qr-modal';

interface Props {
  customerId: string;
  /** Tenant-default required doc type — shown as default, staff can override. */
  defaultDocumentType: RequiredDocumentType;
  onCompleted: () => void;
}

/**
 * Two-step flow: pick required doc type → creates session → shows QR modal.
 * When the customer completes or the staff closes the modal, `onCompleted`
 * is called so the parent can refresh.
 */
export function StartVerificationDialog({
  customerId,
  defaultDocumentType,
  onCompleted,
}: Props) {
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<RequiredDocumentType>(
    defaultDocumentType,
  );
  const [submitting, setSubmitting] = useState(false);
  const [qrState, setQrState] = useState<{
    qrUrl: string;
    verificationId: string;
    sessionExpiresAt: string;
  } | null>(null);

  const handleStart = async () => {
    setSubmitting(true);
    try {
      const { data: res } = await idVerificationApi.createSession({
        customerId,
        requiredDocumentType: docType,
      });
      if (res.success) {
        setQrState({
          qrUrl: res.data.qrUrl,
          verificationId: res.data.verificationId,
          sessionExpiresAt: res.data.sessionExpiresAt,
        });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Could not start verification');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseAll = () => {
    setQrState(null);
    setOpen(false);
    onCompleted();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Start ID Verification</Button>

      <Dialog
        open={open && !qrState}
        onOpenChange={(v) => !v && setOpen(false)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Start ID verification</DialogTitle>
            <DialogDescription>
              A QR code will be generated for the customer to scan with their
              phone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="doc-type">Required document</Label>
              <Select
                value={docType}
                onValueChange={(v) => setDocType(v as RequiredDocumentType)}
              >
                <SelectTrigger id="doc-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REQUIRED_DOCUMENT_TYPE_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleStart} disabled={submitting}>
              {submitting ? 'Starting...' : 'Generate QR'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {qrState && (
        <VerificationQrModal
          open={true}
          onClose={handleCloseAll}
          qrUrl={qrState.qrUrl}
          verificationId={qrState.verificationId}
          sessionExpiresAt={qrState.sessionExpiresAt}
        />
      )}
    </>
  );
}
