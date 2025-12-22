import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hviqoaokxvlancmftwuo.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

const vehicleTemplates = [
  { make: 'Toyota', model: 'Corolla', year: 2023, fuel_type: 'Petrol', colour: 'White', daily_rent: 45, weekly_rent: 280, monthly_rent: 950 },
  { make: 'Honda', model: 'Civic', year: 2022, fuel_type: 'Petrol', colour: 'Black', daily_rent: 50, weekly_rent: 300, monthly_rent: 1000 },
  { make: 'Ford', model: 'Focus', year: 2023, fuel_type: 'Diesel', colour: 'Blue', daily_rent: 40, weekly_rent: 250, monthly_rent: 850 },
  { make: 'BMW', model: '3 Series', year: 2022, fuel_type: 'Petrol', colour: 'Silver', daily_rent: 80, weekly_rent: 500, monthly_rent: 1800 },
  { make: 'Mercedes', model: 'A-Class', year: 2023, fuel_type: 'Diesel', colour: 'Grey', daily_rent: 75, weekly_rent: 480, monthly_rent: 1700 },
];

function generateRegNumber(index, tenantSlug) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const prefix = tenantSlug.substring(0, 2).toUpperCase();
  const year = '24';
  const suffix = `${letters[index % 26]}${letters[(index + 1) % 26]}${letters[(index + 2) % 26]}`;
  return `${prefix}${year} ${suffix}`;
}

async function main() {
  console.log('Fetching tenants...');

  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, slug, company_name');

  if (tenantsError) {
    console.error('Error fetching tenants:', tenantsError);
    process.exit(1);
  }

  if (!tenants || tenants.length === 0) {
    console.log('No tenants found in database.');
    process.exit(0);
  }

  console.log(`Found ${tenants.length} tenant(s):`);
  tenants.forEach(t => console.log(`  - ${t.company_name || t.slug} (${t.id})`));

  for (const tenant of tenants) {
    console.log(`\nSeeding vehicles for tenant: ${tenant.company_name || tenant.slug}`);

    // Check existing vehicles for this tenant
    const { data: existingVehicles } = await supabase
      .from('vehicles')
      .select('id')
      .eq('tenant_id', tenant.id);

    const existingCount = existingVehicles?.length || 0;
    console.log(`  Existing vehicles: ${existingCount}`);

    const vehiclesToInsert = vehicleTemplates.map((template, index) => ({
      ...template,
      tenant_id: tenant.id,
      reg: generateRegNumber(existingCount + index, tenant.slug || 'DR'),
      status: 'Available',
      has_logbook: true,
      has_tracker: true,
      has_spare_key: true,
      description: `${template.year} ${template.make} ${template.model} - Available for rent`,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from('vehicles')
      .insert(vehiclesToInsert)
      .select('id, reg, make, model');

    if (insertError) {
      console.error(`  Error inserting vehicles:`, insertError);
    } else {
      console.log(`  Successfully inserted ${inserted.length} vehicles:`);
      inserted.forEach(v => console.log(`    - ${v.reg}: ${v.make} ${v.model}`));
    }
  }

  console.log('\nSeeding complete!');
}

main();
