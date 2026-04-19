import type {
  IdVerificationStatus,
  IdVerificationDecisionSource,
  BlockedIdentityType,
  RequiredDocumentType,
} from './enums';
import type { IdVerificationCaptureStep } from './constants';

// --- Settings (tenant-scoped) ---

/**
 * Threshold fields are null when the tenant uses platform defaults.
 * Backend resolves per-request via `tenantValue ?? platformDefault`.
 */
export type IdVerificationSettingsResponse = {
  enabled: boolean;
  requiredDocumentType: RequiredDocumentType;
  faceMatchAutoApprovePct: number | null;
  faceMatchReviewPct: number | null;
  minOcrConfidence: number | null;
  // Resolved effective values (useful for the settings UI to show defaults)
  effectiveFaceMatchAutoApprovePct: number;
  effectiveFaceMatchReviewPct: number;
  effectiveMinOcrConfidence: number;
};

export type UpdateIdVerificationSettingsPayload = {
  enabled?: boolean;
  requiredDocumentType?: RequiredDocumentType;
  faceMatchAutoApprovePct?: number | null;
  faceMatchReviewPct?: number | null;
  minOcrConfidence?: number | null;
};

// --- Session creation (staff) ---

export type CreateSessionPayload = {
  customerId: string;
  // Optional override of tenant default for this single session
  requiredDocumentType?: RequiredDocumentType;
};

export type CreateSessionResponse = {
  verificationId: string;
  qrUrl: string;
  sessionExpiresAt: string; // ISO
};

// --- OCR + face match summaries ---

export type OcrResultSummary = {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null; // ISO date
  documentNumber: string | null;
  documentCountry: string | null;
  documentExpiryDate: string | null;
  documentDetectedType: string | null;
  confidence: number | null; // 0–1
};

export type FaceMatchSummary = {
  score: number | null; // 0–100
  autoApproveThreshold: number;
  reviewThreshold: number;
};

// --- Verification record (staff-facing) ---

/**
 * Signed image URLs are generated on read (expire in 5 min) — never store
 * S3 keys in the API response. Staff viewers re-fetch on page load.
 */
export type IdVerificationResponse = {
  id: string;
  tenantId: string;
  customerId: string;
  initiatedByUserId: string | null;
  status: IdVerificationStatus;
  requiredDocumentType: RequiredDocumentType;
  currentStep: IdVerificationCaptureStep | null;
  sessionExpiresAt: string;

  // Signed image URLs (short-lived), null until uploaded
  documentFrontImageUrl: string | null;
  documentBackImageUrl: string | null;
  selfieImageUrl: string | null;

  ocr: OcrResultSummary | null;
  faceMatch: FaceMatchSummary | null;

  decisionSource: IdVerificationDecisionSource | null;
  decidedAt: string | null;
  decidedByUserId: string | null;
  rejectionReason: string | null;
  manualReviewNotes: string | null;
  matchedBlockId: string | null;

  createdAt: string;
  updatedAt: string;
};

export type ListVerificationsQuery = {
  customerId?: string;
  status?: IdVerificationStatus;
  page?: number;
  limit?: number;
};

export type ListVerificationsResponse = {
  items: IdVerificationResponse[];
  total: number;
  page: number;
  limit: number;
};

// --- Events (audit log) ---

export type IdVerificationEventResponse = {
  id: string;
  verificationId: string;
  eventType: string;
  actorType: 'system' | 'staff' | 'customer';
  actorUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ListEventsResponse = {
  items: IdVerificationEventResponse[];
};

// --- Manual review (staff) ---

export type ManualReviewPayload = {
  decision: 'approve' | 'reject';
  reason: string;
};

export type RetryVerificationPayload = {
  reason: string;
};

// --- Public mobile session (QR-token auth) ---

export type PublicSessionResponse = {
  verificationId: string;
  tenantName: string;
  tenantLogoUrl: string | null;
  requiredDocumentType: RequiredDocumentType;
  currentStep: IdVerificationCaptureStep | null;
  status: IdVerificationStatus;
  documentRequiresBack: boolean;
  sessionExpiresAt: string;
};

export type SyncStepPayload = {
  step: IdVerificationCaptureStep;
};

export type UploadFileField = 'document_front' | 'document_back' | 'selfie';

export type UploadFileResponse = {
  field: UploadFileField;
  nextStep: IdVerificationCaptureStep | null;
};

export type SubmitCaptureResponse = {
  status: IdVerificationStatus;
};

// --- Blocked identities ---

export type BlockedIdentityResponse = {
  id: string;
  identityType: BlockedIdentityType;
  identityValue: string;
  reason: string;
  isActive: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ListBlockedIdentitiesQuery = {
  identityType?: BlockedIdentityType;
  isActive?: boolean;
};

export type ListBlockedIdentitiesResponse = {
  items: BlockedIdentityResponse[];
};

export type CreateBlockedIdentityPayload = {
  identityType: BlockedIdentityType;
  identityValue: string;
  reason: string;
};

export type UpdateBlockedIdentityPayload = {
  reason?: string;
  isActive?: boolean;
};
