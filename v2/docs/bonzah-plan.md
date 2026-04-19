# Bonzah Integration — Phase 1 Plan (Full Integration)

> Full V1 parity. Built as a solid foundation because multiple future features (extensions, cancellations, customer self-booking) will depend on the same Bonzah client surface. **Follows every V2 rule strictly** — single source of truth, small files, constants in shared-types, DTOs from drizzle-zod shapes, `@RequireTenant()` + `ParseUUIDPipe` everywhere, no magic numbers, validation at the boundary, tests alongside implementation.

---

## 1. Scope

### In (Phase 1)
- Per-tenant credentials (encrypted at rest, AES-256-GCM)
- Test mode (platform shared creds) + Live mode (tenant's own creds)
- Auth + token caching (per-username, 14 min TTL, 1 min safety buffer)
- `/premiumCalc` via real Bonzah API (no hardcoded rates)
- Quote creation with **30-day chunking** (Bonzah max policy duration) + `chain_id` linkage
- Payment confirmation with balance check + `insufficient_balance` status
- Policy retrieval + view
- PDF download (proxied through backend; auth token never exposed to client)
- CD balance check (broker + allocated)
- Low-balance alerts → reminders + in-app notifications
- Vehicle eligibility check via OpenAI (restricted brand/model list)
- Retry-pending policies UI + endpoint
- Portal Settings → Bonzah page
- Dashboard balance widget
- Per-rental Insurance selector + viewer
- Generic `reminders` module (Bonzah is the first consumer; designed for reuse)

### Out (deferred)
| Deferred | Why |
|----------|-----|
| Booking app (customer self-serve) | `apps/booking` not yet in V2 |
| Extensions (add more days to active policy) | Extensions feature hasn't landed |
| Cancellation endorsements | Depends on cancel-rental-refund work |
| Date-change / name-change endorsements | Lower-value edge case |
| Email notifications for alerts | Notifications module not in V2 yet (in-app notifications only for Phase 1) |
| PDF persistence / S3 storage | No storage layer yet — download is on-demand proxy |
| Multi-instance token cache (Redis) | Single-backend-instance assumption holds for local dev |
| Encryption key rotation | Phase 2 infrastructure concern |
| Vehicle-eligibility list stored in DB | Phase 1 hardcoded in constants; move to DB later |
| Multi-currency premium display | Premium stored as-returned by Bonzah (USD); UI labels it |

---

## 2. File Structure

### New

```
v2/
├── docs/
│   └── bonzah-plan.md                                             ← THIS FILE
│
├── packages/
│   ├── database/src/
│   │   ├── schema/
│   │   │   ├── bonzah-insurance-policies.ts                       ← NEW
│   │   │   ├── reminders.ts                                       ← NEW
│   │   │   └── reminder-configs.ts                                ← NEW
│   │   └── zod/
│   │       ├── bonzah-insurance-policies.ts                       ← NEW
│   │       ├── reminders.ts                                       ← NEW
│   │       └── reminder-configs.ts                                ← NEW
│   │
│   ├── shared-types/src/
│   │   ├── bonzah.types.ts                                        ← NEW
│   │   └── reminders.types.ts                                     ← NEW
│   │
│   └── api-client/src/
│       ├── bonzah.api.ts                                          ← NEW
│       └── reminders.api.ts                                       ← NEW
│
└── apps/
    ├── backend/src/
    │   ├── common/utils/
    │   │   ├── crypto.util.ts                                     ← NEW (AES-256-GCM)
    │   │   └── crypto.util.spec.ts                                ← NEW
    │   │
    │   ├── integrations/
    │   │   ├── bonzah/
    │   │   │   ├── bonzah.module.ts                               ← NEW
    │   │   │   ├── bonzah-api.client.ts                           ← NEW (low-level fetch)
    │   │   │   ├── bonzah-api.client.spec.ts                      ← NEW
    │   │   │   ├── bonzah-token-cache.service.ts                  ← NEW
    │   │   │   ├── bonzah-token-cache.service.spec.ts             ← NEW
    │   │   │   ├── bonzah-credentials.service.ts                  ← NEW (encrypt/decrypt + tenant load)
    │   │   │   ├── bonzah-credentials.service.spec.ts             ← NEW
    │   │   │   ├── constants.ts                                   ← NEW (endpoints, TTLs, restricted vehicles)
    │   │   │   ├── types.ts                                       ← NEW (Bonzah API shapes, BE-only)
    │   │   │   ├── errors.ts                                      ← NEW (typed errors)
    │   │   │   └── utils/
    │   │   │       ├── chunk.util.ts                              ← NEW (pure)
    │   │   │       ├── chunk.util.spec.ts                         ← NEW
    │   │   │       ├── date.util.ts                               ← NEW (MM/DD/YYYY format, PDT validation)
    │   │   │       └── date.util.spec.ts                          ← NEW
    │   │   │
    │   │   └── openai/
    │   │       ├── openai.module.ts                               ← NEW
    │   │       ├── openai.client.ts                               ← NEW
    │   │       └── constants.ts                                   ← NEW
    │   │
    │   ├── database/migrations/
    │   │   └── 0006_<drizzle-generated>.sql                       ← NEW (auto-gen)
    │   │
    │   └── modules/
    │       ├── bonzah/
    │       │   ├── bonzah.module.ts                               ← NEW
    │       │   ├── bonzah.controller.ts                           ← NEW (settings/balance/eligibility)
    │       │   ├── bonzah.service.ts                              ← NEW
    │       │   ├── bonzah.service.spec.ts                         ← NEW
    │       │   ├── bonzah-policies.controller.ts                  ← NEW (policy CRUD + PDF)
    │       │   ├── bonzah-quote.service.ts                        ← NEW
    │       │   ├── bonzah-quote.service.spec.ts                   ← NEW
    │       │   ├── bonzah-payment.service.ts                      ← NEW
    │       │   ├── bonzah-payment.service.spec.ts                 ← NEW
    │       │   ├── bonzah-policy.service.ts                       ← NEW (read + PDF)
    │       │   ├── bonzah-premium.service.ts                      ← NEW
    │       │   ├── bonzah-eligibility.service.ts                  ← NEW (OpenAI wrapper + cache)
    │       │   └── dto/
    │       │       ├── verify-credentials.dto.ts                  ← NEW
    │       │       ├── update-bonzah-settings.dto.ts              ← NEW
    │       │       ├── update-alert-config.dto.ts                 ← NEW
    │       │       ├── calculate-premium.dto.ts                   ← NEW
    │       │       ├── check-eligibility.dto.ts                   ← NEW
    │       │       ├── create-quote.dto.ts                        ← NEW
    │       │       ├── confirm-payment.dto.ts                     ← NEW
    │       │       ├── download-pdf.dto.ts                        ← NEW
    │       │       └── list-policies.dto.ts                       ← NEW
    │       │
    │       └── reminders/
    │           ├── reminders.module.ts                            ← NEW
    │           ├── reminders.controller.ts                        ← NEW
    │           ├── reminders.service.ts                           ← NEW
    │           └── dto/
    │               ├── list-reminders.dto.ts                      ← NEW
    │               └── update-reminder-config.dto.ts              ← NEW
    │
    └── frontend/portal/src/
        ├── app/(dashboard)/
        │   ├── page.tsx                                           (MODIFIED — dashboard balance widget)
        │   ├── rentals/[id]/page.tsx                              (MODIFIED — insurance section)
        │   └── settings/
        │       └── bonzah/page.tsx                                ← NEW
        │
        └── components/bonzah/                                     ← NEW
            ├── balance-card.tsx
            ├── credentials-form.tsx
            ├── mode-badge.tsx
            ├── brochure-url-form.tsx
            ├── alert-config-form.tsx
            ├── pending-policies-card.tsx
            ├── dashboard-balance-widget.tsx
            ├── insurance-selector-dialog.tsx
            ├── coverage-tiles.tsx
            ├── renter-details-form.tsx
            ├── premium-breakdown.tsx
            ├── policy-viewer-card.tsx
            ├── policy-status-badge.tsx
            └── pdf-download-button.tsx
```

### Modified

```
packages/database/src/
├── schema/
│   ├── enums.ts               ← ADD 5 enums (bonzahMode, bonzahPolicyStatus, insuranceStatus,
│   │                                 reminderSeverity, coverageTierCode)
│   ├── tenants.ts             ← ADD 5 columns (integration_bonzah, bonzah_mode,
│   │                                 bonzah_username, bonzah_password_encrypted, bonzah_brochure_url)
│   ├── rentals.ts             ← ADD 3 columns (insurance_premium, bonzah_policy_id, insurance_status)
│   └── index.ts               ← EXPORT new tables

packages/shared-types/src/
├── enums.ts                   ← ADD 5 TS enums
├── constants.ts               ← ADD Bonzah-facing constants (tier codes, min age, rule codes)
├── tenants.types.ts           ← ADD bonzah fields to detail
├── rentals.types.ts           ← ADD insurance summary
└── index.ts                   ← EXPORT new types

packages/api-client/src/
└── index.ts                   ← EXPORT createBonzahApi, createRemindersApi

apps/backend/src/
├── app.module.ts              ← REGISTER BonzahIntegrationModule, OpenAIModule,
│                                          BonzahModule, RemindersModule
├── config/env.config.ts       ← ADD 6 env vars (validated)
└── modules/
    ├── rentals/rentals.service.ts        ← include insurance summary in rental detail
    └── tenants/tenant-settings.controller.ts  ← ADD GET/PATCH /tenant-settings/bonzah

apps/frontend/portal/src/
├── lib/api.ts                 ← WIRE bonzahApi, remindersApi
└── app/(dashboard)/layout.tsx ← ADD "Bonzah" under settings sub-nav
```

---

## 3. Database Schema

### 3.1 New enums — `packages/database/src/schema/enums.ts`

```ts
export const bonzahModeEnum = pgEnum('bonzah_mode', ['test', 'live']);

export const bonzahPolicyStatusEnum = pgEnum('bonzah_policy_status', [
  'quoted',
  'payment_pending',
  'active',
  'cancelled',
  'failed',
  'insufficient_balance',
]);

export const insuranceStatusEnum = pgEnum('insurance_status', [
  'pending',
  'bonzah',
  'external',
  'not_required',
]);

export const reminderSeverityEnum = pgEnum('reminder_severity', [
  'info',
  'warning',
  'critical',
]);

export const coverageTierEnum = pgEnum('coverage_tier', [
  'cdw',
  'rcli',
  'sli',
  'pai',
]);
```

### 3.2 `tenants` additions

```
tenants (ALTER)
  + integration_bonzah        BOOLEAN                       NOT NULL DEFAULT false
  + bonzah_mode               bonzahModeEnum                NOT NULL DEFAULT 'test'
  + bonzah_username           TEXT                          nullable    (null in test mode)
  + bonzah_password_encrypted TEXT                          nullable    (AES-256-GCM, base64-encoded)
  + bonzah_brochure_url       TEXT                          nullable
```

### 3.3 `rentals` additions

```
rentals (ALTER)
  + insurance_premium         NUMERIC(12,2)                 NOT NULL DEFAULT 0
  + insurance_status          insuranceStatusEnum           NOT NULL DEFAULT 'pending'
```

**Note**: no `bonzah_policy_id` column. Deriving the primary policy via
`SELECT * FROM bonzah_insurance_policies WHERE rental_id = :id AND chain_sequence = 0`
avoids a circular FK between `rentals` and `bonzah_insurance_policies` in CommonJS-compiled
output. The denormalized `insurance_premium` + `insurance_status` stay on `rentals` for
fast reads without a join.

### 3.4 `bonzah_insurance_policies`

```
bonzah_insurance_policies
  id                   UUID            PK
  tenant_id            UUID FK         → tenants ON DELETE CASCADE
  rental_id            UUID FK         → rentals ON DELETE CASCADE
  customer_id          UUID FK         → customers ON DELETE RESTRICT
  chain_id             UUID            NOT NULL    (shared across all chunks of one insurance request)
  chain_sequence       INTEGER         NOT NULL DEFAULT 0    (0-indexed chunk position)
  policy_type          TEXT            NOT NULL DEFAULT 'original'   (original | extension — extensions deferred)
  mode                 bonzahModeEnum  NOT NULL    (snapshot of tenant mode at quote time)

  -- Bonzah identifiers
  quote_id             TEXT            NOT NULL
  quote_no             TEXT            nullable
  payment_id           TEXT            nullable
  policy_no            TEXT            nullable
  policy_id            TEXT            nullable

  -- Coverage selection (JSONB for flexibility + PDF IDs)
  coverage             JSONB           NOT NULL
  --   shape: { cdw: boolean, rcli: boolean, sli: boolean, pai: boolean,
  --            pdf_ids?: { cdw?: number, rcli?: number, sli?: number, pai?: number } }

  -- Trip + pricing
  trip_start_date      DATE            NOT NULL
  trip_end_date        DATE            NOT NULL
  pickup_state         TEXT            NOT NULL
  premium_amount       NUMERIC(12,2)   NOT NULL

  -- Renter snapshot (snapshotted at quote time — changes to customer don't affect issued policy)
  renter_details       JSONB           NOT NULL

  -- Lifecycle
  status               bonzahPolicyStatusEnum  NOT NULL DEFAULT 'quoted'
  policy_issued_at     TIMESTAMPTZ     nullable
  last_error           TEXT            nullable    (last error message from Bonzah, for debugging)

  created_at           TIMESTAMPTZ     NOT NULL DEFAULT now()
  updated_at           TIMESTAMPTZ     NOT NULL DEFAULT now()

  -- Constraints
  CHECK (trip_end_date >= trip_start_date)
  UNIQUE (tenant_id, quote_id)

  -- Indexes
  INDEX (tenant_id, rental_id)
  INDEX (tenant_id, chain_id)
  INDEX (tenant_id, status)
```

### 3.5 `reminder_configs`

```
reminder_configs
  id            UUID        PK
  tenant_id     UUID FK     → tenants ON DELETE CASCADE
  config_key    TEXT        NOT NULL    (e.g. 'bonzah_low_balance')
  config_value  JSONB       NOT NULL    (e.g. { threshold: 100, enabled: true })
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()

  UNIQUE (tenant_id, config_key)
```

### 3.6 `reminders`

```
reminders
  id           UUID                       PK
  tenant_id    UUID FK                    → tenants ON DELETE CASCADE
  rule_code    TEXT                       NOT NULL    (e.g. 'BONZAH_LOW_BALANCE')
  object_type  TEXT                       NOT NULL    (e.g. 'Integration')
  object_id    TEXT                       nullable    (loose reference, not FK — polymorphic)
  title        TEXT                       NOT NULL
  message      TEXT                       NOT NULL
  severity     reminderSeverityEnum       NOT NULL DEFAULT 'info'
  context      JSONB                      nullable
  resolved_at  TIMESTAMPTZ                nullable
  created_at   TIMESTAMPTZ                NOT NULL DEFAULT now()
  updated_at   TIMESTAMPTZ                NOT NULL DEFAULT now()

  INDEX (tenant_id, resolved_at, created_at)   -- optimizes "active reminders" query
  INDEX (tenant_id, rule_code)                 -- optimizes upsert by rule code
```

### 3.7 FK behavior summary

| FK | On delete |
|---|---|
| `bonzah_insurance_policies.tenant_id → tenants` | CASCADE |
| `bonzah_insurance_policies.rental_id → rentals` | CASCADE |
| `bonzah_insurance_policies.customer_id → customers` | RESTRICT |
| `reminders.tenant_id → tenants` | CASCADE |
| `reminder_configs.tenant_id → tenants` | CASCADE |

---

## 4. Shared Types (`@drive247/shared-types`)

### 4.1 `enums.ts` (append)
```ts
export enum BonzahMode { TEST = 'test', LIVE = 'live' }
export enum BonzahPolicyStatus {
  QUOTED = 'quoted', PAYMENT_PENDING = 'payment_pending', ACTIVE = 'active',
  CANCELLED = 'cancelled', FAILED = 'failed', INSUFFICIENT_BALANCE = 'insufficient_balance',
}
export enum InsuranceStatus {
  PENDING = 'pending', BONZAH = 'bonzah', EXTERNAL = 'external', NOT_REQUIRED = 'not_required',
}
export enum ReminderSeverity { INFO = 'info', WARNING = 'warning', CRITICAL = 'critical' }
export enum CoverageTier { CDW = 'cdw', RCLI = 'rcli', SLI = 'sli', PAI = 'pai' }
```

### 4.2 `constants.ts` (append)
```ts
// Bonzah (shared — frontend + backend both reference)
export const BONZAH_MIN_DRIVER_AGE = 21;
export const BONZAH_MAX_CHUNK_DAYS = 30;
export const BONZAH_BALANCE_POLL_INTERVAL_MS = 60_000;
export const COVERAGE_TIER_LABELS: Record<string, string> = {
  cdw: 'Collision Damage Waiver (CDW)',
  rcli: "Renter's Contingent Liability (RCLI)",
  sli: 'Supplemental Liability (SLI)',
  pai: 'Personal Accident (PAI)',
};

// Reminders
export const REMINDER_RULE_CODES = {
  BONZAH_LOW_BALANCE: 'BONZAH_LOW_BALANCE',
  // Future additions go here — single source of truth
} as const;
```

### 4.3 `bonzah.types.ts` (new)
All request/response shapes for the HTTP API:
- `BonzahConnectionStatus` — `{ connected: boolean, mode: BonzahMode, username: string | null, brochureUrl: string | null }`
- `BonzahBalanceResponse` — `{ brokerBalance: number, allocatedBalance: number | null, mode: BonzahMode, currency: string, asOf: string, alertLevel: 'none'|'warning'|'critical' }`
- `VerifyCredentialsPayload`, `VerifyCredentialsResponse`
- `CalculatePremiumPayload`, `CalculatePremiumResponse`
- `CoverageSelection` — `{ cdw: boolean; rcli: boolean; sli: boolean; pai: boolean }`
- `RenterDetails` — full shape (first/last name, dob, email, phone, license, address)
- `CreateQuotePayload`, `CreateQuoteResponse` — chain-aware (returns `chainId`, all chunks with ids)
- `BonzahPolicyResponse` — shape of stored policy row for list/detail UI
- `ConfirmPaymentPayload`, `ConfirmPaymentResponse`
- `EligibilityCheckPayload`, `EligibilityCheckResponse`

### 4.4 `reminders.types.ts` (new)
- `ReminderResponse`, `ReminderListQuery`, `ReminderListResponse`
- `ReminderConfigResponse`, `UpdateReminderConfigPayload`

---

## 5. API Client (`@drive247/api-client`)

### `bonzah.api.ts`
```ts
createBonzahApi(api) → {
  // Settings
  getConnection(): GET  /bonzah/connection
  updateSettings(data): PATCH /bonzah/settings           // { mode, username, password, brochureUrl }
  verifyCredentials(data): POST /bonzah/verify-credentials
  // Balance + alerts
  getBalance(): GET  /bonzah/balance
  getAlertConfig(): GET  /bonzah/alert-config
  updateAlertConfig(data): PATCH /bonzah/alert-config
  // Policies
  listPolicies(query): GET  /bonzah/policies
  getPolicy(id): GET  /bonzah/policies/:id
  createQuote(data): POST /bonzah/policies
  confirmPayment(chainId): POST /bonzah/policies/:chainId/confirm-payment
  retryPending(): POST /bonzah/policies/retry-pending
  downloadPdf(policyId, dataId): GET  /bonzah/policies/:id/pdf?dataId=...
  // Premium + eligibility
  calculatePremium(data): POST /bonzah/premium-calculate
  checkEligibility(data): POST /bonzah/eligibility
}
```

### `reminders.api.ts`
```ts
createRemindersApi(api) → {
  list(query): GET /reminders
  resolve(id): PATCH /reminders/:id/resolve
}
```

---

## 6. Backend — `integrations/bonzah/` (solid foundation)

Built to be reused by future features.

### 6.1 `bonzah.module.ts`
Global module (registered once, injected anywhere). Exports `BonzahApiClient`, `BonzahTokenCache`, `BonzahCredentialsService`.

### 6.2 `constants.ts` (backend-only)
```ts
export const BONZAH_PATHS = {
  AUTH:         '/api/v1/auth',
  QUOTE:        '/api/v1/Bonzah/quote',
  PAYMENT:      '/api/v1/Bonzah/payment',
  POLICY:       '/api/v1/Bonzah/policy',
  PREMIUM_CALC: '/api/v1/Bonzah/premiumCalc',
  CD_BALANCE:   '/api/v1/Bonzah/cdBalance',
  MASTER:       '/api/v1/Bonzah/master',
  POLICY_DATA:  '/api/v1/policy/data',
};

export const BONZAH_TOKEN_TTL_MS = 14 * 60 * 1000;          // Bonzah spec: 15 min
export const BONZAH_TOKEN_TTL_BUFFER_MS = 60 * 1000;        // 1-min safety buffer
export const BONZAH_AUTH_HEADER = 'in-auth-token';

// Balance error detection (keyword match in Bonzah error text)
export const BONZAH_BALANCE_ERROR_KEYWORDS = [
  'balance', 'fund', 'allocat', 'deposit', 'insufficient',
];

// Vehicle eligibility — hardcoded for Phase 1; move to DB in Phase 2
export const BONZAH_RESTRICTED_BRANDS = [
  'Ferrari', 'Lamborghini', 'Porsche', 'Tesla', /* … from V1 code … */
];
export const BONZAH_RESTRICTED_MODELS: Array<{ brand: string; modelPattern: RegExp }> = [
  { brand: 'Mercedes', modelPattern: /AMG|G-?Class|S-?Class/i },
  /* … */
];
```

### 6.3 `types.ts` (backend-only)
Strongly-typed shapes for Bonzah API requests/responses. NOT exported to frontend (those live in shared-types).

### 6.4 `errors.ts`
Typed errors for clean error handling in services:
```ts
export class BonzahApiError extends Error { status?: number; code?: string; }
export class BonzahAuthError extends BonzahApiError {}
export class BonzahInsufficientBalanceError extends BonzahApiError {}
export class BonzahValidationError extends BonzahApiError { errors: string[]; }
```

### 6.5 `bonzah-token-cache.service.ts`
```ts
// Per-username in-memory cache. TTL = 14 min.
class BonzahTokenCache {
  get(username): { token, expiresAt } | null
  set(username, token, expiresAt)
  invalidate(username)
}
```

### 6.6 `bonzah-credentials.service.ts`
```ts
class BonzahCredentialsService {
  async loadForTenant(tenantId): Promise<{ username, password, mode, apiUrl }>
  async encrypt(plaintext): Promise<string>      // delegates to crypto.util
  async decrypt(ciphertext): Promise<string>
  // Test mode: returns platform shared creds from env
  // Live mode: decrypts from tenants.bonzah_password_encrypted
}
```

### 6.7 `bonzah-api.client.ts`
Low-level HTTP client. ALL external fetches go through this. Injects auth token, adds logging, throws typed errors.
```ts
class BonzahApiClient {
  async authenticate(username, password, apiUrl): Promise<string>
  async call<T>(tenantId, method, path, body?): Promise<T>   // auth token auto-acquired via cache
  // Handles: token refresh on 401, network retry (bounded), balance error detection
}
```

### 6.8 `utils/chunk.util.ts` (pure)
```ts
export function chunkDateRange(start: Date, end: Date, maxDays: number): Array<{ start: Date; end: Date }>;
// Pure function — easy to unit test
```

### 6.9 `utils/date.util.ts` (pure)
- `formatBonzahDate(d: Date): string` — MM/DD/YYYY
- `formatBonzahDateTime(d: Date): string` — MM/DD/YYYY HH:mm:ss
- `validateTripStart(d: Date, now: Date): 'ok' | 'same_day' | 'past'` — Pacific timezone logic

---

## 7. Backend — `integrations/openai/`

### `openai.module.ts`
Global module, exports `OpenAIClient`.

### `openai.client.ts`
```ts
class OpenAIClient {
  async chat(params: { model, messages, maxTokens? }): Promise<string>
}
```

### `constants.ts`
```ts
export const OPENAI_MODEL_ELIGIBILITY = 'gpt-4o-mini';
export const OPENAI_TEMPERATURE_DETERMINISTIC = 0;
```

---

## 8. Backend — `modules/bonzah/` (feature)

### 8.1 Split into focused services (each ≤200 lines)

| File | Responsibility |
|---|---|
| `bonzah.service.ts` | verify credentials, save settings, get balance (with alert logic), eligibility dispatch, retry pending |
| `bonzah-premium.service.ts` | wraps `/premiumCalc`; stateless |
| `bonzah-quote.service.ts` | creates quotes, chunks date ranges, persists all chunks in a DB transaction, updates rental insurance fields |
| `bonzah-payment.service.ts` | confirms payment for entire chain; detects insufficient balance; updates statuses |
| `bonzah-policy.service.ts` | list/get policies; PDF download proxy |
| `bonzah-eligibility.service.ts` | OpenAI call + in-process LRU cache keyed by `(tenantId, makeLower, modelLower)`, 24h TTL |

### 8.2 Controllers

**`bonzah.controller.ts`** (`/api/bonzah`)
All `@RequireTenant()`. All `:id` params validated with `ParseUUIDPipe`.
| Method | Path | Roles |
|---|---|---|
| `GET` | `/connection` | all 5 |
| `PATCH` | `/settings` | head_admin |
| `POST` | `/verify-credentials` | head_admin |
| `GET` | `/balance` | all 5 |
| `GET` | `/alert-config` | all 5 |
| `PATCH` | `/alert-config` | head_admin, admin |
| `POST` | `/premium-calculate` | head_admin, admin, manager, ops |
| `POST` | `/eligibility` | head_admin, admin, manager, ops |

**`bonzah-policies.controller.ts`** (`/api/bonzah/policies`)
| Method | Path | Roles |
|---|---|---|
| `GET` | `` | all 5 |
| `GET` | `/:id` | all 5 |
| `POST` | `` (create quote) | head_admin, admin, manager, ops |
| `POST` | `/:chainId/confirm-payment` | head_admin, admin |
| `POST` | `/retry-pending` | head_admin, admin |
| `GET` | `/:id/pdf` (query: `dataId`) | all 5 |

### 8.3 DTOs — **single source of truth via drizzle-zod shapes**

Every DTO pulls field shapes from `insertBonzahInsurancePolicySchema.shape.*` where the field exists on the table. New business rules via `.refine()`.

Example — `create-quote.dto.ts`:
```ts
import { insertBonzahInsurancePolicySchema } from '@drive247/database';
import { BONZAH_MIN_DRIVER_AGE } from '@drive247/shared-types';

export const createQuoteSchema = z.object({
  rentalId: z.string().uuid(),
  coverage: z.object({
    cdw: z.boolean(), rcli: z.boolean(), sli: z.boolean(), pai: z.boolean(),
  }).refine(c => !(c.sli && !c.rcli), {
    message: 'SLI requires RCLI',
  }).refine(c => c.cdw || c.rcli || c.sli || c.pai, {
    message: 'At least one coverage must be selected',
  }),
  pickupState: insertBonzahInsurancePolicySchema.shape.pickupState,
  renter: z.object({
    firstName: z.string().min(1).max(50),
    lastName: z.string().min(1).max(50),
    dob: z.coerce.date(),
    email: z.string().email(),
    phone: z.string().regex(/^\d{11}$/, '11 digits, country code (no +) + mobile'),
    address: z.object({
      street: z.string().min(1).max(100),
      city: z.string().min(1).max(50),
      state: z.string().length(2),
      zip: z.string().min(5).max(10),
    }),
    license: z.object({
      number: z.string().min(1).max(50),
      state: z.string().length(2),
    }),
  }).refine((r) => ageInYears(r.dob) >= BONZAH_MIN_DRIVER_AGE, {
    message: `Driver must be at least ${BONZAH_MIN_DRIVER_AGE}`,
    path: ['dob'],
  }),
});
```

**All DTOs use this pattern.** No redefinition of validators that already live on the DB schema.

### 8.4 Transactional writes

`bonzah-quote.service.ts` uses `db.transaction()` for multi-chunk persistence:
- If any chunk fails to persist, all roll back
- If Bonzah API succeeds for chunks 1 and 2 but fails for chunk 3, we:
  - Rollback the DB transaction
  - Log the Bonzah-side orphans for manual reconciliation (Phase 2: automatic rollback call to Bonzah)

---

## 9. Backend — `modules/reminders/`

Generic, Bonzah is first consumer.

### Endpoints
| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/reminders` | all 5 |
| `PATCH` | `/api/reminders/:id/resolve` | head_admin, admin, manager, ops |

No POST — reminders are only created by backend rules, never by users (in Phase 1).

### Config management
Handled via `tenant-settings` controller (already exists): `/api/tenant-settings/reminders/:configKey`. GET/PATCH pattern for per-tenant thresholds.

### `reminders.service.ts` — internal API for rule emitters
```ts
class RemindersService {
  async upsert(tenantId, ruleCode, data: { title, message, severity, context, objectType, objectId }): Promise<Reminder>
  async resolve(tenantId, id): Promise<Reminder>
  async list(tenantId, filters): Promise<Reminder[]>
  async getConfig(tenantId, configKey): Promise<ReminderConfig | null>
  async updateConfig(tenantId, configKey, value): Promise<ReminderConfig>
}
```

`BonzahService.getBalance()` calls `remindersService.upsert(BONZAH_LOW_BALANCE, ...)` whenever balance < threshold.

---

## 10. Tenant Settings Controller — additions

`apps/backend/src/modules/tenants/tenant-settings.controller.ts` gets two more sub-resources:
- `GET /api/tenant-settings/bonzah` — connection status + brochure URL (NEVER password)
- `PATCH /api/tenant-settings/bonzah` — update settings (head_admin only)
  - If password provided → verify via Bonzah API first, then encrypt + store
  - If password blank but username changed → reject
  - `integration_bonzah` toggles automatically based on whether both username + password present

---

## 11. Security & Invariants

### 11.1 Encryption at rest
- `BONZAH_CREDS_ENCRYPTION_KEY` — 32-byte hex env var, validated in `env.config.ts`
- `common/utils/crypto.util.ts` — `encrypt()` / `decrypt()` wrappers around `crypto.createCipheriv('aes-256-gcm', ...)`
- Stored as `base64(iv ‖ authTag ‖ ciphertext)` in `tenants.bonzah_password_encrypted`
- Only `BonzahCredentialsService` ever reads/writes the password column
- API responses NEVER return the password — only `connected: boolean` + `username`

### 11.2 Tenant isolation
- Every query filters by `tenant_id` (hard rule #1)
- All endpoints `@RequireTenant()`
- Policy FKs cascade with tenant delete → orphans impossible

### 11.3 Token cache
- In-memory Map, scoped to process (fine for single-instance)
- Key: `username` (not tenant_id — different tenants may share test creds)
- Value: `{ token, expiresAt }` with TTL = 14 min (1 min buffer below Bonzah's 15 min)
- Cleared on: auth error (401), explicit invalidate, or expiry
- Documented limitation: multi-instance deployment requires Redis (Phase 2)

### 11.4 PDF proxy
- Client never sees the Bonzah auth token
- Backend fetches PDF bytes, streams or returns base64 to client
- Content-Type determined from Bonzah response

### 11.5 No stored secrets in frontend
- OpenAI API key, Bonzah credentials, encryption key — all backend-only
- Frontend never makes direct calls to Bonzah or OpenAI

---

## 12. Business Flows (end-to-end)

### 12.1 Tenant admin connects Bonzah (live mode)
1. Settings → Bonzah → enters username + password
2. `POST /api/bonzah/verify-credentials` — backend calls Bonzah `/auth` (no DB write)
3. On valid: `PATCH /api/bonzah/settings` with `{ username, password, mode: 'live' }`
4. Service encrypts password → writes to `tenants` → sets `integration_bonzah = true`
5. UI refetches `/connection` → shows "Connected"

### 12.2 Admin adds insurance to an active rental
1. Rental detail → Insurance section → "Add Bonzah Insurance"
2. Dialog opens → calls `POST /api/bonzah/eligibility` with vehicle's make/model
3. If eligible → coverage tiles + renter details form (prefilled from customer)
4. Premium updates live via debounced `POST /api/bonzah/premium-calculate`
5. Submit → `POST /api/bonzah/policies` (create quote)
   - Service: validates dates, chunks if >30 days, calls Bonzah `/quote` with `finalize=1` for each chunk in sequence
   - DB transaction: inserts all chunk rows, sets `rental.bonzah_policy_id = first chunk id`, sums `rental.insurance_premium`, sets `rental.insurance_status = 'bonzah'`
6. UI shows policy with status `quoted` + "Confirm Payment" button

### 12.3 Admin confirms payment
1. Click "Confirm Payment" on policy
2. `POST /api/bonzah/policies/:chainId/confirm-payment`
3. Service:
   - Checks Bonzah balance via `/cdBalance`
   - Calls `/payment` for each chunk in chain order
   - On success: status → `active`, stores `policy_no`, `policy_id`, PDF IDs
   - On balance error: status → `insufficient_balance`, writes `last_error`, creates reminder
4. UI polls and refreshes status badge

### 12.4 Low balance alert
1. Dashboard balance widget polls `/api/bonzah/balance` every 60s
2. Backend: fetches from `/cdBalance`, compares to `reminder_configs.bonzah_low_balance.threshold`
3. If `balance < threshold`: `remindersService.upsert('BONZAH_LOW_BALANCE', ...)`
   - `balance ≤ 50% threshold` → severity = `critical`
   - Otherwise → `warning`
4. Settings page shows active reminder + dashboard widget shows LOW badge

### 12.5 Retry pending policies
1. Admin allocates funds in Bonzah portal
2. Settings → "Retry All Pending" button
3. `POST /api/bonzah/policies/retry-pending`
4. Service: queries `insufficient_balance` policies for tenant, calls payment confirmation for each chain, summarizes results

---

## 13. Environment Variables

Added to `apps/backend/src/config/env.config.ts` with Zod validation + `.describe()`:

```ts
BONZAH_API_URL_SANDBOX:            z.string().url().default('https://bonzah.sb.insillion.com')
BONZAH_API_URL_LIVE:               z.string().url().default('https://bonzah.insillion.com')
BONZAH_PLATFORM_USERNAME:          z.string().optional()       // only needed if any tenant is in test mode
BONZAH_PLATFORM_PASSWORD:          z.string().optional()
BONZAH_CREDS_ENCRYPTION_KEY:       z.string().length(64)       // 32-byte hex
OPENAI_API_KEY:                    z.string().min(1)
```

Validated at boot — if encryption key missing or wrong length, the app fails fast.

---

## 14. Business Rules (non-negotiable)

1. **Every query filters by `tenant_id`** (V2 Rule #1)
2. **Bonzah password never returned via API** — only `connected: boolean`
3. **SLI requires RCLI** — enforced in DTO `.refine()`
4. **Minimum driver age 21 — measured against `trip_start_date`, not today** — a customer who turns 21 before pickup is not blocked. A customer who turns 21 after pickup IS blocked.
5. **Phone format**: 11 digits, country code (no +) + mobile — DTO regex
6. **Renter details snapshotted at quote time** — changes to customer record don't affect issued policies
7. **Coverage selection snapshotted** — stored in JSONB on the policy row
8. **Mode snapshotted on each policy row** — test/live at creation time; later tenant mode changes don't retroactively affect
9. **All external API calls go through `BonzahApiClient`** — never inline `fetch()` in services
10. **Balance errors detected by keyword** — marked `insufficient_balance`, not `failed`
11. **Multi-chunk quote creation is transactional on our side** — all-or-nothing DB write. Bonzah-side orphans (if they occur when network fails between chunks) are logged for manual reconciliation; documented as a Phase 2 improvement (`finalize=0` until all chunks succeed, then sweep-finalize).
12. **Token cache keyed by `(username, apiUrl)`** — never username alone. Prevents cross-env pollution.
13. **Mode change to `live` requires valid live credentials in the same update** — settings PATCH verifies creds against the target URL before persisting. No two-step broken state.
14. **Eligibility: hardcoded exclusion list first, OpenAI only for ambiguous cases** — deterministic first pass; fuzzy matcher is the backstop.
15. **`rental.insurance_status` reflects aggregate policy state** — only `'bonzah'` when every chunk is `active`. UI shows per-chunk status; never rolls up to a green checkmark until every chunk is issued.
16. **Renter email labeled in UI** as "Policy confirmation sent to this address" so customers verify before submit.
17. **Token cache TTL uses constants** — no magic numbers
18. **DTOs source from drizzle-zod shapes** — single source of truth from DB to validation
19. **Constants live in shared-types** (if shared) or `integrations/bonzah/constants.ts` (if backend-only) — never inline
20. **Files stay ≤200 lines** — services split by responsibility
21. **`.spec.ts` files alongside implementation** — per V2 Rule from auth migration

---

## 15. Implementation Order

### Step 1 — Shared schema + types + constants
- [ ] Add 5 enums to `schema/enums.ts`
- [ ] Extend `tenants.ts` with 5 columns
- [ ] Extend `rentals.ts` with 3 columns
- [ ] Create 3 new schema files + matching zod files
- [ ] Update barrel exports
- [ ] Add 5 TS enums to `shared-types/enums.ts`
- [ ] Add Bonzah constants + `REMINDER_RULE_CODES` to `shared-types/constants.ts`
- [ ] Create `bonzah.types.ts`, `reminders.types.ts`
- [ ] Barrel export

### Step 2 — Migration
- [ ] `pnpm db:generate`, inspect SQL, `pnpm db:migrate`
- [ ] Rebuild `@drive247/database` + `@drive247/shared-types` dist

### Step 3 — Env config + crypto util
- [ ] Add 6 env vars to `env.config.ts` with Zod validation
- [ ] Create `common/utils/crypto.util.ts` + `.spec.ts` (AES-GCM)
- [ ] Add env vars to `.env.local` example

### Step 4 — `integrations/bonzah/` (foundation)
- [ ] `constants.ts`, `types.ts`, `errors.ts`
- [ ] `utils/date.util.ts` + `.spec.ts`
- [ ] `utils/chunk.util.ts` + `.spec.ts`
- [ ] `bonzah-token-cache.service.ts` + `.spec.ts`
- [ ] `bonzah-credentials.service.ts` + `.spec.ts`
- [ ] `bonzah-api.client.ts` + `.spec.ts` (mock fetch)
- [ ] `bonzah.module.ts` (exports all)

### Step 5 — `integrations/openai/`
- [ ] `openai.client.ts`, `openai.module.ts`, `constants.ts`

### Step 6 — `modules/reminders/`
- [ ] Service, controller, module, DTOs
- [ ] Wire into `app.module.ts`
- [ ] Extend `tenant-settings.controller.ts` with reminder config endpoints

### Step 7 — `modules/bonzah/`
- [ ] DTOs (9 files) — all using drizzle-zod shapes
- [ ] `bonzah-premium.service.ts`
- [ ] `bonzah-eligibility.service.ts` (with in-process LRU cache)
- [ ] `bonzah-quote.service.ts` (with DB transactions for chunked writes)
- [ ] `bonzah-payment.service.ts` (with balance error detection)
- [ ] `bonzah-policy.service.ts` (list/get/pdf proxy)
- [ ] `bonzah.service.ts` (top-level orchestration + settings + balance alert emission)
- [ ] `bonzah.controller.ts`, `bonzah-policies.controller.ts`
- [ ] `bonzah.module.ts` (imports BonzahIntegrationModule, OpenAIModule, RemindersModule)
- [ ] Extend `tenant-settings.controller.ts` with bonzah settings endpoints
- [ ] Wire into `app.module.ts`
- [ ] Extend `rentals.service.ts` to include insurance summary in detail response

### Step 8 — `.spec.ts` test files
- [ ] Crypto round-trip
- [ ] Token cache TTL + eviction
- [ ] Credentials encrypt/decrypt + test-mode fallback
- [ ] API client (mocked fetch) — auth, token refresh, error detection
- [ ] Chunk util — edge cases (≤30 days, 31 days, 90 days, boundary)
- [ ] Date util — MM/DD/YYYY format, Pacific timezone validation
- [ ] Quote service — chunking + chain_id propagation + transaction rollback
- [ ] Payment service — balance check + insufficient_balance path
- [ ] Eligibility service — cache hit/miss, fail-open on OpenAI error
- [ ] Bonzah service — balance alert creation (via mocked reminders service)

### Step 9 — API client package
- [ ] `bonzah.api.ts` and `reminders.api.ts`
- [ ] Barrel export

### Step 10 — Postman tests (all endpoints)
- [ ] Connection + verify-credentials
- [ ] Settings CRUD (encryption roundtrip verified via reconnect)
- [ ] Premium calculate
- [ ] Eligibility check (eligible + restricted brand)
- [ ] Create quote (short rental, 45-day chunked rental, invalid age rejected, SLI-without-RCLI rejected)
- [ ] Confirm payment (success + insufficient_balance simulation)
- [ ] List/get/PDF
- [ ] Balance with threshold configured → reminder appears
- [ ] Retry pending
- [ ] Role gating (ops cannot update settings; viewer cannot create quote)

### Step 11 — Frontend wiring
- [ ] `bonzahApi`, `remindersApi` in `lib/api.ts`
- [ ] Sidebar "Bonzah" entry under settings

### Step 12 — Frontend components
- [ ] All 14 components in `components/bonzah/`
- [ ] Dashboard balance widget added to `/page.tsx`
- [ ] Settings page at `/settings/bonzah/page.tsx`
- [ ] Rental detail integration — Insurance section with selector + policy viewer
- [ ] Polling via `setInterval` using `BONZAH_BALANCE_POLL_INTERVAL_MS` from shared-types

### Step 13 — End-to-end browser test
- [ ] Connect Bonzah (test mode, platform creds)
- [ ] Dashboard shows balance
- [ ] Create rental → open insurance selector → verify eligibility check
- [ ] Build a quote, confirm payment, download PDF
- [ ] Configure low-balance alert → verify reminder appears
- [ ] Force insufficient balance → verify pending policy card + retry

---

## 16. Test Coverage Summary

All listed `.spec.ts` files are part of Phase 1. Each service has its own test file. Pure utility functions (chunk, date) have heavier coverage since they're pure. API client tests use mocked `fetch`.

---

## 17. Notes / Phase 2

### Operational must-do
- **Back up `BONZAH_CREDS_ENCRYPTION_KEY` in a password manager TODAY** — if the key is ever lost, all tenant Bonzah passwords become unrecoverable and every live tenant must re-enter their credentials. There is no recovery path. Treat the key like a database master password.

### Phase 2 improvements
- Email notifications for low balance (requires notifications module)
- Encryption key rotation mechanism (dual-key during transition)
- Multi-instance token cache (Redis)
- Vehicle eligibility list moved to DB (admin-managed) — Phase 1 has it hardcoded in `constants.ts`
- Multi-chunk quote creation with `finalize=0` + sweep-finalize pattern (eliminates Bonzah-side orphans on partial failure)
- Extension endorsements (`policy_type = 'extension'`)
- Cancellation endorsements
- Date-change / name-change endorsements
- PDF persistence in S3 (currently on-demand proxy)
- Customer self-serve booking app integration
- Multi-currency premium conversion

---

## 18. MIGRATION_GUIDE.md updates

- Mark feature #15 "Insurance (Bonzah)" as in progress / done
- Add a new "Integrations" section documenting:
  - `integrations/` folder convention (Bonzah is the first real user)
  - AES-GCM encryption-at-rest pattern for sensitive credentials
  - Token cache pattern (per-username Map, TTL with buffer)
  - OpenAI integration pattern
  - Reminders module as the pattern for tenant-scoped alerts
- Add the encryption key rotation concern to a "Known limitations" section
