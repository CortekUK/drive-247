import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleAdjustCustomerBalance } from "./core.ts";

/**
 * adjust-customer-balance — the Deno entry point. Everything it does lives in
 * core.ts (so the offline contract test can drive the real handler with a
 * recording fake client); this file only wires the clients.
 *
 * createAuthClient is the anon-key client the v1 staff check verifies the
 * caller's JWT with (a bare anon or service key carries no `sub`, so it is never
 * a user) — the choice _shared/deposit-hold-auth.ts makes. Without
 * SUPABASE_ANON_KEY the service-role client does the same GoTrue check.
 */
Deno.serve((req) =>
  handleAdjustCustomerBalance(req, {
    createAdminClient: () =>
      createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      ),
    createAuthClient: () => {
      const url = Deno.env.get("SUPABASE_URL") ?? "";
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      return url && anonKey ? createClient(url, anonKey) : null;
    },
  }),
);
