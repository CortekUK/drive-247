'use client';

/**
 * /admin/customer-health — a 0–100 health score per rental company, so the
 * team can see who might leave and call them before they cancel.
 *
 * The scoring rules are in lib/customer-health/score.ts. This page only loads
 * the facts (logins, bookings, subscription, invoices, setup) and draws them,
 * in the same layout as Platform Rentals: header, search with the filter
 * toggle, stat cards whose other face is the filter panel, then the table.
 *
 * Not to be confused with the old "Tenant Health Score" removed in 1a72736b:
 * that one scored audit-log activity drops in a nightly job and emailed. This
 * one is worked out on page load from tables the platform already keeps, and
 * sends nothing.
 *
 * Test tenants and suspended companies are left out — scoring them is noise.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  HeartPulse,
  RefreshCw,
} from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { FilterChip, FilterSearch, FilterSection, FilterShell } from '@/components/admin/filter-primitives';
import { OverviewFlip } from '@/components/admin/overview-flip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  BAND_THRESHOLDS,
  scoreBuckets,
  scoreTenant,
  type HealthBand,
  type HealthResult,
  type InvoiceFacts,
  type SubscriptionFacts,
  type TenantFacts,
} from '@/lib/customer-health/score';

interface TenantRow extends TenantFacts {
  tenant_type: string | null;
  status: string | null;
}

interface Scored {
  tenant: TenantRow;
  health: HealthResult;
}

const BAND: Record<HealthBand, { label: string; dot: string; text: string; chipBg: string; fill: string }> = {
  critical: {
    label: 'Critical',
    dot: 'bg-red-500',
    text: 'text-red-600',
    chipBg: 'bg-destructive/15 border-destructive/30',
    fill: 'hsl(var(--destructive))',
  },
  at_risk: {
    label: 'At risk',
    dot: 'bg-amber-500',
    text: 'text-amber-600',
    chipBg: 'bg-warning/15 border-warning/30',
    fill: 'hsl(var(--warning))',
  },
  healthy: {
    label: 'Healthy',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600',
    chipBg: 'bg-success/15 border-success/30',
    fill: 'hsl(var(--success))',
  },
};

const DAY_MS = 86_400_000;
const PAGE = 1000;

/** PostgREST caps a response, so read in pages until a short one comes back. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function groupBy<T extends { tenant_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const list = map.get(r.tenant_id);
    if (list) list.push(r);
    else map.set(r.tenant_id, [r]);
  }
  return map;
}

function BandChip({ band, score }: { band: HealthBand; score?: number }) {
  const b = BAND[band];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold', b.chipBg, b.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', b.dot)} />
      {score !== undefined ? <span className="tabular-nums">{score}</span> : b.label}
    </span>
  );
}

function ScoreBar({ score, band }: { score: number; band: HealthBand }) {
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full', BAND[band].dot)} style={{ width: `${score}%` }} />
    </div>
  );
}

export default function CustomerHealthPage() {
  const [rows, setRows] = useState<Scored[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [bandFilter, setBandFilter] = useState<HealthBand | 'all'>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Scored | null>(null);

  const load = useCallback(async () => {
    try {
      const now = new Date();
      const since90 = new Date(now.getTime() - 90 * DAY_MS).toISOString();
      const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
      const db = supabase as any;

      const [tenants, logins, rentals, subs, invoices, bonzah] = await Promise.all([
        fetchAll<TenantRow>((a, b) =>
          db
            .from('tenants')
            .select(
              'id, company_name, slug, created_at, tenant_type, status, stripe_onboarding_complete, stripe_account_status, own_stripe_account_id, own_stripe_test_account_id, integration_bonzah',
            )
            .order('created_at', { ascending: true })
            .range(a, b),
        ),
        // Operator logins only — a super admin opening the portal as them is
        // logged as 'super_admin' and must not make a company look active.
        fetchAll<{ tenant_id: string; created_at: string }>((a, b) =>
          db
            .from('audit_logs')
            .select('tenant_id, created_at')
            .eq('action', 'login_success')
            .eq('activity_source', 'tenant_user')
            .gte('created_at', since90)
            .not('tenant_id', 'is', null)
            .order('created_at', { ascending: false })
            .range(a, b),
        ),
        fetchAll<{ tenant_id: string }>((a, b) =>
          db.from('rentals').select('tenant_id').gte('created_at', since30).order('created_at').range(a, b),
        ),
        fetchAll<SubscriptionFacts & { tenant_id: string }>((a, b) =>
          db
            .from('tenant_subscriptions')
            .select('tenant_id, status, cancel_at, current_period_end, trial_end, created_at')
            .order('created_at')
            .range(a, b),
        ),
        fetchAll<InvoiceFacts & { tenant_id: string }>((a, b) =>
          db
            .from('tenant_subscription_invoices')
            .select('tenant_id, status, attempt_count, created_at')
            .order('created_at')
            .range(a, b),
        ),
        // Pending or approved counts as sent — same rule as the Customer
        // Management "submit your Bonzah form" reminder.
        fetchAll<{ tenant_id: string }>((a, b) =>
          db
            .from('bonzah_onboarding_submissions')
            .select('tenant_id')
            .in('status', ['pending', 'approved'])
            .order('tenant_id')
            .range(a, b),
        ),
      ]);

      const lastLogin = new Map<string, string>();
      for (const l of logins) {
        const prev = lastLogin.get(l.tenant_id);
        if (!prev || l.created_at > prev) lastLogin.set(l.tenant_id, l.created_at);
      }
      const bookings = new Map<string, number>();
      for (const r of rentals) bookings.set(r.tenant_id, (bookings.get(r.tenant_id) ?? 0) + 1);
      const subsBy = groupBy(subs);
      const invoicesBy = groupBy(invoices);
      const bonzahSent = new Set(bonzah.map((b) => b.tenant_id));

      const scored = tenants
        .filter((t) => t.tenant_type !== 'test' && t.status === 'active')
        .map((tenant) => ({
          tenant,
          health: scoreTenant({
            tenant,
            lastLoginAt: lastLogin.get(tenant.id) ?? null,
            bookingsLast30Days: bookings.get(tenant.id) ?? 0,
            subscriptions: subsBy.get(tenant.id) ?? [],
            invoices: invoicesBy.get(tenant.id) ?? [],
            bonzahFormSent: bonzahSent.has(tenant.id),
            now,
          }),
        }))
        // Worst first: the top of the list is who to call.
        .sort((a, b) => a.health.score - b.health.score);

      setRows(scored);
      setError(null);
    } catch (e) {
      // A half-loaded score is a wrong score, so show nothing rather than it.
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<HealthBand, number> = { critical: 0, at_risk: 0, healthy: 0 };
    rows.forEach((r) => (c[r.health.band] += 1));
    return c;
  }, [rows]);

  const average = rows.length ? Math.round(rows.reduce((s, r) => s + r.health.score, 0) / rows.length) : 0;
  const buckets = useMemo(() => scoreBuckets(rows.map((r) => r.health.score)), [rows]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (bandFilter !== 'all' && r.health.band !== bandFilter) return false;
      if (!q) return true;
      return (
        r.tenant.company_name?.toLowerCase().includes(q) || r.tenant.slug?.toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery, bandFilter]);

  const activeFilterCount = (searchQuery.trim() ? 1 : 0) + (bandFilter !== 'all' ? 1 : 0);

  const statCards: { band: HealthBand; title: string; icon: typeof AlertOctagon; iconBg: string; iconText: string; active: string }[] = [
    { band: 'critical', title: `Critical · under ${BAND_THRESHOLDS.atRisk}`, icon: AlertOctagon, iconBg: 'bg-destructive/15', iconText: 'text-destructive', active: 'border-destructive/40 bg-destructive/5' },
    { band: 'at_risk', title: `At risk · ${BAND_THRESHOLDS.atRisk}–${BAND_THRESHOLDS.healthy - 1}`, icon: AlertTriangle, iconBg: 'bg-warning/15', iconText: 'text-warning', active: 'border-warning/40 bg-warning/5' },
    { band: 'healthy', title: `Healthy · ${BAND_THRESHOLDS.healthy}+`, icon: CheckCircle2, iconBg: 'bg-success/15', iconText: 'text-success', active: 'border-success/40 bg-success/5' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <HeartPulse className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Customer Health Score</h1>
            <p className="text-sm text-muted-foreground">
              A 0–100 score that tells us who might leave ·{' '}
              <span className="tabular-nums">{rows.length}</span> companies · average{' '}
              <span className="tabular-nums">{average}</span>
              {counts.critical > 0 && <span className="text-destructive"> · {counts.critical} to call</span>}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not load health scores</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <FilterSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by company name..."
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            activeCount={activeFilterCount}
          />

          <OverviewFlip
            flipped={filtersOpen}
            onFlipBack={() => setFiltersOpen(false)}
            front={
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {statCards.map(({ band, title, icon: Icon, iconBg, iconText, active }) => (
                  <Card
                    key={band}
                    className={cn('cursor-pointer transition-all', bandFilter === band && active)}
                    onClick={() => setBandFilter(bandFilter === band ? 'all' : band)}
                  >
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">{title}</p>
                          {loading ? (
                            <Skeleton className="mt-1 h-8 w-10" />
                          ) : (
                            <p className="text-2xl font-bold tabular-nums">{counts[band]}</p>
                          )}
                        </div>
                        <div className={cn('flex items-center justify-center h-10 w-10 rounded-lg', iconBg)}>
                          <Icon className={cn('h-5 w-5', iconText)} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            }
            back={
              <FilterShell
                activeCount={activeFilterCount}
                onClear={() => {
                  setSearchQuery('');
                  setBandFilter('all');
                }}
                onClose={() => setFiltersOpen(false)}
              >
                <FilterSection icon={<HeartPulse className="size-3 text-success" />} tint="bg-success/10" title="Health">
                  <div className="flex flex-wrap gap-1.5">
                    {(['all', 'critical', 'at_risk', 'healthy'] as const).map((b) => (
                      <FilterChip key={b} active={bandFilter === b} onClick={() => setBandFilter(b)}>
                        {b === 'all' ? 'Any' : BAND[b].label}
                      </FilterChip>
                    ))}
                  </div>
                </FilterSection>
              </FilterShell>
            }
          />

          {/* The graph: how many companies sit in each score range. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Score distribution</CardTitle>
              <CardDescription>Number of companies in each score range. Red bars are the ones to call.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[220px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={buckets} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" vertical={false} />
                    <XAxis dataKey="range" tick={{ fontSize: 11 }} className="fill-muted-foreground" tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      formatter={(v) => [`${v} ${v === 1 ? 'company' : 'companies'}`, 'Count']}
                      labelFormatter={(l) => `Score ${l}`}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {buckets.map((b) => (
                        <Cell key={b.range} fill={BAND[b.band].fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Table — worst first */}
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[90px]">Score</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead>Last login</TableHead>
                    <TableHead className="text-right">Bookings (30d)</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Setup</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 7 }).map((__, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-6 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                        No companies match.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => {
                      const h = r.health;
                      return (
                        <TableRow key={r.tenant.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                          <TableCell>
                            <BandChip band={h.band} score={h.score} />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{r.tenant.company_name ?? r.tenant.slug ?? '—'}</span>
                              {h.ageDays < 14 && (
                                <span className="text-xs text-muted-foreground">New · signed up {h.ageDays}d ago</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <ScoreBar score={h.score} band={h.band} />
                          </TableCell>
                          <TableCell className={cn('text-sm whitespace-nowrap', h.parts.logins.concern && 'text-destructive')}>
                            {h.daysSinceLogin === null
                              ? 'Over 90 days'
                              : h.daysSinceLogin === 0
                                ? 'Today'
                                : `${h.daysSinceLogin}d ago`}
                          </TableCell>
                          <TableCell className={cn('text-right text-sm tabular-nums', h.parts.bookings.concern && 'text-destructive')}>
                            {h.bookingsLast30Days}
                          </TableCell>
                          <TableCell className={cn('text-sm whitespace-nowrap', h.parts.payment.concern && 'text-destructive')}>
                            {h.parts.payment.label}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            <span className={h.stripeConnected ? 'text-emerald-600' : 'text-muted-foreground'}>Stripe</span>
                            {' · '}
                            <span className={h.bonzahFormSent ? 'text-emerald-600' : 'text-muted-foreground'}>Bonzah</span>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* Detail — the breakdown behind one score */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BandChip band={selected.health.band} score={selected.health.score} />
                  {selected.tenant.company_name ?? selected.tenant.slug}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className={cn('rounded-2xl border p-3', BAND[selected.health.band].chipBg)}>
                  <p className={cn('text-xs font-bold uppercase tracking-wide mb-1', BAND[selected.health.band].text)}>
                    {BAND[selected.health.band].label}
                  </p>
                  <p className="text-foreground/80">
                    {selected.health.band === 'critical'
                      ? 'Likely to leave. Call them before they cancel.'
                      : selected.health.band === 'at_risk'
                        ? 'Slipping. Worth a check-in.'
                        : 'Using Drive247 and paying. Nothing to do.'}
                    {selected.health.ageDays < 14 && ` Signed up ${selected.health.ageDays} days ago, so there is little history yet.`}
                  </p>
                </div>

                <div className="rounded-lg border border-border p-3 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">How the score is made</p>
                  {(
                    [
                      ['Logins', selected.health.parts.logins],
                      ['Bookings', selected.health.parts.bookings],
                      ['Payment', selected.health.parts.payment],
                      ['Setup', selected.health.parts.setup],
                    ] as const
                  ).map(([name, part]) => (
                    <div key={name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{name}</span>
                        <span className={cn('tabular-nums font-semibold', part.concern ? 'text-red-600' : 'text-emerald-600')}>
                          {part.points} / {part.max}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full', part.concern ? 'bg-red-500' : 'bg-emerald-500')}
                          style={{ width: `${(part.points / part.max) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">{part.label}</p>
                    </div>
                  ))}
                </div>

                <Link
                  href={`/admin/rentals/${selected.tenant.id}`}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                >
                  Open company <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
