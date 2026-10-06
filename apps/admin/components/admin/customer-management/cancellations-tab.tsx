'use client';

/**
 * Customer Management → Cancellations: why operators leave, and who.
 *
 * Covers v1 and v2 operators alike — the reason sources are the same for both
 * (see lib/customer-management/cancellations.ts for who counts and where each
 * reason comes from). The headline is the brief's one-liner — "Last 3 months:
 * 40% too expensive, 25% never finished setup, 15% switched tools" — so the
 * first thing on the tab is what to fix first.
 *
 * Reads with the super admin's own session (RLS). The only write is a super
 * admin recording a reason for one company (`tenant_churn_reasons`), which
 * overrides every inferred one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, DoorOpen, Loader2, LogOut, PencilLine, RefreshCw, TrendingDown, UserMinus } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  headline,
  inPeriod,
  PERIOD_LABEL,
  REASON_LABEL,
  reasonShares,
  resolveChurn,
  SETTABLE_REASONS,
  SOURCE_LABEL,
  type ChurnOverride,
  type ChurnReason,
  type ChurnRequest,
  type ChurnRow,
  type ChurnSubscription,
  type ChurnTenant,
  type Period,
} from '@/lib/customer-management/cancellations';

const CANCELLATION_TYPE = 'subscription_cancellation';

/** One colour per reason, from the theme's chart tokens; "no reason" stays grey. */
const REASON_FILL: Record<ChurnReason, string> = {
  too_expensive: 'hsl(var(--chart-1))',
  never_finished_setup: 'hsl(var(--chart-2))',
  switched_tools: 'hsl(var(--chart-3))',
  missing_features: 'hsl(var(--chart-4))',
  not_using: 'hsl(var(--chart-5))',
  payment_failed: 'hsl(var(--destructive))',
  closing_business: 'hsl(var(--warning))',
  technical_problems: 'hsl(var(--primary))',
  other: 'hsl(var(--muted-foreground))',
  unknown: 'hsl(var(--border))',
};

