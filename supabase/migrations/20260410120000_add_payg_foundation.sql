-- Migration: Pay-As-You-Go foundation
-- Adds tenant defaults, per-rental state, accrual idempotency table, reminder audit log.
-- Reuses existing ledger_entries categories ('Rental', 'Tax', 'Service Fee') — no constraint change needed.

-- ============================================================================
-- TENANT DEFAULTS
-- ============================================================================

ALTER TABLE "public"."tenants"
  ADD COLUMN IF NOT EXISTS "payg_reminder_interval_days" integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS "payg_grace_period_days" integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "payg_max_reminders" integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "payg_preauth_days" integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "payg_max_duration_days" integer NOT NULL DEFAULT 90;

ALTER TABLE "public"."tenants"
  ADD CONSTRAINT "tenants_payg_reminder_interval_days_check"
    CHECK ("payg_reminder_interval_days" >= 1 AND "payg_reminder_interval_days" <= 365),
  ADD CONSTRAINT "tenants_payg_grace_period_days_check"
    CHECK ("payg_grace_period_days" >= 0 AND "payg_grace_period_days" <= 365),
  ADD CONSTRAINT "tenants_payg_max_reminders_check"
    CHECK ("payg_max_reminders" >= 1 AND "payg_max_reminders" <= 1000),
  ADD CONSTRAINT "tenants_payg_preauth_days_check"
    CHECK ("payg_preauth_days" >= 0 AND "payg_preauth_days" <= 30),
  ADD CONSTRAINT "tenants_payg_max_duration_days_check"
    CHECK ("payg_max_duration_days" >= 1 AND "payg_max_duration_days" <= 3650);

COMMENT ON COLUMN "public"."tenants"."payg_reminder_interval_days" IS
  'PAYG: tenant default interval in days between payment reminder emails. Can be overridden per-rental.';
COMMENT ON COLUMN "public"."tenants"."payg_grace_period_days" IS
  'PAYG: days after rental start before the first reminder can fire.';
COMMENT ON COLUMN "public"."tenants"."payg_max_reminders" IS
  'PAYG: safety cap on number of reminders sent per rental before stopping.';
COMMENT ON COLUMN "public"."tenants"."payg_preauth_days" IS
  'PAYG: number of days worth of daily rate to use as pre-authorization amount (min cap still applies).';
COMMENT ON COLUMN "public"."tenants"."payg_max_duration_days" IS
  'PAYG: safety cap on how many days a PAYG rental can remain open before accrual stops and admin is alerted.';

-- ============================================================================
-- PER-RENTAL PAYG STATE + PER-RENTAL OVERRIDE
-- ============================================================================

ALTER TABLE "public"."rentals"
  ADD COLUMN IF NOT EXISTS "payg_reminder_interval_days" integer, -- nullable; null = use tenant default
  ADD COLUMN IF NOT EXISTS "payg_start_ts" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "payg_last_accrual_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "payg_next_accrual_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "payg_accrual_day_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "payg_last_reminder_sent_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "payg_reminder_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "payg_paused" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "payg_paused_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "payg_closed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "payg_max_duration_alerted" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."rentals"
  ADD CONSTRAINT "rentals_payg_reminder_interval_days_check"
    CHECK ("payg_reminder_interval_days" IS NULL OR ("payg_reminder_interval_days" >= 1 AND "payg_reminder_interval_days" <= 365)),
  ADD CONSTRAINT "rentals_payg_accrual_day_count_check"
    CHECK ("payg_accrual_day_count" >= 0),
  ADD CONSTRAINT "rentals_payg_reminder_count_check"
    CHECK ("payg_reminder_count" >= 0);

COMMENT ON COLUMN "public"."rentals"."payg_reminder_interval_days" IS
  'PAYG: per-rental reminder interval override. NULL = use tenants.payg_reminder_interval_days.';
COMMENT ON COLUMN "public"."rentals"."payg_start_ts" IS
  'PAYG: absolute rental start timestamp (start_date combined with pickup_time in tenant timezone). Anchor for accrual windows.';
COMMENT ON COLUMN "public"."rentals"."payg_next_accrual_at" IS
  'PAYG: timestamp when the next daily accrual is due. Cron picks rows where this <= now().';
COMMENT ON COLUMN "public"."rentals"."payg_accrual_day_count" IS
  'PAYG: count of successfully accrued days (includes partial final day).';
COMMENT ON COLUMN "public"."rentals"."payg_paused" IS
  'PAYG: when true, cron skips this rental. Resumes on toggle.';
COMMENT ON COLUMN "public"."rentals"."payg_closed_at" IS
  'PAYG: timestamp when rental was closed via finalize action. Also sets status=Closed and end_date.';
COMMENT ON COLUMN "public"."rentals"."payg_max_duration_alerted" IS
  'PAYG: set to true after the max-duration admin alert has been sent. Prevents duplicate alerts.';

