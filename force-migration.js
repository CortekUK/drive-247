#!/usr/bin/env node

/**
 * Final attempt: Direct PostgreSQL connection using pg library
 * This will try multiple connection methods
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

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

const migrationSQL = fs.readFileSync(
    path.join(__dirname, 'supabase/migrations/20260113140000_add_area_around_location_mode.sql'),
    'utf8'
);

console.log('🚀 Final attempt: Direct database connection\n');

async function tryConnection(config, name) {
    console.log(`Trying ${name}...`);
    const pool = new Pool(config);

    try {
        const client = await pool.connect();
        console.log(`✅ Connected via ${name}!\n`);

        console.log('⚡ Executing migration...\n');
        await client.query(migrationSQL);

        console.log('✅ Migration executed successfully!\n');
        console.log('━'.repeat(80));
        console.log('✨ SUCCESS! Columns added to tenants table:');
        console.log('  ✓ pickup_area_radius_km');
        console.log('  ✓ return_area_radius_km');
        console.log('  ✓ area_center_lat');
        console.log('  ✓ area_center_lon');
        console.log('━'.repeat(80));

        client.release();
        await pool.end();
        return true;
    } catch (error) {
        console.log(`❌ Failed: ${error.message}\n`);
        await pool.end();
        return false;
    }
}

async function attemptMigration() {
    const projectRef = 'hviqoaokxvlancmftwuo';
    const migrationToken = 'sbp_6b139d9d0f78dd93e75f3683c8cfa4a5fc31f366';

    // Try different connection configurations
    const configs = [
        {
            name: 'Pooler (port 6543)',
            host: 'aws-0-us-east-1.pooler.supabase.com',
            port: 6543,
            user: `postgres.${projectRef}`,
            password: migrationToken,
            database: 'postgres',
            ssl: { rejectUnauthorized: false }
        },
        {
            name: 'Pooler (port 5432)',
            host: 'aws-0-us-east-1.pooler.supabase.com',
            port: 5432,
            user: `postgres.${projectRef}`,
            password: migrationToken,
            database: 'postgres',
            ssl: { rejectUnauthorized: false }
        },
        {
            name: 'Direct DB (port 5432)',
            host: `db.${projectRef}.supabase.co`,
            port: 5432,
            user: 'postgres',
            password: migrationToken,
            database: 'postgres',
            ssl: { rejectUnauthorized: false }
        },
        {
            name: 'Direct DB with project user',
            host: `db.${projectRef}.supabase.co`,
            port: 5432,
            user: `postgres.${projectRef}`,
            password: migrationToken,
            database: 'postgres',
            ssl: { rejectUnauthorized: false }
        }
    ];

    for (const config of configs) {
        const success = await tryConnection(config, config.name);
        if (success) {
            process.exit(0);
        }
    }

    console.log('━'.repeat(80));
    console.log('❌ All connection attempts failed');
    console.log('━'.repeat(80));
    console.log('\nThe migration token provided does not have sufficient permissions');
    console.log('or is not the correct credential for database access.\n');
    console.log('📋 Please run the SQL manually in Supabase Dashboard:');
    console.log('https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo/editor\n');
    console.log('Or provide the DATABASE_URL with the actual database password.\n');

    process.exit(1);
}

attemptMigration();
