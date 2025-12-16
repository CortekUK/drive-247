# Tenant Management Scripts

This directory contains SQL scripts and documentation for managing rental companies (tenants) in the Drive247 SAAS platform.

## Overview

The Drive247 platform uses a multi-tenant architecture where:
- Each rental company is a **tenant** with its own subdomain (e.g., `fleetvana.drive-247.com`)
- Super admins can manage all tenants from `admin.drive-247.com`
- Super admins can login to ANY tenant dashboard using their credentials (master key pattern)

## Available Scripts

### 1. Create Rental Companies
**File**: `create-rental-companies.sql`

Creates three pre-configured rental companies:
- **fleetvana** - Professional plan
- **globalmotiontransport** - Enterprise plan
- **demo-rental** - Trial plan (30-day trial)

**How to run**:
```bash
# Using Supabase CLI
cd /Users/ghulam/projects/drive247/Drive917-client
npx supabase db execute --file scripts/create-rental-companies.sql

# Or via Supabase Dashboard
# 1. Go to Supabase Dashboard → SQL Editor
# 2. Copy/paste the contents of create-rental-companies.sql
# 3. Click "Run"
```

**What it does**:
- Creates tenant records in the `tenants` table
- Uses `ON CONFLICT` so it's safe to run multiple times (idempotent)
- Sets up contact info, subscription plans, and trial periods

---

### 2. Create Rental Credentials
**File**: `create-rental-credentials.sql`

Documentation and instructions for creating admin users for each rental company.

