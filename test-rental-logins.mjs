/**
 * Test script to verify rental company logins
 *
 * This tests:
 * 1. Master password login for both companies
 * 2. Admin credentials login for both companies
 * 3. Branding verification (FleetVana should have blue primary color)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://hviqoaokxvlancmftwuo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function hashMasterPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

async function testMasterPasswordLogin(slug, masterPassword) {
  console.log(`\n🔐 Testing master password login for: ${slug}`);

  try {
    // Fetch tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'active')
      .single();

    if (tenantError || !tenant) {
      console.log(`❌ Tenant not found: ${slug}`);
      return false;
    }

    console.log(`✅ Tenant found: ${tenant.company_name}`);

    // Verify master password
    const hashedInput = await hashMasterPassword(masterPassword);
    const isValid = hashedInput === tenant.master_password_hash;

    if (isValid) {
      console.log(`✅ Master password is valid!`);
      return true;
    } else {
      console.log(`❌ Master password is invalid`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error:`, error.message);
    return false;
  }
}

async function testAdminLogin(email, password) {
  console.log(`\n👤 Testing admin login: ${email}`);

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.log(`❌ Login failed: ${error.message}`);
      return false;
    }

    console.log(`✅ Login successful!`);
    console.log(`   User ID: ${data.user.id}`);
    console.log(`   Email: ${data.user.email}`);

    // Check app_users table
    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('*, tenants(company_name, slug)')
      .eq('auth_user_id', data.user.id)
      .single();

    if (!appUserError && appUser) {
      console.log(`✅ App user found:`);
      console.log(`   Name: ${appUser.name}`);
      console.log(`   Role: ${appUser.role}`);
      console.log(`   Company: ${appUser.tenants.company_name}`);
    }

    // Sign out
    await supabase.auth.signOut();

    return true;
  } catch (error) {
    console.log(`❌ Error:`, error.message);
    return false;
  }
}

async function testBranding(slug, expectedPrimaryColor) {
  console.log(`\n🎨 Testing branding for: ${slug}`);

  try {
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('slug', slug)
      .single();

    if (error || !tenant) {
      console.log(`❌ Tenant not found`);
      return false;
    }

    console.log(`✅ Tenant branding:`);
    console.log(`   App Name: ${tenant.app_name || 'Not set'}`);
    console.log(`   Primary Color: ${tenant.primary_color || 'Not set'}`);
    console.log(`   Secondary Color: ${tenant.secondary_color || 'Not set'}`);

    if (expectedPrimaryColor) {
      const matches = tenant.primary_color?.toLowerCase() === expectedPrimaryColor.toLowerCase();
      if (matches) {
        console.log(`✅ Primary color matches expected: ${expectedPrimaryColor}`);
        return true;
      } else {
        console.log(`❌ Primary color mismatch. Expected: ${expectedPrimaryColor}, Got: ${tenant.primary_color}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.log(`❌ Error:`, error.message);
    return false;
  }
}

async function runTests(credentials) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RENTAL COMPANY LOGIN TESTS');
  console.log('═══════════════════════════════════════════════════════\n');

  let passedTests = 0;
  let totalTests = 0;

  // Test FleetVana
  if (credentials.fleetvana) {
    const fv = credentials.fleetvana;

    console.log('\n🔵 TESTING FLEETVANA\n');
    console.log('─────────────────────────────────────────────────────');

    totalTests++;
    if (await testMasterPasswordLogin(fv.slug, fv.masterPassword)) passedTests++;

    totalTests++;
    if (await testAdminLogin(fv.adminEmail, fv.adminPassword)) passedTests++;

    totalTests++;
    if (await testBranding(fv.slug, '#3B82F6')) passedTests++; // Blue
  }

  // Test Global Motion Transport
  if (credentials.globalMotion) {
    const gmt = credentials.globalMotion;

    console.log('\n\n🟡 TESTING GLOBAL MOTION TRANSPORT\n');
    console.log('─────────────────────────────────────────────────────');

    totalTests++;
    if (await testMasterPasswordLogin(gmt.slug, gmt.masterPassword)) passedTests++;

    totalTests++;
    if (await testAdminLogin(gmt.adminEmail, gmt.adminPassword)) passedTests++;

    totalTests++;
    if (await testBranding(gmt.slug, '#C6A256')) passedTests++; // Default gold
  }

  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log(`  TEST RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (passedTests === totalTests) {
    console.log('🎉 ALL TESTS PASSED!\n');
    process.exit(0);
  } else {
    console.log(`⚠️  ${totalTests - passedTests} TEST(S) FAILED\n`);
    process.exit(1);
  }
}

async function main() {
  // Try to load credentials from file
  try {
    const fs = await import('fs');
    const credentialsData = fs.readFileSync('rental-companies-credentials.json', 'utf8');
    const credentials = JSON.parse(credentialsData);

    await runTests(credentials);
  } catch (error) {
    console.error('❌ Error loading credentials file:', error.message);
    console.log('\nPlease create the rental companies first using:');
    console.log('  node create-rental-companies.mjs');
    console.log('\nOr provide credentials manually in the script.');
    process.exit(1);
  }
}

main();
