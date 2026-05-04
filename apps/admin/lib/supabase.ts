import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hviqoaokxvlancmftwuo.supabase.co';
// Use the actual anon key for the project
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
                        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
                        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

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
