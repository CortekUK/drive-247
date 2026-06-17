'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Activity,
  Search,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
  X,
} from 'lucide-react';

type Severity = 'ok' | 'warning' | 'critical';

interface RentalRow {
  id: string;
  rental_number: string | null;
  status: string | null;
  payment_status: string | null;
  source: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  health_severity: Severity | null;
  creation_context: any;
  tenant: { id: string; company_name: string | null; slug: string | null; tenant_type: string | null } | null;
  customer: { name: string | null; email: string | null } | null;
  vehicle: { make: string | null; model: string | null; year: number | null; reg: string | null } | null;
}

const SEV: Record<Severity, { label: string; dot: string; text: string; chipBg: string }> = {
  critical: { label: 'Critical', dot: 'bg-red-500', text: 'text-red-400', chipBg: 'bg-destructive/15 border-destructive/30' },
  warning: { label: 'Warning', dot: 'bg-amber-500', text: 'text-amber-400', chipBg: 'bg-warning/15 border-warning/30' },
  ok: { label: 'Live', dot: 'bg-emerald-500', text: 'text-emerald-400', chipBg: 'bg-success/15 border-success/30' },
};

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return d; }
}

function vehicleName(v: RentalRow['vehicle']) {
  if (!v) return '—';
  return [v.year, v.make, v.model].filter(Boolean).join(' ') || '—';
}

