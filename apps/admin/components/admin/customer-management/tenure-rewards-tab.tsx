'use client';

/**
 * Tenure Rewards — loyalty perks for v2 operators who stay with Drive247.
 *
 *   Settings     master switch (ships OFF), how tenure is counted, whether a
 *                live subscription is required, tenant notifications
 *   Milestones   "N months → perk": free months, % off (for N months or for
 *                good), platform credits, or a manual perk the team delivers
 *   Operators    every v2 tenant's tenure (from `tenure_reward_tenants()`, the
 *                same function the runner decides on) and its milestones
 *   History      every grant, with Retry / Mark fulfilled
 *
 * `tenure-rewards-run` (pg_cron, daily 06:15 UTC) does the granting. "Preview"
 * asks it what it would do without writing anything.
 */

import { EmptyState, NoMatchState } from '@/components/admin/empty-state';
import { MilestonesEmptyArt } from '@/components/admin/illustrations/scenes/admin-scenes';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, Eye, Gift, Loader2, Pencil, Play, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { readEdgeFunctionError } from '@/lib/push';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LogEntry, LogList, LogRailCard, LogRailLayout } from './log-rail';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type PerkType = 'free_period' | 'percent_discount' | 'credits' | 'manual';
type GrantStatus = 'processing' | 'applied' | 'pending' | 'failed' | 'skipped' | 'manual_todo' | 'fulfilled';

interface Settings {
  enabled: boolean;
  tenure_start: 'account_created' | 'first_subscription';
  require_active_subscription: boolean;
  notify_tenants: boolean;
  last_run_at: string | null;
  last_run_summary: Record<string, number> | null;
}

interface Milestone {
  id: string;
  months: number;
  label: string;
  perk_type: PerkType;
  free_months: number | null;
  percent: number | null;
  duration_months: number | null;
  credits: number | null;
  perk_description: string | null;
  enabled: boolean;
  apply_to_existing: boolean;
}

interface TenureRow {
  tenant_id: string;
  slug: string;
  company_name: string | null;
  tenant_type: string | null;
  started_at: string | null;
  tenure_months: number | null;
  tenure_days: number | null;
  subscription_status: string | null;
}

interface Grant {
  id: string;
  milestone_id: string | null;
  tenant_id: string;
  months: number;
  label: string;
  perk_type: PerkType;
  free_months: number | null;
  percent: number | null;
  duration_months: number | null;
  credits: number | null;
  perk_description: string | null;
  status: GrantStatus;
  detail: string | null;
  granted_at: string | null;
  created_at: string;
}

interface PlanItem {
  tenant: string;
  slug: string;
  milestone: string;
  months: number;
  action: 'grant' | 'skip' | 'wait' | 'retry';
  reason?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const PERK_LABEL: Record<PerkType, string> = {
  free_period: 'Free subscription months',
  percent_discount: 'Subscription discount',
  credits: 'Platform credits',
  manual: 'Manual perk (we deliver it)',
};

function perkText(p: Pick<Milestone, 'perk_type' | 'free_months' | 'percent' | 'duration_months' | 'credits' | 'perk_description'>) {
  switch (p.perk_type) {
    case 'free_period':
      return p.free_months === 1 ? '1 free month' : `${p.free_months} free months`;
    case 'percent_discount':
      return p.duration_months ? `${p.percent}% off for ${p.duration_months} mo` : `${p.percent}% off, permanent`;
    case 'credits':
      return `${p.credits} credits`;
    default:
      return p.perk_description ?? 'Manual perk';
  }
}

function formatTenure(months: number | null, days: number | null) {
  if (months == null) return '—';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0 && m === 0) return `${days ?? 0} day${days === 1 ? '' : 's'}`;
  return [y ? `${y}y` : null, m ? `${m}m` : null].filter(Boolean).join(' ');
}

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

function addMonths(iso: string, months: number) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

