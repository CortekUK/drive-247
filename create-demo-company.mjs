import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = 'https://hviqoaokxvlancmftwuo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Generate master password
function generateMasterPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 32; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Hash master password using SHA-256 (matching browser implementation)
async function hashMasterPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

// Generate random password for admin user
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

async function main() {
  try {
    console.log('\n🚀 Creating Demo Rental Company...\n');

    // Step 1: Create the tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert([
        {
          company_name: 'Demo Rentals',
          slug: 'demo-rental',
          contact_email: 'admin@demo-rental.com',
          status: 'active',
        }
      ])
      .select()
      .single();

    if (tenantError) {
      console.error('❌ Error creating tenant:', tenantError);
      return;
    }

    console.log('✅ Rental Company Created!');
    console.log('   Company Name:', tenant.company_name);
    console.log('   Slug:', tenant.slug);
    console.log('   Contact Email:', tenant.contact_email);
    console.log('   Status:', tenant.status);

    // Step 2: Generate and save master password
    const masterPassword = generateMasterPassword();
    const masterPasswordHash = await hashMasterPassword(masterPassword);

    const { error: updateError } = await supabase
      .from('tenants')
      .update({ master_password_hash: masterPasswordHash })
      .eq('id', tenant.id);

    if (updateError) {
      console.error('❌ Error updating master password:', updateError);
      return;
    }

    console.log('\n✅ MASTER PASSWORD GENERATED:');
    console.log('   Password:', masterPassword);
    console.log('   ⚠️  SAVE THIS SECURELY - IT WON\'T BE SHOWN AGAIN!');

    // Step 3: Create admin user account
    const adminEmail = 'admin@demo-rental.com';
    const adminPassword = generatePassword();

    console.log('\n📧 Creating admin user in Supabase Auth...');

    // Note: This requires service role key, so we'll provide manual instructions instead
    console.log('\n✅ INITIAL ADMIN USER CREDENTIALS:');
    console.log('   Email:', adminEmail);
    console.log('   Password:', adminPassword);
    console.log('\n   ⚠️  NOTE: You need to create this user manually:');
    console.log('   1. Go to Supabase Dashboard > Authentication > Users');
    console.log('   2. Click "Add user" > "Create new user"');
    console.log('   3. Enter email:', adminEmail);
    console.log('   4. Enter password:', adminPassword);
    console.log('   5. Then run the following SQL in Supabase SQL Editor:');
    console.log('');
    console.log('   INSERT INTO app_users (auth_user_id, tenant_id, email, name, role, is_active)');
    console.log('   SELECT');
    console.log('     (SELECT id FROM auth.users WHERE email = \'' + adminEmail + '\'),');
    console.log('     \'' + tenant.id + '\',');
    console.log('     \'' + adminEmail + '\',');
    console.log('     \'Admin User\',');
    console.log('     \'head_admin\',');
    console.log('     true;');
    console.log('');

    console.log('\n🌐 ACCESS URLs:');
    console.log('   Portal (Admin): http://localhost:3001/login');
    console.log('   Booking Site: http://localhost:8080');
    console.log('');
    console.log('💡 TIP: Use the master password to log into the portal without creating the admin user first.');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main();
