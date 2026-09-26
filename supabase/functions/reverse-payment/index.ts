import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleReversePayment } from "./core.ts";

/**
 * reverse-payment — the Deno entry point. Everything it does, including who may
 * call it, lives in core.ts; this file only wires the clients.
 *
 * The anon-key client verifies the caller's JWT (a bare anon or service key
 * carries no `sub`, so it is never a user) — the same choice
 * _shared/deposit-hold-auth.ts makes. Without SUPABASE_ANON_KEY the service-role
 * client does the same GoTrue check with a different apikey.
 */
serve((req) =>
  handleReversePayment(req, {
    createAdminClient: () =>
      createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      ),
    createAuthClient: () => {
      const url = Deno.env.get("SUPABASE_URL") ?? "";
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      return url && anonKey ? createClient(url, anonKey) : null;
    },
  })
);
