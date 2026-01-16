#!/usr/bin/env node

/**
 * Check if pickup_area_radius_km column exists in tenants table
 */

const fs = require('fs');
const path = require('path');

// Read .env file manually
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
const supabaseKey = envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY || envVars.SUPABASE_SERVICE_ROLE_KEY;

async function checkSchema() {
    try {
        console.log('🔍 Checking database schema...\n');

        // Query to check if columns exist
        const query = `
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tenants'
        AND column_name IN ('pickup_area_radius_km', 'return_area_radius_km', 'area_center_lat', 'area_center_lon')
      ORDER BY column_name;
    `;

        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ query })
        });

        if (!response.ok) {
            // Try alternative: query the table directly to see what columns exist
            console.log('⚠️  Cannot query schema directly, trying alternative method...\n');

            const tableResponse = await fetch(`${supabaseUrl}/rest/v1/tenants?select=*&limit=1`, {
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                }
            });

            if (tableResponse.ok) {
                const data = await tableResponse.json();
                console.log('✅ Successfully queried tenants table\n');

                if (data.length > 0) {
                    const columns = Object.keys(data[0]);
                    console.log('📋 Available columns in tenants table:');
                    columns.forEach(col => console.log(`  - ${col}`));

                    const hasPickupRadius = columns.includes('pickup_area_radius_km');
                    const hasReturnRadius = columns.includes('return_area_radius_km');

                    console.log('\n🔍 Migration status:');
                    console.log(`  pickup_area_radius_km: ${hasPickupRadius ? '✅ EXISTS' : '❌ MISSING'}`);
                    console.log(`  return_area_radius_km: ${hasReturnRadius ? '✅ EXISTS' : '❌ MISSING'}`);

                    if (!hasPickupRadius || !hasReturnRadius) {
                        console.log('\n❌ Migration has NOT been applied yet!');
                        console.log('\n📝 You need to apply the migration manually:');
                        console.log('1. Go to: https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/editor');
                        console.log('2. Click "SQL Editor"');
                        console.log('3. Copy SQL from: supabase/migrations/20260113140000_add_area_around_location_mode.sql');
                        console.log('4. Paste and Run');
                    } else {
                        console.log('\n✅ Migration appears to be applied!');
                        console.log('💡 Try restarting your dev server: npm run dev');
                    }
                } else {
                    console.log('⚠️  No tenants found in database');
                }
            } else {
                const errorText = await tableResponse.text();
                console.error('❌ Error querying table:', errorText);
            }
        } else {
            const result = await response.json();
            console.log('✅ Schema query successful:', result);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

checkSchema();
