'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { SettingsRow } from '@/components/admin/settings/settings-kit';

/**
 * "Show pricing on drive-247.com": the team lead's testing switch (Sep 2026).
 *
 * The public landing page renders its pricing tier section, the entry point to
 * self-serve signup, only while this is on. It is turned on to test the live
 * signup journey on the main domain and off again afterwards.
 *
 * Stored as `admin_settings.landing_pricing_enabled` on every row, read as
 * "true if any row is true" like the table's other global flags. The landing
 * page never reads `admin_settings` itself (it holds staff email addresses and
 * is meant to be staff-only); it calls `public.landing_pricing_enabled()`,
 * which returns this one boolean. Default off; the page fails closed, and it
 * reads the value fresh on every load, so a flip shows on the next reload.
 */
export function LandingPricingSwitch() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase.from('admin_settings').select('landing_pricing_enabled' as any);
    if (error) {
      setLoadError(error.message);
      return;
    }
    const rows = (data ?? []) as Array<{ landing_pricing_enabled?: boolean | null }>;
    setEnabled(rows.some((row) => row.landing_pricing_enabled === true));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (next: boolean) => {
    if (enabled === null || saving) return;
    const previous = enabled;
    setEnabled(next);
    setSaving(true);
    // `.select()` so an update that matched no rows (RLS, or no settings row)
    // is reported instead of reading as success.
    const { data, error } = await supabase
      .from('admin_settings')
      .update({ landing_pricing_enabled: next, updated_at: new Date().toISOString() } as any)
      .not('id', 'is', null)
      .select('id');
    setSaving(false);
    if (error || !data || data.length === 0) {
      setEnabled(previous);
      toast.error('Could not change the pricing section', {
        description: error?.message ?? 'No settings row was updated.',
      });
      return;
    }
    toast.success(next ? 'Pricing section is on' : 'Pricing section is off', {
      description: 'Reload drive-247.com to see it; it takes effect on the next page load.',
    });
  };

  const busy = enabled === null || saving;

  return (
    <SettingsRow
      label="Show pricing on drive-247.com"
      htmlFor="landing-pricing-enabled"
      description={
        <>
          Adds the pricing tier section, and with it self-serve signup, to the landing page. Turn it on
          to test the live signup journey, and off again when testing is done.
          {loadError && <span className="mt-1 block text-destructive">Could not read this setting: {loadError}</span>}
        </>
      }
    >
      {enabled === null && !loadError ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <Switch
          id="landing-pricing-enabled"
          aria-label="Show pricing on drive-247.com"
          checked={enabled === true}
          disabled={busy}
          onCheckedChange={(v) => void toggle(v)}
        />
      )}
    </SettingsRow>
  );
}
