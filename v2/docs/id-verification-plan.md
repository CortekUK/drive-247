# ID Verification — Phase 1 Plan (AI-Only)

> Port of V1's identity verification feature, rewritten for V2. **Veriff is removed** — AI path only (OpenAI Vision for OCR + AWS Rekognition for face match). Built on the V2 foundations (NestJS + Drizzle + drizzle-zod DTOs + TenantContextService + typed errors + small focused files). Portal-only for Phase 1 (staff-initiated); customer booking integration deferred until the booking app lands.

---

## ⚠ To Revisit (post-Phase 1, after client discussion)

- **Media retention policy.** Per user decision, V2 will **not** delete document/selfie images — they're stored indefinitely (same as V1). GDPR note: "indefinite storage of biometric + identity documents" without a defined retention period is a compliance risk in UK/EU. When the client is ready, add:
  - `media_retention_days` column on `tenants` (nullable, default = null = indefinite)
  - Scheduled BullMQ job that purges images (not records) past retention
  - Storage-cost monitoring dashboard
  - This will be a **non-breaking** additive change — no schema impact on existing records.

---

## 1. Scope

### In (Phase 1)
- Staff-initiated verification from portal (customer detail page)
- QR-code-based mobile capture flow on the customer's phone
- Multi-step capture: document front → document back (optional by doc type) → selfie
- File storage on AWS S3 via a new `StorageModule` (first consumer; reusable for future features)
- OCR via OpenAI Vision (`gpt-4o-mini` — extract name, DOB, doc number, doc country, expiry, type)
- Face match via AWS Rekognition `CompareFaces`
- Blocked-identities blacklist (tenant-scoped: license / passport / id_card / email)
- Automatic decision based on thresholds + block check (approved / review_required / rejected)
- **Staff manual review UI**: approve / reject / retry with mandatory reason + full audit trail
- **Retry flow**: staff requests fresh capture; new QR generated, old token invalidated
- **Tenant-configurable thresholds** (optional overrides on top of platform defaults)
- Tenant setting: required document type (`driving_license` / `passport` / `id_card`)
- Full event log (audit table) — every state transition recorded with actor
- In-app verification status on customer record
- Portal: customer-level Identity Verification tab + tenant-wide verifications list + settings page + blocked-identities management
- Public mobile page served from portal app under a `(public)` route group (no auth, QR token auth instead)

### Out (deferred)
| Deferred | Why |
|----------|-----|
| Booking-flow integration | `apps/booking` not yet in V2 — portal-only for now |
| Email / SMS notifications to customer | Notification infra not in V2 yet; stubs wired, activated when ready |
| Media retention / auto-delete | Per client decision — keep forever for now (see "To Revisit") |
| Liveness detection | Rekognition CompareFaces alone; add DetectFaces / AgeRange checks later |
| Per-tenant AWS / OpenAI keys | Platform-wide keys for Phase 1 (same as V1) |
| Address / residency verification | Out of scope; only ID identity |
| Duplicate-person detection | Phase 2 feature (match face across all verifications in a tenant) |
| Booking-time verification required toggle | Booking app not in V2 yet |
| Multi-instance S3 presign cache / Redis | Single-backend-instance assumption holds for Phase 1 |
| GDPR data-export endpoint | Separate compliance feature |

---

## 2. File Structure

### New

