/**
 * Opt-in diagnostic for Supabase configuration.
 *
 * Database tables are deliberately not queried here. This helper may be run
 * while the login page is anonymous, where RLS-protected queries are expected
 * to fail and would create a misleading Next.js console-error overlay.
 */

import { supabase } from './supabase';

export async function testSupabaseConfig() {
  console.group('🔍 Supabase Configuration Diagnostic');

  // Check environment variables
  console.log('Environment Variables:');
  console.log('- NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL || 'NOT SET');
  console.log('- NEXT_PUBLIC_SUPABASE_ANON_KEY:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✓ SET (length: ' + process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.length + ')' : '✗ NOT SET');
  console.log('- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? '✓ SET' : '✗ NOT SET');

  // Check runtime Supabase client configuration
  console.log('\nSupabase Client:');
  // @ts-ignore - accessing private properties for diagnostic
  const clientUrl = supabase.supabaseUrl;
  // @ts-ignore - accessing private properties for diagnostic
  const clientKey = supabase.supabaseKey;

  console.log('- URL:', clientUrl);
  console.log('- Key length:', clientKey?.length || 'NOT SET');
  console.log('- Key valid format:', clientKey?.startsWith('eyJ') ? '✓ YES' : '✗ NO');
  console.log('- Key ends with placeholder:', clientKey?.endsWith('.placeholder') ? '✗ YES (INVALID!)' : '✓ NO');

  // Test actual API connection
  console.log('\nAPI Connection Test:');
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('✗ Session check failed:', error.message);
      console.error('  Status:', error.status);
    } else {
      console.log('✓ Session check successful');
    }
  } catch (err) {
    console.error('✗ Connection failed:', err);
  }

  console.groupEnd();

  return {
    envVarsSet: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    keyValid: clientKey?.startsWith('eyJ') && !clientKey?.endsWith('.placeholder'),
    url: clientUrl,
  };
}