export default function PlatformRentalsPage() {
  const [rows, setRows] = useState<RentalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tenantFilter, setTenantFilter] = useState<string>('all');
  const [sevFilter, setSevFilter] = useState<Severity | 'all'>('all');
  const [selected, setSelected] = useState<RentalRow | null>(null);

  const load = async () => {
    const { data, error } = await (supabase as any)
      .from('rentals')
      .select(`
        id, rental_number, status, payment_status, source,
        start_date, end_date, created_at, health_severity, creation_context,
        tenant:tenants ( id, company_name, slug, tenant_type ),
        customer:customers ( name, email ),
        vehicle:vehicles ( make, model, year, reg )
      `)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (!error) {
      // exclude test tenants from platform monitoring
      const live = ((data ?? []) as RentalRow[]).filter((r) => r.tenant?.tenant_type !== 'test');
      setRows(live);
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    load();
    // pre-fill search from the ?ref= deep link used in verdict emails
    if (typeof window !== 'undefined') {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref) setSearchQuery(ref);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tenants = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => {
      if (r.tenant?.id) map.set(r.tenant.id, r.tenant.company_name ?? r.tenant.slug ?? r.tenant.id);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, ok: 0 };
    rows.forEach((r) => { c[(r.health_severity ?? 'ok')] += 1; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (tenantFilter !== 'all' && r.tenant?.id !== tenantFilter) return false;
      if (sevFilter !== 'all' && (r.health_severity ?? 'ok') !== sevFilter) return false;
      if (!q) return true;
      return (
        r.rental_number?.toLowerCase().includes(q) ||
        r.customer?.name?.toLowerCase().includes(q) ||
        r.customer?.email?.toLowerCase().includes(q) ||
        r.tenant?.company_name?.toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery, tenantFilter, sevFilter]);

  const reasons: string[] = Array.isArray(selected?.creation_context?.reasons)
    ? selected!.creation_context.reasons
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Platform Rentals</h1>
            <p className="text-sm text-muted-foreground">
              Every rental ever created across all tenants ·{' '}
              <span className="tabular-nums">{rows.length}</span> all-time
              {counts.critical > 0 && (
                <span className="text-destructive"> · {counts.critical} critical</span>
              )}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => { setRefreshing(true); load(); }}
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card
          className={cn('cursor-pointer transition-all', sevFilter === 'critical' && 'border-destructive/40 bg-destructive/5')}
          onClick={() => setSevFilter(sevFilter === 'critical' ? 'all' : 'critical')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Critical</p>
                <p className="text-2xl font-bold tabular-nums">{counts.critical}</p>
              </div>
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-destructive/15">
                <AlertOctagon className="h-5 w-5 text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={cn('cursor-pointer transition-all', sevFilter === 'warning' && 'border-warning/40 bg-warning/5')}
          onClick={() => setSevFilter(sevFilter === 'warning' ? 'all' : 'warning')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Warning</p>
                <p className="text-2xl font-bold tabular-nums">{counts.warning}</p>
              </div>
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-warning/15">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={cn('cursor-pointer transition-all', sevFilter === 'ok' && 'border-success/40 bg-success/5')}
          onClick={() => setSevFilter(sevFilter === 'ok' ? 'all' : 'ok')}
        >
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">All live</p>
                <p className="text-2xl font-bold tabular-nums">{counts.ok}</p>
              </div>
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-success/15">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by rental ref, customer, or tenant..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={tenantFilter} onValueChange={setTenantFilter}>
              <SelectTrigger className="sm:w-56">
                <SelectValue placeholder="All tenants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tenants</SelectItem>
                {tenants.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(searchQuery || tenantFilter !== 'all' || sevFilter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => { setSearchQuery(''); setTenantFilter('all'); setSevFilter('all'); }}
              >
                <X className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Health</TableHead>
                <TableHead>Rental</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-6 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No rentals match.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => {
                  const sev = SEV[r.health_severity ?? 'ok'];
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(r)}
                    >
                      <TableCell>
                        <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold', sev.chipBg, sev.text)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', sev.dot)} />
                          {sev.label}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{r.rental_number ?? r.id.slice(0, 8)}</TableCell>
                      <TableCell>{r.tenant?.company_name ?? r.tenant?.slug ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{r.customer?.name ?? '—'}</span>
                          {r.customer?.email && (
                            <span className="text-xs text-muted-foreground">{r.customer.email}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{vehicleName(r.vehicle)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {fmtDate(r.start_date)} → {fmtDate(r.end_date)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                        {fmtDateTime(r.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail drawer */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold', SEV[selected.health_severity ?? 'ok'].chipBg, SEV[selected.health_severity ?? 'ok'].text)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', SEV[selected.health_severity ?? 'ok'].dot)} />
                    {SEV[selected.health_severity ?? 'ok'].label}
                  </span>
                  {selected.rental_number ?? selected.id.slice(0, 8)}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground">Tenant</span>
                  <span className="col-span-2 font-medium">{selected.tenant?.company_name ?? '—'}</span>
                  <span className="text-muted-foreground">Customer</span>
                  <span className="col-span-2">{selected.customer?.name ?? '—'}{selected.customer?.email ? ` · ${selected.customer.email}` : ''}</span>
                  <span className="text-muted-foreground">Vehicle</span>
                  <span className="col-span-2">{vehicleName(selected.vehicle)}{selected.vehicle?.reg ? ` · ${selected.vehicle.reg}` : ''}</span>
                  <span className="text-muted-foreground">Dates</span>
                  <span className="col-span-2">{fmtDate(selected.start_date)} → {fmtDate(selected.end_date)}</span>
                  <span className="text-muted-foreground">Status</span>
                  <span className="col-span-2">{selected.status ?? '—'}{selected.payment_status ? ` · payment ${selected.payment_status}` : ''}{selected.source ? ` · via ${selected.source}` : ''}</span>
                </div>

                {/* Reasons */}
                {reasons.length > 0 ? (
                  <div className={cn('rounded-lg border p-3', SEV[selected.health_severity ?? 'ok'].chipBg)}>
                    <p className={cn('text-xs font-bold uppercase tracking-wide mb-2', SEV[selected.health_severity ?? 'ok'].text)}>
                      Why this needs attention
                    </p>
                    <ul className="list-disc pl-4 space-y-1 text-foreground/80">
                      {reasons.map((x, i) => <li key={i}>{x}</li>)}
                    </ul>
                  </div>
                ) : (
                  <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-emerald-400 text-sm font-medium">
                    ✅ Every integration was live-ready at creation.
                  </div>
                )}

                {/* Integration snapshot */}
                {selected.creation_context && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
                      Integration snapshot at creation
                    </p>
                    <div className="space-y-1.5 text-xs">
                      {(['stripe', 'boldsign', 'bonzah', 'subscription'] as const).map((k) => {
                        const node = selected.creation_context?.[k] ?? {};
                        const ready = k === 'subscription' ? node.ok : node.live_ready;
                        return (
                          <div key={k} className="flex items-center justify-between">
                            <span className="capitalize text-muted-foreground">{k}</span>
                            <span className={cn('font-semibold', ready ? 'text-emerald-400' : 'text-red-400')}>
                              {ready ? 'live-ready' : (node.mode ?? node.tenant_mode ?? node.status ?? 'test')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selected.tenant?.id && (
                  <Link
                    href={`/admin/rentals/${selected.tenant.id}`}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    Open tenant <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
