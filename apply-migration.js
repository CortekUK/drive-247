#!/usr/bin/env node

/**
 * Direct SQL execution script for area_around migration
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Read .env file manually
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};

envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        envVars[key] = value;
    }
});

console.log('🔍 Environment variables loaded');
console.log('📍 Supabase URL:', envVars.NEXT_PUBLIC_SUPABASE_URL || 'NOT FOUND');

async function applyMigration() {
    try {
        console.log('\n🔄 Reading migration file...');

        const migrationPath = path.join(__dirname, 'supabase/migrations/20260113140000_add_area_around_location_mode.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        console.log('📄 Migration: 20260113140000_add_area_around_location_mode.sql');

        // Try to find DATABASE_URL or construct from available info
        let connectionString = envVars.DATABASE_URL;

        if (!connectionString) {
            // Try to construct from SUPABASE_DB_URL or similar
            const possibleKeys = Object.keys(envVars).filter(k =>
                k.includes('DATABASE') || k.includes('DB_URL') || k.includes('POSTGRES')
            );

            console.log('\n📋 Available database-related env vars:', possibleKeys);

            if (possibleKeys.length > 0) {
                console.log('\n⚠️  Please provide the correct DATABASE_URL');
                console.log('Available options:');
                possibleKeys.forEach(key => {
                    console.log(`  - ${key}`);
                });
            }

            console.log('\n❌ No DATABASE_URL found in .env file');
            console.log('\n📝 Manual migration steps:');
            console.log('1. Go to Supabase Dashboard: https://supabase.com/dashboard');
            console.log('2. Select your project');
            console.log('3. Go to SQL Editor');
            console.log('4. Copy the SQL from: supabase/migrations/20260113140000_add_area_around_location_mode.sql');
            console.log('5. Paste and run it');
            console.log('\nOR');
            console.log('\nAdd DATABASE_URL to your .env file with the connection string from:');
            console.log('Supabase Dashboard → Project Settings → Database → Connection string (URI)');
            return;
        }

        console.log('\n🔌 Connecting to database...');

        const pool = new Pool({
            connectionString,
            ssl: {
                rejectUnauthorized: false
            }
        });

        const client = await pool.connect();
        console.log('✅ Connected successfully\n');

        console.log('⚡ Executing migration...');
        await client.query(migrationSQL);

        client.release();
        await pool.end();

        console.log('✅ Migration applied successfully!\n');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📦 Added columns to tenants table:');
        console.log('  ✓ pickup_area_radius_km (numeric(5,1), default: 25)');
        console.log('  ✓ return_area_radius_km (numeric(5,1), default: 25)');
        console.log('  ✓ area_center_lat (numeric(10,6))');
        console.log('  ✓ area_center_lon (numeric(10,6))');
        console.log('\n🔧 Updated constraints:');
        console.log('  ✓ pickup_location_mode: fixed | custom | multiple | area_around');
        console.log('  ✓ return_location_mode: fixed | custom | multiple | area_around');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n✨ The "Area Around" location mode is now available!');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);

        if (error.code === 'ECONNREFUSED') {
            console.error('\n🔌 Connection refused. Please check your DATABASE_URL');
        } else if (error.code === '42P07') {
            console.log('\n✅ Columns already exist! Migration may have been applied previously.');
        } else {
            console.error('\n📝 Manual migration steps:');
            console.error('1. Go to: https://supabase.com/dashboard');
            console.error('2. Select your project');
            console.error('3. Navigate to: SQL Editor');
            console.error('4. Open file: supabase/migrations/20260113140000_add_area_around_location_mode.sql');
            console.error('5. Copy and paste the SQL');
            console.error('6. Click "Run"');
        }

        process.exit(1);
    }
}

applyMigration();
