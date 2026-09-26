import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleAdjustCustomerBalance } from "./core.ts";

/**
 * adjust-customer-balance — the Deno entry point. Everything it does lives in
 * core.ts (so the offline contract test can drive the real handler with a
 * recording fake client); this file only wires the service-role client.
 */
Deno.serve((req) =>
  handleAdjustCustomerBalance(req, {
    createAdminClient: () =>
      createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      ),
  }),
);
