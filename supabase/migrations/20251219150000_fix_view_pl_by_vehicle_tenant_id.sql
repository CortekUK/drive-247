-- Fix view_pl_by_vehicle to include tenant_id for multi-tenant filtering
-- This resolves 400 Bad Request errors when filtering the view by tenant_id

-- Drop and recreate since we're adding a column
DROP VIEW IF EXISTS "public"."view_pl_by_vehicle";

CREATE VIEW "public"."view_pl_by_vehicle" AS
 SELECT "v"."id" AS "vehicle_id",
    "v"."tenant_id",
    "v"."reg" AS "vehicle_reg",
    "concat"("v"."make", ' ', "v"."model") AS "make_model",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Revenue'::"text") AND ("pe"."category" = 'Rental'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "revenue_rental",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Revenue'::"text") AND ("pe"."category" = 'Initial Fees'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "revenue_fees",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Revenue'::"text") AND ("pe"."category" = 'Other'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "revenue_other",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Acquisition'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_acquisition",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Finance'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_finance",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Service'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_service",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Fines'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_fines",
    COALESCE("sum"(
        CASE
            WHEN (("pe"."side" = 'Cost'::"text") AND ("pe"."category" = 'Other'::"text")) THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "cost_other",
    COALESCE("sum"(
        CASE
            WHEN ("pe"."side" = 'Revenue'::"text") THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "total_revenue",
    COALESCE("sum"(
        CASE
            WHEN ("pe"."side" = 'Cost'::"text") THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) AS "total_costs",
    (COALESCE("sum"(
        CASE
            WHEN ("pe"."side" = 'Revenue'::"text") THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric) - COALESCE("sum"(
        CASE
            WHEN ("pe"."side" = 'Cost'::"text") THEN "pe"."amount"
            ELSE NULL::numeric
        END), (0)::numeric)) AS "net_profit"
   FROM ("public"."vehicles" "v"
     LEFT JOIN "public"."pnl_entries" "pe" ON (("pe"."vehicle_id" = "v"."id")))
  GROUP BY "v"."id", "v"."tenant_id", "v"."reg", "v"."make", "v"."model";

-- Restore grants
GRANT ALL ON TABLE "public"."view_pl_by_vehicle" TO "anon";
GRANT ALL ON TABLE "public"."view_pl_by_vehicle" TO "authenticated";
GRANT ALL ON TABLE "public"."view_pl_by_vehicle" TO "service_role";
