/**
 * Test Master Password Authentication
 *
 * This script simulates the master password login flow used by the super admin portal.
 * It verifies that master passwords work correctly for both rental companies.
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = 'https://hviqoaokxvlancmftwuo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Hash master password using SHA-256 (same as the UI does)
async function hashMasterPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Test master password login by calling the get-tenant-by-master-password edge function
 * This is the same approach the super admin login page uses.
 */
async function testMasterPasswordViaEdgeFunction(slug, masterPassword) {
  console.log(`\n🔐 Testing Master Password for: ${slug}`);
  console.log('─────────────────────────────────────────────────────');

  try {
    // Hash the password
    const hashedPassword = await hashMasterPassword(masterPassword);

    console.log(`   Slug: ${slug}`);
    console.log(`   Master Password: ${masterPassword.substring(0, 10)}...`);
    console.log(`   Hashed: ${hashedPassword.substring(0, 20)}...`);

    // Call the edge function that super admin login uses
    const { data, error } = await supabase.functions.invoke('get-tenant-by-master-password', {
      body: {
        slug: slug,
        masterPasswordHash: hashedPassword
      }
    });

    if (error) {
      console.log(`\n❌ FAILED: ${error.message}`);
      return false;
    }

    if (!data || !data.tenant) {
      console.log(`\n❌ FAILED: No tenant returned from edge function`);
      return false;
    }

    console.log(`\n✅ SUCCESS: Master password is valid!`);
    console.log(`   Tenant ID: ${data.tenant.id}`);
    console.log(`   Company Name: ${data.tenant.company_name}`);
    console.log(`   Status: ${data.tenant.status}`);
    console.log(`   Contact Email: ${data.tenant.contact_email}`);

    return true;

  } catch (error) {
    console.log(`\n❌ ERROR: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  MASTER PASSWORD AUTHENTICATION TEST');
  console.log('═══════════════════════════════════════════════════════');
  console.log('\nThis test uses the same edge function that the super admin');
  console.log('login page uses to verify master passwords.\n');

  const credentials = {
    fleetvana: {
      slug: 'fleetvana',
      masterPassword: 'fv&Un%&bE9%cT!Ti3gtncxdcK*Rg9rYY'
    },
    globalMotion: {
      slug: 'globalmotiontransport',
      masterPassword: 'fNn4r*tBdrfEXL4AoVDC!dqA1N08tC7$'
    }
  };

  let passedTests = 0;
  let totalTests = 0;

  // Test FleetVana
  console.log('\n🔵 TESTING FLEETVANA');
  console.log('═══════════════════════════════════════════════════════');
  totalTests++;
  if (await testMasterPasswordViaEdgeFunction(
    credentials.fleetvana.slug,
    credentials.fleetvana.masterPassword
  )) {
    passedTests++;
  }

  // Test Global Motion Transport
  console.log('\n\n🟡 TESTING GLOBAL MOTION TRANSPORT');
  console.log('═══════════════════════════════════════════════════════');
  totalTests++;
  if (await testMasterPasswordViaEdgeFunction(
    credentials.globalMotion.slug,
    credentials.globalMotion.masterPassword
  )) {
    passedTests++;
  }

  // Summary
  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log(`  TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (passedTests === totalTests) {
    console.log('🎉 ALL TESTS PASSED!\n');
    console.log('✅ Both rental companies are correctly configured');
    console.log('✅ Master password authentication is working');
    console.log('\nYou can now:');
    console.log('1. Login at http://localhost:3003/admin/login with these master passwords');
    console.log('2. Access the super admin dashboard');
    console.log('3. Manage both rental companies\n');
    process.exit(0);
  } else {
    console.log(`⚠️  ${totalTests - passedTests} TEST(S) FAILED\n`);
    console.log('Possible issues:');
    console.log('- Master password might be incorrect');
    console.log('- Tenant might not exist in database');
    console.log('- Edge function might not be deployed');
    console.log('- RLS policies might be blocking access\n');
    process.exit(1);
  }
}

main();
