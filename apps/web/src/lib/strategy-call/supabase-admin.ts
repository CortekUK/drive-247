import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Server-only client. Never import this module from a client component. */
export function getStrategyCallAdminClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("The strategy-call admin client is server-only");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Strategy-call server storage is not configured");
  }

  if (!client) {
    client = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

