# Universal Super Admin Setup Guide

## Overview

This guide will help you set up a universal super admin account that can access:
- ✅ **Super Admin Dashboard** (`admin.drive-247.com` or `localhost:3003`)
- ✅ **Any Rental Company Dashboard** (FleetVana, Global Motion Transport, etc.)
- ✅ **Full head_admin privileges** in all portals

## Credentials

```
Email: admin@cortek.io
Password: Admin@Cortek2024
```

## How It Works

The codebase already has super admin logic built-in:

**Portal Auth Store** (`apps/portal/src/stores/auth-store.ts`):
- Lines 52-59: Super admins automatically get `head_admin` role
- Lines 102-106: Super admins bypass `is_active` checks
- Lines 110: Super admins bypass `must_change_password` requirement
- Super admins have `tenant_id = NULL` (can access any tenant)

**Super Admin Dashboard** (`apps/admin/store/authStore.ts`):
- Lines 40-44: Verifies `is_super_admin` flag before granting access
- Already configured to work with email/password authentication

## Setup Steps

### Step 1: Create Auth User in Supabase

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo)
2. Navigate to **Authentication** → **Users**
3. Click **Add user** → **Create new user**
4. Enter the following:
   ```
   Email: admin@cortek.io
   Password: Admin@Cortek2024
   ```
5. **IMPORTANT**: Uncheck "Send user a confirmation email"
6. Click **Create user**
7. **Copy the generated User ID** (UUID) - you'll need this in the next step

### Step 2: Add Super Admin Record to app_users

1. Go to **SQL Editor** in Supabase Dashboard
2. Paste the following SQL (replace `<AUTH_USER_ID>` with the UUID from Step 1):

```sql
INSERT INTO app_users (
  auth_user_id,
  tenant_id,
  email,
  name,
  role,
  is_active,
  is_super_admin,
  is_primary_super_admin,
  must_change_password
)
VALUES (
  '<AUTH_USER_ID>',              -- Replace with actual auth.users.id
  NULL,                          -- Super admins don't belong to a specific tenant
  'admin@cortek.io',
  'Cortek Super Admin',
  'head_admin',
  true,
  true,                          -- Key flag for super admin access
  true,                          -- Primary super admin (full permissions)
  false
)
ON CONFLICT (auth_user_id)
DO UPDATE SET
  is_super_admin = true,
  is_primary_super_admin = true,
  is_active = true,
  name = 'Cortek Super Admin',
  email = 'admin@cortek.io';
```

3. Click **Run** to execute the SQL

### Step 3: Verify Setup

Run this query to confirm the account was created correctly:

```sql
SELECT
  au.id,
  au.auth_user_id,
  au.email,
  au.name,
  au.role,
  au.is_active,
  au.is_super_admin,
  au.is_primary_super_admin,
  auth_users.email as auth_email
FROM app_users au
JOIN auth.users auth_users ON auth_users.id = au.auth_user_id
WHERE au.email = 'admin@cortek.io';
```

You should see:
```
✅ email: admin@cortek.io
✅ is_super_admin: true
✅ is_primary_super_admin: true
✅ is_active: true
✅ tenant_id: NULL
```

## Testing

### Test 1: Super Admin Dashboard Login

1. Go to `http://localhost:3003/admin/login`
2. Enter credentials:
   ```
   Email: admin@cortek.io
   Password: Admin@Cortek2024
   ```
3. Click **Sign in**
4. **Expected**: Redirect to `/admin/dashboard` with full access to:
   - All rental companies
   - Platform metrics
   - Contact requests
   - Super admin management

### Test 2: FleetVana Portal Login

1. Go to `http://localhost:3001/login` (or `https://fleetvana.drive-247.com/dashboard`)
2. Enter the same credentials:
   ```
   Email: admin@cortek.io
   Password: Admin@Cortek2024
   ```
3. Click **Sign in**
4. **Expected**: Redirect to `/dashboard` with full `head_admin` access to:
   - Vehicles, customers, rentals
   - Payments, invoices, fines
   - Settings, branding, users
   - All features unlocked

### Test 3: Global Motion Transport Portal Login

1. Go to `http://localhost:3001/login` (or use subdomain)
2. Enter the same credentials
3. **Expected**: Same full access as FleetVana

## What Happens Behind the Scenes

When you login with `admin@cortek.io`:

1. **Supabase Auth** validates email/password
2. **Portal Auth Store** (`fetchAppUser` function):
   - Fetches user from `app_users` table
   - Detects `is_super_admin = true`
   - **Automatically grants `head_admin` role** (line 56)
   - **Bypasses tenant isolation** (no tenant_id required)
   - **Bypasses is_active check** (line 103)
   - **Bypasses must_change_password** (line 110)

3. **Result**: You have full admin access to any rental company dashboard

## Security Notes

- This account has **unrestricted access** to all tenants and data
- Store these credentials securely (password manager, env variables, etc.)
- Consider changing the password after initial setup
- Only share with trusted administrators

## Troubleshooting

### "User profile not found"
- Check that the `app_users` record exists with matching `auth_user_id`
- Verify the SQL insert completed successfully

### "Access denied. Super admin privileges required" (Super Admin Dashboard)
- Check `is_super_admin = true` in `app_users` table
- Ensure you're logging into the correct portal (port 3003 for super admin)

### "Account has been deactivated" (Rental Portal)
- This shouldn't happen for super admins (bypassed)
- If it does, check `is_active = true` in database

## Additional Super Admins

To create more super admin accounts, repeat the setup steps with different emails. For secondary super admins (not primary), set:
```sql
is_primary_super_admin = false
```

Primary super admins have additional privileges (like managing other super admins).

## Next Steps

After setup:
1. ✅ Test login on super admin dashboard
2. ✅ Test login on FleetVana portal
3. ✅ Test login on Global Motion Transport portal
4. 🎨 Configure FleetVana branding (Settings → Branding → Change primary color to blue #3B82F6)
5. ✅ Verify Global Motion Transport keeps default gold colors (#C6A256)
