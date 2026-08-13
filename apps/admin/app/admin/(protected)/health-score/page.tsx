'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Activity,
  AlertTriangle,
  Bell,
  Building2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  TrendingDown,
  Users,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
  matchesHealthQueueFilters,
  visibleHealthTrendSeries,
  type HealthStatus,
  type HealthStatusFilter,
  type HealthTrendFilter,
  type SubscriptionFilter,
  type TenantModeFilter,
} from '@/lib/health-score-filters';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { KPICard } from '@/components/ui/kpi-card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

interface Settings {
  id: string;
  enabled: boolean;
  period_days: number;
  threshold_percent: number;
  minimum_baseline_events: number;
  new_tenant_grace_days: number;
  repeat_alert_after_days: number;
  recovery_notifications_enabled: boolean;
  include_test_tenants: boolean;
  config_version: number;
  updated_at: string;
}

interface Recipient {
  id?: string;
  email: string;
  enabled?: boolean;
}

interface HealthRow {
  snapshot_id: string;
  tenant_id: string;
  company_name: string;
  slug: string;
  tenant_type: string | null;
  tenant_status: string;
  subscription_plan: string | null;
  evaluated_at: string;
  current_period_start: string;
  current_period_end: string;
  baseline_period_start: string;
  baseline_period_end: string;
  current_count: number;
  baseline_count: number;
  health_score: number | null;
  activity_change_percent: number | null;
  status: HealthStatus;
  confidence: 'high' | 'low' | 'insufficient' | 'data_issue';
  last_activity_at: string | null;
  last_login_at: string | null;
  subscription_status: string | null;
  subscription_cancel_at: string | null;
  settings_version: number;
  data_quality_details: Record<string, number | boolean>;
  incident_id: string | null;
  incident_state: 'open' | 'acknowledged' | 'contacted' | 'snoozed' | 'resolved' | null;
  incident_reason: string | null;
  risk_since: string | null;
  snoozed_until: string | null;
  notes: string | null;
  last_notified_at: string | null;
}

interface DashboardData {
  summary: {
    monitored: number;
    at_risk: number;
    new_at_risk: number;
    watch: number;
    insufficient: number;
    median_score: number;
  };
  trend: Array<{ day: string; healthy: number; watch: number; at_risk: number; unavailable: number }>;
  last_run: null | {
    id: string;
    evaluated_at: string;
    completed_at: string | null;
    status: string;
    tenant_count: number;
    at_risk_count: number;
    new_incident_count: number;
    error_message: string | null;
  };
}

interface TenantActivity {
  daily: Array<{
    day_index: number;
    current_day: string;
    baseline_day: string;
    current_count: number;
    baseline_count: number;
  }>;
  entity_counts: Array<{ entity_type: string; count: number }>;
  recent_actions: Array<{
    id: string;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    created_at: string;
  }>;
}

interface HealthLoadError {
  title: string;
  message: string;
  technical?: string;
}

const EMPTY_DASHBOARD: DashboardData = {
  summary: { monitored: 0, at_risk: 0, new_at_risk: 0, watch: 0, insufficient: 0, median_score: 0 },
  trend: [],
  last_run: null,
};

const PAGE_SIZE = 25;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TREND_LINE_META = {
  at_risk: { label: 'At Risk', color: '#ef4444' },
  healthy: { label: 'Healthy', color: '#10b981' },
  watch: { label: 'Watch', color: '#f59e0b' },
  unavailable: { label: 'Unavailable', color: '#94a3b8' },
} as const;

const STATUS_META: Record<HealthStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'info' | 'secondary' }> = {
  healthy: { label: 'Healthy', variant: 'success' },
  watch: { label: 'Watch', variant: 'warning' },
  at_risk: { label: 'At Risk', variant: 'destructive' },
  dormant: { label: 'Dormant', variant: 'destructive' },
  recovering: { label: 'Recovering', variant: 'info' },
  insufficient_data: { label: 'Insufficient Data', variant: 'secondary' },
  data_issue: { label: 'Data Issue', variant: 'secondary' },
};

function dateLabel(value: string | null, includeTime = false) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return format(date, includeTime ? 'dd MMM yyyy, HH:mm' : 'dd MMM yyyy');
}

function relativeDate(value: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return formatDistanceToNow(date, { addSuffix: true });
}

