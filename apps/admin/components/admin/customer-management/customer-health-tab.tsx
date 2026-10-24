'use client';

/**
 * Customer Management → Customer Health Score (was /admin/customer-health,
 * which now redirects here) — a 0–100 health score per rental company, so the
 * team can see who might leave and call them before they cancel.
 *
 * The scoring rules are in lib/customer-health/score.ts. This page only loads
 * the facts (logins, bookings, subscription, invoices, setup) and draws them,
 * in the same layout as the other list pages: header, search with the filter
 * toggle, stat cards whose other face is the filter panel, then the table.
 *
 * Not to be confused with the old "Tenant Health Score" removed in 1a72736b:
 * that one scored audit-log activity drops in a nightly job and emailed. This
 * one is worked out on page load from tables the platform already keeps, and
 * sends nothing.
 *
 * Test tenants and suspended companies are left out — scoring them is noise.
 */

import { EmptyState, NoMatchState } from '@/components/admin/empty-state';
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

import { cn } from '@/lib/utils';
import { FilterChip, FilterSearch, FilterSection, FilterShell } from '@/components/admin/filter-primitives';
import { OverviewFlip } from '@/components/admin/overview-flip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LogEntry, LogList, LogRailCard, LogRailLayout } from './log-rail';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BAND_THRESHOLDS, scoreBuckets, type HealthBand } from '@/lib/customer-health/score';
import { loadScoredTenants, type ScoredTenant } from '@/lib/customer-health/load';
import { BAND, BandChip, HealthBreakdown } from '@/components/admin/customer-management/health-parts';

type Scored = ScoredTenant;

function ScoreBar({ score, band }: { score: number; band: HealthBand }) {
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full', BAND[band].dot)} style={{ width: `${score}%` }} />
    </div>
  );
}

export function CustomerHealthTab() {
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
      const scored = (await loadScoredTenants())
        .filter((r) => r.tenant.tenant_type !== 'test' && r.tenant.status === 'active')
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

  // The read-only record is the right-hand column (log-rail.tsx).
  const rail = (
    error ? null : (
      <LogRailCard title="Companies" description="Worst first. Click one for the breakdown behind its score.">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <NoMatchState size="section" noun="companies" />
        ) : (
          <LogList>
            {filtered.map((r) => {
              const h = r.health;
              return (
                <LogEntry
                  key={r.tenant.id}
                  onOpen={() => setSelected(r)}
                  who={r.tenant.company_name ?? r.tenant.slug ?? '—'}
                  status={<BandChip band={h.band} score={h.score} />}
                  what={
                    <span className="flex items-center gap-2">
                      <ScoreBar score={h.score} band={h.band} />
                      {h.ageDays < 14 && <span className="text-muted-foreground">New · signed up {h.ageDays}d ago</span>}
                    </span>
                  }
                  when={
                    <>
                      <span className={cn(h.parts.logins.concern && 'text-destructive')}>
                        Last login{' '}
                        {h.daysSinceLogin === null ? 'over 90 days ago' : h.daysSinceLogin === 0 ? 'today' : `${h.daysSinceLogin}d ago`}
                      </span>
                      <span className={cn('tabular-nums', h.parts.bookings.concern && 'text-destructive')}>
                        {h.bookingsLast30Days} booking{h.bookingsLast30Days === 1 ? '' : 's'} (30d)
                      </span>
                    </>
                  }
                  detail={
                    <>
                      <span className={cn(h.parts.payment.concern && 'text-destructive')}>{h.parts.payment.label}</span>
                      {' · '}
                      <span className={h.stripeConnected ? 'text-emerald-600' : undefined}>Stripe</span>
                      {' · '}
                      <span className={h.bonzahFormSent ? 'text-emerald-600' : undefined}>Bonzah</span>
                    </>
                  }
                />
              );
            })}
          </LogList>
        )}
      </LogRailCard>
    )
  );

  return (
    <LogRailLayout label="Companies" rail={rail}>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
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
          className="gap-1.5 max-sm:-ml-3 max-sm:self-start"
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
        scopeLabel="Health score"
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
              <div className="grid grid-cols-3 gap-2 sm:gap-4">
                {statCards.map(({ band, title, icon: Icon, iconBg, iconText, active }) => (
                  <Card
                    key={band}
                    className={cn('cursor-pointer transition-all', bandFilter === band && active)}
                    onClick={() => setBandFilter(bandFilter === band ? 'all' : band)}
                  >
                    <CardContent className="pt-6 max-md:p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm text-muted-foreground max-md:text-xs">{title}</p>
                          {loading ? (
                            <Skeleton className="mt-1 h-8 w-10" />
                          ) : (
                            <p className="text-2xl font-bold tabular-nums">{counts[band]}</p>
                          )}
                        </div>
                        {/* Three across on a phone: the band name and count carry it, the icon goes. */}
                        <div className={cn('flex items-center justify-center h-10 w-10 shrink-0 rounded-lg max-md:hidden', iconBg)}>
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
                <HealthBreakdown health={selected.health} />

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
    </LogRailLayout>
  );
}