```
v2/
├── docs/
│   └── id-verification-plan.md                                      ← THIS FILE
│
├── packages/
│   ├── database/src/
│   │   ├── schema/
│   │   │   ├── id-verifications.ts                                  ← NEW
│   │   │   ├── id-verification-events.ts                            ← NEW (audit log)
│   │   │   └── blocked-identities.ts                                ← NEW
│   │   └── zod/
│   │       ├── id-verifications.ts                                  ← NEW
│   │       ├── id-verification-events.ts                            ← NEW
│   │       └── blocked-identities.ts                                ← NEW
│   │
│   ├── shared-types/src/
│   │   └── id-verification.types.ts                                 ← NEW
│   │
│   └── api-client/src/
│       └── id-verification.api.ts                                   ← NEW
│
└── apps/
    ├── backend/src/
    │   ├── common/
    │   │   ├── storage/                                             ← NEW (generic abstraction)
    │   │   │   ├── storage.module.ts
    │   │   │   ├── storage.service.ts                               (interface)
    │   │   │   ├── s3-storage.service.ts                            (implementation)
    │   │   │   ├── s3-storage.service.spec.ts
    │   │   │   └── types.ts
    │   │   └── decorators/
    │   │       └── qr-token-auth.decorator.ts                       ← NEW (marks public QR-auth routes)
    │   │
    │   ├── integrations/
    │   │   ├── aws/                                                 ← NEW
    │   │   │   ├── aws.module.ts
    │   │   │   ├── aws-config.util.ts                               (SDK v3 credential + region setup)
    │   │   │   ├── rekognition.client.ts                            (CompareFaces wrapper)
    │   │   │   ├── rekognition.client.spec.ts
    │   │   │   ├── s3.client.ts                                     (PutObject + GetSignedUrl wrappers)
    │   │   │   ├── constants.ts
    │   │   │   └── errors.ts
    │   │   │
    │   │   └── openai/
    │   │       ├── (existing files — unchanged)
    │   │       └── vision.client.ts                                 ← NEW (OCR method; shares OpenAI client)
    │   │
    │   ├── database/migrations/
    │   │   └── 0007_<drizzle-generated>.sql                         ← NEW
    │   │
    │   └── modules/
    │       └── id-verification/
    │           ├── id-verification.module.ts                        ← NEW
    │           ├── id-verification.controller.ts                    ← NEW (staff-facing, JWT auth)
    │           ├── id-verification-public.controller.ts             ← NEW (QR-token auth, public)
    │           ├── id-verification-blocks.controller.ts             ← NEW (blocked identities CRUD)
    │           ├── id-verification-settings.controller.ts           ← NEW (tenant thresholds + doc type)
    │           ├── id-verification.service.ts                       ← NEW (list / get / cancel)
    │           ├── id-verification-session.service.ts               ← NEW (create session, generate QR, validate token)
    │           ├── id-verification-capture.service.ts               ← NEW (upload files, sync step)
    │           ├── id-verification-processing.service.ts            ← NEW (orchestrate OCR + face match + decision)
    │           ├── id-verification-review.service.ts                ← NEW (manual approve/reject/retry)
    │           ├── id-verification-blocks.service.ts                ← NEW (blocklist CRUD + lookup)
    │           ├── id-verification-events.service.ts                ← NEW (append-only audit log writer)
    │           ├── id-verification.service.spec.ts                  ← NEW
    │           ├── id-verification-session.service.spec.ts          ← NEW
    │           ├── id-verification-processing.service.spec.ts       ← NEW
    │           ├── id-verification-review.service.spec.ts           ← NEW
    │           ├── id-verification-blocks.service.spec.ts           ← NEW
    │           ├── utils/
    │           │   ├── qr-token.util.ts                             ← NEW (generate / hash / compare)
    │           │   ├── qr-token.util.spec.ts                        ← NEW
    │           │   ├── decision.util.ts                             ← NEW (pure: score+blocks → status)
    │           │   └── decision.util.spec.ts                        ← NEW
    │           └── dto/
    │               ├── create-session.dto.ts
    │               ├── list-verifications.dto.ts
    │               ├── sync-step.dto.ts
    │               ├── upload-file.dto.ts
    │               ├── submit-capture.dto.ts
    │               ├── manual-review.dto.ts
    │               ├── retry-verification.dto.ts
    │               ├── create-block.dto.ts
    │               ├── list-blocks.dto.ts
    │               ├── update-block.dto.ts
    │               └── update-settings.dto.ts
    │
    └── frontend/portal/src/
        ├── app/
        │   ├── (public)/                                            ← NEW route group (no auth)
        │   │   └── verify/
        │   │       └── [token]/
        │   │           ├── page.tsx                                 ← NEW (mobile capture UI)
        │   │           └── layout.tsx                               ← NEW (minimal, no sidebar)
        │   │
        │   └── (dashboard)/
        │       ├── customers/[id]/page.tsx                          (MODIFIED — add IdentityVerificationTab)
        │       ├── verifications/page.tsx                           ← NEW (tenant-wide list)
        │       └── settings/
        │           ├── id-verification/page.tsx                     ← NEW (thresholds + required doc type)
        │           └── blocked-identities/page.tsx                  ← NEW
        │
        └── components/id-verification/                              ← NEW
            ├── identity-verification-tab.tsx                        (customer detail tab)
            ├── start-verification-dialog.tsx                        (create session + show QR)
            ├── verification-qr-modal.tsx                            (QR + realtime polling)
            ├── verification-list.tsx
            ├── verification-detail-card.tsx
            ├── verification-status-badge.tsx
            ├── manual-review-dialog.tsx                             (approve/reject with reason)
            ├── retry-verification-dialog.tsx
            ├── ocr-data-panel.tsx                                   (extracted fields readonly)
            ├── face-match-panel.tsx                                 (similarity + threshold bar)
            ├── document-image-viewer.tsx                            (signed-URL image, secure view)
            ├── blocked-identities-table.tsx
            ├── add-block-dialog.tsx
            ├── threshold-settings-form.tsx
            └── mobile/                                              (used only by /verify/[token])
                ├── capture-step-wrapper.tsx
                ├── document-capture-step.tsx                        (camera + upload fallback)
                ├── selfie-capture-step.tsx                          (front-camera only)
                ├── processing-step.tsx                              (spinner + poll)
                ├── result-step.tsx
                └── tenant-brand-header.tsx
```

### Modified

```
packages/database/src/
├── schema/
│   ├── enums.ts                     ← ADD 3 enums (id_verification_status,
│   │                                       id_verification_decision_source,
│   │                                       blocked_identity_type)
│   ├── tenants.ts                   ← ADD 4 columns (id_verification_enabled,
│   │                                       required_document_type,
│   │                                       face_match_auto_approve_pct,
│   │                                       face_match_review_pct)
│   ├── customers.ts                 ← ADD 2 columns (identity_verification_status,
│   │                                       latest_verification_id)  [denormalized pointer]
│   └── index.ts                     ← EXPORT new tables

packages/shared-types/src/
├── enums.ts                         ← ADD 3 TS enums
├── constants.ts                     ← ADD ID-verification constants
├── customers.types.ts               ← ADD identity verification fields
├── tenants.types.ts                 ← ADD verification settings fields
└── index.ts                         ← EXPORT new types

packages/api-client/src/
└── index.ts                         ← EXPORT createIdVerificationApi

apps/backend/src/
├── app.module.ts                    ← REGISTER AwsModule, StorageModule, IdVerificationModule
├── config/env.config.ts             ← ADD 5 env vars (AWS creds + region + S3 bucket)
└── modules/customers/customers.service.ts  ← include verification summary in customer detail

apps/frontend/portal/src/
├── lib/api.ts                       ← WIRE idVerificationApi
└── app/(dashboard)/layout.tsx       ← ADD "Verifications" to sidebar + nested settings entries
```

