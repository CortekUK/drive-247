'use client';

/**
 * Northwind booking site — v1 (the current site) or v2 (the redesign being
 * built beside it).
 *
 * Stored as `admin_settings.northwind_site_version` ('v1' | 'v2') on every row,
 * read as "v2 if any row says v2". The booking middleware reads it through
 * `public.northwind_site_version()`, fails to v1, and only for tenants in
 * NEW_DESIGN_TENANTS (apps/booking/src/lib/booking-design.ts) — so no other
 * tenant's site can change. Pages v2 has not built yet still open from v1.
 */

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { SettingsRow, SettingsSegmented } from '@/components/admin/settings/settings-kit';

type SiteVersion = 'v1' | 'v2';

const OPTIONS: Array<{ value: SiteVersion; label: string }> = [
  { value: 'v1', label: 'v1 · Current' },
  { value: 'v2', label: 'v2 · New' },
];

function siteUrl(): string {
  const local = typeof window !== 'undefined' && window.location.hostname.endsWith('localhost');
  return local ? 'http://northwind.localhost:3000' : 'https://northwind.drive-247.com';
}

export function NorthwindSiteVersionCard() {
  const [version, setVersion] = useState<SiteVersion | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase.from('admin_settings').select('northwind_site_version' as any);
    if (error) {
      setLoadError(error.message);
      return;
    }
    const rows = (data ?? []) as Array<{ northwind_site_version?: string | null }>;
    setVersion(rows.some((row) => row.northwind_site_version === 'v2') ? 'v2' : 'v1');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (next: SiteVersion) => {
    if (version === null || saving || next === version) return;
    const previous = version;
    setVersion(next);
    setSaving(true);
    // `.select()` so an update that matched no rows is reported instead of reading as success.
    const { data, error } = await supabase
      .from('admin_settings')
      .update({ northwind_site_version: next, updated_at: new Date().toISOString() } as any)
      .not('id', 'is', null)
      .select('id');
    setSaving(false);
    if (error || !data || data.length === 0) {
      setVersion(previous);
      toast.error("Could not switch Northwind's booking site", {
        description: error?.message ?? 'No settings row was updated.',
      });
      return;
    }
    toast.success(`Northwind's booking site is now on ${next}`, {
      description: 'Reload the Northwind site to see it; it can take up to 10 seconds.',
    });
  };

  const busy = version === null || saving;
  const url = siteUrl();

  return (
    <SettingsRow
      label="Northwind booking site and customer portal"
      description={
        <>
          Which booking site and customer portal Northwind&apos;s customers see. Pages v2 hasn&apos;t built yet
          still open from v1. To look at the other one without switching, add ?site=v1 or ?site=v2 to the
          address.{' '}
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            Open site <ExternalLink className="size-3.5" />
          </a>{' '}
          <a href={`${url}/portal`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            Open portal <ExternalLink className="size-3.5" />
          </a>
          {loadError && <span className="mt-1 block text-destructive">Could not read this setting: {loadError}</span>}
        </>
      }
    >
      {version === null && !loadError ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <SettingsSegmented
          label="Northwind booking site version"
          options={OPTIONS}
          value={version}
          onChange={(v) => void choose(v)}
          disabled={busy}
        />
      )}
    </SettingsRow>
  );
}
