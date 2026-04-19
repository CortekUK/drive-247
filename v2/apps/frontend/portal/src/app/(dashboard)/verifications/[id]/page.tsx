'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@drive247/ui';
import {
  ID_VERIFICATION_STATUS_POLL_INTERVAL_MS,
  IdVerificationStatus,
  type IdVerificationEventResponse,
  type IdVerificationResponse,
} from '@drive247/shared-types';
import { idVerificationApi } from '@/lib/api';
import { VerificationStatusBadge } from '@/components/id-verification/verification-status-badge';
import { DocumentImageViewer } from '@/components/id-verification/document-image-viewer';
import { OcrDataPanel } from '@/components/id-verification/ocr-data-panel';
import { FaceMatchPanel } from '@/components/id-verification/face-match-panel';
import { ManualReviewDialog } from '@/components/id-verification/manual-review-dialog';
import { RetryVerificationDialog } from '@/components/id-verification/retry-verification-dialog';

export default function VerificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [verification, setVerification] = useState<IdVerificationResponse | null>(
    null,
  );
  const [events, setEvents] = useState<IdVerificationEventResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewState, setReviewState] = useState<'approve' | 'reject' | null>(
    null,
  );
  const [retryOpen, setRetryOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [detailRes, eventsRes] = await Promise.all([
        idVerificationApi.getById(id),
        idVerificationApi.listEvents(id),
      ]);
      if (detailRes.data.success) setVerification(detailRes.data.data);
      if (eventsRes.data.success) setEvents(eventsRes.data.data.items);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Failed to load verification');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Poll while in active / processing states so staff sees live updates
  useEffect(() => {
    if (!verification) return;
    const active =
      verification.status === IdVerificationStatus.INITIATED ||
      verification.status === IdVerificationStatus.IN_PROGRESS ||
      verification.status === IdVerificationStatus.PROCESSING;
    if (!active) return;
    const t = setInterval(fetchAll, ID_VERIFICATION_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [verification, fetchAll]);

  const handleCancel = async () => {
    if (!confirm('Cancel this verification session?')) return;
    setCancelling(true);
    try {
      await idVerificationApi.cancel(id);
      toast.success('Session cancelled');
      fetchAll();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message || 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!verification) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Verification not found.</p>
        <Button variant="outline" asChild>
          <Link href="/verifications">Back to verifications</Link>
        </Button>
      </div>
    );
  }

  const canReview =
    verification.status === IdVerificationStatus.REVIEW_REQUIRED;
  const canRetry =
    verification.status !== IdVerificationStatus.INITIATED &&
    verification.status !== IdVerificationStatus.PROCESSING;
  const canCancel =
    verification.status === IdVerificationStatus.INITIATED ||
    verification.status === IdVerificationStatus.IN_PROGRESS ||
    verification.status === IdVerificationStatus.REVIEW_REQUIRED;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/verifications"
            className="text-sm text-[#6366f1] hover:underline"
          >
            ← Verifications
          </Link>
          <h2 className="text-[30px] font-medium text-[#080812] mt-1">
            Verification detail
          </h2>
          <p className="text-sm text-muted-foreground">
            <Link
              href={`/customers/${verification.customerId}`}
              className="text-[#6366f1] hover:underline"
            >
              View customer
            </Link>
            {' · '}
            Created {new Date(verification.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <VerificationStatusBadge status={verification.status} />
          {verification.rejectionReason && (
            <span className="text-xs text-[#dc2626] max-w-xs">
              {verification.rejectionReason}
            </span>
          )}
        </div>
      </div>

      {/* Actions row */}
      {(canReview || canRetry || canCancel) && (
        <div className="flex gap-2">
          {canReview && (
            <>
              <Button onClick={() => setReviewState('approve')}>
                Approve
              </Button>
              <Button
                variant="outline"
                className="text-[#dc2626]"
                onClick={() => setReviewState('reject')}
              >
                Reject
              </Button>
            </>
          )}
          {canRetry && (
            <Button variant="outline" onClick={() => setRetryOpen(true)}>
              Request retry
            </Button>
          )}
          {canCancel && (
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling...' : 'Cancel session'}
            </Button>
          )}
        </div>
      )}

      {/* Images */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Captured images</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentImageViewer
            documentFrontUrl={verification.documentFrontImageUrl}
            documentBackUrl={verification.documentBackImageUrl}
            selfieUrl={verification.selfieImageUrl}
          />
        </CardContent>
      </Card>

      {/* OCR + face match */}
      <div className="grid grid-cols-2 gap-6">
        <OcrDataPanel ocr={verification.ocr} />
        <FaceMatchPanel faceMatch={verification.faceMatch} />
      </div>

      {/* Audit log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event log</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex justify-between gap-4 pb-2 border-b border-[#f1f5f9] last:border-b-0"
                >
                  <div>
                    <span className="font-medium">{e.eventType}</span>{' '}
                    <span className="text-xs text-muted-foreground">
                      ({e.actorType})
                    </span>
                    {Object.keys(e.metadata).length > 0 && (
                      <pre className="mt-1 text-xs text-muted-foreground">
                        {JSON.stringify(e.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      {reviewState && (
        <ManualReviewDialog
          verificationId={id}
          decision={reviewState}
          open={true}
          onClose={() => setReviewState(null)}
          onDone={fetchAll}
        />
      )}
      {retryOpen && (
        <RetryVerificationDialog
          verificationId={id}
          open={true}
          onClose={() => setRetryOpen(false)}
          onDone={fetchAll}
        />
      )}
    </div>
  );
}