---

## 3. Database Schema

### 3.1 New enums — `packages/database/src/schema/enums.ts`

```ts
export const idVerificationStatusEnum = pgEnum('id_verification_status', [
  'initiated',         // session created, QR active, customer hasn't scanned yet
  'in_progress',       // customer started capture (first step synced)
  'processing',        // all uploads done, OCR + face match running
  'approved',          // auto or manual approval (see decision_source)
  'rejected',          // auto or manual rejection
  'review_required',   // face match in review band; awaits staff decision
  'expired',           // QR lifetime passed, never completed
  'cancelled',         // staff cancelled before completion
]);

export const idVerificationDecisionSourceEnum = pgEnum(
  'id_verification_decision_source',
  ['auto', 'manual'],
);

export const blockedIdentityTypeEnum = pgEnum('blocked_identity_type', [
  'driving_license',
  'passport',
  'id_card',
  'email',
]);
```

### 3.2 `tenants` additions

```
tenants (ALTER)
  + id_verification_enabled          BOOLEAN        NOT NULL DEFAULT false
  + required_document_type           TEXT           NOT NULL DEFAULT 'driving_license'
                                                    CHECK IN ('driving_license','passport','id_card')
  + face_match_auto_approve_pct      NUMERIC(5,2)   nullable   (overrides platform default 90)
  + face_match_review_pct            NUMERIC(5,2)   nullable   (overrides platform default 70)
  + min_ocr_confidence               NUMERIC(4,3)   nullable   (overrides platform default 0.7)
```

### 3.3 `customers` additions

```
customers (ALTER)
  + identity_verification_status     idVerificationStatusEnum  nullable  (null = never verified)
  + latest_verification_id           UUID FK  → id_verifications ON DELETE SET NULL   nullable
```

> These are denormalized pointers for fast customer-list rendering (no join required to show
> status badge). The authoritative record lives on `id_verifications`. Kept in sync on
> every terminal state transition (approved / rejected / expired / cancelled).

### 3.4 `id_verifications`

```
id_verifications
  id                          UUID            PK
  tenant_id                   UUID FK         → tenants ON DELETE CASCADE
  customer_id                 UUID FK         → customers ON DELETE CASCADE
  initiated_by_user_id        UUID FK         → users ON DELETE SET NULL  nullable  (staff who created session)

  -- Session / QR
  session_token_hash          TEXT            NOT NULL   (sha-256 of raw token; raw token only shown once)
  session_expires_at          TIMESTAMPTZ     NOT NULL
  current_step                TEXT            nullable   (document_front | document_back | selfie | processing)

  -- Document requirements snapshot (doc type at time of session — tenant can change later)
  required_document_type      TEXT            NOT NULL

  -- File references (S3 keys, not public URLs — signed on read)
  document_front_s3_key       TEXT            nullable
  document_back_s3_key        TEXT            nullable
  selfie_s3_key               TEXT            nullable

  -- OCR extracted data
  first_name                  TEXT            nullable
  last_name                   TEXT            nullable
  date_of_birth               DATE            nullable
  document_number             TEXT            nullable
  document_country            TEXT            nullable   (ISO-2)
  document_expiry_date        DATE            nullable
  document_detected_type      TEXT            nullable   (what OCR detected — may differ from required)
  ocr_confidence              NUMERIC(4,3)    nullable   (0–1, from OpenAI)
  ocr_raw                     JSONB           nullable   (full OCR response, for debugging)

  -- Face match
  face_match_score            NUMERIC(5,2)    nullable   (0–100, similarity from Rekognition)
  face_match_raw              JSONB           nullable   (full Rekognition response)

  -- Decision
  status                      idVerificationStatusEnum  NOT NULL DEFAULT 'initiated'
  decision_source             idVerificationDecisionSourceEnum  nullable  (set on terminal state)
  decided_at                  TIMESTAMPTZ     nullable
  decided_by_user_id          UUID FK         → users ON DELETE SET NULL  nullable  (null for auto)
  rejection_reason            TEXT            nullable
  manual_review_notes         TEXT            nullable

  -- Block detection snapshot (if matched a blocked identity at decision time)
  matched_block_id            UUID FK         → blocked_identities ON DELETE SET NULL  nullable

  created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now()
  updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT now()

  -- Constraints
  CHECK (session_expires_at > created_at)

  -- Indexes
  INDEX (tenant_id, customer_id)
  INDEX (tenant_id, status)
  INDEX (tenant_id, created_at DESC)
  UNIQUE (session_token_hash)
```

