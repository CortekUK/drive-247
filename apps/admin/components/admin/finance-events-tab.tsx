/**
 * FinanceEventsTab — Sprint 1 super-admin debug view.
 *
 * Surfaces the `financial_events` ledger for a tenant so the engineer can
 * verify that real operational writes (payments, refunds, damages, etc.) are
 * being enqueued correctly via the `enqueue_financial_event` RPC. No sync
 * dashboard yet — that lands in Sprint 3. This view is intentionally minimal:
 * type, amount, occurred_at, source_table, description. Read-only.
 */
'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Activity, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface FinancialEvent {
  id: string;
  tenant_id: string;
  rental_id: string | null;
  customer_id: string | null;
  vehicle_id: string | null;
  event_type: string;
  amount_cents: number;
  tax_cents: number;
  currency: string;
  occurred_at: string;
  status: string;
  source_table: string | null;
  source_id: string | null;
  description: string | null;
  created_at: string;
}

const EVENT_TYPE_STYLE: Record<string, string> = {
  rental_charge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  payment_receipt: 'bg-blue-50 text-blue-700 border-blue-200',
  refund: 'bg-red-50 text-red-700 border-red-200',
  damage_charge: 'bg-orange-50 text-orange-700 border-orange-200',
  mileage_charge: 'bg-amber-50 text-amber-700 border-amber-200',
  late_fee: 'bg-amber-50 text-amber-700 border-amber-200',
  insurance_charge: 'bg-violet-50 text-violet-700 border-violet-200',
  charging_cost: 'bg-sky-50 text-sky-700 border-sky-200',
  extension_charge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  deposit_capture: 'bg-zinc-50 text-zinc-700 border-zinc-200',
  security_hold_release: 'bg-zinc-50 text-zinc-500 border-zinc-200',
  discount: 'bg-pink-50 text-pink-700 border-pink-200',
  maintenance_expense: 'bg-stone-50 text-stone-700 border-stone-200',
  partner_payout: 'bg-stone-50 text-stone-700 border-stone-200',
};

const fmtMoneyCents = (cents: number, currency: string) => {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents) / 100;
  return `${sign}${new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(abs)}`;
};

export function FinanceEventsTab({ tenantId }: { tenantId: string }) {
  const query = useQuery({
    queryKey: ['finance-events-debug', tenantId],
    queryFn: async (): Promise<{ events: FinancialEvent[]; counts: Record<string, number> }> => {
      const { data, error } = await supabase
        .from('financial_events')
        .select('id, tenant_id, rental_id, customer_id, vehicle_id, event_type, amount_cents, tax_cents, currency, occurred_at, status, source_table, source_id, description, created_at')
        .eq('tenant_id', tenantId)
        .order('occurred_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const events = (data ?? []) as unknown as FinancialEvent[];
      const counts: Record<string, number> = {};
      for (const e of events) counts[e.event_type] = (counts[e.event_type] ?? 0) + 1;
      return { events, counts };
    },
    enabled: !!tenantId,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }
  if (query.isError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-red-700">
          Failed to load financial events: {(query.error as Error).message}
        </CardContent>
      </Card>
    );
  }

  const events = query.data?.events ?? [];
  const counts = query.data?.counts ?? {};
  const totalCents = events.reduce((s, e) => s + e.amount_cents, 0);
  const currency = events[0]?.currency ?? 'USD';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Finance Sync · Financial Events
          </CardTitle>
          <CardDescription>
            Internal ledger feeding the Xero/Zoho sync layer. Most recent 200 events for this tenant.
            Populated automatically by edge functions (payments, refunds, damages, mileage, deposits, supercharger costs).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No financial events yet. Once this tenant processes a payment, refund, or damage charge, events will appear here.
            </p>
          ) : (
            <>
              {/* Summary */}
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge variant="outline" className="bg-muted/40">
                  Total events: {events.length}
                </Badge>
                <Badge variant="outline" className="bg-muted/40">
                  Net amount: {fmtMoneyCents(totalCents, currency)}
                </Badge>
                {Object.entries(counts).map(([type, count]) => (
                  <Badge key={type} variant="outline" className={EVENT_TYPE_STYLE[type] ?? ''}>
                    {type}: {count}
                  </Badge>
                ))}
              </div>

              {/* Event list */}
              <ul className="divide-y divide-border">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline" className={EVENT_TYPE_STYLE[e.event_type] ?? ''}>
                          {e.event_type}
                        </Badge>
                        <span className="text-muted-foreground">
                          {new Date(e.occurred_at).toLocaleString()}
                        </span>
                        {e.source_table && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {e.source_table}
                            {e.source_id ? ` · ${e.source_id.slice(0, 8)}` : ''}
                          </span>
                        )}
                        {e.status !== 'finalised' && (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700">{e.status}</Badge>
                        )}
                      </div>
                      {e.description && (
                        <p className="mt-1 truncate text-sm text-foreground">{e.description}</p>
                      )}
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                        {e.rental_id && (
                          <Link
                            href={`/admin/rentals/${tenantId}#rental-${e.rental_id}`}
                            className="inline-flex items-center gap-0.5 hover:text-foreground"
                          >
                            rental {e.rental_id.slice(0, 8)} <ExternalLink className="h-2.5 w-2.5" />
                          </Link>
                        )}
                        {e.vehicle_id && <span>vehicle {e.vehicle_id.slice(0, 8)}</span>}
                        {e.customer_id && <span>customer {e.customer_id.slice(0, 8)}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm font-medium tabular-nums">
                      {fmtMoneyCents(e.amount_cents, e.currency)}
                      {e.tax_cents > 0 && (
                        <div className="text-[10px] text-muted-foreground">
                          incl. {fmtMoneyCents(e.tax_cents, e.currency)} tax
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
