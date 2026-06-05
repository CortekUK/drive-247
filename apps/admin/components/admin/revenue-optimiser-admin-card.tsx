/**
 * Revenue Optimiser — super-admin trigger card (Spec §6 Journey E, Phase 0).
 *
 * Super admins can run a backtest for any tenant on-demand from the tenant
 * detail page. Phase 0 has no tenant-facing UI yet; this is the only entry
 * point for proving the engine works on real data before Phase 1 ships.
 */
'use client';

import { useEffect, useState } from 'react';
import { Loader2, PlayCircle, RefreshCw, FileText } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/sonner';
import { supabase } from '@/lib/supabase';

interface BacktestRow {
  id: string;
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
}

interface Props {
  tenantId: string;
}

export function RevenueOptimiserAdminCard({ tenantId }: Props) {
  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState<BacktestRow | null>(null);
  const [loading, setLoading] = useState(true);

  const loadLatest = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('backtest_results')
      .select('id, period_start, period_end, actual_revenue, projected_revenue, uplift_percent, uplift_amount, vehicles_analysed, bookings_analysed, confidence, generated_at')
      .eq('tenant_id', tenantId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setLatest((data as BacktestRow | null) ?? null);
    setLoading(false);
  };

  useEffect(() => { loadLatest(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);

  const runBacktest = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('revenue-optimiser-backtest', {
        body: { tenantId },
      });
      if (error) {
        const ctx = (error as { context?: { response?: Response } }).context;
        if (ctx?.response) {
          const parsed = await ctx.response.clone().json().catch(() => null);
          const msg = parsed && typeof parsed === 'object' && 'error' in parsed
            ? String((parsed as { error: string }).error) : null;
          if (msg) throw new Error(msg);
        }
        throw error;
      }
      toast.success(`Backtest complete — ${(data as { uplift_percent?: number })?.uplift_percent ?? 0}% projected uplift`);
      await loadLatest();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setRunning(false);
    }
  };

  const fmtMoney = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  const confidenceColor = latest?.confidence === 'high' ? 'bg-emerald-500' : latest?.confidence === 'medium' ? 'bg-amber-500' : 'bg-zinc-400';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Revenue Optimiser — Backtest</CardTitle>
        <CardDescription>
          Replay the last 6 months of this tenant&apos;s bookings against what the elasticity engine would have recommended.
          Use this as the sales proof point: &quot;On your own bookings, RO would have added $X in 6 months.&quot;
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Button onClick={runBacktest} disabled={running}>
            {running ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running (~30s)…</>
            ) : (
              <><PlayCircle className="mr-2 h-4 w-4" /> {latest ? 'Re-run backtest' : 'Run backtest'}</>
            )}
          </Button>
          {latest && (
            <Button variant="outline" asChild>
              <Link href={`/admin/backtest-report/${latest.id}`} target="_blank">
                <FileText className="mr-2 h-4 w-4" /> Open report (PDF-ready)
              </Link>
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={loadLatest} disabled={loading}>
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading latest backtest…</p>
        ) : !latest ? (
          <p className="text-sm text-muted-foreground">No backtest run yet for this tenant.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 rounded-md border p-4 bg-muted/30">
            <div>
              <div className="text-xs text-muted-foreground">Projected uplift</div>
              <div className="text-2xl font-semibold tabular-nums">+{latest.uplift_percent}%</div>
              <div className="text-xs text-muted-foreground">{fmtMoney(latest.uplift_amount)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Actual revenue</div>
              <div className="text-base font-medium tabular-nums">{fmtMoney(latest.actual_revenue)}</div>
              <div className="text-xs text-muted-foreground">Projected: {fmtMoney(latest.projected_revenue)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Period</div>
              <div className="text-sm">{latest.period_start} → {latest.period_end}</div>
              <div className="text-xs text-muted-foreground">{latest.vehicles_analysed} vehicles · {latest.bookings_analysed} bookings</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Confidence</div>
              <Badge className={`${confidenceColor} text-white capitalize`}>{latest.confidence}</Badge>
              <div className="text-xs text-muted-foreground mt-1">
                Generated {new Date(latest.generated_at).toLocaleString()}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