**Why hash the token?** If the DB is ever leaked, the raw QR tokens can't be replayed — same
pattern as password hashes. The raw token is only in the QR code + URL and is never stored.

### 3.5 `id_verification_events` (audit log, append-only)

```
id_verification_events
  id                     UUID        PK
  verification_id        UUID FK     → id_verifications ON DELETE CASCADE
  tenant_id              UUID FK     → tenants ON DELETE CASCADE   (for fast tenant-scoped querying)
  event_type             TEXT        NOT NULL
  -- event_types: 'session.created', 'session.token_validated', 'capture.step_synced',
  --              'capture.file_uploaded', 'capture.submitted',
  --              'processing.started', 'processing.ocr_completed',
  --              'processing.face_match_completed', 'processing.block_matched',
  --              'decision.auto_approved', 'decision.auto_rejected',
  --              'decision.review_required', 'decision.manual_approved',
  --              'decision.manual_rejected', 'session.retried',
  --              'session.cancelled', 'session.expired'
  actor_type             TEXT        NOT NULL      (system | staff | customer)
  actor_user_id          UUID FK     → users ON DELETE SET NULL  nullable
  metadata               JSONB       NOT NULL DEFAULT '{}'
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()

  INDEX (verification_id, created_at)
  INDEX (tenant_id, created_at DESC)
```

**No updates, no deletes** (enforced in service layer). Every state change appends an event.

### 3.6 `blocked_identities`

```
blocked_identities
  id                  UUID            PK
  tenant_id           UUID FK         → tenants ON DELETE CASCADE
  identity_type       blockedIdentityTypeEnum  NOT NULL
  identity_value      TEXT            NOT NULL     (normalized — lowercased email, trimmed doc number)
  reason              TEXT            NOT NULL
  is_active           BOOLEAN         NOT NULL DEFAULT true
  created_by_user_id  UUID FK         → users ON DELETE SET NULL  nullable
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()

  UNIQUE (tenant_id, identity_type, identity_value)
  INDEX (tenant_id, is_active)
```

---

## 4. Shared Constants & Types

### `packages/shared-types/src/constants.ts` additions

```ts
// ID verification
export const ID_VERIFICATION_DEFAULT_AUTO_APPROVE_PCT = 90;   // Rekognition ≥ 90 → approve
export const ID_VERIFICATION_DEFAULT_REVIEW_PCT = 70;         // 70–89 → review, <70 → reject
export const ID_VERIFICATION_DEFAULT_MIN_OCR_CONFIDENCE = 0.7;
export const ID_VERIFICATION_SESSION_TTL_MS = 3 * 60 * 60 * 1000;   // 3 hours
export const ID_VERIFICATION_SIGNED_URL_TTL_SECS = 300;             // 5 min for image viewing
export const ID_VERIFICATION_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ID_VERIFICATION_ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const REQUIRED_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  driving_license: 'Driving License',
  passport: 'Passport',
  id_card: 'National ID Card',
};

// Doc types that require a back side (passport is front-only)
export const DOCUMENT_TYPES_WITH_BACK: readonly string[] = ['driving_license', 'id_card'];
```

### `packages/shared-types/src/enums.ts` additions

```ts
export enum IdVerificationStatus {
  INITIATED = 'initiated',
  IN_PROGRESS = 'in_progress',
  PROCESSING = 'processing',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REVIEW_REQUIRED = 'review_required',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum IdVerificationDecisionSource {
  AUTO = 'auto',
  MANUAL = 'manual',
}

export enum BlockedIdentityType {
  DRIVING_LICENSE = 'driving_license',
  PASSPORT = 'passport',
  ID_CARD = 'id_card',
  EMAIL = 'email',
}

export enum RequiredDocumentType {
  DRIVING_LICENSE = 'driving_license',
  PASSPORT = 'passport',
  ID_CARD = 'id_card',
}
```

### `packages/shared-types/src/id-verification.types.ts`

Response shapes (`IdVerificationResponse`, `IdVerificationListResponse`, `IdVerificationEventResponse`, `BlockedIdentityResponse`, `StartVerificationResponse`, `PublicSessionResponse`, `OcrResultSummary`, `FaceMatchSummary`, `VerificationSettingsResponse`) — all derived from drizzle-zod shapes, with S3 keys hidden and only signed URLs exposed in public-facing shapes.

---

## 5. Environment Variables

```
# AWS (new)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=drive247-v2-documents

# OpenAI (already exists — reused for Vision OCR)
OPENAI_API_KEY=...
```

All validated in `config/env.config.ts` via Zod. No magic strings anywhere else.

---

## 6. Module Structure

### `IntegrationsAwsModule` (global)

- `S3Client` — `putObject(key, buffer, contentType)`, `getSignedUrl(key, expiresSecs)`, `deleteObject(key)`
- `RekognitionClient` — `compareFaces(sourceKey, targetKey)` → `{ similarity: number, faceCount: number, raw: any }`
- Both use AWS SDK v3 with credentials from `env.config`
- Errors: `AwsError`, `S3NotFoundError`, `RekognitionNoFaceDetectedError`

### `StorageModule` (global, wraps S3 with domain logic)

Abstracts S3 away from feature modules. Even though there's one backend today, the interface means future features (vehicle photos, PDFs, etc.) use `StorageService.upload(folder, buffer)` without knowing about S3.

