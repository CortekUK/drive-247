'use client';

import type { FaceMatchSummary } from '@drive247/shared-types';
import { Card, CardContent, CardHeader, CardTitle } from '@drive247/ui';

interface Props {
  faceMatch: FaceMatchSummary | null;
}

/**
 * Visualizes the face-match score against the configured thresholds.
 * The colored bar segment marks the review band so staff can see where
 * the score landed.
 */
export function FaceMatchPanel({ faceMatch }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Face match</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!faceMatch ? (
          <p className="text-muted-foreground">
            Face match has not completed yet.
          </p>
        ) : faceMatch.score === null ? (
          <p className="text-muted-foreground">
            Face match could not be computed. Ask the customer to retake the
            selfie.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Similarity</span>
              <span
                className={`text-[24px] font-medium ${scoreColor(
                  faceMatch.score,
                  faceMatch,
                )}`}
              >
                {faceMatch.score.toFixed(1)}%
              </span>
            </div>
            <ThresholdBar
              score={faceMatch.score}
              reviewFloor={faceMatch.reviewThreshold}
              autoApprove={faceMatch.autoApproveThreshold}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Review floor: {faceMatch.reviewThreshold}%</span>
              <span>Auto-approve: {faceMatch.autoApproveThreshold}%</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function scoreColor(score: number, t: FaceMatchSummary): string {
  if (score >= t.autoApproveThreshold) return 'text-[#16a34a]';
  if (score >= t.reviewThreshold) return 'text-[#d97706]';
  return 'text-[#dc2626]';
}

function ThresholdBar({
  score,
  reviewFloor,
  autoApprove,
}: {
  score: number;
  reviewFloor: number;
  autoApprove: number;
}) {
  const pct = Math.max(0, Math.min(100, score));
  const reviewPct = Math.max(0, Math.min(100, reviewFloor));
  const approvePct = Math.max(0, Math.min(100, autoApprove));
  return (
    <div className="relative h-3 rounded-full bg-[#f1f5f9] overflow-hidden">
      {/* Reject band (0 → reviewFloor) */}
      <div
        className="absolute inset-y-0 left-0 bg-[#fecaca]"
        style={{ width: `${reviewPct}%` }}
      />
      {/* Review band (reviewFloor → autoApprove) */}
      <div
        className="absolute inset-y-0 bg-[#fed7aa]"
        style={{
          left: `${reviewPct}%`,
          width: `${approvePct - reviewPct}%`,
        }}
      />
      {/* Approve band (autoApprove → 100) */}
      <div
        className="absolute inset-y-0 right-0 bg-[#bbf7d0]"
        style={{ width: `${100 - approvePct}%` }}
      />
      {/* Score marker */}
      <div
        className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-[#080812]"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}
