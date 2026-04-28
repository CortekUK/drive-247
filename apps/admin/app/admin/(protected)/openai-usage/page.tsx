'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Sparkles, RotateCcw, AlertTriangle, DollarSign, Activity, Hash, TrendingUp } from 'lucide-react';
import { format, subDays, startOfDay } from 'date-fns';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UsageLog {
  id: string;
  tenant_id: string | null;
  function_name: string;
  endpoint: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  status: string;
  is_fallback: boolean;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}

type RangeKey = '24h' | '7d' | '30d';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtUSD(n: number): string {
  return n < 0.01 && n > 0
    ? `$${n.toFixed(4)}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

function rangeStartIso(range: RangeKey): string {
  const now = new Date();
  if (range === '24h') return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  if (range === '7d') return startOfDay(subDays(now, 7)).toISOString();
  return startOfDay(subDays(now, 30)).toISOString();
}

function functionBadgeColor(fn: string): string {
  if (fn === 'chat') return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
  if (fn === 'customer-chat') return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
  if (fn === 'rental-insights') return 'bg-violet-500/10 text-violet-400 border-violet-500/20';
  if (fn === 'rag-init' || fn === 'rag-sync') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  if (fn.includes('ocr') || fn.includes('validate')) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (fn.includes('insurance')) return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  if (fn.includes('call-recording')) return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
  return 'bg-muted text-muted-foreground';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function OpenAIUsagePage() {
  const [range, setRange] = useState<RangeKey>('7d');
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const since = rangeStartIso(range);

    // Cap at 10K rows for performance — usage logs can balloon
    const { data, error } = await supabase
      .from('openai_usage_logs')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10000);

    if (error) {
      console.error('Failed to fetch usage logs:', error);
      setLogs([]);
      setLoading(false);
      return;
    }

    const rows = (data || []) as UsageLog[];
    setLogs(rows);

    // Resolve tenant names
    const tenantIds = [...new Set(rows.map((r) => r.tenant_id).filter(Boolean) as string[])];
    if (tenantIds.length > 0) {
      const { data: tenants } = await supabase
        .from('tenants')
        .select('id, company_name')
        .in('id', tenantIds);
      if (tenants) {
        setTenantNames(Object.fromEntries(tenants.map((t: { id: string; company_name: string }) => [t.id, t.company_name])));
      }
    }

    setLoading(false);
  }, [range]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // ─── Aggregations ────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    const totalCost = logs.reduce((s, l) => s + Number(l.cost_usd), 0);
    const totalCalls = logs.length;
    const totalTokens = logs.reduce((s, l) => s + l.total_tokens, 0);
    const errorCount = logs.filter((l) => l.status === 'error').length;
    const fallbackCount = logs.filter((l) => l.is_fallback).length;
    return { totalCost, totalCalls, totalTokens, errorCount, fallbackCount };
  }, [logs]);

  const dailyChart = useMemo(() => {
    const buckets: Record<string, { day: string; cost: number; calls: number }> = {};
    for (const l of logs) {
      const day = format(new Date(l.created_at), 'MMM dd');
      if (!buckets[day]) buckets[day] = { day, cost: 0, calls: 0 };
      buckets[day].cost += Number(l.cost_usd);
      buckets[day].calls += 1;
    }
    return Object.values(buckets).reverse();
  }, [logs]);

  const byFunction = useMemo(() => {
    const buckets: Record<string, { fn: string; calls: number; tokens: number; cost: number; avgTokens: number; errors: number }> = {};
    for (const l of logs) {
      const k = l.function_name || 'unknown';
      if (!buckets[k]) buckets[k] = { fn: k, calls: 0, tokens: 0, cost: 0, avgTokens: 0, errors: 0 };
      buckets[k].calls += 1;
      buckets[k].tokens += l.total_tokens;
      buckets[k].cost += Number(l.cost_usd);
      if (l.status === 'error') buckets[k].errors += 1;
    }
    return Object.values(buckets)
      .map((b) => ({ ...b, avgTokens: b.calls > 0 ? Math.round(b.tokens / b.calls) : 0 }))
      .sort((a, b) => b.cost - a.cost);
  }, [logs]);

  const byTenant = useMemo(() => {
    const buckets: Record<string, { tenantId: string | null; calls: number; tokens: number; cost: number }> = {};
    for (const l of logs) {
      const k = l.tenant_id || 'system';
      if (!buckets[k]) buckets[k] = { tenantId: l.tenant_id, calls: 0, tokens: 0, cost: 0 };
      buckets[k].calls += 1;
      buckets[k].tokens += l.total_tokens;
      buckets[k].cost += Number(l.cost_usd);
    }
    return Object.values(buckets).sort((a, b) => b.cost - a.cost);
  }, [logs]);

  const byModel = useMemo(() => {
    const buckets: Record<string, { model: string; calls: number; tokens: number; cost: number }> = {};
    for (const l of logs) {
      if (!buckets[l.model]) buckets[l.model] = { model: l.model, calls: 0, tokens: 0, cost: 0 };
      buckets[l.model].calls += 1;
      buckets[l.model].tokens += l.total_tokens;
      buckets[l.model].cost += Number(l.cost_usd);
    }
    return Object.values(buckets).sort((a, b) => b.cost - a.cost);
  }, [logs]);

  const recentCalls = logs.slice(0, 50);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">OpenAI Usage</h1>
            <p className="text-sm text-muted-foreground">
              Per-call AI cost tracking across all tenants and edge functions
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading} className="gap-1.5">
            <RotateCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<DollarSign className="h-4 w-4" />}
          label="Total Spend"
          value={fmtUSD(totals.totalCost)}
          loading={loading}
          accent="emerald"
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Total Calls"
          value={fmtNum(totals.totalCalls)}
          loading={loading}
          accent="blue"
        />
        <StatCard
          icon={<Hash className="h-4 w-4" />}
          label="Total Tokens"
          value={fmtTokens(totals.totalTokens)}
          loading={loading}
          accent="violet"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Avg Tokens / Call"
          value={totals.totalCalls ? fmtNum(Math.round(totals.totalTokens / totals.totalCalls)) : '—'}
          loading={loading}
          accent="amber"
        />
      </div>

      {/* Alerts */}
      {(totals.errorCount > 0 || totals.fallbackCount > 0) && !loading && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              {totals.errorCount > 0 && (
                <p>
                  <span className="font-medium text-amber-400">{totals.errorCount} failed call{totals.errorCount === 1 ? '' : 's'}</span>{' '}
                  in this range. Errors still cost tokens — check the recent calls table for details.
                </p>
              )}
              {totals.fallbackCount > 0 && (
                <p className="mt-1">
                  <span className="font-medium text-amber-400">{totals.fallbackCount} fallback retry{totals.fallbackCount === 1 ? '' : 'ies'}</span>{' '}
                  triggered (insurance scan). Repeated fallbacks may indicate a bad document or primary key issue.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Daily chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Daily Spend</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : dailyChart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Sparkles className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No OpenAI usage in this range yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Once edge functions make AI calls, they'll show up here within seconds
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dailyChart} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'currentColor' }} className="text-muted-foreground" />
                <YAxis
                  tick={{ fontSize: 11, fill: 'currentColor' }}
                  className="text-muted-foreground"
                  tickFormatter={(v) => `$${v.toFixed(0)}`}
                />
                <ReTooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={((value: number) => [fmtUSD(value), 'Cost']) as never}
                />
                <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* By Function */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">By Edge Function</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {loading ? (
            <div className="space-y-2 px-6 pb-6">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-primary/5 hover:bg-primary/5">
                  <TableHead>Function</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Avg / call</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byFunction.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      No data yet
                    </TableCell>
                  </TableRow>
                ) : byFunction.map((f) => (
                  <TableRow key={f.fn}>
                    <TableCell>
                      <Badge variant="outline" className={`${functionBadgeColor(f.fn)} text-[11px] font-mono`}>
                        {f.fn}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(f.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtTokens(f.tokens)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmtNum(f.avgTokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.errors > 0 ? <span className="text-rose-400">{f.errors}</span> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{fmtUSD(f.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Two-column: By Tenant + By Model */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">By Tenant</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {loading ? (
              <div className="space-y-2 px-6 pb-6">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary/5 hover:bg-primary/5">
                    <TableHead>Tenant</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byTenant.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">No data</TableCell>
                    </TableRow>
                  ) : byTenant.map((t, i) => (
                    <TableRow key={t.tenantId || `system-${i}`}>
                      <TableCell className="text-sm">
                        {t.tenantId ? (tenantNames[t.tenantId] || t.tenantId.slice(0, 8) + '…') : (
                          <span className="text-muted-foreground italic">System / unknown</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(t.calls)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{fmtUSD(t.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">By Model</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {loading ? (
              <div className="space-y-2 px-6 pb-6">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary/5 hover:bg-primary/5">
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byModel.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No data</TableCell>
                    </TableRow>
                  ) : byModel.map((m) => (
                    <TableRow key={m.model}>
                      <TableCell><span className="font-mono text-xs">{m.model}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(m.calls)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTokens(m.tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{fmtUSD(m.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent calls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Recent Calls (last 50)</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {loading ? (
            <div className="space-y-2 px-6 pb-6">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : recentCalls.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">No calls in this range</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-primary/5 hover:bg-primary/5">
                  <TableHead className="w-[160px]">Time</TableHead>
                  <TableHead>Function</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentCalls.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {format(new Date(l.created_at), 'MMM dd HH:mm:ss')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${functionBadgeColor(l.function_name)} text-[10px] font-mono`}>
                        {l.function_name}
                      </Badge>
                      {l.is_fallback && (
                        <Badge variant="outline" className="ml-1 text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">
                          fallback
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {l.tenant_id ? (tenantNames[l.tenant_id] || l.tenant_id.slice(0, 8) + '…') : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><span className="font-mono text-[11px]">{l.model}</span></TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{fmtNum(l.total_tokens)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{fmtUSD(Number(l.cost_usd))}</TableCell>
                    <TableCell className="text-right">
                      {l.status === 'success' ? (
                        <span className="text-xs text-emerald-400">ok</span>
                      ) : (
                        <span className="text-xs text-rose-400" title={l.error_message || ''}>error</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  loading,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
  accent: 'emerald' | 'blue' | 'violet' | 'amber';
}) {
  const colors = {
    emerald: 'text-emerald-400 bg-emerald-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
    violet: 'text-violet-400 bg-violet-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
  };
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            {loading ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <p className="text-2xl font-bold tabular-nums">{value}</p>
            )}
          </div>
          <div className={`flex items-center justify-center h-8 w-8 rounded-lg ${colors[accent]}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