- `StorageService.upload(folder: string, file: Buffer, mime: string): Promise<{ key: string }>`
- `StorageService.getSignedUrl(key: string): Promise<string>`
- `StorageService.delete(key: string): Promise<void>`

Tenant isolation: folder keys always prefixed with `tenants/{tenantId}/...` so a bug in code path can't leak across tenants at the path level.

### `OpenAI` module (existing — extended)

Add `VisionClient.extractDocumentData(imageUrl: string, backImageUrl?: string, documentType: string)` — wraps chat completion with a strict JSON schema prompt. Returns typed `OcrResult`.

### `IdVerificationModule`

Controllers:
- `IdVerificationController` — staff-facing, `@RequireTenant()` on every route
- `IdVerificationPublicController` — public, QR token auth (no tenant context from JWT; resolved from token)
- `IdVerificationBlocksController` — staff CRUD for blocked identities
- `IdVerificationSettingsController` — per-tenant thresholds & doc type

Services (each ≤200 lines):
- `IdVerificationSessionService` — create session, generate QR, hash token, validate raw token, cancel session, check/mark expired
- `IdVerificationCaptureService` — accept file upload (validates mime + size, uploads via StorageService), sync current step
- `IdVerificationProcessingService` — orchestrate OCR → face match → block check → decision. Wraps in DB transaction where appropriate
- `IdVerificationReviewService` — manual approve / reject / retry; idempotent on already-decided records
- `IdVerificationBlocksService` — blocklist CRUD + lookup helper used by ProcessingService
- `IdVerificationEventsService` — append-only audit log writer used by all other services
- `IdVerificationService` — read-only queries (list, get, tenant summary)

Utils:
- `qr-token.util.ts` — `generateToken() → { raw: string, hash: string }`, `hashToken(raw)` (SHA-256 base64url), `isExpired(expiresAt)`
- `decision.util.ts` — pure function: `(score, ocrConfidence, blockMatch, thresholds) → { status, reason }`. Zero IO, fully unit-tested.

---

## 7. API Endpoints

### Staff-facing (JWT + `@RequireTenant()`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/id-verification` | List verifications (filters: `customerId`, `status`, pagination) |
| GET | `/id-verification/:id` | Detail incl. OCR, face match, events, signed image URLs |
| GET | `/id-verification/:id/events` | Full audit log for one verification |
| POST | `/id-verification/sessions` | Create session for customer → returns `{ qrUrl, sessionId, expiresAt }` |
| POST | `/id-verification/:id/cancel` | Cancel an active session (initiated / in_progress / review_required) |
| POST | `/id-verification/:id/retry` | Generate new QR, mark old session as cancelled, append event |
| POST | `/id-verification/:id/review` | Manual approve/reject with reason (only valid for `review_required` or when overriding a terminal state — the latter is Phase 2) |

### Staff-facing — blocked identities

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/id-verification/blocks` | List tenant's blocked identities |
| POST | `/id-verification/blocks` | Add a block |
| PATCH | `/id-verification/blocks/:id` | Toggle `is_active` or edit reason |
| DELETE | `/id-verification/blocks/:id` | Remove (hard delete; the snapshot on verifications holds the history) |

### Staff-facing — settings

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/id-verification/settings` | Get tenant thresholds + enabled flag + required doc type |
| PATCH | `/id-verification/settings` | Update any of the four settings fields |

### Public (QR token auth via `@QrTokenAuth()` decorator + custom guard)