function activityChange(row: HealthRow) {
  if (row.baseline_count === 0 && row.current_count > 0) return 'New activity';
  if (row.activity_change_percent == null) return 'No baseline';
  const value = Number(row.activity_change_percent);
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function scoreColor(score: number | null, status: HealthStatus) {
  if (score == null) return 'text-muted-foreground';
  if (status === 'at_risk' || status === 'dormant') return 'text-red-400';
  if (status === 'watch') return 'text-amber-400';
  if (status === 'recovering') return 'text-sky-400';
  return 'text-emerald-400';
}

function actionLabel(action: string) {
  return action.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function healthLoadError(error: any): HealthLoadError {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? 'Unknown error');
  const technical = code ? `${code}: ${message}` : message;

  if (code === '42501' || /permission denied|unauthorized|forbidden/i.test(message)) {
    return {
      title: 'Health Score access denied',
      message: 'Your current session does not have Super Admin access to Health Score data. Sign in again with a Super Admin account and retry.',
      technical,
    };
  }

  if (
    ['PGRST202', 'PGRST205', '42P01', '42883'].includes(code) ||
    /schema cache|relation ["']?.+["']? does not exist|function .+ does not exist|could not find (?:the )?(?:table|function)/i.test(message)
  ) {
    return {
      title: 'Health Score backend is not installed',
      message: 'The Admin page is ready, but the required Supabase migration and Edge Function have not been deployed to this project.',
      technical,
    };
  }

  if (/failed to fetch|network|load failed/i.test(message)) {
    return {
      title: 'Could not reach Supabase',
      message: 'Check the network connection and Supabase project availability, then retry.',
      technical,
    };
  }

  return {
    title: 'Could not load Health Score',
    message: 'The dashboard could not load its configuration and tenant snapshots. Retry, or inspect the technical detail below.',
    technical,
  };
}

export default function HealthScorePage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData>(EMPTY_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<HealthLoadError | null>(null);
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<HealthRow | null>(null);
  const [activity, setActivity] = useState<TenantActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<HealthStatusFilter>('attention');
  const [modeFilter, setModeFilter] = useState<TenantModeFilter>('production');
  const [subscriptionFilter, setSubscriptionFilter] = useState<SubscriptionFilter>('all');
  const [sort, setSort] = useState('score');
  const [historyDays, setHistoryDays] = useState(30);
  const [trendFilter, setTrendFilter] = useState<HealthTrendFilter>('all');
  const [page, setPage] = useState(0);

  const visibleTrendLines = visibleHealthTrendSeries(trendFilter);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      const [settingsRes, recipientsRes, healthRes, dashboardRes] = await Promise.all([
        (supabase as any).from('health_score_settings').select('*').eq('singleton', true).single(),
        (supabase as any).from('health_score_recipients').select('id, email, enabled').order('created_at'),
        (supabase as any).from('v_latest_tenant_health').select('*').order('health_score', { ascending: true, nullsFirst: false }).range(0, 4999),
        (supabase as any).rpc('get_health_score_dashboard', { p_history_days: historyDays }),
      ]);

      const requests = [
        ['settings', settingsRes],
        ['recipients', recipientsRes],
        ['tenant snapshots', healthRes],
        ['dashboard summary', dashboardRes],
      ] as const;
      for (const [source, response] of requests) {
        if (response.error) {
          throw Object.assign(new Error(`${source}: ${response.error.message}`), response.error);
        }
      }
      setSettings(settingsRes.data as Settings);
      setRecipients((recipientsRes.data ?? []) as Recipient[]);
      setRows((healthRes.data ?? []) as HealthRow[]);
      setDashboard((dashboardRes.data ?? EMPTY_DASHBOARD) as DashboardData);
    } catch (error: any) {
      setLoadError(healthLoadError(error));
    } finally {
      setLoading(false);
    }
  }, [historyDays]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    setPage(0);
  }, [search, statusFilter, modeFilter, subscriptionFilter, sort]);

  useEffect(() => {
    if (!selected) {
      setActivity(null);
      return;
    }
    let cancelled = false;
    setActivityLoading(true);
    (supabase as any).rpc('get_tenant_health_activity', {
      p_tenant_id: selected.tenant_id,
      p_period_days: settings?.period_days ?? historyDays,
      p_anchor: selected.evaluated_at,
    }).then(({ data, error }: any) => {
      if (cancelled) return;
      if (error) toast.error(`Could not load tenant activity: ${error.message}`);
      else setActivity(data as TenantActivity);
      setActivityLoading(false);
    });
    return () => { cancelled = true; };
  }, [selected, settings?.period_days, historyDays]);

  const filteredRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      return matchesHealthQueueFilters(row, {
        search,
        status: statusFilter,
        mode: modeFilter,
        subscription: subscriptionFilter,
      });
    });
    return filtered.sort((a, b) => {
      if (sort === 'decline') return (a.activity_change_percent ?? 999999) - (b.activity_change_percent ?? 999999);
      if (sort === 'last_activity') return (a.last_activity_at ?? '').localeCompare(b.last_activity_at ?? '');
      if (sort === 'name') return a.company_name.localeCompare(b.company_name);
      return (a.health_score ?? 101) - (b.health_score ?? 101);
    });
  }, [rows, search, statusFilter, modeFilter, subscriptionFilter, sort]);

  const visibleRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  const lastRunFailed = dashboard.last_run?.status === 'failed';
  const stale = lastRunFailed || !dashboard.last_run?.completed_at ||
    Date.now() - new Date(dashboard.last_run.completed_at).getTime() > 48 * 60 * 60 * 1000;

  const runEvaluation = async (notify = true, forceNotifyCurrentRisks = false) => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('evaluate-health-scores', {
        body: {
          force: true,
          notify,
          notify_unnotified_recipients: false,
          force_notify_current_risks: notify && forceNotifyCurrentRisks,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const evaluation = data?.evaluation ?? {};

      if (evaluation.status === 'skipped') {
        const reason = evaluation.reason === 'evaluation_already_running'
          ? 'Another Health Score evaluation is already running.'
          : evaluation.reason === 'already_evaluated'
            ? 'Health Score was already evaluated for this period.'
            : evaluation.reason === 'feature_disabled'
              ? 'Scheduled Health Score evaluations are disabled.'
              : 'The Health Score evaluation was skipped.';
        toast.info(reason);
        await loadData(true);
        return;
      }
      if (evaluation.status !== 'succeeded') {
        throw new Error('The evaluator returned an unexpected result');
      }

      const failedDeliveries = Number(data?.delivery?.failed ?? 0);
      if (notify && failedDeliveries > 0) {
        toast.warning(
          `Health evaluation complete, but ${failedDeliveries} alert ${failedDeliveries === 1 ? 'delivery' : 'deliveries'} failed and will be retried.`,
        );
      } else {
        const deliveredAlerts = Number(data?.delivery?.sent ?? 0);
        toast.success(
          `Health evaluation complete · ${evaluation.tenant_count ?? 0} tenants · ${evaluation.at_risk_count ?? 0} at risk${notify ? deliveredAlerts > 0 ? ` · ${deliveredAlerts} alerts delivered` : ' · no email due (already notified or in cooldown)' : ''}`,
        );
      }
      await loadData(true);
    } catch (error: any) {
      toast.error(`Health evaluation failed: ${error.message}`);
    } finally {
      setRunning(false);
    }
  };

  const updateIncident = async (action: 'acknowledged' | 'contacted' | 'snoozed' | 'resolved', notes?: string) => {
    if (!selected?.incident_id) return;
    const now = new Date().toISOString();
    const values: Record<string, any> = { state: action };
    if (notes !== undefined) values.notes = notes.trim() || null;
    if (action === 'acknowledged') values.acknowledged_at = now;
    if (action === 'contacted') values.contacted_at = now;
    values.snoozed_until = action === 'snoozed' ? new Date(Date.now() + 7 * 86400000).toISOString() : null;
    if (action === 'resolved') values.resolved_at = now;

    const { data, error } = await (supabase as any)
      .from('tenant_health_incidents')
      .update(values)
      .eq('id', selected.incident_id)
      .select('id')
      .maybeSingle();
    if (error) {
      toast.error(`Could not update incident: ${error.message}`);
      return;
    }
    if (!data) {
      toast.error('This incident no longer exists or is no longer accessible. The dashboard has been refreshed.');
      setSelected(null);
      await loadData(true);
      return;
    }
    toast.success(`Incident marked ${action}`);
    setSelected({ ...selected, incident_state: action, notes: values.notes ?? selected.notes, snoozed_until: values.snoozed_until });
    await loadData(true);
  };

  if (loading) return <HealthLoading />;
  if (loadError) return <HealthUnavailable error={loadError} onRetry={() => loadData()} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tenant Health Score</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Find falling tenant engagement before it becomes subscription churn.
            </p>
            <p className={cn('mt-1 text-xs', stale ? 'text-amber-400' : 'text-muted-foreground')}>
              {dashboard.last_run?.completed_at
                ? `${lastRunFailed ? 'Last evaluation failed' : 'Last calculated'} ${relativeDate(dashboard.last_run.completed_at)} using configuration v${settings?.config_version ?? '—'}`
                : 'No successful evaluation yet'}
              {stale && ' · Results are stale'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-4 w-4" /> Settings
          </Button>
          <Button onClick={() => runEvaluation(true)} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {running ? 'Evaluating…' : 'Run now'}
          </Button>
        </div>
      </div>

      {!settings?.enabled && (
        <Notice icon={<ShieldAlert className="h-4 w-4" />} tone="warning">
          Scheduled Health Score evaluations are disabled. Manual runs remain available for preview and testing.
        </Notice>
      )}
      {lastRunFailed && (
        <Notice icon={<AlertTriangle className="h-4 w-4" />} tone="warning">
          The latest evaluation failed. Previous snapshots were preserved. {dashboard.last_run?.error_message || 'Run it again or inspect the Edge Function logs.'}
        </Notice>
      )}
      {recipients.filter((recipient) => recipient.enabled !== false).length === 0 && (
        <Notice icon={<Bell className="h-4 w-4" />} tone="warning">
          Email alerts are not configured. Scores and incidents are still recorded, but nobody will be notified.
        </Notice>
      )}
      {rows.length === 0 && (
        <Notice icon={<Activity className="h-4 w-4" />} tone="info">
          No Health Score snapshots exist yet. Select “Run now” to calculate the first comparison.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICard title="Monitored tenants" value={dashboard.summary.monitored} subtitle={`${dashboard.summary.insufficient} awaiting reliable data`} icon={<Building2 className="h-5 w-5" />} />
        <KPICard title="At risk" value={dashboard.summary.at_risk} subtitle="Threshold breach or dormant" valueClassName="text-red-400" icon={<AlertTriangle className="h-5 w-5" />} />
        <KPICard title="Newly at risk" value={dashboard.summary.new_at_risk} subtitle="Opened in the last 24 hours" valueClassName="text-amber-400" icon={<TrendingDown className="h-5 w-5" />} />
        <KPICard title="Median score" value={`${Math.round(Number(dashboard.summary.median_score ?? 0))}%`} subtitle={`${dashboard.summary.watch} tenants on watch/recovering`} valueClassName="text-emerald-400" icon={<Users className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div>
            <CardTitle className="text-base">Health trend</CardTitle>
            <CardDescription>Smooth daily trend reconstructed from audit logs. At Risk includes dormant; Watch includes recovering.</CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select value={trendFilter} onValueChange={(value) => setTrendFilter(value as HealthTrendFilter)}>
              <SelectTrigger aria-label="Filter graph by health state" className="w-full sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All health states</SelectItem>
                <SelectItem value="at_risk">At Risk</SelectItem>
                <SelectItem value="healthy">Healthy</SelectItem>
                <SelectItem value="watch">Watch</SelectItem>
                <SelectItem value="unavailable">Unavailable</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(historyDays)} onValueChange={(value) => setHistoryDays(Number(value))}>
              <SelectTrigger aria-label="Graph history period" className="w-full sm:w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[7, 14, 30, 60, 90].map((days) => <SelectItem key={days} value={String(days)}>{days} days</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {dashboard.trend.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Trend appears after the first evaluation.</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={dashboard.trend} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tickFormatter={(value) => format(new Date(`${value}T00:00:00`), 'dd MMM')} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#141414', border: '1px solid #303030', borderRadius: 8 }} />
                <Legend />
                {visibleTrendLines.map((series) => (
                  <Line
                    key={series}
                    type="monotone"
                    dataKey={series}
                    name={TREND_LINE_META[series].label}
                    stroke={TREND_LINE_META[series].color}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tenant attention queue</CardTitle>
          <CardDescription>
            Scores compare the configured {settings?.period_days ?? 30}-day period with the preceding equal period. Dashboard filters never change automated alert settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="relative xl:col-span-2">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tenant…" className="pl-9" />
            </div>
            <FilterSelect value={statusFilter} onChange={(value) => setStatusFilter(value as HealthStatusFilter)} options={[
              ['attention', 'Needs attention'], ['all', 'All health states'], ['healthy', 'Healthy'], ['watch', 'Watch'], ['at_risk', 'At Risk'], ['dormant', 'Dormant'], ['recovering', 'Recovering'], ['insufficient_data', 'Insufficient Data'], ['data_issue', 'Data Issue'],
            ]} />
            <FilterSelect value={modeFilter} onChange={(value) => setModeFilter(value as TenantModeFilter)} options={[["production", 'Production'], ['test', 'Test only'], ['all', 'All modes']]} />
            <FilterSelect value={subscriptionFilter} onChange={(value) => setSubscriptionFilter(value as SubscriptionFilter)} options={[["all", 'All subscriptions'], ['active', 'Active'], ['trialing', 'Trialing'], ['past_due', 'Past due'], ['none', 'No subscription row']]} />
            <FilterSelect value={sort} onChange={setSort} options={[["score", 'Lowest score'], ['decline', 'Largest decline'], ['last_activity', 'Oldest activity'], ['name', 'Tenant name']]} />
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead><TableHead>Health</TableHead><TableHead className="text-center">Current</TableHead>
                  <TableHead className="text-center">Previous</TableHead><TableHead>Change</TableHead><TableHead>Last activity</TableHead>
                  <TableHead>Subscription</TableHead><TableHead>Workflow</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">No tenants match these filters.</TableCell></TableRow>
                ) : visibleRows.map((row) => {
                  const meta = STATUS_META[row.status];
                  return (
                    <TableRow key={row.tenant_id} className="cursor-pointer" onClick={() => setSelected(row)}>
                      <TableCell>
                        <div className="font-medium">{row.company_name}</div>
                        <div className="text-xs text-muted-foreground">{row.slug}{row.tenant_type === 'test' ? ' · Test' : ''}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={cn('text-lg font-bold tabular-nums', scoreColor(row.health_score, row.status))}>{row.health_score == null ? '—' : `${row.health_score}%`}</span>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </div>
                        {row.confidence !== 'high' && <div className="mt-1 text-[11px] text-muted-foreground">{row.confidence.replace('_', ' ')} confidence</div>}
                      </TableCell>
                      <TableCell className="text-center font-mono">{row.current_count}</TableCell>
                      <TableCell className="text-center font-mono">{row.baseline_count}</TableCell>
                      <TableCell className={cn('font-medium', Number(row.activity_change_percent) < 0 ? 'text-red-400' : 'text-emerald-400')}>{activityChange(row)}</TableCell>
                      <TableCell><div>{relativeDate(row.last_activity_at)}</div><div className="text-[11px] text-muted-foreground">Login: {relativeDate(row.last_login_at)}</div></TableCell>
                      <TableCell>
                        <Badge variant={row.subscription_status === 'past_due' ? 'destructive' : 'outline'}>{row.subscription_status ?? 'Legacy / none'}</Badge>
                        {row.subscription_cancel_at && <div className="mt-1 text-[11px] text-amber-400">Cancels {dateLabel(row.subscription_cancel_at)}</div>}
                      </TableCell>
                      <TableCell><Badge variant="secondary">{row.incident_state?.replace('_', ' ') ?? 'No incident'}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Showing {filteredRows.length === 0 ? 0 : page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span>Page {page + 1} of {pageCount}</span>
              <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <HealthSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        recipients={recipients}
        onSaved={async (run) => {
          setSettingsOpen(false);
          if (run) await runEvaluation(true, true);
          else await loadData(true);
        }}
      />

      <TenantDetailSheet
        row={selected}
        activity={activity}
        loading={activityLoading}
        periodDays={settings?.period_days ?? 30}
        threshold={settings?.threshold_percent ?? 50}
        onClose={() => setSelected(null)}
        onUpdateIncident={updateIncident}
      />
    </div>
  );
}

function FilterSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([option, label]) => <SelectItem key={option} value={option}>{label}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Notice({ children, icon, tone }: { children: React.ReactNode; icon: React.ReactNode; tone: 'warning' | 'info' }) {
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border px-4 py-3 text-sm', tone === 'warning' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-sky-500/30 bg-sky-500/10 text-sky-300')}>
      {icon}{children}
    </div>
  );
}

function HealthLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-12 w-80" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[130px]" />)}</div>
      <Skeleton className="h-80" /><Skeleton className="h-96" />
    </div>
  );
}

function HealthUnavailable({ error, onRetry }: { error: HealthLoadError; onRetry: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-2xl border-amber-500/30">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
          </div>
          <CardTitle>{error.title}</CardTitle>
          <CardDescription className="text-sm leading-6">{error.message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error.technical && (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 font-mono text-xs text-muted-foreground">
              {error.technical}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={onRetry}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/dashboard">Back to dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TenantDetailSheet({ row, activity, loading, periodDays, threshold, onClose, onUpdateIncident }: {
  row: HealthRow | null;
  activity: TenantActivity | null;
  loading: boolean;
  periodDays: number;
  threshold: number;
  onClose: () => void;
  onUpdateIncident: (action: 'acknowledged' | 'contacted' | 'snoozed' | 'resolved', notes?: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState('');
  useEffect(() => { setNotes(row?.notes ?? ''); }, [row?.tenant_id, row?.notes]);
  const chart = activity?.daily.map((day, index) => ({ index: index + 1, current: Number(day.current_count), previous: Number(day.baseline_count) })) ?? [];

  return (
    <Sheet open={!!row} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {row && <>
          <SheetHeader>
            <SheetTitle className="pr-8">{row.company_name}</SheetTitle>
            <SheetDescription>{row.slug} · Evaluated {dateLabel(row.evaluated_at, true)}</SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniMetric label="Health score" value={row.health_score == null ? '—' : `${row.health_score}%`} className={scoreColor(row.health_score, row.status)} />
              <MiniMetric label="Current" value={row.current_count} />
              <MiniMetric label="Previous" value={row.baseline_count} />
              <MiniMetric label="Change" value={activityChange(row)} className={Number(row.activity_change_percent) < 0 ? 'text-red-400' : 'text-emerald-400'} />
            </div>

            <Card>
              <CardHeader><CardTitle className="text-sm">Why this score?</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>The last {periodDays} days contain <strong className="text-foreground">{row.current_count}</strong> qualifying tenant-user actions. The preceding {periodDays} days contain <strong className="text-foreground">{row.baseline_count}</strong>.</p>
                <p>Alert threshold: current activity at or below <strong className="text-foreground">{threshold}%</strong> of the preceding period. Minimum reliable baseline: {row.data_quality_details?.minimum_baseline_events ?? '—'} events.</p>
                <p>Comparison: {dateLabel(row.baseline_period_start)}–{dateLabel(row.baseline_period_end)} versus {dateLabel(row.current_period_start)}–{dateLabel(row.current_period_end)}.</p>
                {Number(row.data_quality_details?.unattributed_events_in_comparison_window ?? 0) > 0 && <p className="text-amber-400">{Number(row.data_quality_details.unattributed_events_in_comparison_window)} unattributed audit events were excluded.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Activity comparison</CardTitle><CardDescription>Day 1–{periodDays} inside each rolling window</CardDescription></CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-60" /> : chart.length === 0 ? <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">No qualifying activity.</div> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={chart} margin={{ left: -25, right: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="index" tick={{ fill: '#9ca3af', fontSize: 10 }} />
                      <YAxis allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: '#141414', border: '1px solid #303030', borderRadius: 8 }} />
                      <Legend />
                      <Line type="monotone" dataKey="previous" stroke="#6b7280" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="current" stroke="#8b5cf6" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {!!activity?.entity_counts.length && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Current activity by area</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={activity.entity_counts} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" allowDecimals={false} tick={{ fill: '#9ca3af', fontSize: 10 }} />
                      <YAxis type="category" dataKey="entity_type" width={90} tick={{ fill: '#9ca3af', fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: '#141414', border: '1px solid #303030', borderRadius: 8 }} />
                      <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle className="text-sm">Tenant and subscription</CardTitle></CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                <Info label="Last activity" value={dateLabel(row.last_activity_at, true)} />
                <Info label="Last successful login" value={dateLabel(row.last_login_at, true)} />
                <Info label="Subscription" value={row.subscription_status ?? 'Legacy / no row'} />
                <Info label="Cancellation" value={row.subscription_cancel_at ? `Scheduled ${dateLabel(row.subscription_cancel_at)}` : 'Not scheduled'} />
                <Info label="Risk since" value={dateLabel(row.risk_since, true)} />
                <Info label="Last alerted" value={dateLabel(row.last_notified_at, true)} />
              </CardContent>
            </Card>

            {row.incident_id && row.incident_state !== 'resolved' && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Retention workflow</CardTitle><CardDescription>Current state: {row.incident_state ?? 'open'}{row.snoozed_until ? ` until ${dateLabel(row.snoozed_until)}` : ''}</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} placeholder="Contact notes, tenant issue, offer discussed…" />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => onUpdateIncident('acknowledged', notes)}>Acknowledge</Button>
                    <Button size="sm" variant="outline" onClick={() => onUpdateIncident('contacted', notes)}>Mark contacted</Button>
                    <Button size="sm" variant="outline" onClick={() => onUpdateIncident('snoozed', notes)}>Snooze 7 days</Button>
                    <Button size="sm" onClick={() => onUpdateIncident('resolved', notes)}>Resolve</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><Link href={`/admin/rentals/${row.tenant_id}`}>Open tenant <ExternalLink className="h-4 w-4" /></Link></Button>
              <Button asChild variant="outline"><Link href={`/admin/audit-logs?tenant_id=${row.tenant_id}`}>Open audit logs <ExternalLink className="h-4 w-4" /></Link></Button>
            </div>

            {!!activity?.recent_actions.length && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Recent qualifying activity</h3>
                {activity.recent_actions.map((action) => (
                  <div key={action.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div><div>{actionLabel(action.action)}</div><div className="text-xs text-muted-foreground">{action.entity_type ?? 'Other'}</div></div>
                    <span className="text-xs text-muted-foreground">{relativeDate(action.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>}
      </SheetContent>
    </Sheet>
  );
}

function MiniMetric({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className={cn('mt-1 text-xl font-bold tabular-nums', className)}>{value}</div></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-0.5 font-medium">{value}</div></div>;
}

function HealthSettingsDialog({ open, onOpenChange, settings, recipients, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings | null;
  recipients: Recipient[];
  onSaved: (run: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Settings | null>(settings);
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [preview, setPreview] = useState<{ monitored: number; insufficient_data: number; data_issue: number; dormant: number; at_risk: number; would_alert: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(settings ? { ...settings } : null);
      setEmails(recipients.filter((recipient) => recipient.enabled !== false).map((recipient) => recipient.email.toLowerCase()));
      setPreview(null);
    }
  }, [open, settings, recipients]);

  useEffect(() => {
    if (!open || !draft) return;
    const timer = window.setTimeout(async () => {
      setPreviewing(true);
      const { data, error } = await (supabase as any).rpc('preview_tenant_health_settings', {
        p_period_days: draft.period_days,
        p_threshold_percent: draft.threshold_percent,
        p_minimum_baseline_events: draft.minimum_baseline_events,
        p_new_tenant_grace_days: draft.new_tenant_grace_days,
        p_include_test_tenants: draft.include_test_tenants,
      });
      if (!error) setPreview(data);
      setPreviewing(false);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [open, draft?.period_days, draft?.threshold_percent, draft?.minimum_baseline_events, draft?.new_tenant_grace_days, draft?.include_test_tenants]);

  if (!draft) return null;

  const setNumber = (key: keyof Settings, min: number, max: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    setDraft((current) => current ? { ...current, [key]: Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min } : current);
  };

  const addEmail = () => {
    const email = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return toast.error('Enter a valid email address');
    if (emails.some((existing) => existing.toLowerCase() === email)) return toast.error('That recipient is already listed');
    setEmails((current) => [...current, email]);
    setNewEmail('');
  };

  const save = async (run: boolean) => {
    setSaving(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const { error } = await (supabase as any)
        .rpc('update_health_score_config', {
          p_expected_version: draft.config_version,
          p_enabled: draft.enabled,
          p_period_days: draft.period_days,
          p_threshold_percent: draft.threshold_percent,
          p_minimum_baseline_events: draft.minimum_baseline_events,
          p_new_tenant_grace_days: draft.new_tenant_grace_days,
          p_repeat_alert_after_days: draft.repeat_alert_after_days,
          p_recovery_notifications_enabled: draft.recovery_notifications_enabled,
          p_include_test_tenants: draft.include_test_tenants,
          p_recipient_emails: emails,
        })
        .abortSignal(controller.signal);
      if (error) throw error;

      toast.success(run ? 'Settings saved · evaluation started in the background' : 'Health Score settings saved');
      onOpenChange(false);
      void onSaved(run).catch((error: any) => {
        toast.error(`Could not refresh Health Score: ${error?.message ?? 'Unknown error'}`);
      });
    } catch (error: any) {
      if (error.code === '40001' || error.code === '409') toast.error('Settings changed in another session. Reload and try again.');
      else if (error?.name === 'AbortError' || /abort|timed?\s*out/i.test(String(error?.message ?? ''))) toast.error('Saving settings timed out. Check your connection and try again.');
      else toast.error(`Could not save settings: ${error.message}`);
    } finally {
      window.clearTimeout(timeout);
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Health Score settings</DialogTitle>
          <DialogDescription>Platform-wide alert behavior. Dashboard display filters do not modify these values.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <SettingSwitch label="Scheduled evaluations" description="Run the daily evaluator and create retention incidents automatically." checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} />

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberSetting label="Analysis period (days)" description="Compared with the immediately preceding equal period." value={draft.period_days} min={1} max={365} onChange={setNumber('period_days', 1, 365)} />
            <NumberSetting label="At-risk threshold (%)" description="At or below this score becomes At Risk." value={draft.threshold_percent} min={1} max={99} onChange={setNumber('threshold_percent', 1, 99)} />
            <NumberSetting label="Minimum baseline events" description="Smaller non-zero baselines are low confidence and do not email." value={draft.minimum_baseline_events} min={0} max={1000000} onChange={setNumber('minimum_baseline_events', 0, 1000000)} />
            <NumberSetting label="New-tenant grace (days)" description="The evaluator also waits for two complete periods." value={draft.new_tenant_grace_days} min={0} max={365} onChange={setNumber('new_tenant_grace_days', 0, 365)} />
            <NumberSetting label="Repeat alert cooldown (days)" description="Minimum delay before reminding about an open incident." value={draft.repeat_alert_after_days} min={1} max={365} onChange={setNumber('repeat_alert_after_days', 1, 365)} />
          </div>

          <SettingSwitch label="Recovery emails" description="Notify recipients after two consecutive recovered evaluations." checked={draft.recovery_notifications_enabled} onChange={(recovery_notifications_enabled) => setDraft({ ...draft, recovery_notifications_enabled })} />
          <SettingSwitch label="Include test tenants" description="Off by default so sandbox activity cannot create retention noise." checked={draft.include_test_tenants} onChange={(include_test_tenants) => setDraft({ ...draft, include_test_tenants })} />

          <div className="rounded-lg border bg-secondary/30 p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Impact preview</div>
              {previewing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {preview ? (
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                <Info label="Monitored" value={String(preview.monitored)} />
                <Info label="Would alert" value={String(preview.would_alert)} />
                <Info label="Dormant" value={String(preview.dormant)} />
                <Info label="Data issues" value={String(preview.data_issue ?? 0)} />
                <Info label="Insufficient" value={String(preview.insufficient_data)} />
              </div>
            ) : <p className="mt-2 text-xs text-muted-foreground">Calculating the effect of these settings…</p>}
          </div>

          <div className="space-y-3">
            <div><Label>Email alert recipients</Label><p className="mt-1 text-xs text-muted-foreground">No recipients means incidents are stored but no email is sent.</p></div>
            <div className="flex flex-wrap gap-2">
              {emails.length === 0 && <span className="text-xs text-amber-400">No recipients configured</span>}
              {emails.map((email) => (
                <span key={email} className="inline-flex items-center gap-1.5 rounded-full border bg-secondary px-2.5 py-1 text-xs">
                  {email}<button aria-label={`Remove ${email}`} onClick={() => setEmails((current) => current.filter((item) => item !== email))}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addEmail(); } }} placeholder="retention@drive-247.com" />
              <Button type="button" variant="outline" onClick={addEmail}><Mail className="h-4 w-4" /> Add</Button>
            </div>
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => save(false)} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save for next run</Button>
          <Button onClick={() => save(true)} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Save, evaluate & notify</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingSwitch({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4"><div><Label>{label}</Label><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><Switch checked={checked} onCheckedChange={onChange} /></div>;
}

function NumberSetting({ label, description, value, min, max, onChange }: { label: string; description: string; value: number; min: number; max: number; onChange: (event: React.ChangeEvent<HTMLInputElement>) => void }) {
  return <div className="space-y-1.5"><Label>{label}</Label><Input type="number" value={value} min={min} max={max} onChange={onChange} /><p className="text-xs text-muted-foreground">{description}</p></div>;
}
