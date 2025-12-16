import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hviqoaokxvlancmftwuo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q";

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