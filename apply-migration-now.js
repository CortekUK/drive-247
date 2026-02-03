#!/usr/bin/env node

/**
 * Apply migration directly using Supabase REST API
 * This script executes the SQL migration to add the missing columns
 */

const fs = require('fs');
const path = require('path');

// Read .env file
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};

envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        envVars[key] = value;
    }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

async function executeSql(sql) {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({ query: sql })
    });

    return response;
}

async function applyMigrationDirectly() {
    try {
        console.log('🚀 Applying migration directly to database...\n');

        // Read migration file
        const migrationPath = path.join(__dirname, 'supabase/migrations/20260113140000_add_area_around_location_mode.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        console.log('📄 Migration file loaded');
        console.log('🔗 Target database:', supabaseUrl);
        console.log('\n⚡ Executing SQL statements...\n');

        // Split into individual statements and execute them one by one
        const statements = [
            // Drop existing constraints
            `DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.tenants'::regclass
    AND conname LIKE '%pickup_location_mode%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END IF;

  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.tenants'::regclass
    AND conname LIKE '%return_location_mode%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END IF;
END $$;`,

            // Add new constraints
            `ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_pickup_location_mode_check
    CHECK (pickup_location_mode IS NULL OR pickup_location_mode IN ('fixed', 'custom', 'multiple', 'area_around'));`,

            `ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_return_location_mode_check
    CHECK (return_location_mode IS NULL OR return_location_mode IN ('fixed', 'custom', 'multiple', 'area_around'));`,

            // Add columns
            `ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS pickup_area_radius_km numeric(5,1) DEFAULT 25,
  ADD COLUMN IF NOT EXISTS return_area_radius_km numeric(5,1) DEFAULT 25,
  ADD COLUMN IF NOT EXISTS area_center_lat numeric(10,6),
  ADD COLUMN IF NOT EXISTS area_center_lon numeric(10,6);`,

            // Add comments
            `COMMENT ON COLUMN public.tenants.pickup_area_radius_km IS 'Maximum pickup distance in km for area_around mode';`,
            `COMMENT ON COLUMN public.tenants.return_area_radius_km IS 'Maximum return distance in km for area_around mode';`,
            `COMMENT ON COLUMN public.tenants.area_center_lat IS 'Optional: Fixed center point latitude (if not using live location)';`,
            `COMMENT ON COLUMN public.tenants.area_center_lon IS 'Optional: Fixed center point longitude (if not using live location)';`
        ];

        // Try to execute all statements at once first
        const { Pool } = require('pg');

        // Try with DATABASE_URL if available
        let connectionString = envVars.DATABASE_URL;

        if (!connectionString) {
            console.log('⚠️  DATABASE_URL not found in .env');
            console.log('📝 Please add DATABASE_URL to your .env file\n');
            console.log('Get it from: Supabase Dashboard → Settings → Database → Connection string (URI)\n');

            console.log('Alternatively, run this SQL manually in Supabase Dashboard:\n');
            console.log('─'.repeat(80));
            console.log(migrationSQL);
            console.log('─'.repeat(80));
            process.exit(1);
        }

        const pool = new Pool({
            connectionString,
            ssl: { rejectUnauthorized: false }
        });

        const client = await pool.connect();
        console.log('✅ Connected to database\n');

        // Execute the full migration
        await client.query(migrationSQL);

        console.log('✅ Migration executed successfully!\n');

        client.release();
        await pool.end();

        console.log('━'.repeat(80));
        console.log('✨ SUCCESS! The following columns have been added:');
        console.log('  ✓ pickup_area_radius_km');
        console.log('  ✓ return_area_radius_km');
        console.log('  ✓ area_center_lat');
        console.log('  ✓ area_center_lon');
        console.log('━'.repeat(80));
        console.log('\n🔄 Please restart your dev server to see the changes!');

    } catch (error) {
        console.error('❌ Error:', error.message);

        if (error.code === '42P07') {
            console.log('\n✅ Columns already exist! Migration was already applied.');
            console.log('🔄 Try restarting your dev server.');
        } else {
            console.log('\n📝 Please apply the migration manually via Supabase Dashboard:');
            console.log('https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/editor');
        }

        process.exit(1);
    }
}

applyMigrationDirectly();
