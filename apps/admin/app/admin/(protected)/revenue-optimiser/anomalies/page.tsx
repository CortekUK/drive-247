/**
 * /admin/revenue-optimiser/anomalies — Phase 3 super-admin anomaly inbox.
 *
 * Lists rows from `revenue_optimiser_anomalies`. Acknowledge silences without
 * resolving; Resolve closes with optional notes. Suppress recommendation calls
 * `revenue-optimiser-suppress` edge fn for `large_swing` anomalies — that
 * marks the underlying recommendation as `suppressed_by_admin`.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Pause, Loader2, ExternalLink, ShieldOff, Eye,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

interface Anomaly {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  recommendation_id: string | null;
  anomaly_type: 'large_swing' | 'utilisation_drop' | 'apply_then_revert' | 'autopilot_paused_fleet' | 'autopilot_paused_vehicle';
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  details: Record<string, unknown> | null;
  status: 'open' | 'acknowledged' | 'resolved';
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
}

const SEVERITY_STYLE: Record<Anomaly['severity'], string> = {
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
};

const TYPE_LABEL: Record<Anomaly['anomaly_type'], string> = {
  large_swing: 'Large swing',
  utilisation_drop: 'Utilisation drop',
  apply_then_revert: 'Apply → revert',
  autopilot_paused_fleet: 'Autopilot paused (fleet)',
  autopilot_paused_vehicle: 'Autopilot paused (vehicle)',
};

export default function AnomaliesPage() {
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | 'acknowledged' | 'resolved'>('open');
  const [typeFilter, setTypeFilter] = useState<'all' | Anomaly['anomaly_type']>('all');
  const [resolveAnomaly, setResolveAnomaly] = useState<Anomaly | null>(null);

  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['ro-anomalies', statusFilter, typeFilter],
    queryFn: async (): Promise<{ rows: Anomaly[]; tenants: Map<string, string> }> => {
      let q = supabase.from('revenue_optimiser_anomalies').select('*').order('created_at', { ascending: false }).limit(200);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (typeFilter !== 'all') q = q.eq('anomaly_type', typeFilter);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as Anomaly[];

      // Resolve tenant names in bulk
      const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];
      const tenants = new Map<string, string>();
      if (tenantIds.length > 0) {
        const { data: tRaw } = await supabase
          .from('tenants')
          .select('id, company_name, slug')
          .in('id', tenantIds);
        for (const t of (tRaw ?? []) as Array<{ id: string; company_name: string | null; slug: string | null }>) {
          tenants.set(t.id, t.company_name ?? t.slug ?? t.id);
        }
      }
      return { rows, tenants };
    },
  });

  const acknowledge = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('revenue_optimiser_anomalies')
        .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ro-anomalies'] }),
  });

  const resolve = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase
        .from('revenue_optimiser_anomalies')
        .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolution_notes: notes || null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ro-anomalies'] });
      setResolveAnomaly(null);
    },
  });

  const suppressRec = useMutation({
    mutationFn: async ({ recId, reason }: { recId: string; reason: string }) => {
      const { error } = await supabase.functions.invoke('revenue-optimiser-suppress', {
        body: { recommendationId: recId, reason },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ro-anomalies'] }),
  });

  const isLoading = query.isLoading;
  const rows = query.data?.rows ?? [];
  const tenants = query.data?.tenants ?? new Map<string, string>();

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Revenue Optimiser · Anomaly Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pricing anomalies surfaced by the 6-hourly anomaly-check cron. Acknowledge to silence,
          resolve to close out with notes.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="h-9 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
          <SelectTrigger className="h-9 w-[200px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All anomaly types</SelectItem>
            <SelectItem value="large_swing">Large swing</SelectItem>
            <SelectItem value="utilisation_drop">Utilisation drop</SelectItem>
            <SelectItem value="apply_then_revert">Apply → revert</SelectItem>
            <SelectItem value="autopilot_paused_fleet">Autopilot paused (fleet)</SelectItem>
            <SelectItem value="autopilot_paused_vehicle">Autopilot paused (vehicle)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <h3 className="mt-3 text-sm font-medium">No anomalies matching the current filters</h3>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              The anomaly-check cron runs every 6 hours. Anything caught will surface here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={a.id}>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={SEVERITY_STYLE[a.severity]}>
                        {a.severity}
                      </Badge>
                      <Badge variant="secondary">{TYPE_LABEL[a.anomaly_type]}</Badge>
                      <Badge variant="outline">
                        {tenants.get(a.tenant_id) ?? a.tenant_id.slice(0, 8)}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                      {a.status !== 'open' && (
                        <Badge variant="outline" className="bg-zinc-50 text-zinc-600">
                          {a.status}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <CardTitle className="mt-2 text-base font-medium leading-snug">
                    {a.summary}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {a.details && Object.keys(a.details).length > 0 && (
                    <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                      {Object.entries(a.details).map(([k, v]) => (
                        <div key={k} className="rounded border border-border bg-muted/30 px-2 py-1">
                          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{k}</div>
                          <div className="font-medium">{formatDetail(v)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {a.recommendation_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        asChild
                      >
                        <Link href={`/admin/rentals/${a.tenant_id}`}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> Open tenant
                        </Link>
                      </Button>
                    )}
                    {a.recommendation_id && a.anomaly_type === 'large_swing' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-50"
                        disabled={suppressRec.isPending}
                        onClick={() => {
                          const reason = window.prompt('Why are you suppressing this recommendation?', 'Bad data / model artefact');
                          if (reason !== null) suppressRec.mutate({ recId: a.recommendation_id!, reason });
                        }}
                      >
                        <ShieldOff className="mr-1 h-3.5 w-3.5" /> Suppress rec
                      </Button>
                    )}
                    {a.status === 'open' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={acknowledge.isPending}
                        onClick={() => acknowledge.mutate(a.id)}
                      >
                        <Pause className="mr-1 h-3.5 w-3.5" /> Acknowledge
                      </Button>
                    )}
                    {a.status !== 'resolved' && (
                      <Button
                        size="sm"
                        onClick={() => setResolveAnomaly(a)}
                        className="ml-auto"
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Resolve
                      </Button>
                    )}
                    {a.status === 'resolved' && a.resolution_notes && (
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        Notes: {a.resolution_notes}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ResolveDialog
        anomaly={resolveAnomaly}
        onClose={() => setResolveAnomaly(null)}
        onSubmit={(notes) => resolveAnomaly && resolve.mutate({ id: resolveAnomaly.id, notes })}
        isSubmitting={resolve.isPending}
      />
    </main>
  );
}

function ResolveDialog({
  anomaly, onClose, onSubmit, isSubmitting,
}: {
  anomaly: Anomaly | null;
  onClose: () => void;
  onSubmit: (notes: string) => void;
  isSubmitting: boolean;
}) {
  const [notes, setNotes] = useState('');
  if (!anomaly) return null;
  return (
    <Dialog open={!!anomaly} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Resolve anomaly</DialogTitle>
          <DialogDescription>{anomaly.summary}</DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Resolution notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 500))}
          rows={4}
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={() => onSubmit(notes)} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDetail(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toString() : v.toFixed(2);
  if (typeof v === 'string') return v.length > 24 ? `${v.slice(0, 24)}…` : v;
  return JSON.stringify(v);
}