-- Helpful indexes for the accrual + reminder cron queries
CREATE INDEX IF NOT EXISTS "idx_rentals_payg_next_accrual_at"
  ON "public"."rentals" ("payg_next_accrual_at")
  WHERE "is_pay_as_you_go" = true AND "payg_closed_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_rentals_payg_reminder_scan"
  ON "public"."rentals" ("tenant_id", "payg_last_reminder_sent_at")
  WHERE "is_pay_as_you_go" = true AND "payg_closed_at" IS NULL;

-- ============================================================================
-- ACCRUAL IDEMPOTENCY TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."payg_accruals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rental_id" uuid NOT NULL REFERENCES "public"."rentals"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
  "accrual_day_index" integer NOT NULL,
  "accrual_window_start" timestamp with time zone NOT NULL,
  "accrual_window_end" timestamp with time zone NOT NULL,
  "daily_rate" numeric(12,2) NOT NULL,
  "tax_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "service_fee_amount" numeric(12,2) NOT NULL DEFAULT 0,
  "is_partial" boolean NOT NULL DEFAULT false,
  "hours_covered" numeric(6,2) NOT NULL DEFAULT 24.00,
  "ledger_entry_ids" uuid[] NOT NULL DEFAULT '{}',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "payg_accruals_rental_day_unique" UNIQUE ("rental_id", "accrual_day_index"),
  CONSTRAINT "payg_accruals_day_index_check" CHECK ("accrual_day_index" >= 1),
  CONSTRAINT "payg_accruals_hours_covered_check" CHECK ("hours_covered" > 0 AND "hours_covered" <= 24)
);

CREATE INDEX IF NOT EXISTS "idx_payg_accruals_rental_id" ON "public"."payg_accruals" ("rental_id");
CREATE INDEX IF NOT EXISTS "idx_payg_accruals_tenant_id" ON "public"."payg_accruals" ("tenant_id");

COMMENT ON TABLE "public"."payg_accruals" IS
  'PAYG: one row per accrued day. Enforces idempotency so cron cannot double-post. Back-references ledger_entries rows it created.';
COMMENT ON COLUMN "public"."payg_accruals"."accrual_day_index" IS
  '1-indexed day counter (day 1 = first accrual, day 2 = second, etc.). Unique per rental.';
COMMENT ON COLUMN "public"."payg_accruals"."is_partial" IS
  'True for the final pro-rated day when admin closes a rental mid-cycle.';
COMMENT ON COLUMN "public"."payg_accruals"."hours_covered" IS
  'Number of hours this accrual covers. 24 for full days, <24 for the partial final day.';

-- RLS
ALTER TABLE "public"."payg_accruals" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payg_accruals_tenant_read"
  ON "public"."payg_accruals"
  FOR SELECT
  USING ("tenant_id" = "public"."get_user_tenant_id"() OR "public"."is_super_admin"());

-- service_role bypasses RLS automatically; no explicit write policy needed
-- (edge functions use service_role key)

-- ============================================================================
-- REMINDER AUDIT LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."payg_reminder_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "rental_id" uuid NOT NULL REFERENCES "public"."rentals"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
  "sent_at" timestamp with time zone NOT NULL DEFAULT now(),
  "reminder_number" integer NOT NULL,
  "outstanding_amount" numeric(12,2) NOT NULL,
  "days_active" integer NOT NULL,
  "days_overdue" integer NOT NULL DEFAULT 0,
  "channel" text NOT NULL DEFAULT 'email',
  "recipient" text NOT NULL,
  "success" boolean NOT NULL DEFAULT true,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "payg_reminder_log_reminder_number_check" CHECK ("reminder_number" >= 1),
  CONSTRAINT "payg_reminder_log_channel_check" CHECK ("channel" IN ('email', 'sms', 'whatsapp'))
);

CREATE INDEX IF NOT EXISTS "idx_payg_reminder_log_rental_sent"
  ON "public"."payg_reminder_log" ("rental_id", "sent_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_payg_reminder_log_tenant"
  ON "public"."payg_reminder_log" ("tenant_id", "sent_at" DESC);

COMMENT ON TABLE "public"."payg_reminder_log" IS
  'PAYG: audit trail of payment reminder emails (and future SMS/WhatsApp). One row per send attempt.';

-- RLS
ALTER TABLE "public"."payg_reminder_log" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payg_reminder_log_tenant_read"
  ON "public"."payg_reminder_log"
  FOR SELECT
  USING ("tenant_id" = "public"."get_user_tenant_id"() OR "public"."is_super_admin"());

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT SELECT ON "public"."payg_accruals" TO "authenticated";
GRANT SELECT ON "public"."payg_reminder_log" TO "authenticated";
GRANT ALL ON "public"."payg_accruals" TO "service_role";
GRANT ALL ON "public"."payg_reminder_log" TO "service_role";