The guard reads `:token` path param, hashes it, looks up `id_verifications` by `session_token_hash`, checks not-expired and status in `[initiated, in_progress]`, and injects the verification row into the request for the controller.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/public/id-verification/sessions/:token` | Validate token, return tenant branding + required doc type + current step |
| POST | `/public/id-verification/sessions/:token/files` | Upload one image (field: `document_front` \| `document_back` \| `selfie`) — multipart |
| POST | `/public/id-verification/sessions/:token/step` | Sync `current_step` (persisted for mobile resume) |
| POST | `/public/id-verification/sessions/:token/submit` | All uploads done → kick off processing (async, returns 202) |

**Note:** the public controller lives on the main backend. No separate service. It's "public" only in the sense of not requiring a JWT — the token acts as the credential.

---

## 8. Business Rules (The Bible — like Bonzah's 21)

1. **Tenant-scoped everywhere.** Every query in every service filters by `tenantId` from `TenantContextService.requireTenantId()`. Public controller resolves tenant from the session row itself.
2. **QR token is cryptographically random** (32-byte base64url, `crypto.randomBytes`).
3. **Raw token is never persisted.** Only the SHA-256 hash is stored. Token in URL + QR only.
4. **QR tokens expire** at `session_expires_at` (default 3 h, platform constant).
5. **Token is single-use at the final step.** Once `submit` is called and processing starts, the token is treated as consumed — subsequent hits to `/files` or `/submit` reject with `SessionAlreadySubmittedError`.
6. **One active session per customer** at a time. Creating a new session auto-cancels any existing `initiated` / `in_progress` session (with event logged).
7. **File uploads** validated: mime type in `ID_VERIFICATION_ACCEPTED_MIME_TYPES`, size ≤ `MAX_FILE_SIZE_BYTES`. Oversized or wrong mime → 400 before upload to S3.
8. **S3 keys tenant-prefixed:** `tenants/{tenantId}/id-verification/{verificationId}/{field}.{ext}`. Never generatable from an unauthenticated request.
9. **Signed URLs short-lived** (5 min default, platform constant). Staff image viewer re-fetches on page load.
10. **OCR confidence enforced.** If `ocr_confidence < min_ocr_confidence` (tenant override if set, else platform default 0.7), the decision is `review_required` regardless of face match score. Logged with reason. Resolved per-request (same pattern as face match thresholds — never hardcoded in decision code).
11. **Block check runs before auto-approval.** If any of `document_number`, `email`, or detected-type-specific value matches an active block, status → `rejected` with `matched_block_id` set. Blocks are matched case-insensitively and trim-normalized.
12. **Face match thresholds resolved per-request.** Tenant overrides from `tenants.face_match_auto_approve_pct` / `face_match_review_pct` if set, else platform constants. Never hardcoded in decision code.
13. **Decision logic is a pure function** (`decision.util.ts`). Given `(score, ocrConfidence, blockMatch, thresholds)` → `(status, reason)`. No DB, no side effects. Unit-tested exhaustively.
14. **Retry generates a fresh QR.** Old session marked `cancelled`. New row is **not** created — same `id_verifications` record gets a new `session_token_hash` + `session_expires_at` + cleared S3 keys + reset to `initiated`. Old S3 files deleted. Events logged for both the cancellation and the retry.
15. **Manual review requires a reason.** The DTO rejects empty strings. Reason is stored in `manual_review_notes`. `decided_by_user_id` = current user. `decision_source = manual`.
16. **Manual review is only allowed on `review_required`.** Overriding auto-approved or auto-rejected records is a Phase 2 feature requiring a separate "override" event type and elevated permission.
17. **Staff cannot edit OCR data.** Extracted fields are immutable once processing completes. Source of truth is the document. Corrections happen via retry + new capture.
18. **Every state transition appends an event** to `id_verification_events`. Services use `IdVerificationEventsService.append(...)` — no direct inserts elsewhere.
19. **External API calls go through dedicated clients.** `RekognitionClient`, `S3Client`, `VisionClient`. No inline `fetch` or SDK calls in services. (V2 rule #9.)
20. **Typed errors map to HTTP.** `SessionExpiredError` → 410 Gone, `SessionAlreadySubmittedError` → 409 Conflict, `BlockedIdentityMatchedError` → logged, returned as part of rejection, `RekognitionNoFaceDetectedError` → 422 with guidance to retake selfie.
21. **DTOs from drizzle-zod.** All DTOs start with `.pick()` from an auto-generated insert/select schema, then `.extend()` or `.refine()`. No manual duplication of column shapes.
22. **Denormalized customer pointers kept in sync.** Any terminal-state transition updates `customers.identity_verification_status` and `latest_verification_id` within the same DB transaction as the verification update.
23. **No retention.** Images and records kept forever in Phase 1. (See "⚠ To Revisit".)
24. **Files small.** Services ≤ 200 lines, utils ≤ 100 lines, tests co-located as `.spec.ts`.
25. **`review_required` auto-creates a reminder.** `ProcessingService` calls `RemindersService.upsert` with rule_code `ID_VERIFICATION_REVIEW_REQUIRED`, severity `warning`, object_type `id_verification`, object_id = verification id. `ReviewService` calls `RemindersService.resolve` on terminal transitions (approve / reject / retry). Prevents the "nobody saw the review queue" failure mode.

---

## 9. End-to-End Flows

### 9.1 Flow A — Happy path (staff-initiated, auto-approved)

```
1. Staff opens customer detail page in portal
   → clicks "Start ID Verification"

2. Portal POST /id-verification/sessions { customerId, requiredDocumentType? }
   ← { verificationId, qrUrl: "https://portal.drive-247.com/verify/<token>", expiresAt }
   → Service: generates raw token + hash; inserts id_verifications (status=initiated);
     appends event 'session.created'; if customer has active session, cancels it first.

3. Portal shows QR modal; polling starts on GET /id-verification/:id every 3s

4. Customer scans QR on phone → /verify/<token> loads
   → GET /public/id-verification/sessions/:token
     → Guard: hash token, look up row, check not-expired, check status in [initiated, in_progress]
   ← { tenantBrand, requiredDocType, currentStep }
   → Service: appends event 'session.token_validated'

5. Step 1: Document front
   → POST /public/.../files { field: 'document_front', image: multipart }
     → validate mime+size → StorageService.upload('id-verification/<id>', buffer, mime)
     → update id_verifications.document_front_s3_key, current_step='document_back'
     → append event 'capture.file_uploaded' { field: 'document_front' }

6. Step 2: Document back (if required by doc type — skip for passport)
   → same as above with field: 'document_back'

7. Step 3: Selfie
   → same with field: 'selfie'; current_step='processing'

8. POST /public/.../submit
   → ProcessingService.process(verificationId) [queued in BullMQ, returns 202]
   → status='processing'; append event 'capture.submitted'

