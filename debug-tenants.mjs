import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://hviqoaokxvlancmftwuo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function debugTenants() {
  console.log('\n🔍 DEBUGGING TENANT DATABASE\n');
  console.log('════════════════════════════════════════════════════\n');

  // Try to fetch ALL tenants (no filters)
  console.log('1️⃣  Fetching ALL tenants from database...\n');

  const { data: allTenants, error: allError } = await supabase
    .from('tenants')
    .select('*');

  if (allError) {
    console.log('❌ Error fetching tenants:', allError);
    return;
  }

  if (!allTenants || allTenants.length === 0) {
    console.log('⚠️  NO TENANTS FOUND in database\n');
    console.log('This could mean:');
    console.log('- RLS policy is blocking anonymous access');
    console.log('- Tenants table is empty');
    console.log('- Wrong Supabase project\n');
    return;
  }

  console.log(`✅ Found ${allTenants.length} tenant(s):\n`);

  allTenants.forEach((tenant, index) => {
    console.log(`────────────────────────────────────────────────────`);
    console.log(`Tenant ${index + 1}:`);
    console.log(`  ID: ${tenant.id}`);
    console.log(`  Company Name: ${tenant.company_name}`);
    console.log(`  Slug: ${tenant.slug}`);
    console.log(`  Status: ${tenant.status}`);
    console.log(`  Contact Email: ${tenant.contact_email}`);
    console.log(`  Master Password Hash: ${tenant.master_password_hash ? 'SET ✅' : 'NOT SET ❌'}`);
    console.log(`  App Name: ${tenant.app_name || 'Not set'}`);
    console.log(`  Primary Color: ${tenant.primary_color || 'Not set'}`);
    console.log(`  Created: ${new Date(tenant.created_at).toLocaleString()}`);
    console.log('');
  });

  console.log('════════════════════════════════════════════════════\n');

  // Check for our specific tenants
  console.log('2️⃣  Checking for specific tenants...\n');

  const targetSlugs = ['fleetvana', 'globalmotiontransport'];

  for (const slug of targetSlugs) {
    const found = allTenants.find(t => t.slug === slug);
    if (found) {
      console.log(`✅ ${slug}: FOUND`);
    } else {
      console.log(`❌ ${slug}: NOT FOUND`);
    }
  }

  console.log('\n════════════════════════════════════════════════════\n');

  // Check auth users
  console.log('3️⃣  Checking admin users in auth...\n');

  const { data: authData, error: authError } = await supabase.auth.getSession();

  console.log('Current auth session:', authData.session ? 'Logged in' : 'Not logged in');

  if (authData.session) {
    console.log('User email:', authData.session.user.email);
  }

  console.log('\n════════════════════════════════════════════════════\n');
}

debugTenants();
