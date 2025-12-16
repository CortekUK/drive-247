# Rental Company Testing Guide

## Test Status: Companies Created ✅

Both **FleetVana** and **Global Motion Transport** have been successfully created and appear in the super admin dashboard.

---

## Why Automated Tests Failed ❌

The test scripts failed because:
- **RLS (Row Level Security)** policies require authentication to access the `tenants` table
- Policy: `auth.uid() IS NOT NULL` (see migration `20251215160005_rls_permissive_policies.sql:174-176`)
- Test scripts use anonymous Supabase key which has no auth.uid()
- Super admin dashboard works because it uses authenticated sessions

---

## Manual Testing Instructions

### 1. Test Master Password Login (FleetVana)

**URL**: `http://localhost:3003/admin/login`

1. Open the super admin login page
2. Enter master password credentials:
   ```
   Slug: fleetvana
   Master Password: fv&Un%&bE9%cT!Ti3gtncxdcK*Rg9rYY
   ```
3. Click "Sign In with Master Password"
4. **Expected Result**: ✅ Should redirect to super admin dashboard
5. Verify you can see all rental companies in the list

---

### 2. Test Master Password Login (Global Motion Transport)

**URL**: `http://localhost:3003/admin/login`

1. Return to super admin login page
2. Enter master password credentials:
   ```
   Slug: globalmotiontransport
   Master Password: fNn4r*tBdrfEXL4AoVDC!dqA1N08tC7$
   ```
3. Click "Sign In with Master Password"
4. **Expected Result**: ✅ Should redirect to super admin dashboard

---

### 3. Test Admin User Login (FleetVana) ⚠️ NEEDS SETUP

**URL**: `http://localhost:3001/login` (Portal) or subdomain login

**IMPORTANT**: Admin users need to be manually created first.

#### Step 1: Create Admin User in Supabase Auth

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/hviqoaokxvlancmftwuo)
2. Navigate to **Authentication** → **Users**
3. Click **Add user** → **Create new user**
4. Enter credentials:
   ```
   Email: ilyasghulam35@gmail.com
   Password: KuXsrQ*Y4kt^RYps
   ```
5. Click **Create user**
6. Copy the generated `user.id` (UUID)

#### Step 2: Link User to app_users Table

7. Navigate to **SQL Editor** in Supabase Dashboard
8. Run the following SQL (replace `<USER_ID>` and `<TENANT_ID>`):

```sql
-- First, get the FleetVana tenant ID
SELECT id, company_name, slug FROM tenants WHERE slug = 'fleetvana';

-- Then insert app_user record (replace <USER_ID> and <TENANT_ID>)
INSERT INTO app_users (
  auth_user_id,
  tenant_id,
  email,
  name,
  role,
  is_active
)
VALUES (
  '<USER_ID>',           -- UUID from step 6
  '<TENANT_ID>',         -- Tenant ID from query above
  'ilyasghulam35@gmail.com',
  'FleetVana Admin',
  'head_admin',
  true
);
```

#### Step 3: Test Login

9. Go to `http://localhost:3001/login`
10. Enter credentials:
    ```
    Email: ilyasghulam35@gmail.com
    Password: KuXsrQ*Y4kt^RYps
    ```
11. Click **Sign In**
12. **Expected Result**: ✅ Should redirect to `/dashboard` with FleetVana branding

---

### 4. Test Admin User Login (Global Motion Transport) ⚠️ NEEDS SETUP

Repeat the same process as Step 3, but:

**Create separate auth user** (Supabase Auth doesn't allow duplicate emails):
```
Email: admin-gmt@drive-247.com  (or another unique email)
Password: AYeXYEZpj5b9AyS4
```

**Link to Global Motion Transport tenant**:
```sql
-- Get Global Motion Transport tenant ID
SELECT id, company_name, slug FROM tenants WHERE slug = 'globalmotiontransport';

-- Insert app_user record
INSERT INTO app_users (
  auth_user_id,
  tenant_id,
  email,
  name,
  role,
  is_active
)
VALUES (
  '<USER_ID>',
  '<TENANT_ID>',
  'admin-gmt@drive-247.com',
  'Global Motion Admin',
  'head_admin',
  true
);
```

---

### 5. Test Branding (FleetVana - Blue Primary Color) ⚠️ TODO

**After admin user login works:**

1. Log into FleetVana portal: `http://localhost:3001/login` (or subdomain)
2. Navigate to **Settings** → **Branding** tab
3. Change the primary color:
   ```
   Current: #C6A256 (gold)
   New: #3B82F6 (blue)
   ```
4. Click **Save Changes**
5. **Expected Result**: ✅ Sidebar, buttons, and UI elements should turn blue

---

### 6. Test Branding (Global Motion Transport - Keep Default)

**After admin user login works:**

1. Log into Global Motion Transport portal
2. Navigate to **Settings** → **Branding** tab
3. Verify primary color is: `#C6A256` (gold)
4. **Expected Result**: ✅ Should keep default gold color scheme

---

## Automated Testing Alternative

To enable automated tests, we would need to:

1. **Create a Supabase Edge Function** that bypasses RLS using service role key
2. **Or use service role key directly** in test scripts (NOT recommended for security)
3. **Or create a test-only RLS policy** that allows anon access (NOT recommended)

**Recommended**: Keep RLS strict and test manually via UI as documented above.

---

## Summary Checklist

- ✅ FleetVana created with credentials
- ✅ Global Motion Transport created with credentials
- ✅ Master passwords set and stored
- ⏳ Admin users need to be created in Supabase Auth
- ⏳ Admin users need to be linked to `app_users` table
- ⏳ FleetVana branding needs to be changed to blue
- ✅ Global Motion Transport keeps default colors

---

## Credentials Reference

### FleetVana
```
Company Name: fleetvana
Slug: fleetvana
Subdomain: fleetvana.drive-247.com
Master Password: fv&Un%&bE9%cT!Ti3gtncxdcK*Rg9rYY
Admin Email: ilyasghulam35@gmail.com (needs Supabase Auth user)
Admin Password: KuXsrQ*Y4kt^RYps
Portal URL: https://fleetvana.drive-247.com/dashboard
Booking URL: https://fleetvana.drive-247.com
```

### Global Motion Transport
```
Company Name: globalmotiontransport
Slug: globalmotiontransport
Subdomain: globalmotiontransport.drive-247.com
Master Password: fNn4r*tBdrfEXL4AoVDC!dqA1N08tC7$
Admin Email: admin-gmt@drive-247.com (needs unique email)
Admin Password: AYeXYEZpj5b9AyS4
Portal URL: https://globalmotiontransport.drive-247.com/dashboard
Booking URL: https://globalmotiontransport.drive-247.com
```