**Recommended Credentials** (you'll create these manually):
```
FleetVana:
  Email: admin@fleetvana.com
  Password: Password123!
  Role: head_admin

Global Motion Transport:
  Email: admin@globalmotiontransport.com
  Password: Password123!
  Role: head_admin

Demo Rental:
  Email: demo@drive-247.com
  Password: Password123!
  Role: head_admin
```

**How to create users** (RECOMMENDED - Use Super Admin Dashboard):

1. Login to `admin.drive-247.com` with super admin credentials:
   - Email: `admin@cortek.io`
   - Password: `Admin@Cortek2024`

2. Go to "Rental Companies" page

3. For each company, you can either:
   - **Option A**: Click "View Details" → "Add User" (future feature)
   - **Option B**: Use the Supabase Dashboard to create users manually

**Manual creation via Supabase Dashboard**:

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Add User" → "Create New User"
3. Enter email and password (e.g., `admin@fleetvana.com`, `Password123!`)
4. Copy the `auth_user_id` (UUID) from the created user
5. Go to SQL Editor and run:

```sql
-- Get the tenant_id for FleetVana
SELECT id FROM tenants WHERE slug = 'fleetvana';

-- Create app_users record (replace <auth_user_id> and <tenant_id>)
INSERT INTO app_users (
  auth_user_id,
  tenant_id,
  email,
  name,
  role,
  is_active,
  must_change_password
) VALUES (
  '<auth_user_id_from_step_4>',
  '<tenant_id_from_step_1>',
  'admin@fleetvana.com',
  'FleetVana Admin',
  'head_admin',
  true,
  false
);
```

6. Repeat for each rental company

---

### 3. Create Super Admin
**File**: `create-super-admin.sql`

Documentation for creating super admin users who can access all tenants.

**Existing Super Admin**:
```
Email: admin@cortek.io
Password: Admin@Cortek2024
```

**How to create additional super admins**:

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Add User" → "Create New User"
3. Enter email and password
4. Copy the `auth_user_id`
5. Run this SQL (replace `<auth_user_id>`):

```sql
INSERT INTO app_users (
  auth_user_id,
  tenant_id,
  email,
  name,
  role,
  is_active,
  must_change_password,
  is_super_admin,
  created_at,
  updated_at
) VALUES (
  '<auth_user_id>',
  NULL,  -- Super admins don't belong to a tenant
  'your-email@drive-247.com',
  'Your Name',
  'head_admin',
  true,
  false,
  true,  -- This makes them a super admin!
  now(),
  now()
);
```

**Super Admin Capabilities**:
- Access `admin.drive-247.com` dashboard
- View/create/edit/suspend all rental companies
- Login to ANY rental dashboard using their own credentials (master key)
- See special sidebar tabs (Website Content, etc.) in rental dashboards
- Bypass `is_active` checks and password change requirements

---

### 4. Delete Rental Company
**File**: `delete-rental.sql`

**⚠️ WARNING**: This is a DESTRUCTIVE operation!

**RECOMMENDED**: Use "Suspend" instead of delete
```sql
UPDATE tenants
SET status = 'suspended'
WHERE slug = 'demo-rental';
```

Suspended tenants:
- Cannot login
- Data is preserved
- Can be reactivated later

**Hard Delete** (DANGEROUS - use only if you're sure):

See `delete-rental.sql` for the complete deletion script. It will:
- Delete ALL vehicles
- Delete ALL customers
- Delete ALL rentals
- Delete ALL payments
- Delete ALL users
- Delete the tenant record

**How to delete via Super Admin Dashboard**:

1. Login to `admin.drive-247.com`
2. Go to "Rental Companies"
3. Click "Delete" button for the tenant
4. Confirm the deletion by typing the company name exactly
5. The system will permanently delete the tenant and all data

---

## Quick Start Guide

### Step 1: Create Rental Companies
```bash
npx supabase db execute --file scripts/create-rental-companies.sql
```

### Step 2: Verify Tenants Were Created
```sql
SELECT id, slug, company_name, status, contact_email
FROM tenants
WHERE slug IN ('fleetvana', 'globalmotiontransport', 'demo-rental');
```

### Step 3: Create Admin Users for Each Tenant

Use the Supabase Dashboard method described above for each company.

### Step 4: Test Login

Try logging into each rental dashboard:
```
http://localhost:3001/login  (portal app in dev mode)

FleetVana credentials:
  admin@fleetvana.com / Password123!

Global Motion Transport credentials:
  admin@globalmotiontransport.com / Password123!

Demo Rental credentials:
  demo@drive-247.com / Password123!

Super Admin credentials (works for ALL dashboards):
  admin@cortek.io / Admin@Cortek2024
```

---

## Super Admin Dashboard Features

The super admin dashboard at `admin.drive-247.com` allows you to:

✅ **View all rental companies** - See status, subscription plan, contact info
✅ **Create new companies** - Add new rental companies to the platform
✅ **Suspend/Activate companies** - Temporarily block access (soft delete)
✅ **Delete companies** - Permanently remove with all data (hard delete)
✅ **Generate master passwords** - Create per-tenant master passwords (legacy feature)
✅ **View company details** - See stats and manage users (future)

---

## Database Schema

### `tenants` Table
```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  slug TEXT UNIQUE,              -- URL-safe subdomain
  company_name TEXT,             -- Display name
  status TEXT,                   -- 'active', 'suspended', 'trial'
  contact_email TEXT,
  contact_phone TEXT,
  subscription_plan TEXT,        -- 'basic', 'pro', 'enterprise'
  trial_ends_at TIMESTAMPTZ,
  master_password_hash TEXT,     -- Legacy feature
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### `app_users` Table
```sql
CREATE TABLE app_users (
  id UUID PRIMARY KEY,
  auth_user_id UUID,             -- Links to auth.users
  tenant_id UUID,                -- NULL for super admins
  email TEXT,
  name TEXT,
  role TEXT,                     -- 'head_admin', 'admin', 'ops', 'viewer'
  is_active BOOLEAN,
  must_change_password BOOLEAN,
  is_super_admin BOOLEAN,        -- Super admin flag
  is_primary_super_admin BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

---

## Troubleshooting

### "User profile not found" error
- Make sure you created both auth.users AND app_users records
- Check that `auth_user_id` in app_users matches the auth.users id

### "Account has been deactivated" error
- Check `is_active = true` in app_users
- Super admins bypass this check

### Cannot login to rental dashboard with super admin credentials
- Verify `is_super_admin = true` in app_users
- Check the auth store bypass logic in `apps/portal/src/stores/auth-store.ts`

### "Website Content" tab not showing
- Only super admins see this tab
- Check the sidebar filtering logic in `apps/portal/src/components/shared/layout/app-sidebar.tsx`

---

## Development URLs

```
Landing Page:          http://localhost:3000
Booking App:           http://localhost:8080
Portal (Rental Admin): http://localhost:3001
Admin (Super Admin):   http://localhost:3002
```

---

## Production URLs

```
Landing Page:          https://drive-247.com
Super Admin Dashboard: https://admin.drive-247.com
Rental Dashboards:     https://{slug}.drive-247.com/dashboard
Booking Sites:         https://{slug}.drive-247.com
```

Example for FleetVana:
- Booking: `https://fleetvana.drive-247.com`
- Dashboard: `https://fleetvana.drive-247.com/dashboard`

---

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the SQL scripts for detailed comments
3. Check Supabase logs for database errors
4. Contact the development team
