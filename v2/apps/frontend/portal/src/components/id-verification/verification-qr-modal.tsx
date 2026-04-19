'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@drive247/ui';
import {
  ID_VERIFICATION_STATUS_POLL_INTERVAL_MS,
  IdVerificationStatus,
  type IdVerificationResponse,
} from '@drive247/shared-types';
import { idVerificationApi } from '@/lib/api';
import { VerificationStatusBadge } from './verification-status-badge';

interface Props {
  open: boolean;
  onClose: () => void;
  qrUrl: string;
  verificationId: string;
  sessionExpiresAt: string;
  onStatusChange?: (verification: IdVerificationResponse) => void;
}

/**
 * Displays the QR code for a freshly-created verification session.
 * Polls the backend for status updates every 3s and reports them to the
 * parent. Parent closes the modal when a terminal status is reached.
 */
export function VerificationQrModal({
  open,
  onClose,
  qrUrl,
  verificationId,
  sessionExpiresAt,
  onStatusChange,
}: Props) {
  const [status, setStatus] = useState<IdVerificationStatus>(
    IdVerificationStatus.INITIATED,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let stopped = false;

    const poll = async () => {
      try {
        const { data: res } = await idVerificationApi.getById(verificationId);
        if (stopped || !res.success) return;
        setStatus(res.data.status);
        onStatusChange?.(res.data);
      } catch {
        // ignore transient errors — keep polling
      }
    };

    poll();
    const t = setInterval(poll, ID_VERIFICATION_STATUS_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, verificationId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(qrUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no clipboard access
    }
  };

  const expiresDate = new Date(sessionExpiresAt);
  const expiresLabel = isFinite(expiresDate.getTime())
    ? expiresDate.toLocaleTimeString()
    : '—';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Customer ID verification</DialogTitle>
          <DialogDescription>
            Ask the customer to scan this code with their phone camera.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="p-4 bg-white border border-[#f1f5f9] rounded-md">
            <QRCodeSVG value={qrUrl} size={220} />
          </div>

          <div className="w-full space-y-1 text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs text-muted-foreground">Status:</span>
              <VerificationStatusBadge status={status} />
            </div>
            <p className="text-xs text-muted-foreground">
              Session expires at {expiresLabel}
            </p>
          </div>

          <div className="w-full space-y-1">
            <p className="text-xs text-muted-foreground">Or share this link:</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={qrUrl}
                className="flex-1 text-xs px-2 py-1 border border-[#f1f5f9] rounded bg-[#f8fafc]"
              />
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
