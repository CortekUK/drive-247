/**
 * /admin/revenue-optimiser/tenants/[id] — Per-tenant Revenue Optimiser dashboard.
 *
 * Spec §15 surface for super-admin observability of one tenant:
 *   - Mode + calibration status
 *   - Apply rate, positive outcome %, measured uplift (90d)
 *   - OpenAI cost over the last 30 days
 *   - Last anomaly + count of open anomalies
 *   - Recent applied recommendations table
 *   - Currently-running A/B experiments
 */
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Activity, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export default function TenantPerfPage() {
  const params = useParams();
  const tenantId = params.id as string;

  const query = useQuery({
    queryKey: ['ro-tenant-detail', tenantId],
    queryFn: async () => {
      const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();

      const [tenant, settings, applied30, dismissed30, outcomes90, openai30, anomalies, recentApplied, experiments] = await Promise.all([
        supabase.from('tenants').select('id, company_name, slug, contact_email, admin_email').eq('id', tenantId).maybeSingle(),
        supabase.from('revenue_optimiser_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('pricing_recommendations').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('status', 'applied').gte('applied_at', since30),
        supabase.from('pricing_recommendations').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('status', 'dismissed').gte('dismissed_at', since30),
        supabase.from('pricing_recommendation_outcomes').select('outcome, net_revenue_delta, measured_at')
          .eq('tenant_id', tenantId).gte('measured_at', since90),
        supabase.from('openai_usage_logs').select('total_cost_usd').eq('tenant_id', tenantId)
          .ilike('function_name', 'revenue-optimiser%').gte('created_at', since30),
        supabase.from('revenue_optimiser_anomalies').select('id, status, anomaly_type, summary, created_at, severity')
          .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(20),
        supabase.from('pricing_recommendations')
          .select('id, vehicle_id, tier, current_price, applied_price, applied_source, applied_at, status, vehicle:vehicles(reg, make, model)')
          .eq('tenant_id', tenantId).eq('status', 'applied').order('applied_at', { ascending: false }).limit(15),
        supabase.from('pricing_experiments').select('*').eq('tenant_id', tenantId).order('started_at', { ascending: false }).limit(10),
      ]);

      const outRows = (outcomes90.data ?? []) as Array<{ outcome: string; net_revenue_delta: number | null }>;
      const positive = outRows.filter((o) => o.outcome === 'positive').length;
      const negative = outRows.filter((o) => o.outcome === 'negative').length;
      const netUplift = outRows.reduce((s, o) => s + Number(o.net_revenue_delta ?? 0), 0);
      const openAiCost = ((openai30.data ?? []) as Array<{ total_cost_usd: number | null }>)
        .reduce((s, x) => s + Number(x.total_cost_usd ?? 0), 0);

      const anomalyRows = (anomalies.data ?? []) as Array<{ id: string; status: string; anomaly_type: string; summary: string; created_at: string; severity: string }>;
      return {
        tenant: tenant.data as { id: string; company_name: string | null; slug: string | null; contact_email: string | null; admin_email: string | null } | null,
        settings: settings.data,
        applied30: Number(applied30.count ?? 0),
        dismissed30: Number(dismissed30.count ?? 0),
        positive,
        negative,
        outcomesTotal: outRows.length,
        netUplift,
        openAiCost,
        openAnomalies: anomalyRows.filter((a) => a.status === 'open').length,
        latestAnomaly: anomalyRows[0] ?? null,
        anomalyHistory: anomalyRows,
        recentApplied: recentApplied.data ?? [],
        experiments: experiments.data ?? [],
      };
    },
    enabled: !!tenantId,
  });

  if (query.isLoading) {
    return <div className="p-6 space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }
  if (query.isError || !query.data?.tenant) {
    return <main className="p-6 text-sm text-muted-foreground">Tenant not found.</main>;
  }

  const d = query.data;
  const settings = d.settings as { mode?: string; enabled?: boolean; calibration_complete?: boolean; max_swing_percent?: number; require_approval_above_amount?: number | null } | null;
  const applyRate = (d.applied30 + d.dismissed30) > 0 ? d.applied30 / (d.applied30 + d.dismissed30) : null;
  const positivePct = d.outcomesTotal > 0 ? d.positive / d.outcomesTotal : null;

  return (
    <main className="p-6">
      <Link href="/admin/revenue-optimiser/tenants" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Back to tenants
      </Link>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{d.tenant?.company_name ?? d.tenant?.slug ?? tenantId.slice(0, 8)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{d.tenant?.admin_email ?? d.tenant?.contact_email ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={settings?.mode === 'autopilot' ? 'default' : 'secondary'}>{settings?.mode ?? 'disabled'}</Badge>
          {settings?.calibration_complete ? (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700">calibrated</Badge>
          ) : (
            <Badge variant="outline" className="bg-amber-50 text-amber-700">calibrating</Badge>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Apply rate (30d)"
          value={applyRate !== null ? `${Math.round(applyRate * 100)}%` : '—'}
          subtext={`${d.applied30} applied · ${d.dismissed30} dismissed`}
        />
        <KpiCard
          label="Positive outcomes (90d)"
          value={positivePct !== null ? `${Math.round(positivePct * 100)}%` : '—'}
          subtext={`${d.positive} / ${d.outcomesTotal}`}
          tone={positivePct !== null && positivePct >= 0.6 ? 'positive' : positivePct !== null && positivePct < 0.4 ? 'negative' : undefined}
        />
        <KpiCard
          label="Net uplift (90d)"
          value={`${d.netUplift >= 0 ? '+' : ''}${fmtMoney(d.netUplift)}`}
          tone={d.netUplift >= 0 ? 'positive' : 'negative'}
        />
        <KpiCard
          label="OpenAI cost (30d)"
          value={fmtMoney(d.openAiCost)}
          subtext={`Open anomalies: ${d.openAnomalies}`}
          tone={d.openAnomalies > 0 ? 'warning' : undefined}
        />
      </div>

      {/* Latest anomaly + history */}
      {d.latestAnomaly && (
        <Card className="mt-4 border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Latest anomaly
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>{d.latestAnomaly.summary}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {new Date(d.latestAnomaly.created_at).toLocaleString()} · severity {d.latestAnomaly.severity} · {d.latestAnomaly.status}
            </p>
            <Link href="/admin/revenue-optimiser/anomalies" className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline">
              All anomalies <ExternalLink className="h-3 w-3" />
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Recently applied */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-sm">Recently applied recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          {d.recentApplied.length === 0 ? (
            <p className="text-xs text-muted-foreground">None in this window.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {(d.recentApplied as unknown as Array<{
                id: string; vehicle_id: string; tier: string; current_price: number; applied_price: number | null;
                applied_source: string | null; applied_at: string | null; status: string;
                vehicle: { reg: string | null; make: string | null; model: string | null } | null;
              }>).map((rec) => (
                <li key={rec.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm">
                      {[rec.vehicle?.make, rec.vehicle?.model].filter(Boolean).join(' ') || 'Vehicle'}
                      {rec.vehicle?.reg ? ` · ${rec.vehicle.reg}` : ''}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {rec.tier} · {rec.applied_at ? new Date(rec.applied_at).toLocaleDateString() : '—'} · {rec.applied_source ?? 'manual'}
                    </div>
                  </div>
                  <div className="text-right text-sm tabular-nums">
                    {fmtMoney(rec.current_price)} → {fmtMoney(rec.applied_price ?? 0)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* A/B experiments */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-3.5 w-3.5" /> A/B experiments</CardTitle>
        </CardHeader>
        <CardContent>
          {d.experiments.length === 0 ? (
            <p className="text-xs text-muted-foreground">No experiments yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {(d.experiments as unknown as Array<{ id: string; tier: string; control_price: number; test_price: number; control_bookings: number | null; test_bookings: number | null; status: string; winner: string | null; started_at: string; ends_at: string }>).map((exp) => (
                <li key={exp.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <div className="text-sm">{exp.tier} · {fmtMoney(exp.control_price)} vs {fmtMoney(exp.test_price)}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(exp.started_at).toLocaleDateString()} → {new Date(exp.ends_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-right text-[11px]">
                    <Badge variant={exp.status === 'running' ? 'default' : 'outline'}>{exp.status}</Badge>
                    {exp.winner && <span className="ml-1 text-muted-foreground">winner: {exp.winner}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function KpiCard({
  label, value, subtext, tone,
}: { label: string; value: string; subtext?: string; tone?: 'positive' | 'negative' | 'warning' }) {
  const color = tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-foreground';
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-xl font-medium tabular-nums ${color}`}>{value}</div>
        {subtext && <div className="text-[10px] text-muted-foreground">{subtext}</div>}
      </CardContent>
    </Card>
  );
}
