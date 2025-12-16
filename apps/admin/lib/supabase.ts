import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hviqoaokxvlancmftwuo.supabase.co';
// Use the actual anon key for the project
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
                        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
                        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
