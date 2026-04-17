import { config } from 'dotenv';
config({ path: '.env.local' });

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { tenants, appUsers } from '@drive247/database';
import { hashPassword } from '../../common/utils/password.util';

// Read from env with fallbacks
const TENANT_SLUG = process.env.SEED_TENANT_SLUG || 'test';
const TENANT_NAME = process.env.SEED_TENANT_NAME || 'Test Rental Company';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@test.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'admin123456';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'Test Admin';

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log('Seeding database...\n');

  // 1. Create test tenant
  const [tenant] = await db
    .insert(tenants)
    .values({
      slug: TENANT_SLUG,
      companyName: TENANT_NAME,
      status: 'active',
    })
    .returning();

  console.log(`✓ Tenant: ${tenant.slug} (${tenant.id})`);

  // 2. Create head_admin for the test tenant
  const adminHash = await hashPassword(ADMIN_PASSWORD);
  const [admin] = await db
    .insert(appUsers)
    .values({
      tenantId: tenant.id,
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      passwordHash: adminHash,
      role: 'head_admin',
      isActive: true,
      mustChangePassword: false,
    })
    .returning({ id: appUsers.id, email: appUsers.email });

  console.log(`✓ Head Admin: ${admin.email} (${admin.id})`);

  // 3. Create super admin (tenant_id = NULL)
  const superHash = await hashPassword('super123456');
  const [superAdmin] = await db
    .insert(appUsers)
    .values({
      tenantId: null,
      email: 'super@drive247.com',
      name: 'Super Admin',
      passwordHash: superHash,
      role: 'head_admin',
      isSuperAdmin: true,
      isPrimarySuperAdmin: true,
      isActive: true,
      mustChangePassword: false,
    })
    .returning({ id: appUsers.id, email: appUsers.email });

  console.log(`✓ Super Admin: ${superAdmin.email} (${superAdmin.id})`);

  console.log('\n✅ Seed complete!\n');
  console.log('Credentials:');
  console.log(`  Head Admin:  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (tenant: ${TENANT_SLUG})`);
  console.log('  Super Admin: super@drive247.com / super123456 (no tenant)\n');

  await pool.end();
}

seed().catch((err) => {
  console.error('\n❌ Seed failed:', err);
  process.exit(1);
});
