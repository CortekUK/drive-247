/**
 * Bulk Branding Update Script
 *
 * This script reads branding config from branding-config.json and updates
 * multiple tenants' branding in one run.
 *
 * Usage:
 *   1. Edit branding-config.json with your tenant slugs and branding data
 *   2. Place logo files in ./scripts/logos/ folder
 *   3. Run: npm run update-branding
 *
 * Environment Variables Required:
 *   - SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (for admin access to bypass RLS)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('\x1b[31mError: Missing required environment variables!\x1b[0m');
  console.error('Please ensure the following are set in your .env file:');
  console.error('  - SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  console.error('  - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Create Supabase client with service role key (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Storage bucket for logos
const LOGO_BUCKET = 'company-logos';

/**
 * Upload a local file to Supabase storage
 */
async function uploadFile(localPath, bucketPath) {
  const absolutePath = path.resolve(__dirname, localPath);

  if (!fs.existsSync(absolutePath)) {
    console.warn(`  Warning: File not found: ${absolutePath}`);
    return null;
  }

  const fileBuffer = fs.readFileSync(absolutePath);
  const contentType = getContentType(localPath);

  const { data, error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(bucketPath, fileBuffer, {
      contentType,
      upsert: true
    });

  if (error) {
    console.error(`  Error uploading ${localPath}:`, error.message);
    return null;
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from(LOGO_BUCKET)
    .getPublicUrl(bucketPath);

  return publicUrl;
}

/**
 * Get content type from file extension
 */
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon'
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Update a single tenant's branding
 */
async function updateTenantBranding(tenantConfig) {
  const { slug, app_name, logo_path, favicon_path, colors, seo, contact } = tenantConfig;

  console.log(`\nProcessing tenant: ${slug}`);

  // Find tenant by slug
  const { data: tenant, error: findError } = await supabase
    .from('tenants')
    .select('id, slug, company_name')
    .eq('slug', slug)
    .single();

  if (findError || !tenant) {
    console.error(`  Error: Tenant with slug "${slug}" not found!`);
    return false;
  }

  console.log(`  Found tenant: ${tenant.company_name} (ID: ${tenant.id})`);

  // Prepare update data
  const updateData = {
    app_name: app_name || undefined,
    meta_title: seo?.meta_title || undefined,
    meta_description: seo?.meta_description || undefined,
    phone: contact?.phone || undefined,
    address: contact?.address || undefined,
    ...colors
  };

  // Upload logo if provided
  if (logo_path) {
    console.log(`  Uploading logo: ${logo_path}`);
    const logoFileName = `${slug}-logo-${Date.now()}${path.extname(logo_path)}`;
    const logoUrl = await uploadFile(logo_path, logoFileName);
    if (logoUrl) {
      updateData.logo_url = logoUrl;
      console.log(`  Logo uploaded: ${logoUrl}`);
    }
  }

  // Upload favicon if provided
  if (favicon_path) {
    console.log(`  Uploading favicon: ${favicon_path}`);
    const faviconFileName = `${slug}-favicon-${Date.now()}${path.extname(favicon_path)}`;
    const faviconUrl = await uploadFile(favicon_path, faviconFileName);
    if (faviconUrl) {
      updateData.favicon_url = faviconUrl;
      console.log(`  Favicon uploaded: ${faviconUrl}`);
    }
  }

  // Remove undefined values
  Object.keys(updateData).forEach(key => {
    if (updateData[key] === undefined) {
      delete updateData[key];
    }
  });

  // Update tenant
  const { error: updateError } = await supabase
    .from('tenants')
    .update(updateData)
    .eq('id', tenant.id);

  if (updateError) {
    console.error(`  Error updating tenant:`, updateError.message);
    return false;
  }

  console.log(`  \x1b[32mSuccess!\x1b[0m Updated branding for ${tenant.company_name}`);
  return true;
}

/**
 * Main function
 */
async function main() {
  console.log('\n========================================');
  console.log('  Bulk Branding Update Script');
  console.log('========================================\n');

  // Load config
  const configPath = path.join(__dirname, 'branding-config.json');

  if (!fs.existsSync(configPath)) {
    console.error('Error: branding-config.json not found!');
    console.error('Please create it in the scripts folder.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  if (!config.tenants || config.tenants.length === 0) {
    console.error('Error: No tenants configured in branding-config.json');
    process.exit(1);
  }

  console.log(`Found ${config.tenants.length} tenant(s) to update\n`);

  // Process each tenant
  let successCount = 0;
  let failCount = 0;

  for (const tenantConfig of config.tenants) {
    const success = await updateTenantBranding(tenantConfig);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  // Summary
  console.log('\n========================================');
  console.log('  Summary');
  console.log('========================================');
  console.log(`  Total tenants: ${config.tenants.length}`);
  console.log(`  \x1b[32mSuccess: ${successCount}\x1b[0m`);
  if (failCount > 0) {
    console.log(`  \x1b[31mFailed: ${failCount}\x1b[0m`);
  }
  console.log('========================================\n');
}

// Run the script
main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
