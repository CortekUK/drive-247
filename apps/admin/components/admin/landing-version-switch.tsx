'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { SettingsRow, SettingsSegmented } from '@/components/admin/settings/settings-kit';

type LandingVersion = 'v1' | 'v2';

const OPTIONS: Array<{ value: LandingVersion; label: string }> = [
  { value: 'v1', label: 'v1 · Current' },
  { value: 'v2', label: 'v2 · New' },
];

/**
 * "Landing page version": which drive-247.com landing page is live (Oct 2026).
 *
 * Stored as `admin_settings.landing_version` ('v1' | 'v2') on every row, read
 * as "v2 if any row says v2". The landing page never reads `admin_settings`
 * itself; it calls `public.landing_version()`, fails to v1, and reads fresh on
 * every load, so a switch shows on the next reload. `/?landing=v2` previews v2
 * without switching it on for everyone.
 */
export function LandingVersionSwitch() {
  const [version, setVersion] = useState<LandingVersion | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase.from('admin_settings').select('landing_version' as any);
    if (error) {
      setLoadError(error.message);
      return;
    }
    const rows = (data ?? []) as Array<{ landing_version?: string | null }>;
    setVersion(rows.some((row) => row.landing_version === 'v2') ? 'v2' : 'v1');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (next: LandingVersion) => {
    if (version === null || saving || next === version) return;
    const previous = version;
    setVersion(next);
    setSaving(true);
    // `.select()` so an update that matched no rows (RLS, or no settings row)
    // is reported instead of reading as success.
    const { data, error } = await supabase
      .from('admin_settings')
      .update({ landing_version: next, updated_at: new Date().toISOString() } as any)
      .not('id', 'is', null)
      .select('id');
    setSaving(false);
    if (error || !data || data.length === 0) {
      setVersion(previous);
      toast.error('Could not switch the landing page', {
        description: error?.message ?? 'No settings row was updated.',
      });
      return;
    }
    toast.success(`drive-247.com is now on landing page ${next}`, {
      description: 'Reload drive-247.com to see it; it takes effect on the next page load.',
    });
  };

  const busy = version === null || saving;

  return (
    <SettingsRow
      label="Landing page version"
      description={
        <>
          Which landing page drive-247.com shows. To look at the other one without switching it for
          everyone, open drive-247.com/?landing=v1 or ?landing=v2.
          {loadError && <span className="mt-1 block text-destructive">Could not read this setting: {loadError}</span>}
        </>
      }
    >
      {version === null && !loadError ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <SettingsSegmented
          label="Landing page version"
          options={OPTIONS}
          value={version}
          onChange={(v) => void choose(v)}
          disabled={busy}
        />
      )}
    </SettingsRow>
  );
}
