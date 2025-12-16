# Branding Architecture Fix: Per-Tenant Isolation

## Problem Summary

The current branding system is **broken** because it uses a global `org_settings` table that is shared across all tenants, instead of per-tenant branding stored in the `tenants` table.

**Current (Broken) Flow**:
```
User logs in (FleetVana) → Settings page saves to org_settings (global) →
Other user logs in (Global Motion Transport) → Sees FleetVana's branding ❌
```

**Expected (Correct) Flow**:
```
User logs in (FleetVana) → Settings saves to tenants WHERE slug='fleetvana' →
Other user logs in (Global Motion Transport) → Sees GMT's branding from tenants WHERE slug='globalmotiontransport' ✅
```

## Root Cause

### Current State:
1. **`org_settings` table**: Global settings (1 row for entire system)
   - Contains: payment_mode, reminders, AND branding colors ❌
   - Problem: Branding should be per-tenant, not global

2. **`tenants` table**: Per-tenant data
   - Contains: company_name, slug, status
   - Missing: Branding columns not being fetched by TenantContext

3. **`useDynamicTheme` hook**: Reads from `org_settings` ❌
   - Should read from the logged-in user's tenant record

4. **Settings page**: Saves branding to `org_settings` ❌
   - Should save to the current user's tenant record

## Solution Architecture

### Data Model

**`tenants` table** (per-tenant branding):
```sql
- id
- slug
- company_name
- app_name              -- Custom app name (e.g., "FleetVana Rentals")
- primary_color         -- Main brand color (#3B82F6)
- secondary_color
- accent_color
- logo_url              -- Company logo
- favicon_url           -- Custom favicon
- light_primary_color   -- Light theme variant
- dark_primary_color    -- Dark theme variant
- ... (all branding fields)
```

**`org_settings` table** (global operational settings):
```sql
- id
- payment_mode          -- automated/manual
- reminder_due_today    -- bool
- reminder_overdue_1d   -- bool
- ... (operational settings only, NO branding)
```

### Code Changes Required

#### 1. Update TenantContext to Fetch Branding

**File**: `apps/portal/src/contexts/TenantContext.tsx`

**Current** (line 56):
```typescript
.select('id, slug, company_name, status, contact_email')
```

**Fix**:
```typescript
.select(`
  id,
  slug,
  company_name,
  status,
  contact_email,
  app_name,
  primary_color,
  secondary_color,
  accent_color,
  logo_url,
  favicon_url,
  light_primary_color,
  light_secondary_color,
  light_accent_color,
  dark_primary_color,
  dark_secondary_color,
  dark_accent_color,
  light_background_color,
  dark_background_color,
  light_header_footer_color,
  dark_header_footer_color,
  meta_title,
  meta_description,
  og_image_url
`)
```

**Also update Tenant interface** (line 7):
```typescript
interface Tenant {
  id: string;
  slug: string;
  company_name: string;
  status: string;
  contact_email: string;
  // Add branding fields
  app_name?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  logo_url?: string;
  favicon_url?: string;
  light_primary_color?: string;
  light_secondary_color?: string;
  light_accent_color?: string;
  dark_primary_color?: string;
  dark_secondary_color?: string;
  dark_accent_color?: string;
  light_background_color?: string;
  dark_background_color?: string;
  light_header_footer_color?: string;
  dark_header_footer_color?: string;
  meta_title?: string;
  meta_description?: string;
  og_image_url?: string;
}
```

#### 2. Create useTenantBranding Hook

**New File**: `apps/portal/src/hooks/use-tenant-branding.ts`

```typescript
import { useAuth } from '@/stores/auth-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useTenantBranding() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  // Fetch tenant branding based on logged-in user's tenant_id
  const { data: branding, isLoading } = useQuery({
    queryKey: ['tenant-branding', appUser?.tenant_id],
    queryFn: async () => {
      if (!appUser?.tenant_id) return null;

      const { data, error } = await supabase
        .from('tenants')
        .select(`
          app_name,
          primary_color,
          secondary_color,
          accent_color,
          logo_url,
          favicon_url,
          light_primary_color,
          light_secondary_color,
          light_accent_color,
          dark_primary_color,
          dark_secondary_color,
          dark_accent_color,
          light_background_color,
          dark_background_color,
          light_header_footer_color,
          dark_header_footer_color,
          meta_title,
          meta_description,
          og_image_url
        `)
        .eq('id', appUser.tenant_id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!appUser?.tenant_id,
  });

  // Update tenant branding
  const updateBrandingMutation = useMutation({
    mutationFn: async (updates: Partial<typeof branding>) => {
      if (!appUser?.tenant_id) throw new Error('No tenant ID');

      const { data, error } = await supabase
        .from('tenants')
        .update(updates)
        .eq('id', appUser.tenant_id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['tenant-branding', appUser?.tenant_id], data);
    },
  });

  return {
    branding,
    isLoading,
    updateBranding: updateBrandingMutation.mutateAsync,
  };
}
```

