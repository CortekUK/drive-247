'use client';

/**
 * NPS Program — "How likely are you to recommend Drive247?" (0–10), asked of
 * rental operators as a popup inside their portal (v1 and v2).
 *
 *   Settings   on/off; the schedule (days after the tenant started — 14, 30,
 *              90 …); which staff roles are asked; which tenants (every tenant
 *              minus exclusions, or only the selected ones).
 *   Scores     NPS, response rate, the promoter / passive / detractor split,
 *              the 0–10 distribution, every tenant's numbers and every answer.
 *              Live over realtime.
 *
 * The portal asks through get_my_nps_prompt() / submit_nps_response(), which
 * apply the schedule for each user: one ask per scheduled day, only the latest
 * due day, at least a week apart. "Not now" counts as that day's answer.
 * "Started" is the tenant's first subscription, else account creation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gauge, Loader2, MessageSquareText, Plus, RefreshCw, Save, Search, Users, X } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Audience = 'all' | 'selected';

interface Settings {
  enabled: boolean;
  schedule_days: number[];
  roles: string[];
  audience: Audience;
  target_tenant_ids: string[];
  excluded_tenant_ids: string[];
}

interface ResponseRow {
  id: string;
  tenant_id: string;
  schedule_day: number;
  status: 'answered' | 'dismissed';
  score: number | null;
  comment: string | null;
  portal: 'v1' | 'v2' | null;
  tenant_age_days: number | null;
  created_at: string;
  app_users: { name: string | null; email: string | null; role: string | null } | null;
}

interface TenantLite {
  id: string;
  company_name: string | null;
  slug: string;
  portal_experience: string | null;
  status: string | null;
  tenant_type: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const ROLES: { id: string; label: string }[] = [
  { id: 'head_admin', label: 'Head admin' },
  { id: 'admin', label: 'Admin' },
  { id: 'manager', label: 'Manager' },
  { id: 'ops', label: 'Ops' },
  { id: 'viewer', label: 'Viewer' },
];

const RANGES: { id: string; label: string; days: number | null }[] = [
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '365', label: 'Last 12 months', days: 365 },
  { id: 'all', label: 'All time', days: null },
];

const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  schedule_days: [14, 30, 90],
  roles: ['head_admin', 'admin'],
  audience: 'all',
  target_tenant_ids: [],
  excluded_tenant_ids: [],
};

type Group = 'promoter' | 'passive' | 'detractor';
const groupOf = (score: number): Group => (score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor');

/** Text colours for the three groups — always beside the group's name, never alone. */
const GROUP_TEXT: Record<Group, string> = {
  promoter: 'text-green-700 dark:text-green-400',
  passive: 'text-amber-700 dark:text-amber-400',
  detractor: 'text-red-700 dark:text-red-400',
};
const GROUP_FILL: Record<Group, string> = {
  promoter: 'bg-green-600 dark:bg-green-500',
  passive: 'bg-amber-500 dark:bg-amber-400',
  detractor: 'bg-red-600 dark:bg-red-500',
};
const GROUP_LABEL: Record<Group, string> = { promoter: 'Promoters', passive: 'Passives', detractor: 'Detractors' };

interface Summary {
  answered: number;
  dismissed: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number | null;
  avg: number | null;
  last: string | null;
}

