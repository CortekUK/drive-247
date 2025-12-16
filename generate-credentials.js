import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = 'https://hviqoaokxvlancmftwuo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Generate master password
function generateMasterPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 24; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Hash master password
async function hashMasterPassword(password) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, 'platform-salt-v1', 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });
}

async function main() {
  try {
    // Get the demo tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('*')
      .eq('slug', 'demo-rental')
      .single();

    if (tenantError) {
      console.error('Error fetching tenant:', tenantError);
      return;
    }

    console.log('\n=== DEMO RENTAL COMPANY ===');
    console.log('Company Name:', tenant.company_name);
    console.log('Slug:', tenant.slug);
    console.log('Contact Email:', tenant.contact_email);
    
    // Generate and update master password
    const masterPassword = generateMasterPassword();
    const masterPasswordHash = await hashMasterPassword(masterPassword);

    const { error: updateError } = await supabase
      .from('tenants')
      .update({ master_password_hash: masterPasswordHash })
      .eq('id', tenant.id);

    if (updateError) {
      console.error('Error updating master password:', updateError);
      return;
    }

    console.log('\n✅ MASTER PASSWORD GENERATED:');
    console.log('Master Password:', masterPassword);
    console.log('(Save this securely - it will not be shown again!)');

    console.log('\n=== INITIAL ADMIN USER ===');
    console.log('To create the first admin user, use the master password to log in at:');
    console.log(`URL: http://localhost:3001/login`);
    console.log('Then create an admin user through the portal settings.');

  } catch (error) {
    console.error('Error:', error);
  }
}

main();
