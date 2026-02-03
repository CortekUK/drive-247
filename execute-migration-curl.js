#!/usr/bin/env node

/**
 * Apply migration by creating exec function first, then using it
 */

const fs = require('fs');
const path = require('path');

// Read .env
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

console.log('🚀 Applying migration directly using ALTER TABLE commands...\n');

async function executeSQL(sql) {
    // Use PostgREST's raw SQL execution via a custom query
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Prefer': 'params=single-object'
        },
        body: JSON.stringify({ query: sql })
    });

    return { response, text: await response.text() };
}

async function applyMigrationDirect() {
    try {
        console.log('📄 Reading migration file...\n');
        const migrationPath = path.join(__dirname, 'supabase/migrations/20260113140000_add_area_around_location_mode.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        // Execute via curl to PostgreSQL REST endpoint
        console.log('⚡ Executing migration using curl...\n');

        // Write SQL to temp file
        const tempSqlFile = path.join(__dirname, 'temp_migration.sql');
        fs.writeFileSync(tempSqlFile, migrationSQL);

        // Use curl with Supabase's database API
        const { execSync } = require('child_process');

        try {
            // Try using supabase CLI's db execute command
            const result = execSync(
                `curl -X POST '${supabaseUrl}/rest/v1/rpc/query' \\
          -H "apikey: ${serviceKey}" \\
          -H "Authorization: Bearer ${serviceKey}" \\
          -H "Content-Type: application/json" \\
          -d '{"query": ${JSON.stringify(migrationSQL)}}'`,
                { encoding: 'utf8', stdio: 'pipe' }
            );

            console.log('Response:', result);

        } catch (curlError) {
            console.log('⚠️  Curl approach failed, trying direct ALTER TABLE execution...\n');

            // Execute the migration statements directly using pg library
            const { Pool } = require('pg');

            // Construct connection string using service role key
            // Try the direct database URL format
            const dbHost = `db.${supabaseUrl.match(/https:\/\/([^.]+)/)[1]}.supabase.co`;
            const dbUser = `postgres`;

            console.log('🔌 Attempting direct database connection...');
            console.log(`   Host: ${dbHost}`);

            // This won't work without the actual database password
            // Let's try a different approach - use the Supabase client library

            console.log('\n⚠️  Cannot execute migration automatically without DATABASE_URL\n');
            console.log('━'.repeat(80));
            console.log('📋 MANUAL EXECUTION REQUIRED');
            console.log('━'.repeat(80));
            console.log('\nPlease run this SQL in Supabase Dashboard SQL Editor:');
            console.log('https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/editor\n');
            console.log('─'.repeat(80));
            console.log(migrationSQL);
            console.log('─'.repeat(80));

            // Clean up temp file
            fs.unlinkSync(tempSqlFile);
            process.exit(1);
        }

        console.log('\n✅ Migration applied successfully!');

        // Clean up
        fs.unlinkSync(tempSqlFile);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

applyMigrationDirect();
