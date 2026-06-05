/**
 * Revenue Optimiser — printable backtest report (Spec §6 Journey E, §19 Phase 0 acceptance).
 *
 * "The output is a shareable PDF (auto-generated)" — we render a clean HTML
 * layout sized for A4 print; the viewer uses browser File → Save as PDF, or
 * the in-page button which triggers window.print().
 *
 * Sales asset: super-admin opens the report from the tenant detail page,
 * prints to PDF, emails to the prospect.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Printer, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

interface BacktestRow {
  id: string;
  tenant_id: string;
  period_start: string;
  period_end: string;
  actual_revenue: number;
  projected_revenue: number;
  uplift_percent: number;
  uplift_amount: number;
  vehicles_analysed: number;
  bookings_analysed: number;
  confidence: string;
  generated_at: string;
  per_vehicle_summary: {
    narrative?: string;
    cap_applied?: boolean;
    total_fleet_size?: number;
    rows?: Array<{ vehicle_id: string; reg: string; make: string; model: string; actual: number; projected: number; bookings: number }>;
  } | null;
  monthly_breakdown: Array<{ month: string; actual: number; projected: number }> | null;
}

interface TenantRow {
  id: string;
  company_name: string | null;
  slug: string | null;
  logo_url: string | null;
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const confidenceMeta: Record<string, { color: string; label: string }> = {
  high: { color: '#16a34a', label: 'High' },
  medium: { color: '#d97706', label: 'Medium' },
  low: { color: '#737373', label: 'Low' },
};

export default function BacktestReportPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [report, setReport] = useState<BacktestRow | null>(null);
  const [tenant, setTenant] = useState<TenantRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: r, error: rErr } = await supabase
          .from('backtest_results')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (rErr) throw rErr;
        if (!r) throw new Error('Backtest report not found');
        if (cancelled) return;
        setReport(r as BacktestRow);
        const { data: t } = await supabase
          .from('tenants')
          .select('id, company_name, slug, logo_url')
          .eq('id', (r as BacktestRow).tenant_id)
          .maybeSingle();
        if (cancelled) return;
        setTenant((t as TenantRow | null) ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <main className="p-12 text-sm text-zinc-500">Loading report…</main>;
  if (error) return <main className="p-12 text-sm text-red-600">{error}</main>;
  if (!report) return null;

  const narrative = report.per_vehicle_summary?.narrative ?? '';
  const perVehicle = report.per_vehicle_summary?.rows ?? [];
  const months = report.monthly_breakdown ?? [];
  const maxMonthBar = Math.max(1, ...months.flatMap((m) => [m.actual, m.projected]));
  const conf = confidenceMeta[report.confidence] ?? confidenceMeta.low;

  return (
    <>
      {/* Print-specific styling: hide controls, A4 margins, clean colors.
          Plain <style> tag avoids styled-jsx dep; dangerouslySetInnerHTML is
          intentional here — we're injecting a tiny static CSS string. */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .report-page { box-shadow: none !important; margin: 0 !important; max-width: none !important; }
        }
        @page { size: A4; margin: 14mm; }
      ` }} />

      {/* Top toolbar — not printed */}
      <div className="no-print sticky top-0 z-10 bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="text-sm text-zinc-600">Backtest report · {tenant?.company_name ?? '—'}</div>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-3.5 w-3.5" /> Print / Save as PDF
        </Button>
      </div>

      <main className="report-page mx-auto my-6 max-w-[820px] bg-white p-10 shadow-sm">
        {/* Header */}
        <header className="border-b pb-4 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-indigo-600 font-semibold">
                Drive247 · Revenue Optimiser
              </div>
              <h1 className="mt-1 text-3xl font-semibold text-zinc-900">Backtest Report</h1>
              <div className="mt-2 text-sm text-zinc-600">
                {tenant?.company_name ?? 'Tenant'} · {report.vehicles_analysed} vehicles ·{' '}
                Period {report.period_start} → {report.period_end}
              </div>
            </div>
            <div className="text-right text-xs text-zinc-500">
              Generated {new Date(report.generated_at).toLocaleString()}
            </div>
          </div>
        </header>

        {/* Narrative */}
        {narrative && (
          <section className="mb-6 rounded border-l-4 border-indigo-500 bg-indigo-50/40 p-4">
            <p className="text-[15px] leading-relaxed text-zinc-800">{narrative}</p>
          </section>
        )}

        {/* KPI grid */}
        <section className="mb-8 grid grid-cols-4 gap-4">
          <div className="rounded border p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Projected lift</div>
            <div className="mt-1 text-3xl font-semibold text-emerald-600 tabular-nums">+{report.uplift_percent}%</div>
            <div className="mt-1 text-xs text-zinc-600 tabular-nums">{fmtMoney(report.uplift_amount)}</div>
          </div>
          <div className="rounded border p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Actual revenue</div>
            <div className="mt-1 text-xl font-medium tabular-nums">{fmtMoney(report.actual_revenue)}</div>
            <div className="mt-1 text-xs text-zinc-500">What you earned</div>
          </div>
          <div className="rounded border p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Projected revenue</div>
            <div className="mt-1 text-xl font-medium tabular-nums">{fmtMoney(report.projected_revenue)}</div>
            <div className="mt-1 text-xs text-zinc-500">What you could have earned</div>
          </div>
          <div className="rounded border p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Confidence</div>
            <div className="mt-1 text-xl font-medium" style={{ color: conf.color }}>{conf.label}</div>
            <div className="mt-1 text-xs text-zinc-500">Based on {report.bookings_analysed} bookings</div>
          </div>
        </section>

        {/* Monthly breakdown */}
        {months.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 mb-3">
              Revenue by month — actual vs. projected
            </h2>
            <div className="space-y-2">
              {months.map((m) => (
                <div key={m.month}>
                  <div className="flex items-center justify-between text-xs text-zinc-600 mb-1">
                    <span>{m.month}</span>
                    <span className="tabular-nums">
                      {fmtMoney(m.actual)} → <span className="text-emerald-700 font-medium">{fmtMoney(m.projected)}</span>
                    </span>
                  </div>
                  <div className="relative h-6 bg-zinc-100 rounded overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-zinc-300" style={{ width: `${(m.actual / maxMonthBar) * 100}%` }} />
                    <div className="absolute inset-y-0 left-0 border-r-2 border-emerald-600" style={{ width: `${(m.projected / maxMonthBar) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-4 text-[11px] text-zinc-500">
              <span><span className="inline-block w-3 h-3 bg-zinc-300 align-middle mr-1" />Actual</span>
              <span><span className="inline-block w-3 h-3 border-2 border-emerald-600 align-middle mr-1" />Projected with Revenue Optimiser</span>
            </div>
          </section>
        )}

        {/* Per-vehicle table */}
        {perVehicle.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 mb-3">
              Top vehicles by projected lift
            </h2>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-zinc-300 text-left text-xs text-zinc-600">
                  <th className="py-2 font-medium">Vehicle</th>
                  <th className="py-2 font-medium text-right">Bookings</th>
                  <th className="py-2 font-medium text-right">Actual</th>
                  <th className="py-2 font-medium text-right">Projected</th>
                  <th className="py-2 font-medium text-right">Lift</th>
                </tr>
              </thead>
              <tbody>
                {perVehicle.slice(0, 15).map((v) => {
                  const lift = v.projected - v.actual;
                  const liftPct = v.actual > 0 ? (lift / v.actual) * 100 : 0;
                  return (
                    <tr key={v.vehicle_id} className="border-b border-zinc-100">
                      <td className="py-2">
                        <div className="text-zinc-900">{v.make} {v.model}</div>
                        <div className="text-xs text-zinc-500">{v.reg}</div>
                      </td>
                      <td className="py-2 text-right tabular-nums text-zinc-600">{v.bookings}</td>
                      <td className="py-2 text-right tabular-nums">{fmtMoney(v.actual)}</td>
                      <td className="py-2 text-right tabular-nums text-emerald-700">{fmtMoney(v.projected)}</td>
                      <td className="py-2 text-right tabular-nums font-medium text-emerald-700">
                        {lift > 0 ? '+' : ''}{fmtMoney(lift)}
                        <span className="ml-1 text-xs text-zinc-500">({liftPct > 0 ? '+' : ''}{Math.round(liftPct * 10) / 10}%)</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {perVehicle.length > 15 && (
              <p className="mt-2 text-xs text-zinc-500">… plus {perVehicle.length - 15} more vehicles</p>
            )}
          </section>
        )}

        {/* Caveats — required by spec §6 Journey E */}
        <section className="mt-10 rounded border border-amber-200 bg-amber-50/40 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-zinc-700 space-y-1">
              <p className="font-medium">Caveats</p>
              <ul className="list-disc ml-5 space-y-0.5">
                <li>Backtest assumes historical demand patterns; actual results depend on market conditions and how often you apply recommendations.</li>
                <li>Projected revenue uses the current vehicle price as the baseline. If you changed prices during this period, the projection may over- or under-estimate.</li>
                <li>Vehicles with fewer than 60 days of history are excluded from this estimate.</li>
                {report.per_vehicle_summary?.cap_applied && (
                  <li>This tenant has {report.per_vehicle_summary.total_fleet_size} usable vehicles; analysis was capped at the first 500 to keep generation under 60s. Re-run for the long tail separately.</li>
                )}
                <li>Confidence: <span className="font-medium capitalize" style={{ color: conf.color }}>{report.confidence}</span> · Based on {report.bookings_analysed} bookings across {report.vehicles_analysed} vehicles.</li>
              </ul>
            </div>
          </div>
        </section>

        <footer className="mt-10 pt-4 border-t text-center text-[10px] text-zinc-400">
          Drive247 · Revenue Optimiser · Generated {new Date(report.generated_at).toISOString().slice(0, 10)} · Report ID {report.id.slice(0, 8)}
        </footer>
      </main>
    </>
  );
}
