// payment-reallocate — the Deno entry point. Everything the function does
// lives in core.ts (so the offline suite drives the real handler against real
// Postgres); this file only wires the service-role client and the canary list.
//
// Actions, auth and error contract: see core.ts. SQL: supabase/migrations/
// 20260926120100_payment_reallocation.sql (payment_reallocate,
// charge_recompute_remaining, bill_reconcile_options).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handlePaymentReallocate } from "./core.ts";

Deno.serve((req) =>
  handlePaymentReallocate(req, {
    createAdminClient: () =>
      createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""),
    tenantSlugs: Deno.env.get("PAYMENT_RECONCILE_TENANT_SLUGS") ?? null,
  }),
);
