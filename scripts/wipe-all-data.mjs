#!/usr/bin/env node

/**
 * Nuclear wipe script - Deletes ALL data from the database
 * Run with: node scripts/wipe-all-data.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hviqoaokxvlancmftwuo.supabase.co';

// You'll need to provide the service role key
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  console.log('\nTo run this script:');
  console.log('SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" node scripts/wipe-all-data.mjs');
  console.log('\nYou can find your service role key at:');
  console.log('https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/settings/api');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Tables to delete in order (child tables first)
const tablesToDelete = [
  // Reminder system
  'reminder_actions',
  'reminder_events',
  'reminder_logs',
  'reminder_emails',
  'reminders',
  'reminder_rules',

  // Notifications
  'notifications',

  // Payment system
  'payment_applications',
  'authority_payments',
  'ledger_entries',
  'pnl_entries',
  'payments',

  // Fines
  'fine_files',
  'fines',

  // Insurance
  'insurance_documents',
  'insurance_policies',

  // Vehicle related
  'vehicle_files',
  'vehicle_events',
  'vehicle_photos',
  'service_records',
  'vehicle_expenses',
  'plates',

  // Invoices and charges
  'invoices',
  'charges',

  // Rentals
  'rentals',

  // Vehicles
  'vehicles',

  // Customer related
  'customer_documents',
  'identity_verifications',

  // Customers
  'customers',

  // CMS
  'cms_page_versions',
  'cms_page_sections',
  'cms_pages',

  // Email and logs
  'email_logs',
  'audit_logs',
  'login_attempts',
  'maintenance_runs',

  // Feedback and contact
  'feedback_submissions',
  'contact_requests',

  // Settings
  'org_settings',
  'pricing_extras',

  // Users
  'app_users',

  // Global passwords
  'global_master_passwords',

  // Tenants (last)
  'tenants',
];

async function deleteAllFromTable(tableName) {
  try {
    // Use a condition that matches all rows
    const { error } = await supabase
      .from(tableName)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) {
      // Try with gte on created_at if id doesn't work
      const { error: error2 } = await supabase
        .from(tableName)
        .delete()
        .gte('created_at', '1970-01-01');

      if (error2) {
        console.log(`  ⚠️  ${tableName}: ${error2.message}`);
        return false;
      }
    }

    console.log(`  ✅ ${tableName}: deleted`);
    return true;
  } catch (err) {
    console.log(`  ❌ ${tableName}: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('🔥 NUCLEAR WIPE - Deleting ALL data from database...\n');

  let successCount = 0;
  let failCount = 0;

  for (const table of tablesToDelete) {
    const success = await deleteAllFromTable(table);
    if (success) successCount++;
    else failCount++;
  }

  console.log('\n========================================');
  console.log(`✅ Successfully wiped: ${successCount} tables`);
  console.log(`⚠️  Skipped/failed: ${failCount} tables`);
  console.log('========================================');

  console.log('\n⚠️  NOTE: Auth users (auth.users) must be deleted manually via:');
  console.log('https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/auth/users');

  console.log('\n🎉 Database wipe complete!');
}

main().catch(console.error);
