CREATE TYPE "public"."tenant_status" AS ENUM('active', 'inactive', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."tenant_type" AS ENUM('production', 'test');--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."tenant_status";--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "status" SET DATA TYPE "public"."tenant_status" USING "status"::"public"."tenant_status";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "admin_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tenant_type" "tenant_type" DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_ends_at" timestamp with time zone;