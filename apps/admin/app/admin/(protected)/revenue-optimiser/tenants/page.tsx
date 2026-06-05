/**
 * /admin/revenue-optimiser/tenants — list every tenant currently using Revenue
 * Optimiser (any mode + enabled=true). Click a row to drill into per-tenant
 * performance metrics.
 */
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface TenantRow {
  tenant_id: string;
  company_name: string | null;
  slug: string | null;
  mode: string;
  calibration_complete: boolean;
  pending_count: number;
  applied_30d: number;
  positive_outcomes_90d: number;
  total_outcomes_90d: number;
  net_uplift_90d: number;
}

export default function TenantsPage() {
  const query = useQuery({
    queryKey: ['ro-tenant-perf'],
    queryFn: async (): Promise<TenantRow[]> => {
      const { data: settingsRaw } = await supabase
        .from('revenue_optimiser_settings')
        .select('tenant_id, mode, calibration_complete')
        .eq('enabled', true);
      const settings = (settingsRaw ?? []) as Array<{ tenant_id: string; mode: string; calibration_complete: boolean }>;
      if (settings.length === 0) return [];

      const tenantIds = settings.map((s) => s.tenant_id);
      const { data: tenantsRaw } = await supabase
        .from('tenants')
        .select('id, company_name, slug')
        .in('id', tenantIds);
      const tenantMap = new Map<string, { company_name: string | null; slug: string | null }>(
        ((tenantsRaw ?? []) as Array<{ id: string; company_name: string | null; slug: string | null }>)
          .map((t) => [t.id, { company_name: t.company_name, slug: t.slug }]),
      );

      // Pull pending counts in parallel via per-tenant queries
      const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();

      const rows = await Promise.all(settings.map(async (s) => {
        const [pending, applied, outcomes] = await Promise.all([
          supabase.from('pricing_recommendations')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', s.tenant_id).eq('status', 'pending'),
          supabase.from('pricing_recommendations')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', s.tenant_id).eq('status', 'applied').gte('applied_at', since30),
          supabase.from('pricing_recommendation_outcomes')
            .select('outcome, net_revenue_delta')
            .eq('tenant_id', s.tenant_id).gte('measured_at', since90),
        ]);
        const outRows = (outcomes.data ?? []) as Array<{ outcome: string; net_revenue_delta: number | null }>;
        return {
          tenant_id: s.tenant_id,
          company_name: tenantMap.get(s.tenant_id)?.company_name ?? null,
          slug: tenantMap.get(s.tenant_id)?.slug ?? null,
          mode: s.mode,
          calibration_complete: s.calibration_complete,
          pending_count: Number(pending.count ?? 0),
          applied_30d: Number(applied.count ?? 0),
          positive_outcomes_90d: outRows.filter((o) => o.outcome === 'positive').length,
          total_outcomes_90d: outRows.length,
          net_uplift_90d: outRows.reduce((acc, o) => acc + Number(o.net_revenue_delta ?? 0), 0),
        };
      }));
      return rows;
    },
  });

  if (query.isLoading) {
    return <div className="p-6 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }

  const rows = query.data ?? [];

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Revenue Optimiser · Tenant Performance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-tenant pipeline + 90d measured outcomes. Click a row for the full breakdown.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-medium">No tenants have enabled Revenue Optimiser yet.</h3>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.tenant_id}>
              <Link href={`/admin/revenue-optimiser/tenants/${r.tenant_id}`}>
                <Card className="transition-colors hover:border-indigo-300">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base font-medium">{r.company_name ?? r.slug ?? r.tenant_id.slice(0, 8)}</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant={r.mode === 'autopilot' ? 'default' : 'secondary'}>{r.mode}</Badge>
                        {!r.calibration_complete && <Badge variant="outline" className="bg-amber-50 text-amber-700">calibrating</Badge>}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
                      <Metric label="Pending recs" value={r.pending_count.toString()} />
                      <Metric label="Applied (30d)" value={r.applied_30d.toString()} />
                      <Metric
                        label="Positive outcomes (90d)"
                        value={r.total_outcomes_90d > 0 ? `${r.positive_outcomes_90d}/${r.total_outcomes_90d}` : '0/0'}
                        subtext={r.total_outcomes_90d > 0 ? `${Math.round(r.positive_outcomes_90d / r.total_outcomes_90d * 100)}%` : undefined}
                      />
                      <Metric
                        label="Net uplift (90d)"
                        value={`${r.net_uplift_90d >= 0 ? '+' : ''}$${Math.round(r.net_uplift_90d).toLocaleString()}`}
                        tone={r.net_uplift_90d >= 0 ? 'positive' : 'negative'}
                      />
                    </dl>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Metric({
  label, value, subtext, tone,
}: { label: string; value: string; subtext?: string; tone?: 'positive' | 'negative' }) {
  const color = tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-red-600' : 'text-foreground';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-medium tabular-nums ${color}`}>{value}</div>
      {subtext && <div className="text-[10px] text-muted-foreground">{subtext}</div>}
    </div>
  );
}
