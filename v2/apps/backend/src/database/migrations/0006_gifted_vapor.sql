CREATE TYPE "public"."bonzah_mode" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TYPE "public"."bonzah_policy_status" AS ENUM('quoted', 'payment_pending', 'active', 'cancelled', 'failed', 'insufficient_balance');--> statement-breakpoint
CREATE TYPE "public"."coverage_tier" AS ENUM('cdw', 'rcli', 'sli', 'pai');--> statement-breakpoint
CREATE TYPE "public"."insurance_status" AS ENUM('pending', 'bonzah', 'external', 'not_required');--> statement-breakpoint
CREATE TYPE "public"."reminder_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TABLE "bonzah_insurance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"chain_id" uuid NOT NULL,
	"chain_sequence" integer DEFAULT 0 NOT NULL,
	"policy_type" text DEFAULT 'original' NOT NULL,
	"mode" "bonzah_mode" NOT NULL,
	"quote_id" text NOT NULL,
	"quote_no" text,
	"payment_id" text,
	"policy_no" text,
	"policy_id" text,
	"coverage" jsonb NOT NULL,
	"trip_start_date" date NOT NULL,
	"trip_end_date" date NOT NULL,
	"pickup_state" text NOT NULL,
	"premium_amount" numeric(12, 2) NOT NULL,
	"renter_details" jsonb NOT NULL,
	"status" "bonzah_policy_status" DEFAULT 'quoted' NOT NULL,
	"policy_issued_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bonzah_policies_date_order" CHECK ("bonzah_insurance_policies"."trip_end_date" >= "bonzah_insurance_policies"."trip_start_date")
);
--> statement-breakpoint
CREATE TABLE "reminder_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"config_key" text NOT NULL,
	"config_value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_code" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"severity" "reminder_severity" DEFAULT 'info' NOT NULL,
	"context" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "integration_bonzah" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "bonzah_mode" "bonzah_mode" DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "bonzah_username" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "bonzah_password_encrypted" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "bonzah_brochure_url" text;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "insurance_premium" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "insurance_status" "insurance_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "bonzah_insurance_policies" ADD CONSTRAINT "bonzah_insurance_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonzah_insurance_policies" ADD CONSTRAINT "bonzah_insurance_policies_rental_id_rentals_id_fk" FOREIGN KEY ("rental_id") REFERENCES "public"."rentals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonzah_insurance_policies" ADD CONSTRAINT "bonzah_insurance_policies_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_configs" ADD CONSTRAINT "reminder_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bonzah_policies_tenant_quote_idx" ON "bonzah_insurance_policies" USING btree ("tenant_id","quote_id");--> statement-breakpoint
CREATE INDEX "bonzah_policies_rental_idx" ON "bonzah_insurance_policies" USING btree ("tenant_id","rental_id");--> statement-breakpoint
CREATE INDEX "bonzah_policies_chain_idx" ON "bonzah_insurance_policies" USING btree ("tenant_id","chain_id");--> statement-breakpoint
CREATE INDEX "bonzah_policies_status_idx" ON "bonzah_insurance_policies" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_configs_tenant_key_idx" ON "reminder_configs" USING btree ("tenant_id","config_key");--> statement-breakpoint
CREATE INDEX "reminders_tenant_active_idx" ON "reminders" USING btree ("tenant_id","resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "reminders_tenant_rule_idx" ON "reminders" USING btree ("tenant_id","rule_code");