9. ProcessingService execution:
   a. Generate signed URLs for the three S3 keys
   b. VisionClient.extractDocumentData(frontUrl, backUrl, requiredDocType)
      → persist OCR fields + ocr_raw; append event 'processing.ocr_completed'
   c. RekognitionClient.compareFaces(frontKey, selfieKey)
      → persist score + raw; append event 'processing.face_match_completed'
   d. BlocksService.findMatch(tenantId, ocrFields)
      → if match: append event 'processing.block_matched' { blockId }
   e. DecisionUtil.decide({ score, ocrConfidence, blockMatch, thresholds })
      → { status: 'approved' | 'rejected' | 'review_required', reason? }
   f. DB transaction:
      - UPDATE id_verifications SET status, decision_source='auto', decided_at=now(),
        rejection_reason, matched_block_id
      - UPDATE customers SET identity_verification_status, latest_verification_id
      - INSERT id_verification_events (decision.auto_approved | .auto_rejected | .review_required)

10. Mobile page polls GET /public/.../<token> → sees terminal status → shows result screen
    (Note: after submit, the guard allows reads through processing+terminal states
     but rejects mutation attempts.)

11. Staff portal polling picks up the new status → toast + tab refresh
```

### 9.2 Flow B — Review required → manual approve

```
Steps 1–9 as above. Step 9(e) returns status='review_required' (face match 70–89%).

10. Staff sees "Review Required" badge in customer's verification list
11. Opens verification detail → sees OCR panel + face match panel showing 78% similarity
12. Clicks "Approve" → dialog → staff enters reason: "Photo quality low but identity clearly matches based on OCR data"
13. POST /id-verification/:id/review { decision: 'approve', reason }
    → ReviewService validates status === 'review_required'
    → DB transaction:
      - UPDATE id_verifications SET status='approved', decision_source='manual',
        decided_by_user_id, decided_at, manual_review_notes
      - UPDATE customers SET identity_verification_status='approved'
      - INSERT event 'decision.manual_approved'
14. Staff gets success toast; customer record now shows approved
```

### 9.3 Flow C — Retry (bad capture)

```
1. Customer submitted blurry photos; result = review_required with ocr_confidence = 0.45
2. Staff opens detail, sees poor OCR; clicks "Request Retry"
3. Dialog confirms with reason: "Document photo too blurry — please retake in better light"
4. POST /id-verification/:id/retry { reason }
   → ReviewService:
     - Delete old S3 files (StorageService.delete x3)
     - Generate new token + hash
     - UPDATE id_verifications SET
         session_token_hash, session_expires_at=now()+3h, current_step=null,
         status='initiated', document_front_s3_key=null, document_back_s3_key=null,
         selfie_s3_key=null, first_name=null, ... (all OCR cleared),
         face_match_score=null, face_match_raw=null, ocr_raw=null
     - INSERT event 'session.retried' { reason, previousTokenHash }
5. Fresh QR returned → staff shows to customer → flow restarts from step 4 of Flow A
```

### 9.4 Flow D — Blocked identity detected

```
1. Customer completes capture
2. OCR extracts document_number = "D1234567"
3. BlocksService.findMatch finds active block for this tenant:
   { type: 'driving_license', value: 'D1234567', reason: 'Outstanding damage fees from prev rental' }
4. Decision → status='rejected', matched_block_id set, rejection_reason auto-populated
   from block reason
5. Event 'processing.block_matched' + 'decision.auto_rejected' appended
6. customers.identity_verification_status='rejected'; customer record flagged in portal
7. (Phase 2) Admin notification emitted via ReminderService
```

### 9.5 Flow E — Session expired

```
1. Customer never scans QR
2. 3 hours later, staff views verification → GET returns row with expires_at in the past
3. On any read, SessionService lazily marks status='expired' if past expiry and status was
   [initiated, in_progress], appends event 'session.expired'
4. Staff can start a new session (no retry flow needed — same as initial create)

