'use client';

/**
 * Pausing Accounts — who may pause their subscription, and every pause.
 *
 * One switch (`subscription_pause_settings.all_v2_enabled`):
 *   off (default)  only the pilot tenant, ali-rentals, sees "Pause" in Billing
 *   on             every v2 tenant does (ali-rentals included)
 * v1 tenants never do: the button lives in the v2 Billing page, and the
 * `subscription-pause` edge function checks the same rule again.
 *
 * Below it, every pause ever booked (super-admin RLS): dates, whether it is
 * running, and what Stripe was told — a failed Stripe call is shown here, since
 * that is a tenant who is paused in Drive247 but may still be billed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, PauseCircle, RefreshCw } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
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

interface PauseRow {
  id: string;
  tenant_id: string;
  start_date: string;
  end_date: string;
  months: number;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'active' | 'ended' | 'cancelled';
  stripe_status: 'pending' | 'applied' | 'failed' | 'resumed' | 'not_needed';
  stripe_error: string | null;
  created_at: string;
  ended_at: string | null;
}

interface TenantLite {
  id: string;
  slug: string;
  company_name: string | null;
  portal_experience: string | null;
}

/** A calendar day as stored ("YYYY-MM-DD"), without a timezone shift. */
const fmtDay = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** What the row means now, from its dates: the same rule the database uses. */
function stateOf(p: PauseRow, now: number): { label: string; cls: string } {
  if (p.status === 'cancelled') return { label: 'Cancelled', cls: 'text-muted-foreground' };
  const open = p.status === 'scheduled' || p.status === 'active';
  if (open && new Date(p.starts_at).getTime() <= now && new Date(p.ends_at).getTime() > now) {
    return { label: 'Paused now', cls: 'text-sky-700 dark:text-sky-400' };
  }
  if (open && new Date(p.starts_at).getTime() > now) return { label: 'Scheduled', cls: 'text-amber-700 dark:text-amber-400' };
  return { label: 'Ended', cls: 'text-muted-foreground' };
}

const STRIPE_LABEL: Record<PauseRow['stripe_status'], string> = {
  pending: 'Waiting for start',
  applied: 'Collection paused',
  failed: 'Stripe call failed',
  resumed: 'Collection resumed',
  not_needed: 'Not needed',
};

export function PausingAccountsTab({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pauses, setPauses] = useState<PauseRow[]>([]);
  const [tenants, setTenants] = useState<Map<string, TenantLite>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, t] = await Promise.all([
        db.from('subscription_pause_settings').select('all_v2_enabled, pilot_tenant_slug, updated_at').eq('id', 1).maybeSingle(),
        db.from('tenant_subscription_pauses').select('*').order('created_at', { ascending: false }).limit(500),
        db.from('tenants').select('id, slug, company_name, portal_experience'),
      ]);
      for (const res of [s, p, t]) if (res.error) throw res.error;
      setSettings(s.data as Settings);
      setPauses((p.data as PauseRow[]) ?? []);
      setTenants(new Map(((t.data as TenantLite[]) ?? []).map((r) => [r.id, r])));
    } catch (e) {
      toast.error('Could not load Pausing Accounts', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const v2Count = useMemo(
    () => [...tenants.values()].filter((t) => t.portal_experience === 'v2').length,
    [tenants],
  );

  const setAllV2 = async (on: boolean) => {
    setSaving(true);
    try {
      const { data, error } = await db
        .from('subscription_pause_settings')
        .update({ all_v2_enabled: on, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
        .eq('id', 1)
        .select('all_v2_enabled, pilot_tenant_slug, updated_at')
        .single();
      if (error) throw error;
      setSettings(data as Settings);
      toast.success(on ? 'Pausing is now available to every V2 tenant' : `Pausing is now limited to ${data.pilot_tenant_slug}`);
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
            Apply supabase/migrations/20261009170000_subscription_pausing.sql to use this tab.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const now = Date.now();
  const nameOf = (id: string) => {
    const t = tenants.get(id);
    return t ? t.company_name || t.slug : 'Deleted tenant';
  };
  const pausedNow = pauses.filter((p) => stateOf(p, now).label === 'Paused now').length;
  const scheduled = pauses.filter((p) => stateOf(p, now).label === 'Scheduled').length;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <PauseCircle className="h-5 w-5" />
          Pausing Accounts
        </h1>
        <p className="text-sm text-muted-foreground">
          Let V2 tenants pause their subscription for 1 or 2 months from Billing → Pause.
        </p>
      </div>

      {/* ── who may pause ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Who can pause</CardTitle>
          <CardDescription>
            Off: only <span className="font-medium text-foreground">{settings.pilot_tenant_slug}</span> sees the
            Pause button. On: every V2 tenant does ({v2Count} today). V1 tenants never do.
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

      {/* ── the rules ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>The rules tenants see</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Whole months only: minimum 1, maximum 2 (30 Oct → 30 Nov or 30 Dec). Anything else: &ldquo;Can only pause for minimum 1 month and max 2 months.&rdquo;</li>
            <li>The account switches back on by itself when the pause ends, so 2 months is never outstayed.</li>
            <li>No pause may start in the last 10 days before a bill: &ldquo;You can not pause right now, as your subscription fee has X days left.&rdquo;</li>
            <li>The billing date never moves. Bills inside the pause are voided in Stripe (pause_collection), and the next one is on the usual day.</li>
            <li>While paused: no charges, nothing deleted, no new rentals, vehicles or customers, and the booking site shows &ldquo;Booking on hold for N days&rdquo;.</li>
            <li>Not during a free trial, with an unpaid bill, or when the subscription is already set to end. One pause at a time; the tenant can cancel or end it early.</li>
          </ul>
        </CardContent>
      </Card>

      {/* ── every pause ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Pauses</CardTitle>
            <CardDescription>
              {pausedNow} paused now · {scheduled} scheduled · {pauses.length} in total
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {pauses.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No tenant has paused yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Pause</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Billing (Stripe)</TableHead>
                  <TableHead>Booked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pauses.map((p) => {
                  const state = stateOf(p, now);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{nameOf(p.tenant_id)}</TableCell>
                      <TableCell>
                        {fmtDay(p.start_date)} → {fmtDay(p.end_date)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {p.months} month{p.months === 1 ? '' : 's'}
                        </span>
                      </TableCell>
                      <TableCell className={state.cls}>{state.label}</TableCell>
                      <TableCell>
                        {p.stripe_status === 'failed' ? (
                          <Badge variant="destructive" title={p.stripe_error ?? undefined}>
                            {STRIPE_LABEL.failed}
                          </Badge>
                        ) : (
                          <span className="text-sm">{STRIPE_LABEL[p.stripe_status]}</span>
                        )}
                        {p.stripe_error && (
                          <p className="mt-1 max-w-xs truncate text-xs text-muted-foreground" title={p.stripe_error}>
                            {p.stripe_error}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmtWhen(p.created_at)}</TableCell>
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
