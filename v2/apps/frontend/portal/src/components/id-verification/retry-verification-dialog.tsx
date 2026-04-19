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
} from '@drive247/ui';
import { idVerificationApi } from '@/lib/api';
import { VerificationQrModal } from './verification-qr-modal';

interface Props {
  verificationId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Retry flow: mandatory reason → regenerates QR → reuses QR modal for
 * polling. Old S3 files are deleted server-side.
 */
export function RetryVerificationDialog({
  verificationId,
  open,
  onClose,
  onDone,
}: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [qrState, setQrState] = useState<{
    qrUrl: string;
    sessionExpiresAt: string;
  } | null>(null);

  const handleSubmit = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast.error('Reason must be at least 3 characters');
      return;
    }
    setSubmitting(true);
    try {
      const { data: res } = await idVerificationApi.retry(verificationId, {
        reason: trimmed,
      });
      if (res.success) {
        setQrState({
          qrUrl: res.data.qrUrl,
          sessionExpiresAt: res.data.sessionExpiresAt,
        });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Retry failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseAll = () => {
    setQrState(null);
    setReason('');
    onDone();
    onClose();
  };

  if (qrState) {
    return (
      <VerificationQrModal
        open={true}
        onClose={handleCloseAll}
        qrUrl={qrState.qrUrl}
        verificationId={verificationId}
        sessionExpiresAt={qrState.sessionExpiresAt}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Retry verification</DialogTitle>
          <DialogDescription>
            A new QR code will be generated and the customer&apos;s existing
            captures will be deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="retry-reason">Reason</Label>
          <textarea
            id="retry-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-[#e2e8f0] rounded-md bg-white focus:outline-none focus:border-[#6366f1]"
            placeholder="Document photo too blurry — please retake in better light"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Starting retry...' : 'Generate new QR'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
