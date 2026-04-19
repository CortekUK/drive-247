CREATE TYPE "public"."blocked_identity_type" AS ENUM('driving_license', 'passport', 'id_card', 'email');--> statement-breakpoint
CREATE TYPE "public"."id_verification_decision_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."id_verification_status" AS ENUM('initiated', 'in_progress', 'processing', 'approved', 'rejected', 'review_required', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."required_document_type" AS ENUM('driving_license', 'passport', 'id_card');--> statement-breakpoint
CREATE TABLE "blocked_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"identity_type" "blocked_identity_type" NOT NULL,
	"identity_value" text NOT NULL,
	"reason" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "id_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"initiated_by_user_id" uuid,
	"session_token_hash" text NOT NULL,
	"session_expires_at" timestamp with time zone NOT NULL,
	"current_step" text,
	"required_document_type" "required_document_type" NOT NULL,
	"document_front_s3_key" text,
	"document_back_s3_key" text,
	"selfie_s3_key" text,
	"first_name" text,
	"last_name" text,
	"date_of_birth" date,
	"document_number" text,
	"document_country" text,
	"document_expiry_date" date,
	"document_detected_type" text,
	"ocr_confidence" numeric(4, 3),
	"ocr_raw" jsonb,
	"face_match_score" numeric(5, 2),
	"face_match_raw" jsonb,
	"status" "id_verification_status" DEFAULT 'initiated' NOT NULL,
	"decision_source" "id_verification_decision_source",
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"rejection_reason" text,
	"manual_review_notes" text,
	"matched_block_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "id_verifications_expiry_after_creation" CHECK ("id_verifications"."session_expires_at" > "id_verifications"."created_at")
);
--> statement-breakpoint
CREATE TABLE "id_verification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verification_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "id_verification_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "required_document_type" "required_document_type" DEFAULT 'driving_license' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "face_match_auto_approve_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "face_match_review_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "min_ocr_confidence" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "identity_verification_status" "id_verification_status";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "latest_verification_id" uuid;--> statement-breakpoint
ALTER TABLE "blocked_identities" ADD CONSTRAINT "blocked_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_identities" ADD CONSTRAINT "blocked_identities_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_verifications" ADD CONSTRAINT "id_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_verifications" ADD CONSTRAINT "id_verifications_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_verifications" ADD CONSTRAINT "id_verifications_initiated_by_user_id_app_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_verifications" ADD CONSTRAINT "id_verifications_decided_by_user_id_app_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_verifications" ADD CONSTRAINT "id_verifications_matched_block_id_blocked_identities_id_fk" FOREIGN KEY ("matched_block_id") REFERENCES "public"."blocked_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_verification_events" ADD CONSTRAINT "id_verification_events_verification_id_id_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."id_verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_verification_events" ADD CONSTRAINT "id_verification_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_verification_events" ADD CONSTRAINT "id_verification_events_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blocked_identities_tenant_type_value_idx" ON "blocked_identities" USING btree ("tenant_id","identity_type","identity_value");--> statement-breakpoint
CREATE INDEX "blocked_identities_tenant_active_idx" ON "blocked_identities" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "id_verifications_session_token_hash_idx" ON "id_verifications" USING btree ("session_token_hash");--> statement-breakpoint
CREATE INDEX "id_verifications_tenant_customer_idx" ON "id_verifications" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "id_verifications_tenant_status_idx" ON "id_verifications" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "id_verifications_tenant_created_idx" ON "id_verifications" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "id_verification_events_verification_idx" ON "id_verification_events" USING btree ("verification_id","created_at");--> statement-breakpoint
CREATE INDEX "id_verification_events_tenant_idx" ON "id_verification_events" USING btree ("tenant_id","created_at");