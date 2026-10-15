'use client';

/**
 * Custom Domain — who connects their own domain self-serve, and every domain.
 *
 * One switch (`custom_domain_settings.all_v2_enabled`):
 *   off (default)  only the pilot tenant, northwind, gets the self-serve flow
 *   on             every v2 tenant does (northwind included)
 * v1 tenants never do: they keep the manual-handoff panel. The portal and the
 * `custom-domain` edge function both read the same rule
 * (custom_domain_self_serve_allowed).
 *
 * Below it, every tenant with a custom domain and where it stands — pending,
 * live, or stuck — so a stuck one can be spotted without asking the tenant.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, Loader2, RefreshCw } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Settings {
  all_v2_enabled: boolean;
  pilot_tenant_slug: string;
  updated_at: string;
}

interface TenantRow {
  id: string;
  slug: string;
  company_name: string | null;
  portal_experience: string | null;
  custom_booking_domain: string | null;
  custom_portal_domain: string | null;
  custom_domain_status: 'pending' | 'active' | 'error' | null;
  custom_domain_detail: string | null;
  custom_domain_checked_at: string | null;
  custom_domain_live_at: string | null;
}

const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: 'Live', cls: 'text-green-700 dark:text-green-400' },
  pending: { label: 'Waiting for DNS', cls: 'text-amber-700 dark:text-amber-400' },
  error: { label: 'Needs attention', cls: 'text-red-700 dark:text-red-400' },
  manual: { label: 'Set up by hand', cls: 'text-muted-foreground' },
};

export function CustomDomainTab({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        db.from('custom_domain_settings').select('all_v2_enabled, pilot_tenant_slug, updated_at').eq('id', 1).maybeSingle(),
        db
          .from('tenants')
          .select(
            'id, slug, company_name, portal_experience, custom_booking_domain, custom_portal_domain, custom_domain_status, custom_domain_detail, custom_domain_checked_at, custom_domain_live_at',
          ),
      ]);
      for (const res of [s, t]) if (res.error) throw res.error;
      setSettings(s.data as Settings);
      setTenants((t.data as TenantRow[]) ?? []);
    } catch (e) {
      toast.error('Could not load Custom Domain', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const v2Count = useMemo(() => tenants.filter((t) => t.portal_experience === 'v2').length, [tenants]);
  const withDomain = useMemo(
    () =>
      tenants
        .filter((t) => t.custom_booking_domain || t.custom_domain_status)
        .sort((a, b) => (a.company_name || a.slug).localeCompare(b.company_name || b.slug)),
    [tenants],
  );

  const setAllV2 = async (on: boolean) => {
    setSaving(true);
    try {
      const { data, error } = await db
        .from('custom_domain_settings')
        .update({ all_v2_enabled: on, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
        .eq('id', 1)
        .select('all_v2_enabled, pilot_tenant_slug, updated_at')
        .single();
      if (error) throw error;
      setSettings(data as Settings);
      toast.success(
        on ? 'Self-serve custom domains are now on for every V2 tenant' : `Self-serve custom domains are now limited to ${data.pilot_tenant_slug}`,
      );
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading && !settings) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!settings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not installed</CardTitle>
          <CardDescription>
            Apply supabase/migrations/20261015140000_custom_domain_settings.sql to use this tab.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const live = withDomain.filter((t) => t.custom_domain_status === 'active').length;
  const pending = withDomain.filter((t) => t.custom_domain_status === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Globe className="h-5 w-5" />
          Custom Domain
        </h1>
        <p className="text-sm text-muted-foreground">
          Let V2 tenants connect their own domain themselves: they add two DNS records, and we add the domain to
          our hosting, check it and issue the certificate automatically.
        </p>
      </div>

      {/* ── who gets self-serve ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Who can connect a domain themselves</CardTitle>
          <CardDescription>
            Off: only <span className="font-medium text-foreground">{settings.pilot_tenant_slug}</span>. On: every V2
            tenant ({v2Count} today). V1 tenants keep the manual setup with our team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center justify-between gap-4 rounded-xl border p-4">
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">Available to all V2 tenants</span>
              <span className="block text-xs text-muted-foreground">
                {settings.all_v2_enabled
                  ? `On: all ${v2Count} V2 tenants, ${settings.pilot_tenant_slug} included.`
                  : `Off: ${settings.pilot_tenant_slug} only.`}{' '}
                Last changed {fmtWhen(settings.updated_at)}.
              </span>
            </span>
            <span className="flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={settings.all_v2_enabled}
                disabled={!canEdit || saving}
                onCheckedChange={(on) => void setAllV2(on)}
                aria-label="Available to all V2 tenants"
              />
            </span>
          </label>
        </CardContent>
      </Card>

      {/* ── every domain ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Domains</CardTitle>
            <CardDescription>
              {live} live · {pending} waiting for DNS · {withDomain.length} in total
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {withDomain.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No tenant has a custom domain yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last checked</TableHead>
                  <TableHead>Live since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withDomain.map((t) => {
                  const st = STATUS[t.custom_domain_status ?? 'manual'];
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        {t.company_name || t.slug}
                        <span className="ml-2 text-xs uppercase text-muted-foreground">{t.portal_experience ?? 'v1'}</span>
                      </TableCell>
                      <TableCell>
                        <a href={`https://${t.custom_booking_domain}`} target="_blank" rel="noreferrer" className="hover:underline">
                          {t.custom_booking_domain ?? '—'}
                        </a>
                        {t.custom_portal_domain && (
                          <p className="text-xs text-muted-foreground">{t.custom_portal_domain}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={`text-sm ${st.cls}`}>{st.label}</span>
                        {t.custom_domain_detail && t.custom_domain_status !== 'active' && (
                          <p className="mt-1 max-w-xs truncate text-xs text-muted-foreground" title={t.custom_domain_detail}>
                            {t.custom_domain_detail}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtWhen(t.custom_domain_checked_at)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtWhen(t.custom_domain_live_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