async function invokeRun(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('tenure-rewards-run', { body });
  if (error) throw new Error(await readEdgeFunctionError(error, 'Request failed'));
  return data;
}

const STATUS_STYLE: Record<GrantStatus, { label: string; cls: string }> = {
  processing: { label: 'Processing', cls: 'text-muted-foreground' },
  applied: { label: 'Applied', cls: 'text-green-700 dark:text-green-400' },
  fulfilled: { label: 'Fulfilled', cls: 'text-green-700 dark:text-green-400' },
  pending: { label: 'Waiting for subscription', cls: 'text-amber-700 dark:text-amber-400' },
  manual_todo: { label: 'To fulfil', cls: 'text-amber-700 dark:text-amber-400' },
  failed: { label: 'Failed', cls: 'text-red-700 dark:text-red-400' },
  skipped: { label: 'Skipped', cls: 'text-muted-foreground' },
};

export function TenureRewardsTab({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tenants, setTenants] = useState<TenureRow[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);

  const [editing, setEditing] = useState<Milestone | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  const [granting, setGranting] = useState<TenureRow | null>(null);
  const [plan, setPlan] = useState<{ plan: PlanItem[]; summary: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m, t, g] = await Promise.all([
        db.from('tenure_reward_settings').select('*').eq('id', 1).single(),
        db.from('tenure_milestones').select('*').order('months'),
        db.rpc('tenure_reward_tenants'),
        db.from('tenure_reward_grants').select('*').order('created_at', { ascending: false }).limit(500),
      ]);
      for (const res of [s, m, t, g]) if (res.error) throw res.error;
      setSettings(s.data as Settings);
      setMilestones((m.data as Milestone[]) ?? []);
      setTenants((t.data as TenureRow[]) ?? []);
      setGrants((g.data as Grant[]) ?? []);
    } catch (e) {
      toast.error('Could not load tenure rewards', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tenantName = useCallback(
    (id: string) => {
      const t = tenants.find((x) => x.tenant_id === id);
      return t ? t.company_name || t.slug : id.slice(0, 8);
    },
    [tenants],
  );

  const grantsByTenant = useMemo(() => {
    const map = new Map<string, Grant[]>();
    for (const g of grants) map.set(g.tenant_id, [...(map.get(g.tenant_id) ?? []), g]);
    return map;
  }, [grants]);

  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const prev = settings;
    setSettings({ ...settings, ...patch });
    const { error } = await db
      .from('tenure_reward_settings')
      .update({ ...patch, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
      .eq('id', 1);
    if (error) {
      setSettings(prev);
      toast.error('Could not save', { description: error.message });
      return;
    }
    toast.success('Saved');
    // How tenure is counted changes every number on the page.
    if ('tenure_start' in patch) void load();
  };

  const preview = async () => {
    setBusy('preview');
    try {
      const data = await invokeRun({ action: 'preview' });
      setPlan({ plan: data.plan ?? [], summary: data.summary ?? {} });
    } catch (e) {
      toast.error('Preview failed', { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy('run');
    try {
      const data = await invokeRun({ action: 'run' });
      if (data.skipped) toast.message(data.skipped);
      else {
        const s = data.summary ?? {};
        toast.success('Run complete', {
          description: `${s.applied ?? 0} applied · ${s.manual ?? 0} to fulfil · ${s.pending ?? 0} waiting · ${s.failed ?? 0} failed · ${s.skipped ?? 0} skipped`,
        });
      }
      setPlan(null);
      await load();
    } catch (e) {
      toast.error('Run failed', { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const toggleMilestone = async (m: Milestone) => {
    setBusy(m.id);
    const { error } = await db.from('tenure_milestones').update({ enabled: !m.enabled }).eq('id', m.id);
    setBusy(null);
    if (error) return toast.error('Could not update', { description: error.message });
    setMilestones((list) => list.map((x) => (x.id === m.id ? { ...x, enabled: !m.enabled } : x)));
  };

  const deleteMilestone = async () => {
    if (!deleting) return;
    setBusy(deleting.id);
    const { error } = await db.from('tenure_milestones').delete().eq('id', deleting.id);
    setBusy(null);
    if (error) return toast.error('Could not delete', { description: error.message });
    setMilestones((list) => list.filter((x) => x.id !== deleting.id));
    setDeleting(null);
    toast.success('Milestone deleted');
  };

  const retry = async (g: Grant) => {
    setBusy(g.id);
    try {
      const data = await invokeRun({ action: 'retry', grantId: g.id });
      if (data.outcome?.status === 'failed') toast.error('Still failing', { description: data.outcome.detail });
      else toast.success(data.outcome?.status === 'pending' ? 'Still waiting for a subscription' : 'Applied');
      await load();
    } catch (e) {
      toast.error('Retry failed', { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const markFulfilled = async (g: Grant) => {
    setBusy(g.id);
    const { error } = await db
      .from('tenure_reward_grants')
      .update({ status: 'fulfilled', detail: `Fulfilled by hand`, granted_by: user?.id ?? null })
      .eq('id', g.id);
    setBusy(null);
    if (error) return toast.error('Could not update', { description: error.message });
    setGrants((list) => list.map((x) => (x.id === g.id ? { ...x, status: 'fulfilled', detail: 'Fulfilled by hand' } : x)));
    toast.success('Marked fulfilled');
  };

  if (loading && !settings) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!settings) return null;

  const toFulfil = grants.filter((g) => g.status === 'manual_todo').length;
  const needsAttention = grants.filter((g) => g.status === 'failed' || g.status === 'pending').length;
  const enabledMilestones = milestones.filter((m) => m.enabled);

  // The read-only record is the right-hand column (log-rail.tsx).
  const rail = (
    <LogRailCard title="History">
      {grants.length === 0 ? (
        <EmptyState
          size="section"
          headline="No rewards given yet"
          body="Each reward an operator earns for staying is recorded here."
        />
      ) : (
        <LogList>
          {grants.map((g) => (
            <LogEntry
              key={g.id}
              who={tenantName(g.tenant_id)}
              status={<span className={cn('text-xs font-medium', STATUS_STYLE[g.status].cls)}>{STATUS_STYLE[g.status].label}</span>}
              what={
                <>
                  {g.label}
                  <span className="text-muted-foreground"> · {perkText(g)}</span>
                </>
              }
              when={<span className="whitespace-nowrap">{formatDate(g.granted_at ?? g.created_at)}</span>}
              detail={g.detail || null}
              action={
                g.status === 'pending' || g.status === 'failed' ? (
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={!canEdit || busy === g.id} onClick={() => void retry(g)}>
                    {busy === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    Retry
                  </Button>
                ) : g.status === 'manual_todo' ? (
                  <Button size="sm" className="gap-1.5" disabled={!canEdit || busy === g.id} onClick={() => void markFulfilled(g)}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark fulfilled
                  </Button>
                ) : null
              }
            />
          ))}
        </LogList>
      )}
    </LogRailCard>
  );

  return (
    <LogRailLayout label="Reward history" rail={rail}>
    <div className="space-y-6">
      {/* ── header + settings ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" />
                Tenure Rewards
              </CardTitle>
              <CardDescription>
                Loyalty perks for v2 operators who stay with Drive247. Checked automatically every day at 06:15 UTC;
                each milestone is given to an operator once.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void preview()} disabled={!!busy}>
                {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Preview next run
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Programme on</div>
                <div className="text-xs text-muted-foreground">Off: the daily check grants nothing.</div>
              </div>
              <Switch checked={settings.enabled} disabled={!canEdit} onCheckedChange={(v) => void saveSettings({ enabled: v })} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Only operators with a live subscription</div>
                <div className="text-xs text-muted-foreground">Others are re-checked once they subscribe.</div>
              </div>
              <Switch
                checked={settings.require_active_subscription}
                disabled={!canEdit}
                onCheckedChange={(v) => void saveSettings({ require_active_subscription: v })}
              />
            </label>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Count tenure from</div>
                <div className="text-xs text-muted-foreground">Changes every operator’s tenure below.</div>
              </div>
              <Select
                value={settings.tenure_start}
                disabled={!canEdit}
                onValueChange={(v) => void saveSettings({ tenure_start: v as Settings['tenure_start'] })}
              >
                <SelectTrigger className="h-9 w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="account_created">Account created</SelectItem>
                  <SelectItem value="first_subscription">First subscription</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Notify operators</div>
                <div className="text-xs text-muted-foreground">A note in their portal bell when a perk is given.</div>
              </div>
              <Switch
                checked={settings.notify_tenants}
                disabled={!canEdit}
                onCheckedChange={(v) => void saveSettings({ notify_tenants: v })}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              Last run: {settings.last_run_at ? new Date(settings.last_run_at).toLocaleString() : 'never'}
              {settings.last_run_summary &&
                ` · ${settings.last_run_summary.applied ?? 0} applied, ${settings.last_run_summary.manual ?? 0} to fulfil, ${settings.last_run_summary.failed ?? 0} failed`}
            </span>
            <span className="flex gap-3">
              {toFulfil > 0 && <span className="text-amber-700 dark:text-amber-400">{toFulfil} perk(s) to fulfil</span>}
              {needsAttention > 0 && (
                <span className="text-amber-700 dark:text-amber-400">{needsAttention} waiting / failed</span>
              )}
            </span>
          </div>
          {!canEdit && <p className="text-sm text-muted-foreground">Read-only: changes need a super admin account.</p>}
        </CardContent>
      </Card>

      {/* ── milestones ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base">Milestones</CardTitle>
              <CardDescription>
                Operators who had already passed a milestone when it was switched on are skipped unless “Include
                operators already past it” is on — you can still grant those by hand.
              </CardDescription>
            </div>
            <Button size="sm" className="gap-1.5" disabled={!canEdit} onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" />
              Add milestone
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {milestones.length === 0 ? (
            <EmptyState
              size="section"
              illustration={<MilestonesEmptyArt />}
              headline="No milestones yet"
              body="Set how long an operator has to stay to earn each reward, and they are listed here."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenure</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Perk</TableHead>
                    <TableHead>Already past it</TableHead>
                    <TableHead className="text-right">Given</TableHead>
                    <TableHead>On</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {milestones.map((m) => {
                    const given = grants.filter((g) => g.milestone_id === m.id && g.status !== 'skipped').length;
                    return (
                      <TableRow key={m.id} className={cn(!m.enabled && 'opacity-60')}>
                        <TableCell className="font-medium tabular-nums">
                          {m.months % 12 === 0 ? `${m.months / 12} yr` : `${m.months} mo`}
                        </TableCell>
                        <TableCell>{m.label}</TableCell>
                        <TableCell>
                          <div className="font-medium">{perkText(m)}</div>
                          <div className="text-xs text-muted-foreground">{PERK_LABEL[m.perk_type]}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{m.apply_to_existing ? 'Included' : 'Skipped'}</TableCell>
                        <TableCell className="text-right tabular-nums">{given}</TableCell>
                        <TableCell>
                          <Switch
                            checked={m.enabled}
                            disabled={!canEdit || busy === m.id}
                            onCheckedChange={() => void toggleMilestone(m)}
                            aria-label="Milestone on"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" className="gap-1.5" disabled={!canEdit} onClick={() => setEditing(m)}>
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              aria-label="Delete milestone"
                              disabled={!canEdit}
                              onClick={() => setDeleting(m)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── operators ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">V2 operators</CardTitle>
          <CardDescription>
            {tenants.length} operators · tenure counted from{' '}
            {settings.tenure_start === 'account_created' ? 'account creation' : 'their first subscription'}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operator</TableHead>
                  <TableHead>With us since</TableHead>
                  <TableHead className="text-right">Tenure</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Next milestone</TableHead>
                  <TableHead>Rewards</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((t) => {
                  const mine = grantsByTenant.get(t.tenant_id) ?? [];
                  const next = t.started_at
                    ? enabledMilestones.find((m) => t.tenure_months != null && m.months > t.tenure_months)
                    : undefined;
                  const nextDate = next && t.started_at ? addMonths(t.started_at, next.months) : null;
                  const daysToNext = nextDate ? Math.ceil((nextDate.getTime() - Date.now()) / 86_400_000) : null;
                  return (
                    <TableRow key={t.tenant_id}>
                      <TableCell>
                        <div className="font-medium">{t.company_name || t.slug}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.slug}
                          {t.tenant_type === 'test' && ' · test'}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(t.started_at)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {t.started_at ? formatTenure(t.tenure_months, t.tenure_days) : <span className="text-muted-foreground">Not started</span>}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'capitalize',
                          t.subscription_status ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground',
                        )}
                      >
                        {t.subscription_status?.replace('_', ' ') ?? 'None'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {next && nextDate ? (
                          <>
                            <div>{next.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatDate(nextDate.toISOString())} · in {daysToNext} day{daysToNext === 1 ? '' : 's'}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {mine.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            mine.map((g) => (
                              <Badge
                                key={g.id}
                                variant={g.status === 'skipped' ? 'outline' : 'secondary'}
                                title={`${g.label}: ${STATUS_STYLE[g.status].label}`}
                                className={cn(g.status === 'skipped' && 'text-muted-foreground line-through')}
                              >
                                {g.months} mo
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          disabled={!canEdit || milestones.length === 0}
                          onClick={() => setGranting(t)}
                        >
                          <Gift className="h-3.5 w-3.5" />
                          Grant
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {editing && (
        <MilestoneDialog
          milestone={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete milestone?</DialogTitle>
            <DialogDescription>
              “{deleting?.label}” won’t be given to anyone else. Rewards already given stay in the history, and discounts
              already on subscriptions are not removed. To pause it instead, switch it off.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void deleteMilestone()} disabled={!!busy}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {granting && (
        <GrantDialog
          tenant={granting}
          milestones={milestones}
          grants={grantsByTenant.get(granting.tenant_id) ?? []}
          onClose={() => setGranting(null)}
          onDone={() => {
            setGranting(null);
            void load();
          }}
        />
      )}

      <Dialog open={plan !== null} onOpenChange={(open) => !open && busy !== 'run' && setPlan(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Next run preview</DialogTitle>
            <DialogDescription>
              What the daily check would do right now. Nothing has been changed.
              {!settings.enabled && ' The programme is off, so the real run will do nothing until you switch it on.'}
            </DialogDescription>
          </DialogHeader>
          {plan && plan.plan.length === 0 ? (
            <EmptyState
              size="section"
              headline="Nothing to give out"
              body="No operator has reached a new milestone since the last run."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operator</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead>Would</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan?.plan.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{p.tenant}</TableCell>
                    <TableCell>{p.milestone}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'font-medium',
                          (p.action === 'grant' || p.action === 'retry') && 'text-green-700 dark:text-green-400',
                          p.action === 'wait' && 'text-amber-700 dark:text-amber-400',
                          p.action === 'skip' && 'text-muted-foreground',
                        )}
                      >
                        {p.action === 'grant' ? 'Give it' : p.action === 'retry' ? 'Apply (retry)' : p.action === 'wait' ? 'Wait' : 'Skip'}
                      </span>
                      {p.reason && <div className="text-xs text-muted-foreground">{p.reason}</div>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlan(null)} disabled={busy === 'run'}>
              Close
            </Button>
            <Button
              onClick={() => void runNow()}
              disabled={!canEdit || !settings.enabled || busy === 'run' || !plan || plan.plan.length === 0}
              className="gap-1.5"
            >
              {busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </LogRailLayout>
  );
}

// ── milestone editor ────────────────────────────────────────────────────────

function MilestoneDialog({
  milestone,
  onClose,
  onSaved,
}: {
  milestone: Milestone | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [months, setMonths] = useState(String(milestone?.months ?? 6));
  const [label, setLabel] = useState(milestone?.label ?? '');
  const [perkType, setPerkType] = useState<PerkType>(milestone?.perk_type ?? 'free_period');
  const [freeMonths, setFreeMonths] = useState(String(milestone?.free_months ?? 1));
  const [percent, setPercent] = useState(String(milestone?.percent ?? 10));
  const [permanent, setPermanent] = useState(milestone ? milestone.duration_months == null : true);
  const [duration, setDuration] = useState(String(milestone?.duration_months ?? 12));
  const [credits, setCredits] = useState(String(milestone?.credits ?? 500));
  const [description, setDescription] = useState(milestone?.perk_description ?? '');
  const [applyExisting, setApplyExisting] = useState(milestone?.apply_to_existing ?? false);
  const [saving, setSaving] = useState(false);

  const int = (v: string, min: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const m = int(months, 1, 600);
  const fields = {
    free_months: perkType === 'free_period' ? int(freeMonths, 1, 36) : null,
    percent: perkType === 'percent_discount' ? int(percent, 1, 100) : null,
    duration_months: perkType === 'percent_discount' && !permanent ? int(duration, 1, 120) : null,
    credits: perkType === 'credits' ? int(credits, 1, 1_000_000) : null,
    perk_description: description.trim() || null,
  };
  const perkInvalid =
    (perkType === 'free_period' && fields.free_months === null) ||
    (perkType === 'percent_discount' && (fields.percent === null || (!permanent && fields.duration_months === null))) ||
    (perkType === 'credits' && fields.credits === null) ||
    (perkType === 'manual' && !fields.perk_description);
  const invalid = m === null || perkInvalid;

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    const payload = {
      months: m,
      label: label.trim() || (m! % 12 === 0 ? `${m! / 12} year${m === 12 ? '' : 's'} with Drive247` : `${m} months with Drive247`),
      perk_type: perkType,
      ...fields,
      apply_to_existing: applyExisting,
    };
    const { error } = milestone
      ? await db.from('tenure_milestones').update(payload).eq('id', milestone.id)
      : await db.from('tenure_milestones').insert(payload);
    setSaving(false);
    if (error) {
      toast.error('Could not save the milestone', {
        description: error.code === '23505' ? `There is already a ${m}-month milestone.` : error.message,
      });
      return;
    }
    toast.success(milestone ? 'Milestone updated' : 'Milestone added');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{milestone ? 'Edit milestone' : 'Add milestone'}</DialogTitle>
          <DialogDescription>
            Changes apply to operators who reach it from now on. Rewards already given are not changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="tm-months">After (months)</Label>
              <Input id="tm-months" type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} />
              {m === null && <p className="text-xs text-destructive">1–600</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-label">Name</Label>
              <Input
                id="tm-label"
                maxLength={120}
                value={label}
                placeholder={m ? (m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'} with Drive247` : `${m} months with Drive247`) : ''}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Perk</Label>
            <Select value={perkType} onValueChange={(v) => setPerkType(v as PerkType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PERK_LABEL) as PerkType[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {PERK_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {perkType === 'free_period' && (
            <div className="space-y-1.5">
              <Label htmlFor="tm-free">Free months</Label>
              <Input id="tm-free" type="number" min={1} max={36} value={freeMonths} onChange={(e) => setFreeMonths(e.target.value)} />
              <p className="text-xs text-muted-foreground">100% off their subscription for this many months.</p>
            </div>
          )}

          {perkType === 'percent_discount' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="tm-pct">Percent off</Label>
                <Input id="tm-pct" type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} />
              </div>
              <label className="flex items-center gap-3">
                <Switch checked={permanent} onCheckedChange={setPermanent} />
                <span className="text-sm">Permanent (for as long as they stay subscribed)</span>
              </label>
              {!permanent && (
                <div className="space-y-1.5">
                  <Label htmlFor="tm-dur">For how many months</Label>
                  <Input id="tm-dur" type="number" min={1} max={120} value={duration} onChange={(e) => setDuration(e.target.value)} />
                </div>
              )}
              <p className="text-xs text-muted-foreground">A later tenure discount replaces this one instead of adding to it.</p>
            </div>
          )}

          {perkType === 'credits' && (
            <div className="space-y-1.5">
              <Label htmlFor="tm-credits">Credits</Label>
              <Input id="tm-credits" type="number" min={1} value={credits} onChange={(e) => setCredits(e.target.value)} />
              <p className="text-xs text-muted-foreground">Added to their platform credit wallet (e-signatures, OCR…).</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="tm-desc">{perkType === 'manual' ? 'What we give them *' : 'Note (optional)'}</Label>
            <Input
              id="tm-desc"
              maxLength={500}
              value={description}
              placeholder={perkType === 'manual' ? 'Priority support for 3 months' : ''}
              onChange={(e) => setDescription(e.target.value)}
            />
            {perkType === 'manual' && (
              <p className="text-xs text-muted-foreground">Shows in History as “To fulfil” until someone marks it done.</p>
            )}
          </div>

          <label className="flex items-start gap-3 rounded-lg border p-3">
            <Switch checked={applyExisting} onCheckedChange={setApplyExisting} />
            <span className="text-sm">
              Include operators already past it
              <span className="block text-xs text-muted-foreground">
                Off: only operators who reach it after it’s switched on. On: everyone past it gets it on the next run.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={invalid || saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {milestone ? 'Save' : 'Add milestone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── manual grant ────────────────────────────────────────────────────────────

function GrantDialog({
  tenant,
  milestones,
  grants,
  onClose,
  onDone,
}: {
  tenant: TenureRow;
  milestones: Milestone[];
  grants: Grant[];
  onClose: () => void;
  onDone: () => void;
}) {
  // Only milestones never given to this tenant (a skipped one can be given).
  const options = milestones.filter((m) => {
    const g = grants.find((x) => x.milestone_id === m.id);
    return !g || g.status === 'skipped';
  });
  const [milestoneId, setMilestoneId] = useState(options[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const grant = async () => {
    setBusy(true);
    try {
      const data = await invokeRun({ action: 'grant', tenantId: tenant.tenant_id, milestoneId });
      const o = data.outcome ?? {};
      if (o.status === 'failed') toast.error('Recorded, but applying it failed', { description: o.detail });
      else if (o.status === 'pending') toast.warning('Recorded — waiting for an active subscription', { description: o.detail });
      else toast.success(o.status === 'manual_todo' ? 'Granted — now in History to fulfil' : 'Granted');
      onDone();
    } catch (e) {
      toast.error('Could not grant', { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant a milestone to {tenant.company_name || tenant.slug}</DialogTitle>
          <DialogDescription>
            Tenure {formatTenure(tenant.tenure_months, tenant.tenure_days)}. Gives the perk now, whatever their tenure
            or subscription — use it for skipped milestones or a goodwill gesture.
          </DialogDescription>
        </DialogHeader>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every milestone has already been given to this operator.</p>
        ) : (
          <div className="space-y-1.5">
            <Label>Milestone</Label>
            <Select value={milestoneId} onValueChange={setMilestoneId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label} — {perkText(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void grant()} disabled={busy || !milestoneId || options.length === 0} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Grant now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
