-- Add tenant_id to view_customer_statements so it can be filtered per-tenant.
-- Without this column, the Reports page in the portal cannot scope statements
-- by tenant and ends up showing data from other tenants.

DROP VIEW IF EXISTS "public"."view_customer_statements";

CREATE OR REPLACE VIEW "public"."view_customer_statements" AS
 SELECT "le"."customer_id",
    "c"."tenant_id",
    "c"."name" AS "customer_name",
    "c"."email" AS "customer_email",
    "c"."phone" AS "customer_phone",
    "le"."id" AS "entry_id",
    "le"."entry_date",
    "le"."type",
    "le"."category",
    "le"."amount",
    "le"."remaining_amount",
    "le"."due_date",
    "le"."rental_id",
    "le"."vehicle_id",
    "v"."reg" AS "vehicle_reg",
    "v"."make" AS "vehicle_make",
    "v"."model" AS "vehicle_model",
        CASE
            WHEN ("le"."type" = 'Payment'::"text") THEN "le"."amount"
            ELSE (- "le"."amount")
        END AS "transaction_amount",
    "sum"(
        CASE
            WHEN ("le"."type" = 'Payment'::"text") THEN "le"."amount"
            ELSE (- "le"."amount")
        END) OVER (PARTITION BY "le"."customer_id" ORDER BY "le"."entry_date", "le"."id" ROWS UNBOUNDED PRECEDING) AS "running_balance"
   FROM (("public"."ledger_entries" "le"
     JOIN "public"."customers" "c" ON (("c"."id" = "le"."customer_id")))
     LEFT JOIN "public"."vehicles" "v" ON (("v"."id" = "le"."vehicle_id")))
  WHERE (("le"."type" <> 'Upcoming'::"text") OR ("le"."type" IS NULL))
  ORDER BY "le"."customer_id", "le"."entry_date", "le"."id";

ALTER VIEW "public"."view_customer_statements" OWNER TO "postgres";

GRANT ALL ON TABLE "public"."view_customer_statements" TO "anon";
GRANT ALL ON TABLE "public"."view_customer_statements" TO "authenticated";
GRANT ALL ON TABLE "public"."view_customer_statements" TO "service_role";