function summarise(rows: ResponseRow[]): Summary {
  const answered = rows.filter((r) => r.status === 'answered' && r.score !== null);
  const promoters = answered.filter((r) => groupOf(r.score!) === 'promoter').length;
  const passives = answered.filter((r) => groupOf(r.score!) === 'passive').length;
  const detractors = answered.length - promoters - passives;
  return {
    answered: answered.length,
    dismissed: rows.length - answered.length,
    promoters,
    passives,
    detractors,
    nps: answered.length ? Math.round(((promoters - detractors) / answered.length) * 100) : null,
    avg: answered.length ? answered.reduce((s, r) => s + r.score!, 0) / answered.length : null,
    last: rows.reduce<string | null>((m, r) => (!m || r.created_at > m ? r.created_at : m), null),
  };
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const isV2 = (t: TenantLite) => t.portal_experience === 'v2' || t.slug === 'northwind';

export function NpsProgramTab({ canEdit }: { canEdit: boolean }) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [live, setLive] = useState(false);

  const [range, setRange] = useState('90');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [answerFilter, setAnswerFilter] = useState<'answered' | 'dismissed' | 'all'>('answered');
  const [newDay, setNewDay] = useState('');
  const [tenantSearch, setTenantSearch] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [s, r, t] = await Promise.all([
        db.from('nps_settings').select('*').eq('id', 1).maybeSingle(),
        db
          .from('nps_responses')
          .select('id, tenant_id, schedule_day, status, score, comment, portal, tenant_age_days, created_at, app_users(name, email, role)')
          .order('created_at', { ascending: false })
          .limit(5000),
        db.from('tenants').select('id, company_name, slug, portal_experience, status, tenant_type').order('company_name'),
      ]);
      for (const res of [s, r, t]) if (res.error) throw res.error;
      const loaded: Settings = s.data
        ? {
            enabled: !!s.data.enabled,
            schedule_days: [...(s.data.schedule_days ?? [])].sort((a: number, b: number) => a - b),
            roles: s.data.roles ?? [],
            audience: s.data.audience === 'selected' ? 'selected' : 'all',
            target_tenant_ids: s.data.target_tenant_ids ?? [],
            excluded_tenant_ids: s.data.excluded_tenant_ids ?? [],
          }
        : DEFAULT_SETTINGS;
      if (!quiet) {
        setSettings(loaded);
        setDraft(loaded);
      }
      setResponses((r.data as ResponseRow[]) ?? []);
      setTenants((t.data as TenantLite[]) ?? []);
    } catch (e) {
      if (!quiet) toast.error('Could not load the NPS program', { description: (e as Error).message });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('nps-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'nps_responses' }, () => void load(true))
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const tenantName = useMemo(() => {
    const m = new Map(tenants.map((t) => [t.id, t.company_name || t.slug]));
    return (id: string) => m.get(id) ?? 'Unknown tenant';
  }, [tenants]);

  const liveTenants = useMemo(() => tenants.filter((t) => t.status === 'active' && t.tenant_type !== 'test'), [tenants]);

  /* ── settings ─────────────────────────────────────────────────────────── */

  const dirty = JSON.stringify(settings) !== JSON.stringify(draft);
  const picked = draft ? (draft.audience === 'selected' ? draft.target_tenant_ids : draft.excluded_tenant_ids) : [];
  const reach = draft
    ? liveTenants.filter((t) =>
        draft.audience === 'selected' ? draft.target_tenant_ids.includes(t.id) : !draft.excluded_tenant_ids.includes(t.id),
      ).length
    : 0;

  function addDay() {
    if (!draft) return;
    const n = Number(newDay);
    if (!Number.isInteger(n) || n < 1 || n > 3650) return void toast.error('Enter a whole number of days between 1 and 3650');
    if (draft.schedule_days.includes(n)) return void toast.error(`Day ${n} is already in the schedule`);
    if (draft.schedule_days.length >= 12) return void toast.error('Up to 12 days in the schedule');
    setDraft({ ...draft, schedule_days: [...draft.schedule_days, n].sort((a, b) => a - b) });
    setNewDay('');
  }

  function togglePicked(id: string) {
    if (!draft) return;
    const list = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setDraft(
      draft.audience === 'selected'
        ? { ...draft, target_tenant_ids: list }
        : { ...draft, excluded_tenant_ids: list },
    );
  }

  async function save() {
    if (!draft) return;
    if (draft.schedule_days.length === 0) return void toast.error('Add at least one day to the schedule');
    if (draft.roles.length === 0) return void toast.error('Choose at least one role to ask');
    if (draft.audience === 'selected' && draft.target_tenant_ids.length === 0) {
      return void toast.error('Pick at least one tenant, or choose All tenants');
    }
    setSaving(true);
    try {
      const { error } = await db.from('nps_settings').upsert({ id: 1, ...draft, updated_at: new Date().toISOString() });
      if (error) throw error;
      setSettings(draft);
      toast.success(draft.enabled ? 'Saved — the NPS survey is live' : 'Saved');
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  /* ── scores ───────────────────────────────────────────────────────────── */

  const scoped = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)?.days ?? null;
    const since = days ? Date.now() - days * 86_400_000 : 0;
    return responses.filter(
      (r) => (tenantFilter === 'all' || r.tenant_id === tenantFilter) && Date.parse(r.created_at) >= since,
    );
  }, [responses, range, tenantFilter]);

  const summary = useMemo(() => summarise(scoped), [scoped]);

  const distribution = useMemo(() => {
    const counts = Array.from({ length: 11 }, () => 0);
    for (const r of scoped) if (r.status === 'answered' && r.score !== null) counts[r.score]++;
    return counts;
  }, [scoped]);
  const maxCount = Math.max(1, ...distribution);

  const perTenant = useMemo(() => {
    const by = new Map<string, ResponseRow[]>();
    for (const r of scoped) by.set(r.tenant_id, [...(by.get(r.tenant_id) ?? []), r]);
    return [...by.entries()]
      .map(([id, rows]) => ({ id, name: tenantName(id), ...summarise(rows) }))
      .sort((a, b) => b.answered - a.answered || a.name.localeCompare(b.name));
  }, [scoped, tenantName]);

  const listed = useMemo(
    () => scoped.filter((r) => answerFilter === 'all' || r.status === answerFilter).slice(0, 500),
    [scoped, answerFilter],
  );

  if (loading && !draft) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const tenantList = liveTenants.filter((t) =>
    (t.company_name || t.slug).toLowerCase().includes(tenantSearch.trim().toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* ── settings ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Gauge className="h-5 w-5 text-primary" />
                NPS Program
              </CardTitle>
              <CardDescription>
                Operators are asked <span className="font-medium text-foreground">“How likely are you to recommend Drive247?”</span>{' '}
                (0–10) in a popup inside their portal — v1 and v2 — on the days you set below, counted from when the tenant
                started (their first subscription, or account creation). Each person is asked once per day in the schedule,
                only the latest one that is due, and never twice in a week. &ldquo;Not now&rdquo; skips to the next day.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        {draft && (
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Show the NPS survey</Label>
                  <p className="text-xs text-muted-foreground">Off: nobody is asked. Scores already given stay here.</p>
                </div>
                <Switch checked={draft.enabled} disabled={!canEdit} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
              </div>

              <div className="space-y-2 rounded-lg border p-4">
                <Label className="text-sm font-medium">Who is asked</Label>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {ROLES.map((r) => (
                    <label key={r.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={draft.roles.includes(r.id)}
                        onChange={() =>
                          setDraft({
                            ...draft,
                            roles: draft.roles.includes(r.id) ? draft.roles.filter((x) => x !== r.id) : [...draft.roles, r.id],
                          })
                        }
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2 rounded-lg border p-4 md:col-span-2">
                <Label className="text-sm font-medium">Schedule — days after the tenant started</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {draft.schedule_days.map((d) => (
                    <Badge key={d} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 text-sm font-medium">
                      Day {d}
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Remove day ${d}`}
                          onClick={() => setDraft({ ...draft, schedule_days: draft.schedule_days.filter((x) => x !== d) })}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </Badge>
                  ))}
                  {draft.schedule_days.length === 0 && <span className="text-sm text-muted-foreground">No days yet.</span>}
                  {canEdit && (
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        addDay();
                      }}
                    >
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        value={newDay}
                        onChange={(e) => setNewDay(e.target.value)}
                        placeholder="e.g. 45"
                        className="h-8 w-24"
                        aria-label="Add a day to the schedule"
                      />
                      <Button type="submit" variant="outline" size="sm" className="h-8 gap-1">
                        <Plus className="h-3.5 w-3.5" />
                        Add day
                      </Button>
                    </form>
                  )}
                </div>
              </div>

              <div className="space-y-2 rounded-lg border p-4 md:col-span-2">
                <Label className="text-sm font-medium">Tenants</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(['all', 'selected'] as Audience[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setDraft({ ...draft, audience: a, target_tenant_ids: [], excluded_tenant_ids: [] })}
                      className={cn(
                        'rounded-lg border p-3 text-left text-sm transition-colors',
                        draft.audience === a ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
                      )}
                    >
                      <span className="block font-medium">{a === 'all' ? 'All tenants' : 'Only selected tenants'}</span>
                      <span className="block text-xs text-muted-foreground">
                        {a === 'all' ? 'Tick any to exclude — they are never asked' : 'Tick the ones to ask'}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="rounded-lg border">
                  <div className="flex items-center gap-2 border-b p-2">
                    <Search className="ml-1 h-4 w-4 text-muted-foreground" />
                    <input
                      value={tenantSearch}
                      onChange={(e) => setTenantSearch(e.target.value)}
                      placeholder={draft.audience === 'all' ? 'Search tenants to exclude' : 'Search tenants to ask'}
                      className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <span className="whitespace-nowrap pr-1 text-xs text-muted-foreground">
                      {picked.length} {draft.audience === 'all' ? 'excluded' : 'selected'} · {reach} will be asked
                    </span>
                  </div>
                  <div className="max-h-56 overflow-y-auto p-1">
                    {tenantList.length === 0 ? (
                      <p className="p-3 text-center text-sm text-muted-foreground">No tenants match.</p>
                    ) : (
                      tenantList.map((t) => {
                        const on = picked.includes(t.id);
                        return (
                          <label key={t.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                            <input type="checkbox" disabled={!canEdit} checked={on} onChange={() => togglePicked(t.id)} />
                            <span className={cn('flex-1 truncate', draft.audience === 'all' && on && 'text-muted-foreground line-through')}>
                              {t.company_name || t.slug}
                            </span>
                            <span className="text-xs uppercase text-muted-foreground">{isV2(t) ? 'v2' : 'v1'}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>

            {canEdit && (
              <div className="flex justify-end">
                <Button className="gap-1.5" onClick={() => void save()} disabled={!dirty || saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save settings
                </Button>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tenantFilter} onValueChange={setTenantFilter}>
          <SelectTrigger className="h-9 w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tenants</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.company_name || t.slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className={cn('ml-auto text-xs', live ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>
          {live ? '● Live' : 'Updates on refresh'}
        </span>
      </div>

      {/* ── headline numbers ─────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="NPS score"
          value={summary.nps === null ? '—' : `${summary.nps > 0 ? '+' : ''}${summary.nps}`}
          sub="% promoters − % detractors (−100 to +100)"
        />
        <Stat label="Responses" value={String(summary.answered)} sub={`${summary.dismissed} chose “Not now”`} />
        <Stat
          label="Response rate"
          value={summary.answered + summary.dismissed ? `${Math.round((summary.answered / (summary.answered + summary.dismissed)) * 100)}%` : '—'}
          sub="Of everyone who saw the popup"
        />
        <Stat label="Average score" value={summary.avg === null ? '—' : summary.avg.toFixed(1)} sub="Out of 10" />
      </div>

      {/* ── split and distribution ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Promoters, passives and detractors</CardTitle>
            <CardDescription>9–10 promote, 7–8 are passive, 0–6 detract.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {summary.answered === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No scores in this range yet.</p>
            ) : (
              <>
                <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Share of promoters, passives and detractors">
                  {(['promoter', 'passive', 'detractor'] as Group[]).map((g) => {
                    const n = g === 'promoter' ? summary.promoters : g === 'passive' ? summary.passives : summary.detractors;
                    if (n === 0) return null;
                    return (
                      <div
                        key={g}
                        className={cn('h-full first:rounded-l-full last:rounded-r-full', GROUP_FILL[g])}
                        style={{ width: `${(n / summary.answered) * 100}%` }}
                        title={`${GROUP_LABEL[g]}: ${n} (${Math.round((n / summary.answered) * 100)}%)`}
                      />
                    );
                  })}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['promoter', 'passive', 'detractor'] as Group[]).map((g) => {
                    const n = g === 'promoter' ? summary.promoters : g === 'passive' ? summary.passives : summary.detractors;
                    return (
                      <div key={g} className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className={cn('h-2 w-2 rounded-full', GROUP_FILL[g])} />
                          {GROUP_LABEL[g]}
                        </div>
                        <div className="text-lg font-semibold tabular-nums">{Math.round((n / summary.answered) * 100)}%</div>
                        <div className="text-xs text-muted-foreground tabular-nums">{n} {n === 1 ? 'person' : 'people'}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Scores given</CardTitle>
            <CardDescription>How many people chose each score.</CardDescription>
          </CardHeader>
          <CardContent>
            {summary.answered === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No scores in this range yet.</p>
            ) : (
              <div className="flex h-36 items-end gap-0.5" role="img" aria-label="Number of responses for each score from 0 to 10">
                {distribution.map((n, score) => (
                  <div key={score} className="group flex h-full flex-1 flex-col items-center justify-end gap-1" title={`Score ${score}: ${n} ${n === 1 ? 'response' : 'responses'}`}>
                    <span className="text-[10px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">{n}</span>
                    <div
                      className="w-full rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary"
                      style={{ height: `${n === 0 ? 0 : Math.max(4, (n / maxCount) * 100)}%` }}
                    />
                    <span className="text-xs tabular-nums text-muted-foreground">{score}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── per tenant ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            By tenant
          </CardTitle>
          <CardDescription>Click a tenant to see only their answers.</CardDescription>
        </CardHeader>
        <CardContent>
          {perTenant.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No responses in this range yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead className="text-right">NPS</TableHead>
                  <TableHead className="text-right">Average</TableHead>
                  <TableHead className="text-right">Responses</TableHead>
                  <TableHead className="text-right">Promoters</TableHead>
                  <TableHead className="text-right">Passives</TableHead>
                  <TableHead className="text-right">Detractors</TableHead>
                  <TableHead className="text-right">“Not now”</TableHead>
                  <TableHead>Last answer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perTenant.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => setTenantFilter(t.id)}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {t.nps === null ? '—' : `${t.nps > 0 ? '+' : ''}${t.nps}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.avg === null ? '—' : t.avg.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.answered}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.promoters}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.passives}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.detractors}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{t.dismissed}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(t.last)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── every answer ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquareText className="h-4 w-4" />
                Every response
              </CardTitle>
              <CardDescription>
                {tenantFilter === 'all' ? 'All tenants' : tenantName(tenantFilter)}
                {tenantFilter !== 'all' && (
                  <button type="button" className="ml-2 text-primary underline-offset-4 hover:underline" onClick={() => setTenantFilter('all')}>
                    Show all tenants
                  </button>
                )}
              </CardDescription>
            </div>
            <Select value={answerFilter} onValueChange={(v) => setAnswerFilter(v as 'answered' | 'dismissed' | 'all')}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="answered">Scores</SelectItem>
                <SelectItem value="dismissed">“Not now”</SelectItem>
                <SelectItem value="all">Everything</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {listed.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Asked on</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Comment</TableHead>
                  <TableHead>Portal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listed.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.created_at)}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{tenantName(r.tenant_id)}</TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="truncate">{r.app_users?.name || r.app_users?.email || 'Former user'}</div>
                      <div className="truncate text-xs text-muted-foreground">{r.app_users?.role?.replace('_', ' ') ?? ''}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      Day {r.schedule_day}
                      {r.tenant_age_days !== null && r.tenant_age_days !== r.schedule_day && (
                        <span className="text-xs text-muted-foreground"> (day {r.tenant_age_days})</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.status === 'answered' && r.score !== null ? (
                        <span className={cn('font-semibold tabular-nums', GROUP_TEXT[groupOf(r.score)])}>
                          {r.score} <span className="text-xs font-normal">{GROUP_LABEL[groupOf(r.score)].slice(0, -1)}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not now</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[320px] whitespace-pre-wrap text-sm">{r.comment || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs uppercase text-muted-foreground">{r.portal ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {scoped.filter((r) => answerFilter === 'all' || r.status === answerFilter).length > 500 && (
            <p className="pt-3 text-center text-xs text-muted-foreground">Showing the latest 500. Narrow the filters to see more.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
