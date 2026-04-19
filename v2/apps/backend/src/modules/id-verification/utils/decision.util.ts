import {
  ID_VERIFICATION_DEFAULT_AUTO_APPROVE_PCT,
  ID_VERIFICATION_DEFAULT_MIN_OCR_CONFIDENCE,
  ID_VERIFICATION_DEFAULT_REVIEW_PCT,
  IdVerificationStatus,
} from '@drive247/shared-types';

/**
 * Resolved per-request thresholds. Backend combines platform defaults
 * with optional per-tenant overrides — the decision function consumes
 * the already-resolved values, not raw tenant settings.
 */
export interface DecisionThresholds {
  autoApprovePct: number; // e.g. 90
  reviewPct: number; // e.g. 70
  minOcrConfidence: number; // e.g. 0.7
}

export interface DecisionInput {
  /** Face match similarity 0–100. Null = face match couldn't be computed. */
  faceMatchScore: number | null;
  /** OCR self-reported confidence 0–1. Null = OCR unavailable. */
  ocrConfidence: number | null;
  /** True if any extracted identifier matches an active block. */
  blockMatch: boolean;
  thresholds: DecisionThresholds;
}

export interface DecisionOutput {
  status:
    | IdVerificationStatus.APPROVED
    | IdVerificationStatus.REJECTED
    | IdVerificationStatus.REVIEW_REQUIRED;
  /** Short, auditable reason for the decision. */
  reason: string;
}

/**
 * Pure decision function. No IO, no side effects — fully unit-tested.
 *
 * Priority order:
 *   1. Block match → immediate REJECTED (rule #11). Never overridden by a
 *      high face-match score.
 *   2. Missing OCR or below-threshold confidence → REVIEW_REQUIRED
 *      (even if face match is perfect). Reason: we can't trust the
 *      extracted identifiers.
 *   3. Missing face match score → REVIEW_REQUIRED.
 *   4. score >= autoApprovePct    → APPROVED
 *   5. score >= reviewPct         → REVIEW_REQUIRED
 *   6. score <  reviewPct         → REJECTED
 */
export function decide(input: DecisionInput): DecisionOutput {
  if (input.blockMatch) {
    return {
      status: IdVerificationStatus.REJECTED,
      reason: 'Identifier matches an active block on this tenant',
    };
  }

  if (
    input.ocrConfidence === null ||
    input.ocrConfidence < input.thresholds.minOcrConfidence
  ) {
    return {
      status: IdVerificationStatus.REVIEW_REQUIRED,
      reason:
        input.ocrConfidence === null
          ? 'OCR could not read the document'
          : `OCR confidence ${formatPct(
              input.ocrConfidence * 100,
            )} is below minimum ${formatPct(
              input.thresholds.minOcrConfidence * 100,
            )}`,
    };
  }

  if (input.faceMatchScore === null) {
    return {
      status: IdVerificationStatus.REVIEW_REQUIRED,
      reason: 'Face match could not be computed',
    };
  }

  if (input.faceMatchScore >= input.thresholds.autoApprovePct) {
    return {
      status: IdVerificationStatus.APPROVED,
      reason: `Face match ${formatPct(
        input.faceMatchScore,
      )} >= auto-approve ${formatPct(input.thresholds.autoApprovePct)}`,
    };
  }

  if (input.faceMatchScore >= input.thresholds.reviewPct) {
    return {
      status: IdVerificationStatus.REVIEW_REQUIRED,
      reason: `Face match ${formatPct(
        input.faceMatchScore,
      )} in review band (${formatPct(input.thresholds.reviewPct)}-${formatPct(
        input.thresholds.autoApprovePct,
      )})`,
    };
  }

  return {
    status: IdVerificationStatus.REJECTED,
    reason: `Face match ${formatPct(
      input.faceMatchScore,
    )} below review floor ${formatPct(input.thresholds.reviewPct)}`,
  };
}

/**
 * Resolve effective thresholds by combining platform defaults with
 * optional tenant overrides. Called by ProcessingService + returned to
 * the settings API so the UI can show "(default: 90)" hints.
 */
export function resolveThresholds(overrides: {
  autoApprovePct: number | null | undefined;
  reviewPct: number | null | undefined;
  minOcrConfidence: number | null | undefined;
}): DecisionThresholds {
  return {
    autoApprovePct:
      overrides.autoApprovePct ?? ID_VERIFICATION_DEFAULT_AUTO_APPROVE_PCT,
    reviewPct: overrides.reviewPct ?? ID_VERIFICATION_DEFAULT_REVIEW_PCT,
    minOcrConfidence:
      overrides.minOcrConfidence ?? ID_VERIFICATION_DEFAULT_MIN_OCR_CONFIDENCE,
  };
}

function formatPct(v: number): string {
  return `${Math.round(v * 10) / 10}%`;
}
