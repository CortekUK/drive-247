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

// Hash master password using SHA-256
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

async function createCompany(companyName, slug, contactEmail, brandingColors) {
  try {
    console.log(`\n🚀 Creating ${companyName}...`);

    // Step 1: Create the tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert([
        {
          company_name: companyName,
          slug: slug,
          contact_email: contactEmail,
          status: 'active',
          app_name: companyName,
          ...brandingColors
        }
      ])
      .select()
      .single();

    if (tenantError) {
      console.error('❌ Error creating tenant:', tenantError);
      return null;
    }

    console.log('✅ Company Created!');
    console.log('   Company Name:', tenant.company_name);
    console.log('   Slug:', tenant.slug);
    console.log('   Subdomain:', `${tenant.slug}.drive-247.com`);

    // Step 2: Generate and save master password
    const masterPassword = generateMasterPassword();
    const masterPasswordHash = await hashMasterPassword(masterPassword);

    const { error: updateError } = await supabase
      .from('tenants')
      .update({ master_password_hash: masterPasswordHash })
      .eq('id', tenant.id);

    if (updateError) {
      console.error('❌ Error updating master password:', updateError);
      return null;
    }

    console.log('\n✅ MASTER PASSWORD GENERATED:');
    console.log('   Password:', masterPassword);
    console.log('   ⚠️  SAVE THIS SECURELY!');

    // Step 3: Generate admin credentials
    const adminEmail = contactEmail;
    const adminPassword = generatePassword();

    console.log('\n✅ ADMIN USER CREDENTIALS:');
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
    console.log('   Portal (Admin): https://' + slug + '.drive-247.com/dashboard');
    console.log('   Booking Site: https://' + slug + '.drive-247.com');
    console.log('');

    return {
      tenantId: tenant.id,
      companyName: companyName,
      slug: slug,
      subdomain: `${slug}.drive-247.com`,
      contactEmail: contactEmail,
      masterPassword: masterPassword,
      adminEmail: adminEmail,
      adminPassword: adminPassword,
      portalUrl: `https://${slug}.drive-247.com/dashboard`,
      bookingUrl: `https://${slug}.drive-247.com`
    };

  } catch (error) {
    console.error('❌ Error:', error);
    return null;
  }
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Creating Rental Companies with Credentials');
  console.log('═══════════════════════════════════════════════════════\n');

  // Create FleetVana with blue primary color
  const fleetvana = await createCompany(
    'FleetVana',
    'fleetvana',
    'admin@fleetvana.com',
    {
      primary_color: '#3B82F6',      // Blue
      secondary_color: '#3B82F6',    // Blue
      accent_color: '#3B82F6',       // Blue
      light_primary_color: '#3B82F6',
      dark_primary_color: '#2563EB'
    }
  );

  console.log('\n───────────────────────────────────────────────────────\n');

  // Create Global Motion Transport with default colors
  const globalMotion = await createCompany(
    'Global Motion Transport',
    'globalmotiontransport',
    'admin@globalmotiontransport.com',
    {
      primary_color: '#C6A256',
      secondary_color: '#C6A256',
      accent_color: '#C6A256'
    }
  );

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SUMMARY - SAVE THESE CREDENTIALS');
  console.log('═══════════════════════════════════════════════════════\n');

  if (fleetvana) {
    console.log('🔵 FLEETVANA:');
    console.log('   Subdomain: fleetvana.drive-247.com');
    console.log('   Master Password:', fleetvana.masterPassword);
    console.log('   Admin Email:', fleetvana.adminEmail);
    console.log('   Admin Password:', fleetvana.adminPassword);
    console.log('   Portal: https://fleetvana.drive-247.com/dashboard');
    console.log('   Booking: https://fleetvana.drive-247.com\n');
  }

  if (globalMotion) {
    console.log('🟡 GLOBAL MOTION TRANSPORT:');
    console.log('   Subdomain: globalmotiontransport.drive-247.com');
    console.log('   Master Password:', globalMotion.masterPassword);
    console.log('   Admin Email:', globalMotion.adminEmail);
    console.log('   Admin Password:', globalMotion.adminPassword);
    console.log('   Portal: https://globalmotiontransport.drive-247.com/dashboard');
    console.log('   Booking: https://globalmotiontransport.drive-247.com\n');
  }

  console.log('═══════════════════════════════════════════════════════\n');

  // Save to JSON file for testing
  const credentials = {
    fleetvana,
    globalMotion
  };

  const fs = await import('fs');
  fs.writeFileSync(
    'rental-companies-credentials.json',
    JSON.stringify(credentials, null, 2)
  );

  console.log('✅ Credentials saved to: rental-companies-credentials.json\n');
}

main();