#### 3. Update useDynamicTheme to Use Tenant Branding

**File**: `apps/portal/src/hooks/use-dynamic-theme.ts`

**Current** (line 115):
```typescript
const { settings } = useOrgSettings();
```

**Fix**:
```typescript
const { branding } = useTenantBranding(); // Get branding from tenant, not org_settings
```

**Then replace all references** to `settings.primary_color` with `branding?.primary_color`, etc.

#### 4. Update Settings Page to Save to Tenant

**File**: `apps/portal/src/app/(dashboard)/settings/page.tsx`

**Replace** `useOrgSettings` with both hooks:
```typescript
const { settings, updateSettings } = useOrgSettings(); // For operational settings
const { branding, updateBranding } = useTenantBranding(); // For branding
```

**Update** `handleSaveBranding` (line 161):
```typescript
const handleSaveBranding = async () => {
  setIsSavingBranding(true);
  try {
    const brandingData = {
      app_name: brandingForm.app_name,
      primary_color: brandingForm.primary_color,
      secondary_color: brandingForm.secondary_color,
      accent_color: brandingForm.accent_color,
      light_primary_color: brandingForm.light_primary_color || null,
      light_secondary_color: brandingForm.light_secondary_color || null,
      light_accent_color: brandingForm.light_accent_color || null,
      dark_primary_color: brandingForm.dark_primary_color || null,
      dark_secondary_color: brandingForm.dark_secondary_color || null,
      dark_accent_color: brandingForm.dark_accent_color || null,
      light_background_color: brandingForm.light_background_color || null,
      dark_background_color: brandingForm.dark_background_color || null,
      light_header_footer_color: brandingForm.light_header_footer_color || null,
      dark_header_footer_color: brandingForm.dark_header_footer_color || null,
      meta_title: brandingForm.meta_title,
      meta_description: brandingForm.meta_description,
      og_image_url: brandingForm.og_image_url,
      favicon_url: brandingForm.favicon_url || null,
      logo_url: brandingForm.logo_url,
    };

    // Save to TENANT table, not org_settings
    await updateBranding(brandingData);

    toast({
      title: "Branding Updated",
      description: "Your branding settings have been saved and applied.",
    });
  } catch (error: any) {
    console.error('Branding save error:', error);
    toast({
      title: "Error",
      description: error.message || "Failed to save branding settings",
      variant: "destructive",
    });
  } finally {
    setIsSavingBranding(false);
  }
};
```

## Implementation Steps

1. ✅ Add branding columns to `tenants` table (if missing)
2. ✅ Update `TenantContext` to fetch branding fields
3. ✅ Create `useTenantBranding` hook
4. ✅ Update `useDynamicTheme` to use tenant branding
5. ✅ Update Settings page to save to tenant
6. ✅ Test with FleetVana and Global Motion Transport

## Testing Plan

1. **Login as FleetVana admin** (`admin@fleetvana.com`)
2. **Change branding**: Primary color to #3B82F6 (blue)
3. **Verify**: Sidebar, buttons show blue
4. **Logout**
5. **Login as Global Motion Transport admin** (`admin@globalmotiontransport.com`)
6. **Verify**: Branding is still default gold #C6A256
7. **Success**: Branding is isolated ✅

## Migration Notes

### Existing Data

If `org_settings` already has branding data that should be preserved:

```sql
-- Migrate org_settings branding to a specific tenant (e.g., the first/default tenant)
UPDATE tenants
SET
  primary_color = (SELECT primary_color FROM org_settings LIMIT 1),
  secondary_color = (SELECT secondary_color FROM org_settings LIMIT 1),
  app_name = (SELECT app_name FROM org_settings LIMIT 1)
WHERE slug = 'default-tenant-slug';

-- Clean up org_settings (remove branding columns)
ALTER TABLE org_settings
DROP COLUMN IF EXISTS primary_color,
DROP COLUMN IF EXISTS secondary_color,
DROP COLUMN IF EXISTS app_name,
DROP COLUMN IF EXISTS logo_url,
-- ... (drop all branding columns)
```

### Default Branding for New Tenants

Set default colors in `tenants` table defaults:

```sql
ALTER TABLE tenants
ALTER COLUMN primary_color SET DEFAULT '#C6A256',
ALTER COLUMN secondary_color SET DEFAULT '#C6A256',
ALTER COLUMN app_name SET DEFAULT 'Drive 917';
```

## Benefits After Fix

✅ **Per-tenant branding isolation**: Each rental company has their own colors/logo
✅ **No cross-contamination**: FleetVana blue doesn't leak to Global Motion Transport
✅ **Scalable**: Add 100 tenants, each with unique branding
✅ **Clean separation**: `org_settings` for operations, `tenants` for branding
✅ **Follows test expectations**: Matches the `test-branding-isolation.sql` requirements
