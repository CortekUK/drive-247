/**
 * Reset Super Admin Password
 *
 * This script uses the Supabase Admin API to reset the password for admin@cortek.io
 * to Admin@Cortek2024
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://hviqoaokxvlancmftwuo.supabase.co';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceRoleKey) {
  console.error('\n❌ ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is required\n');
  console.log('To get your service role key:');
  console.log('1. Go to Supabase Dashboard → Settings → API');
  console.log('2. Copy the "service_role" secret key (not the anon key)');
  console.log('3. Run this script with:');
  console.log('   SUPABASE_SERVICE_ROLE_KEY="your-service-key" node reset-super-admin-password.mjs\n');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function resetPassword() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RESETTING SUPER ADMIN PASSWORD');
  console.log('═══════════════════════════════════════════════════════\n');

  const userId = '979d59ae-b597-4ae3-bacf-73715af538ab';
  const newPassword = 'Admin@Cortek2024';

  console.log('Target user ID:', userId);
  console.log('Email: admin@cortek.io');
  console.log('New password: Admin@Cortek2024\n');

  try {
    // Use admin API to update user password
    const { data, error } = await supabase.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (error) {
      console.log('❌ ERROR:', error.message);
      console.log('\nPossible issues:');
      console.log('- Service role key might be incorrect');
      console.log('- User ID might not exist');
      console.log('- API permissions issue\n');
      process.exit(1);
    }

    console.log('✅ PASSWORD RESET SUCCESSFUL!\n');
    console.log('User details:');
    console.log('  ID:', data.user.id);
    console.log('  Email:', data.user.email);
    console.log('  Updated at:', new Date(data.user.updated_at).toLocaleString());
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  YOU CAN NOW LOGIN WITH:');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('  Email: admin@cortek.io');
    console.log('  Password: Admin@Cortek2024\n');
    console.log('  Login URLs:');
    console.log('  - http://localhost:3003/admin/login (super admin)');
    console.log('  - http://localhost:3001/login (rental portals)\n');

  } catch (error) {
    console.log('❌ UNEXPECTED ERROR:', error.message);
    process.exit(1);
  }
}

resetPassword();
