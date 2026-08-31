import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

/**
 * v1 (apps/booking) hardcodes the PRODUCTION url + anon key as fallbacks here, so
 * a missing `.env.local` silently points the whole app at live customer data.
 * v2 refuses to do that: a missing variable is a hard, named failure at module
 * load, which surfaces during `next build` rather than as production writes from
 * a developer's laptop.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL is not set. Create v2/apps/web/.env.local with the " +
      "Supabase project URL and anon key. There is deliberately no fallback — " +
      "without it the app would otherwise talk to production.",
  );
}

if (!SUPABASE_ANON_KEY) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Create v2/apps/web/.env.local with the " +
      "Supabase project URL and anon key. There is deliberately no fallback — " +
      "without it the app would otherwise talk to production.",
  );
}

// No-op storage for SSR / edge, where `window` does not exist.
const noopStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/**
 * Typed browser client. Works in both the browser and during SSR — session
 * persistence is switched off wherever `window` is unavailable.
 *
 * import { supabase } from "@/integrations/supabase/client";
 */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? window.localStorage : noopStorage,
    persistSession: typeof window !== "undefined",
    autoRefreshToken: true,
    detectSessionInUrl: typeof window !== "undefined",
  },
});

/**
 * Untyped escape hatch for queries against columns that are not yet in the
 * generated `Database` types. Use sparingly — prefer the typed client.
 *
 * This is a re-typing of the SAME instance, not a second client: constructing a
 * second one would spin up a second auth client against the same storage key and
 * the two would fight over the session.
 */
export const supabaseUntyped = supabase as unknown as SupabaseClient;