Alternative: Phase 2 adds a BullMQ cron that sweeps expired sessions nightly for consistency.
```

---

## 10. Frontend — Portal

### Staff-facing pages

- **`/customers/[id]` (modified)** — add `<IdentityVerificationTab />`
  - Shows latest verification status + history
  - "Start Verification" button → `StartVerificationDialog`
  - Clicking a historical row opens `<VerificationDetailCard />` modal

- **`/verifications`** (new) — tenant-wide list
  - Filters: status, date range, customer search
  - Table: Customer | Status | Doc Type | Score | Initiated By | Date | Actions

- **`/settings/id-verification`** (new) — thresholds + required doc type + enabled toggle
  - `<ThresholdSettingsForm />` with sliders for auto-approve % and review %; validates `auto_approve > review`

- **`/settings/blocked-identities`** (new) — blocklist CRUD

### Mobile-facing page

- **`/verify/[token]`** (new, under `(public)` route group — no auth wrapper)
  - Token-based session fetch; shows tenant logo + name
  - Stepper: Document Front → Document Back → Selfie → Processing → Result
  - Camera capture via `getUserMedia` (front camera for selfie, rear for document)
  - Fallback file-input if camera permission denied
  - Image preview + retake before upload
  - Polls own status every 3 s while `processing`

### Components (all in `components/id-verification/`)

(See "New" file list in section 2.)

Shared style notes:
- Status badge colors: `approved` green, `rejected` red, `review_required` amber, `processing` blue, `initiated` / `in_progress` gray, `expired` / `cancelled` muted
- Face match panel has a threshold bar visualizing where the score lands between review and auto-approve cutoffs
- OCR panel is read-only with field labels matching document terminology
- Signed URLs for images are fetched server-side on page load, never cached in React state past 5 min

---

## 11. Security & Privacy Notes (beyond rules)

- **QR token entropy:** 32 random bytes = 256 bits. Brute-force impractical.
- **Token hash comparison** is constant-time (`timingSafeEqual`).
- **S3 bucket must be private.** All access via signed URLs. Bucket policy denies public reads.
- **Multipart upload size validated** at Express body parser level before reaching handler (set `limits.fileSize`).
- **Face match raw data** (Rekognition response) is stored but never exposed to clients — it can contain face bounding boxes and landmark coordinates that leak structure.
- **OCR raw** similarly never exposed to clients — contains the full prompt completion that could include hallucinations.
- **No retention** (per user) — flagged in "To Revisit" section. Add compliance footnote when ready.
- **Tenant isolation testing:** cross-tenant read/write tests are mandatory before merge. One test per service method.

---

## 12. Testing Plan

### Unit tests (colocated `.spec.ts`)

- `qr-token.util.spec.ts` — generate uniqueness, hash determinism, expiry boolean
- `decision.util.spec.ts` — every combination: (block match, high score, low score, mid score, low OCR) × thresholds
- `id-verification-session.service.spec.ts` — session creation, auto-cancellation of old session, retry, expiration, invalid token, already-consumed
- `id-verification-processing.service.spec.ts` — mocked OCR + mocked Rekognition + mocked blocks; verify DB transaction boundaries, event emission, denormalized customer update
- `id-verification-review.service.spec.ts` — approve/reject gates (only `review_required`), reason required, retry flow
- `id-verification-blocks.service.spec.ts` — lookup case-insensitivity + trim, tenant isolation
- `s3-storage.service.spec.ts` — key prefixing includes tenantId; signed URL expiry set correctly
- `rekognition.client.spec.ts` — "no face detected" error mapping; multi-face handling

### Integration tests

- Full flow against mocked AWS + mocked OpenAI: happy path, review path, rejected path, retry path
- Cross-tenant isolation: verify tenant A cannot read / cancel / review tenant B's verification (must 404)

### Manual smoke tests (live AWS sandbox)

1. Create session → QR renders
2. Scan on phone → mobile page renders with correct tenant brand
3. Capture three images → uploads succeed
4. Submit → processing completes → result visible on both mobile and portal
5. Retry flow clears old files from S3 (verify with `aws s3 ls`)
6. Cancel flow marks status correctly
7. Blocked identity match: add block → run verification → auto-reject with correct reason

---

## 13. Implementation Order

1. **Schema + migration** — enums, `id_verifications`, `id_verification_events`, `blocked_identities`, tenant + customer additions → generate migration → run on dev DB
2. **Shared types + constants** — enums, types, constants in `@drive247/shared-types`
3. **AwsModule + StorageModule** — S3Client + RekognitionClient + StorageService; unit tests with localstack or mocked SDK
4. **OpenAI VisionClient** — extend existing module with `extractDocumentData`; unit test with fixture response
5. **Blocks service + controller** — CRUD + lookup helper (no verification dependency yet)
6. **SessionService** — create/cancel/retry/validate, event logging
7. **CaptureService + public controller** — token guard, file upload, step sync
8. **ProcessingService + decision util** — the heart; OCR → face match → blocks → decision; DB transactions
9. **ReviewService** — manual approve/reject
10. **Staff controller** — list/detail/events endpoints
11. **Settings controller** — thresholds + required doc type CRUD
12. **api-client package** — typed API methods for frontend
13. **Portal: staff UI** — customer detail tab, verification list, settings, blocks
14. **Portal: mobile UI** — public route group, capture pages, camera component
15. **Live sandbox smoke test** — end-to-end on real AWS
16. **Cross-tenant isolation tests** — gate for merge

---

## 14. Decisions Locked In (previously open questions)

- **Required doc type: tenant-level only.** Staff picks from the tenant-configured allowed type when starting a session. Per-customer override deferred to Phase 2 as a nullable column on `customers`.
- **`review_required` auto-creates a reminder.** Encoded as rule #25.
- **All three thresholds follow the same pattern:** platform default + optional nullable tenant override. Resolved per-request in the decision util. Exposed together in `ThresholdSettingsForm`.
  - Face match auto-approve: default 90, override `tenants.face_match_auto_approve_pct`
  - Face match review floor: default 70, override `tenants.face_match_review_pct`
  - Min OCR confidence: default 0.7, override `tenants.min_ocr_confidence`

## 15. Phase 2 Ideas (captured for future reference)

- Duplicate-person detection (face-match across all tenant verifications)
- Override terminal states (requires elevated permission + separate event type)
- Media retention (see "⚠ To Revisit" at top of doc)
- Email / SMS notifications to customer on result
- Booking-flow integration once `apps/booking` v2 lands
- Liveness detection (Rekognition DetectFaces quality checks)
- Per-customer doc type override
- Scheduled BullMQ cron to sweep expired sessions nightly

---

**End of plan.**
