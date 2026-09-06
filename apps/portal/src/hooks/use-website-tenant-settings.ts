import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

/**
 * The two website-facing `tenants` columns that no hook owned.
 *
 * `useTenantBranding` owns the branding/SEO columns and `useRentalSettings`
 * owns `blog_enabled`, so those two keep their existing write paths — this hook
 * exists ONLY for the leftovers:
 *
 *   `customer_theme_mode`        light/dark on the customer booking site
 *   `maintenance_banner_*`       the notice shown to visitors (and to staff)
 *
 * `customer_theme_mode` is written today by an inline handler inside the 5,400
 * line v1 settings page (`saveCustomerThemeMode`). That handler is NOT edited:
 * it is the path all 56 non-v2 tenants still use, and V2_PLAN §7 is explicit
 * that a v1 path serving everyone is not refactored for one canary. The two
 * cannot disagree because they are never both reachable for the same tenant —
 * the v2 gate replaces the v1 control with a pointer row (see
 * `(dashboard)/settings/page.tsx`), so exactly one screen carries the control
 * at a time. The SQL below is deliberately identical to that handler's, down to
 * the zero-row check, so behaviour is the same wherever it is written from.
 *
 * `maintenance_banner_*` has no tenant-facing writer anywhere in the portal
 * today — the columns were only ever set from the admin app — so there is no
 * second path to agree with.
 *
 * Reads come from `TenantContext`, which already SELECTs all three columns; no
 * extra query is issued.
 */

export type CustomerThemeMode = 'dark' | 'light' | 'light_only' | 'dark_only';

export interface WebsiteTenantSettings {
  customer_theme_mode: CustomerThemeMode;
  maintenance_banner_enabled: boolean;
  maintenance_banner_message: string;
}

/** Exactly the columns this hook writes — nothing else is ever sent. */
const WRITABLE = [
  'customer_theme_mode',
  'maintenance_banner_enabled',
  'maintenance_banner_message',
] as const;

export function useWebsiteTenantSettings() {
  const { tenant, refetchTenant } = useTenant();
  const [isSaving, setIsSaving] = useState(false);

  // `Tenant` declares only the ~40 columns TenantContext types explicitly, and
  // the three below are among them — but the interface has no index signature,
  // so a direct cast is rejected. Widening through `unknown` is the same route
  // every other consumer of these loosely-typed tenant columns takes.
  const t = tenant as unknown as (Record<string, unknown> & { id?: string }) | null;

  const values: WebsiteTenantSettings = {
    // Matches the v1 settings page's default: a tenant that never chose gets dark.
    customer_theme_mode: ((t?.customer_theme_mode as string) ??
      'dark') as CustomerThemeMode,
    maintenance_banner_enabled: t?.maintenance_banner_enabled === true,
    maintenance_banner_message: (t?.maintenance_banner_message as string) ?? '',
  };

  /**
   * Write one or more of the three columns.
   *
   * `.select()` is load-bearing, not decoration. `tenants` has RLS enabled and
   * PostgREST reports an UPDATE that matched NO ROWS as `error: null` — which is
   * indistinguishable from success. Without the row count a user whose role has
   * no UPDATE policy sees "Saved", changes nothing, and watches the control snap
   * back with no explanation. This is the same guard the v1 handler carries.
   */
  const save = useCallback(
    async (patch: Partial<WebsiteTenantSettings>): Promise<boolean> => {
      if (!tenant?.id) return false;

      const clean: Record<string, unknown> = {};
      for (const key of WRITABLE) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          clean[key] = patch[key];
        }
      }
      if (Object.keys(clean).length === 0) return true;

      setIsSaving(true);
      try {
        const { data, error } = await supabase
          .from('tenants')
          .update(clean)
          .eq('id', tenant.id)
          .select(WRITABLE.join(', '));
        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error('You do not have permission to change this setting.');
        }
        await refetchTenant();
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        toast({
          title: 'Failed to save',
          description: message,
          variant: 'destructive',
        });
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [tenant?.id, refetchTenant],
  );

  return { values, save, isSaving };
}