function money(cents: number | null, currency = 'usd'): string {
  if (cents === null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function fmtDay(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** PostgREST caps a response; read in pages until a short one comes back. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

function group<T extends { tenant_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.tenant_id, [...(m.get(r.tenant_id) ?? []), r]);
  return m;
}

export function CancellationsTab({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<ChurnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [period, setPeriod] = useState<Period>('90');
  const [stateFilter, setStateFilter] = useState<'all' | 'left' | 'leaving'>('all');
  const [portalFilter, setPortalFilter] = useState<'all' | 'v1' | 'v2'>('all');
  const [reasonFilter, setReasonFilter] = useState<ChurnReason | null>(null);
  const [editing, setEditing] = useState<ChurnRow | null>(null);

  const load = useCallback(async () => {
    try {
      const db = supabase as any;
      const [tenants, subs, requests, overrides, invoices] = await Promise.all([
        fetchAll<ChurnTenant & { tenant_type: string | null }>((a, b) =>
          db
            .from('tenants')
            .select(
              'id, company_name, slug, created_at, status, tenant_type, portal_experience, setup_completed_at, stripe_onboarding_complete, stripe_account_status, own_stripe_account_id, own_stripe_test_account_id',
            )
            .order('created_at')
            .range(a, b),
        ),
        fetchAll<ChurnSubscription & { tenant_id: string }>((a, b) =>
          db
            .from('tenant_subscriptions')
            .select(
              'tenant_id, status, plan_name, amount, currency, interval, created_at, cancel_at, canceled_at, ended_at, cancellation_reason, cancellation_feedback, cancellation_comment',
            )
            .order('created_at')
            .range(a, b),
        ),
        fetchAll<ChurnRequest & { tenant_id: string }>((a, b) =>
          db
            .from('go_live_requests')
            .select('tenant_id, status, note, created_at')
            .eq('integration_type', CANCELLATION_TYPE)
            .order('created_at')
            .range(a, b),
        ),
        fetchAll<ChurnOverride & { tenant_id: string }>((a, b) =>
          db.from('tenant_churn_reasons').select('tenant_id, reason, note, updated_at').order('tenant_id').range(a, b),
        ),
        fetchAll<{ tenant_id: string; amount_paid: number | null }>((a, b) =>
          db.from('tenant_subscription_invoices').select('tenant_id, amount_paid').eq('status', 'paid').order('created_at').range(a, b),
        ),
      ]);

      const subsBy = group(subs);
      const reqBy = group(requests);
      const overrideBy = new Map(overrides.map((o) => [o.tenant_id, o]));
      const paidBy = new Map<string, number>();
      for (const i of invoices) paidBy.set(i.tenant_id, (paidBy.get(i.tenant_id) ?? 0) + (i.amount_paid ?? 0));

      const now = new Date();
      const out = tenants
        .filter((t) => t.tenant_type !== 'test')
        .map((t) =>
          resolveChurn({
            tenant: t,
            subscriptions: subsBy.get(t.id) ?? [],
            requests: reqBy.get(t.id) ?? [],
            override: overrideBy.get(t.id) ?? null,
            paidCents: paidBy.get(t.id) ?? 0,
            now,
          }),
        )
        .filter((r): r is ChurnRow => r !== null)
        .sort((a, b) => (b.leftAt ?? '').localeCompare(a.leftAt ?? ''));

      setRows(out);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const now = useMemo(() => new Date(), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // The period and v1/v2 decide the report; Left/Leaving and a clicked bar
  // only narrow the table, so the chart always shows the whole picture.
  const inScope = useMemo(
    () => rows.filter((r) => inPeriod(r, period, now) && (portalFilter === 'all' || r.portal === portalFilter)),
    [rows, period, portalFilter, now],
  );
  const leftRows = inScope.filter((r) => r.state === 'left');
  const leavingRows = inScope.filter((r) => r.state === 'leaving');
  const shares = useMemo(() => reasonShares(leftRows), [leftRows]);
  const lostMonthly = leftRows.reduce((s, r) => s + (r.monthlyCents ?? 0), 0);
  const known = leftRows.filter((r) => r.reason !== 'unknown').length;

  const tableRows = inScope.filter(
    (r) => (stateFilter === 'all' || r.state === stateFilter) && (!reasonFilter || r.reason === reasonFilter),
  );

  return (
    <div className="space-y-6">
      {/* The answer first. */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-primary" />
                Cancellations
              </CardTitle>
              <CardDescription>Why operators leave Drive247, and who — v1 and v2 portals.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
                <SelectTrigger className="h-9 w-[150px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PERIOD_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={portalFilter} onValueChange={(v) => setPortalFilter(v as 'all' | 'v1' | 'v2')}>
                <SelectTrigger className="h-9 w-[130px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">v1 and v2</SelectItem>
                  <SelectItem value="v1">v1 portal</SelectItem>
                  <SelectItem value="v2">v2 portal</SelectItem>
                </SelectContent>
              </Select>
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
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-6 w-2/3" />
          ) : error ? (
            <p className="text-sm text-destructive">Could not load: {error}</p>
          ) : (
            <p className="text-lg font-medium tracking-tight">{headline(leftRows, period)}</p>
          )}
          {!loading && !error && leftRows.length > 0 && known < leftRows.length && (
            <p className="mt-1 text-xs text-muted-foreground">
              {leftRows.length - known} of {leftRows.length} left without a known reason — record one with “Set reason”
              below after you speak to them.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Stat cards, in the Platform Rentals idiom. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Left"
          value={loading ? null : String(leftRows.length)}
          icon={LogOut}
          tone="destructive"
          active={stateFilter === 'left'}
          onClick={() => setStateFilter(stateFilter === 'left' ? 'all' : 'left')}
        />
        <StatCard
          label="Leaving (cancel scheduled or asked)"
          value={loading ? null : String(leavingRows.length)}
          icon={DoorOpen}
          tone="warning"
          active={stateFilter === 'leaving'}
          onClick={() => setStateFilter(stateFilter === 'leaving' ? 'all' : 'leaving')}
        />
        <StatCard
          label="Top reason"
          value={loading ? null : shares[0] ? `${shares[0].percent}% · ${shares[0].label}` : '—'}
          icon={UserMinus}
          tone="primary"
          small
        />
        <StatCard
          label="Monthly revenue lost"
          value={loading ? null : money(lostMonthly)}
          icon={TrendingDown}
          tone="destructive"
        />
      </div>

      {/* Why — the chart. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Why they left</CardTitle>
          <CardDescription>
            {PERIOD_LABEL[period]} · {leftRows.length} {leftRows.length === 1 ? 'company' : 'companies'}. Click a bar to see
            who.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : shares.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nobody left in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, shares.length * 40)}>
              <BarChart data={shares} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} className="fill-muted-foreground" tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="label" width={190} tick={{ fontSize: 12 }} className="fill-muted-foreground" tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }}
                  formatter={(v, _n, item) => [`${v} (${(item?.payload as { percent: number }).percent}%)`, 'Companies']}
                />
                <Bar
                  dataKey="count"
                  radius={[0, 4, 4, 0]}
                  className="cursor-pointer"
                  onClick={(d) => {
                    const reason = (d as unknown as { reason: ChurnReason }).reason;
                    setReasonFilter(reasonFilter === reason ? null : reason);
                  }}
                  label={{ position: 'right', fontSize: 11, formatter: (v: unknown) => String(v) }}
                >
                  {shares.map((s) => (
                    <Cell
                      key={s.reason}
                      fill={REASON_FILL[s.reason]}
                      opacity={reasonFilter && reasonFilter !== s.reason ? 0.35 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Who. */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Who</CardTitle>
            {(reasonFilter || stateFilter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setReasonFilter(null);
                  setStateFilter('all');
                }}
              >
                Clear filters
                {reasonFilter && <Badge variant="secondary" className="ml-2">{REASON_LABEL[reasonFilter]}</Badge>}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Portal</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Customer for</TableHead>
                <TableHead>Left</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-[110px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : tableRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                    No companies match.
                  </TableCell>
                </TableRow>
              ) : (
                tableRows.map((r) => (
                  <TableRow key={r.tenant.id}>
                    <TableCell>
                      <Link
                        href={`/admin/rentals/${r.tenant.id}`}
                        className="inline-flex items-center gap-1 font-medium hover:underline"
                      >
                        {r.tenant.company_name ?? r.tenant.slug ?? '—'}
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      </Link>
                      {r.tenant.status === 'suspended' && (
                        <span className="block text-xs text-muted-foreground">Suspended</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px] uppercase">
                        {r.portal}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {r.plan ?? '—'}
                      {r.monthlyCents !== null && (
                        <span className="block text-xs text-muted-foreground">{money(r.monthlyCents, r.currency)}/month</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {r.monthsAsCustomer === null ? '—' : r.monthsAsCustomer < 1 ? 'Under a month' : `${r.monthsAsCustomer} mo`}
                      <span className="block text-xs text-muted-foreground">paid {money(r.paidCents, r.currency)}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {r.state === 'leaving' ? (
                        <span className="text-amber-600">Leaving · {fmtDay(r.leftAt)}</span>
                      ) : (
                        fmtDay(r.leftAt)
                      )}
                    </TableCell>
                    <TableCell className="max-w-[320px]">
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: REASON_FILL[r.reason] }} />
                        {REASON_LABEL[r.reason]}
                      </span>
                      <span className="block text-xs text-muted-foreground">{SOURCE_LABEL[r.source]}</span>
                      {r.detail && <span className="mt-0.5 block text-xs italic text-foreground/70">“{r.detail}”</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit && (
                        <Button variant="ghost" size="sm" className="gap-1" onClick={() => setEditing(r)}>
                          <PencilLine className="h-3.5 w-3.5" />
                          Set reason
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ReasonDialog
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  active,
  onClick,
  small,
}: {
  label: string;
  value: string | null;
  icon: typeof LogOut;
  tone: 'destructive' | 'warning' | 'primary';
  active?: boolean;
  onClick?: () => void;
  small?: boolean;
}) {
  const toneCls = {
    destructive: { bg: 'bg-destructive/15', text: 'text-destructive', active: 'border-destructive/40 bg-destructive/5' },
    warning: { bg: 'bg-warning/15', text: 'text-warning', active: 'border-warning/40 bg-warning/5' },
    primary: { bg: 'bg-primary/15', text: 'text-primary', active: 'border-primary/40 bg-primary/5' },
  }[tone];
  return (
    <Card className={cn(onClick && 'cursor-pointer transition-all', active && toneCls.active)} onClick={onClick}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            {value === null ? (
              <Skeleton className="mt-1 h-8 w-16" />
            ) : (
              <p className={cn('font-bold tabular-nums', small ? 'truncate text-base' : 'text-2xl')}>{value}</p>
            )}
          </div>
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', toneCls.bg)}>
            <Icon className={cn('h-5 w-5', toneCls.text)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Record why one company left — after a call, say. Overrides every other source. */
function ReasonDialog({ row, onClose, onSaved }: { row: ChurnRow | null; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (row) {
      setReason(row.source === 'admin' || row.reason !== 'unknown' ? row.reason : '');
      setNote(row.source === 'admin' ? row.detail ?? '' : '');
    }
  }, [row]);

  const save = async () => {
    if (!row || !reason) return;
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await (supabase as any).from('tenant_churn_reasons').upsert({
      tenant_id: row.tenant.id,
      reason,
      note: note.trim() || null,
      updated_by: auth.user?.id ?? null,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      toast.error(`Could not save: ${error.message}`);
      return;
    }
    toast.success(`Saved: ${row.tenant.company_name ?? 'company'} — ${REASON_LABEL[reason as ChurnReason]}`);
    onSaved();
  };

  const clear = async () => {
    if (!row) return;
    setSaving(true);
    const { error } = await (supabase as any).from('tenant_churn_reasons').delete().eq('tenant_id', row.tenant.id);
    setSaving(false);
    if (error) {
      toast.error(`Could not clear: ${error.message}`);
      return;
    }
    toast.success('Back to the reason worked out automatically.');
    onSaved();
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle>Why did {row.tenant.company_name ?? 'they'} leave?</DialogTitle>
              <DialogDescription>
                What you record here replaces the reason worked out automatically
                {row.source !== 'none' && row.source !== 'admin' && <> (now: {REASON_LABEL[row.reason]}, {SOURCE_LABEL[row.source].toLowerCase()})</>}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {SETTABLE_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {REASON_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="churn-note">Note (optional)</Label>
                <Textarea
                  id="churn-note"
                  rows={3}
                  maxLength={500}
                  placeholder="What they told us"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {row.source === 'admin' ? (
                  <Button variant="ghost" size="sm" disabled={saving} onClick={() => void clear()}>
                    Clear my reason
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose} disabled={saving}>
                    Cancel
                  </Button>
                  <Button onClick={() => void save()} disabled={saving || !reason}>
                    {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    Save
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
