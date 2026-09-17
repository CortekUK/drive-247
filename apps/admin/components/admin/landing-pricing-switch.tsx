'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0 max-w-2xl">
          <p className="text-sm font-semibold">Show pricing on drive-247.com</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Adds the pricing tier section, and with it self-serve signup, to the landing page.
            Turn it on to test the live signup journey, and off again when testing is done.
          </p>
          {loadError && (
            <p className="mt-1 text-sm text-destructive">Could not read this setting: {loadError}</p>
          )}
        </div>
        <label className={cn('flex shrink-0 items-center', busy ? 'cursor-wait' : 'cursor-pointer')}>
          <div className="relative">
            <input
              type="checkbox"
              role="switch"
              aria-label="Show pricing on drive-247.com"
              checked={enabled === true}
              disabled={busy}
              onChange={(e) => void toggle(e.target.checked)}
              className="peer sr-only"
            />
            <div
              className={cn(
                'h-6 w-11 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
                enabled ? 'bg-emerald-500' : 'bg-muted',
                busy && 'opacity-70',
              )}
            >
              <div
                className={cn(
                  'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md ring-1 ring-black/5 transition-transform',
                  enabled && 'translate-x-5',
                )}
              />
            </div>
          </div>
          <Badge variant={enabled ? 'success' : 'outline'} className="ml-2 whitespace-nowrap">
            {enabled === null ? (
              loadError ? 'Unknown' : <Loader2 className="h-3 w-3 animate-spin" />
            ) : enabled ? (
              'Showing'
            ) : (
              'Hidden'
            )}
          </Badge>
        </label>
      </CardContent>
    </Card>
  );
}
