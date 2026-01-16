#!/usr/bin/env node

/**
 * Apply migration using Supabase Management API
 * This uses the service role key to execute SQL via the API
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
const projectRef = 'hviqoaokxvlancmftwuo';

console.log('🚀 Applying migration via Supabase Management API...\n');
console.log('📍 Project:', projectRef);
console.log('🔗 URL:', supabaseUrl);

if (!serviceKey) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env');
    process.exit(1);
}

async function applyMigration() {
    try {
        // Read migration SQL
        const migrationPath = path.join(__dirname, 'supabase/migrations/20260113140000_add_area_around_location_mode.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        console.log('📄 Migration SQL loaded\n');
        console.log('⚡ Executing migration...\n');

        // Use Supabase's SQL execution endpoint
        // Try the management API endpoint
        const apiUrl = `https://${projectRef}.supabase.co/rest/v1/rpc/exec`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': serviceKey,
                'Authorization': `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
                query: migrationSQL
            })
        });

        const responseText = await response.text();

        if (!response.ok) {
            console.log('⚠️  RPC endpoint failed, trying alternative...\n');

            // Try using supabase-js client with raw SQL
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(supabaseUrl, serviceKey);

            // Split SQL into statements and execute
            const statements = migrationSQL
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.startsWith('--') && s !== '');

            console.log(`📋 Executing ${statements.length} SQL statements...\n`);

            for (let i = 0; i < statements.length; i++) {
                const stmt = statements[i];
                if (stmt.trim()) {
                    console.log(`  [${i + 1}/${statements.length}] Executing...`);

                    // Use the raw SQL execution
                    const { error } = await supabase.rpc('exec', { query: stmt + ';' });

                    if (error) {
                        // Try direct execution via REST API
                        const execResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'apikey': serviceKey,
                                'Authorization': `Bearer ${serviceKey}`,
                            },
                            body: JSON.stringify({ query: stmt + ';' })
                        });

                        if (!execResponse.ok) {
                            const errorText = await execResponse.text();
                            console.error(`  ❌ Failed: ${errorText}`);
                            throw new Error(`Statement ${i + 1} failed: ${errorText}`);
                        }
                    }

                    console.log(`  ✅ Done`);
                }
            }

            console.log('\n✅ All statements executed successfully!\n');
        } else {
            console.log('✅ Migration executed successfully!\n');
        }

        console.log('━'.repeat(80));
        console.log('✨ SUCCESS! Migration applied to database');
        console.log('━'.repeat(80));
        console.log('\n📦 Added columns:');
        console.log('  ✓ pickup_area_radius_km');
        console.log('  ✓ return_area_radius_km');
        console.log('  ✓ area_center_lat');
        console.log('  ✓ area_center_lon');
        console.log('\n🔄 Next step: Restart your dev server or refresh the page');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error('\n🔍 Error details:', error);
        process.exit(1);
    }
}

applyMigration();
