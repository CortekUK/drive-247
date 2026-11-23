import { createClient } from '@supabase/supabase-js';

/**
 * The developer hub talks to PRODUCTION (Ghulam, 2026-11-23). Its Onboarding
 * tab keeps the test emails list that the live signup reads, and drive-247.com
 * and localhost:4003 both run that same signup, so staging could not reach it.
 * Every action goes through the `dev-signup-rehearsal` edge function, which
 * checks for a super admin. `.env.local` (and the Vercel project, once
 * deployed) carry the URL and anon key; there is deliberately no fallback, so
 * a missing variable fails loudly.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Developer hub: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.');
}

// SSR-safe storage: only the browser has localStorage.
const getStorage = () => (typeof window !== 'undefined' ? localStorage : undefined);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: getStorage(),
    // Its own key, so a session here never collides with another Drive247
    // app open on the same origin in development.
    storageKey: 'drive247-developer-auth',
    persistSession: true,
    autoRefreshToken: true,
  },
});
