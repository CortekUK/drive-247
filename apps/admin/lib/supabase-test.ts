/**
 * Diagnostic test for Supabase configuration
 * Run this to verify environment variables and API key are loaded correctly
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

  // Test public query (should work with anon key)
  console.log('\nDatabase Query Test:');
  try {
    const { data, error } = await supabase
      .from('tenants')
      .select('count')
      .limit(1);

    if (error) {
      console.error('✗ Query failed:', error.message);
      console.error('  Code:', error.code);
      console.error('  Details:', error.details);
    } else {
      console.log('✓ Query successful');
    }
  } catch (err) {
    console.error('✗ Query error:', err);
  }

  console.groupEnd();

  return {
    envVarsSet: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    keyValid: clientKey?.startsWith('eyJ') && !clientKey?.endsWith('.placeholder'),
    url: clientUrl,
  };
}

// Auto-run in development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  testSupabaseConfig();
}
