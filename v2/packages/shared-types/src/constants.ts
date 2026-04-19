// --- Auth ---
export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/auth';
export const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const ACCESS_TOKEN_EXPIRY_SECS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_EXPIRY_SECS = 7 * 24 * 60 * 60; // 7 days

// --- Password ---
export const BCRYPT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 8;

// --- Tenants ---
export const RESERVED_SLUGS = [
  'www',
  'admin',
  'portal',
  'api',
  'app',
  'mail',
  'blog',
  'docs',
  'help',
  'support',
  'status',
] as const;

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 50;
export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

// --- Pagination ---
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// --- Bonzah (shared — frontend + backend) ---
export const BONZAH_MIN_DRIVER_AGE = 21;
export const BONZAH_MAX_CHUNK_DAYS = 30;
export const BONZAH_BALANCE_POLL_INTERVAL_MS = 60_000;

export const COVERAGE_TIER_LABELS: Record<string, string> = {
  cdw: 'Collision Damage Waiver (CDW)',
  rcli: "Renter's Contingent Liability (RCLI)",
  sli: 'Supplemental Liability (SLI)',
  pai: 'Personal Accident (PAI)',
};

// --- Reminders (rule codes — single source of truth) ---
export const REMINDER_RULE_CODES = {
  BONZAH_LOW_BALANCE: 'BONZAH_LOW_BALANCE',
  ID_VERIFICATION_REVIEW_REQUIRED: 'ID_VERIFICATION_REVIEW_REQUIRED',
} as const;

export type ReminderRuleCode =
  (typeof REMINDER_RULE_CODES)[keyof typeof REMINDER_RULE_CODES];

// --- ID Verification (shared — frontend + backend) ---
// Platform defaults — tenants may override via tenants.face_match_auto_approve_pct,
// tenants.face_match_review_pct, tenants.min_ocr_confidence (all nullable).
export const ID_VERIFICATION_DEFAULT_AUTO_APPROVE_PCT = 90;
export const ID_VERIFICATION_DEFAULT_REVIEW_PCT = 70;
export const ID_VERIFICATION_DEFAULT_MIN_OCR_CONFIDENCE = 0.7;

export const ID_VERIFICATION_SESSION_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
export const ID_VERIFICATION_SIGNED_URL_TTL_SECS = 300; // 5 min
export const ID_VERIFICATION_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ID_VERIFICATION_STATUS_POLL_INTERVAL_MS = 3_000;

export const ID_VERIFICATION_ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type IdVerificationAcceptedMimeType =
  (typeof ID_VERIFICATION_ACCEPTED_MIME_TYPES)[number];

export const REQUIRED_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  driving_license: 'Driving License',
  passport: 'Passport',
  id_card: 'National ID Card',
};

export const BLOCKED_IDENTITY_TYPE_LABELS: Record<string, string> = {
  driving_license: 'Driving License',
  passport: 'Passport',
  id_card: 'National ID',
  email: 'Email',
};

// Doc types that require a back side capture (passport is front-only)
export const DOCUMENT_TYPES_WITH_BACK: readonly string[] = [
  'driving_license',
  'id_card',
];

// Capture steps — persisted on the verification row so mobile can resume
export const ID_VERIFICATION_CAPTURE_STEPS = [
  'document_front',
  'document_back',
  'selfie',
  'processing',
] as const;
export type IdVerificationCaptureStep =
  (typeof ID_VERIFICATION_CAPTURE_STEPS)[number];

// Event types emitted to id_verification_events audit log
export const ID_VERIFICATION_EVENT_TYPES = {
  SESSION_CREATED: 'session.created',
  SESSION_TOKEN_VALIDATED: 'session.token_validated',
  SESSION_RETRIED: 'session.retried',
  SESSION_CANCELLED: 'session.cancelled',
  SESSION_EXPIRED: 'session.expired',
  CAPTURE_STEP_SYNCED: 'capture.step_synced',
  CAPTURE_FILE_UPLOADED: 'capture.file_uploaded',
  CAPTURE_SUBMITTED: 'capture.submitted',
  PROCESSING_STARTED: 'processing.started',
  PROCESSING_OCR_COMPLETED: 'processing.ocr_completed',
  PROCESSING_FACE_MATCH_COMPLETED: 'processing.face_match_completed',
  PROCESSING_BLOCK_MATCHED: 'processing.block_matched',
  DECISION_AUTO_APPROVED: 'decision.auto_approved',
  DECISION_AUTO_REJECTED: 'decision.auto_rejected',
  DECISION_REVIEW_REQUIRED: 'decision.review_required',
  DECISION_MANUAL_APPROVED: 'decision.manual_approved',
  DECISION_MANUAL_REJECTED: 'decision.manual_rejected',
} as const;

export type IdVerificationEventType =
  (typeof ID_VERIFICATION_EVENT_TYPES)[keyof typeof ID_VERIFICATION_EVENT_TYPES];
