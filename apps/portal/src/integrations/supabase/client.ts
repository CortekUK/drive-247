import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// No fallback values on purpose. A literal default here silently points a
// staging (or local) build at PRODUCTION whenever the env is missing, which is
// exactly the failure it looks like it is protecting against.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Set both in apps/portal/.env.local before building or running the portal.',
  );
}

// Re-exported so callers that hand-build edge-function URLs use these validated
// values instead of re-deriving them with their own hardcoded fallback.
export const SUPABASE_URL_VALIDATED = SUPABASE_URL;
export const SUPABASE_ANON_KEY_VALIDATED = SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

// Use a function to safely access localStorage (for SSR compatibility)
const getStorage = () => {
  if (typeof window !== 'undefined') {
    return localStorage;
  }
  return undefined;
};

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: getStorage(),
    persistSession: true,
    autoRefreshToken: true,
  }
});

// Untyped client for queries that cause type instantiation depth issues
export const supabaseUntyped = supabase as any;
