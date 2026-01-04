/**
 * Create site-settings CMS page for a tenant
 * Usage: node scripts/create-site-settings-page.js [tenant-slug]
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const TENANT_SLUG = process.argv[2];

if (!TENANT_SLUG) {
  console.error('Usage: node scripts/create-site-settings-page.js [tenant-slug]');
  process.exit(1);
}

async function main() {
  console.log(`\nCreating site-settings page for: ${TENANT_SLUG}\n`);

  // Find tenant
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, slug, company_name')
    .eq('slug', TENANT_SLUG)
    .single();

  if (tenantError || !tenant) {
    console.error(`Tenant "${TENANT_SLUG}" not found!`);
    process.exit(1);
  }

  console.log(`Found tenant: ${tenant.company_name} (${tenant.id})`);

  // Check if site-settings page exists
  const { data: existingPage } = await supabase
    .from('cms_pages')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('slug', 'site-settings')
    .single();

  if (existingPage) {
    console.log('site-settings page already exists!');
    return;
  }

  // Create site-settings page
  const { data: newPage, error: createError } = await supabase
    .from('cms_pages')
    .insert({
      tenant_id: tenant.id,
      slug: 'site-settings',
      name: 'Site Settings',
      status: 'published',
      published_at: new Date().toISOString()
    })
    .select()
    .single();

  if (createError) {
    console.error('Error creating page:', createError.message);
    process.exit(1);
  }

  console.log(`Created site-settings page (ID: ${newPage.id})`);
  console.log('\nNow run: npm run update-cms ' + TENANT_SLUG);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
