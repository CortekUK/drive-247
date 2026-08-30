import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Fail loudly rather than falling back to a hardcoded project. A baked-in
// default silently pointed this app at production whenever the env was
// missing or mis-scoped, which is exactly the mistake a staging build must
// not be able to make.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Set them in .env.local (local) or the Vercel project env (deployed).',
  );
}

export { supabaseUrl };

// SSR-safe storage getter. Without explicit auth config, the module evaluated
// during SSR can initialise the client with no storage, and that bare instance
// may persist into the browser — leaving requests un-authenticated, so
// auth.uid() is null at the DB and is_super_admin() returns false, making
// every RLS-gated INSERT fail with "new row violates row-level security
// policy" even for the logged-in super admin.
const getStorage = () => {
  if (typeof window !== 'undefined') {
    return localStorage;
  }
  return undefined;
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: getStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});
