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

interface Props {
  verificationId: string;
  decision: 'approve' | 'reject';
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Mandatory-reason dialog for manual approve / reject (rule #15).
 */
export function ManualReviewDialog({
  verificationId,
  decision,
  open,
  onClose,
  onDone,
}: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast.error('Reason must be at least 3 characters');
      return;
    }
    setSubmitting(true);
    try {
      await idVerificationApi.review(verificationId, {
        decision,
        reason: trimmed,
      });
      toast.success(
        decision === 'approve' ? 'Verification approved' : 'Verification rejected',
      );
      onDone();
      setReason('');
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Review failed');
    } finally {
      setSubmitting(false);
    }
  };

  const title =
    decision === 'approve' ? 'Approve verification' : 'Reject verification';
  const description =
    decision === 'approve'
      ? 'Record why you are approving this verification despite requiring manual review.'
      : 'Record the reason for rejecting this verification.';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="review-reason">Reason</Label>
          <textarea
            id="review-reason"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-[#e2e8f0] rounded-md bg-white focus:outline-none focus:border-[#6366f1]"
            placeholder={
              decision === 'approve'
                ? 'Photo quality low but face match clearly corresponds to ID data'
                : 'Face on ID does not match selfie'
            }
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className={
              decision === 'reject' ? 'bg-[#dc2626] hover:bg-[#b91c1c]' : ''
            }
          >
            {submitting
              ? 'Submitting...'
              : decision === 'approve'
                ? 'Approve'
                : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
