'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CreditCard, Calendar, Clock } from 'lucide-react';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/format-utils';
import { PaygDetailsDialog } from './payg-details-dialog';

interface PaygPaymentBreakdownProps {
  rentalId: string;
  rental: {
    payg_start_ts?: string | null;
    payg_next_accrual_at?: string | null;
    payg_last_reminder_sent_at?: string | null;
    payg_reminder_count?: number | null;
    payg_reminder_interval_days?: number | null;
    payg_paused?: boolean | null;
    payg_closed_at?: string | null;
    payg_accrual_day_count?: number | null;
  };
  currencyCode: string;
  onTakePayment?: (args: { categories: string[]; amount: number }) => void;
}

interface CategoryTotals {
  category: string;
  charged: number;
  remaining: number;
}

const PAYG_CATEGORIES = ['Rental', 'Tax', 'Service Fee'] as const;

/**
 * Payment Breakdown variant for PAYG rentals.
 *
 * Layout mirrors the regular Payment Breakdown card so it doesn't feel out of place,
 * but the PAYG-accrued categories (Rental / Tax / Service Fee) are isolated in a
 * blue-bordered sub-panel with a "View timeline details" button — clicking it opens
 * <PaygDetailsDialog /> with the full per-day history, payment activity, refunds,
 * reminder log, and live countdowns.
 */
export function PaygPaymentBreakdown({
  rentalId,
  rental,
  currencyCode,
  onTakePayment,
}: PaygPaymentBreakdownProps) {
  const { tenant } = useTenant();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { data: ledger, isLoading } = useQuery({
    queryKey: ['payg-payment-breakdown', tenant?.id, rentalId],
    queryFn: async () => {
      if (!rentalId || !tenant?.id) return [] as any[];
      const { data, error } = await supabaseUntyped
        .from('ledger_entries')
        .select('id, type, category, amount, remaining_amount')
        .eq('rental_id', rentalId)
        .eq('tenant_id', tenant.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!rentalId && !!tenant?.id,
    staleTime: 15_000,
  });

  // Aggregate ledger rows by category — PAYG charges land daily so each category may
  // have many rows (one per day). Sum amounts and remainders, ignore Payment rows
  // (those have negative amounts that already reduce remaining_amount on charges).
  const totals = useMemo(() => {
    const map = new Map<string, CategoryTotals>();
    for (const row of ledger || []) {
      if (row.type !== 'Charge') continue;
      const t = map.get(row.category) || { category: row.category, charged: 0, remaining: 0 };
      t.charged += Number(row.amount || 0);
      t.remaining += Math.max(0, Number(row.remaining_amount || 0));
      map.set(row.category, t);
    }
    return map;
  }, [ledger]);

  const paygTotals = PAYG_CATEGORIES.map(
    (cat) => totals.get(cat) || { category: cat, charged: 0, remaining: 0 },
  );
  const paygSubtotal = paygTotals.reduce((s, c) => s + c.charged, 0);
  const paygRemaining = paygTotals.reduce((s, c) => s + c.remaining, 0);
  const paygPaid = paygSubtotal - paygRemaining;

  // Other categories (Fines, Supercharger, etc.) — render in their own section so the
  // breakdown is still complete even though most PAYG rentals won't have these.
  const otherCategories = Array.from(totals.values()).filter(
    (c) => !PAYG_CATEGORIES.includes(c.category as any),
  );
  const otherSubtotal = otherCategories.reduce((s, c) => s + c.charged, 0);
  const otherRemaining = otherCategories.reduce((s, c) => s + c.remaining, 0);

  const grandCharged = paygSubtotal + otherSubtotal;
  const grandRemaining = paygRemaining + otherRemaining;
  const grandPaid = grandCharged - grandRemaining;

  const dayCount = rental.payg_accrual_day_count || 0;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              Payment Breakdown
            </CardTitle>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                Charged <span className="text-foreground font-semibold tabular-nums">{formatCurrency(grandCharged, currencyCode)}</span>
              </span>
              <span className="text-muted-foreground">
                Paid <span className="text-emerald-600 font-semibold tabular-nums">{formatCurrency(grandPaid, currencyCode)}</span>
              </span>
              <span className="text-muted-foreground">
                Outstanding{' '}
                <span className={`font-semibold tabular-nums ${grandRemaining > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {formatCurrency(grandRemaining, currencyCode)}
                </span>
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Blue PAYG sub-panel */}
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="w-full text-left rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="View Pay-As-You-Go details"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-blue-200 dark:border-blue-800/60">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">Pay-As-You-Go</span>
                <Badge variant="outline" className="text-[10px] text-blue-700 border-blue-300 bg-blue-100/80 dark:text-blue-300 dark:border-blue-700 dark:bg-blue-950/50">
                  Accrued daily
                </Badge>
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {dayCount} day{dayCount === 1 ? '' : 's'} accrued
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-300 group-hover:gap-2 transition-all">
                <span>View timeline details</span>
                <ChevronRight className="h-4 w-4" />
              </div>
            </div>

            <div className="p-0">
              {isLoading ? (
                <div className="px-4 py-3 text-sm text-muted-foreground">Loading PAYG charges...</div>
              ) : (
                <Table>
                  <TableBody>
                    {paygTotals.map((cat) => {
                      const paid = cat.charged - cat.remaining;
                      const status =
                        cat.charged === 0
                          ? 'pending'
                          : cat.remaining <= 0.001
                            ? 'paid'
                            : paid > 0.001
                              ? 'partial'
                              : 'unpaid';
                      return (
                        <TableRow key={cat.category} className="border-b border-blue-100 dark:border-blue-900/50 last:border-b-0 hover:bg-blue-50/40 dark:hover:bg-blue-950/20">
                          <TableCell className="text-sm py-2.5 text-blue-900 dark:text-blue-200">
                            {cat.category}
                            {cat.category === 'Rental' && dayCount > 0 && (
                              <span className="text-xs text-muted-foreground ml-2">
                                · {dayCount} day{dayCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-right tabular-nums py-2.5">
                            {formatCurrency(cat.charged, currencyCode)}
                          </TableCell>
                          <TableCell className="text-sm text-right tabular-nums py-2.5 text-muted-foreground">
                            {paid > 0 ? `+${formatCurrency(paid, currencyCode)}` : '—'}
                          </TableCell>
                          <TableCell className="text-right py-2.5 w-32">
                            {status === 'pending' ? (
                              <span className="text-[11px] text-muted-foreground italic flex items-center justify-end gap-1">
                                <Clock className="h-3 w-3" /> Awaiting accrual
                              </span>
                            ) : status === 'paid' ? (
                              <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-700 dark:bg-emerald-950/30">
                                Paid
                              </Badge>
                            ) : status === 'partial' ? (
                              <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-700 dark:bg-amber-950/30">
                                {formatCurrency(cat.remaining, currencyCode)} due
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] text-red-700 border-red-300 bg-red-50 dark:text-red-300 dark:border-red-700 dark:bg-red-950/30">
                                {formatCurrency(cat.remaining, currencyCode)} unpaid
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* Subtotal row for the PAYG group */}
                    <TableRow className="bg-blue-100/50 dark:bg-blue-950/40 font-semibold border-t-2 border-blue-300 dark:border-blue-700">
                      <TableCell className="text-sm py-2.5 text-blue-900 dark:text-blue-200">PAYG Subtotal</TableCell>
                      <TableCell className="text-sm text-right tabular-nums py-2.5 text-blue-900 dark:text-blue-200">{formatCurrency(paygSubtotal, currencyCode)}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums py-2.5 text-emerald-700 dark:text-emerald-400">
                        {paygPaid > 0 ? `+${formatCurrency(paygPaid, currencyCode)}` : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums py-2.5">
                        {paygRemaining > 0 ? (
                          <span className="text-red-600 dark:text-red-400">{formatCurrency(paygRemaining, currencyCode)}</span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">$0.00</span>
                        )}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </div>
          </button>

          {/* Per-day take-payment shortcut for any outstanding PAYG balance */}
          {paygRemaining > 0.001 && onTakePayment && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-blue-300 text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:border-blue-700"
                onClick={() =>
                  onTakePayment({
                    categories: paygTotals.filter((c) => c.remaining > 0).map((c) => c.category),
                    amount: paygRemaining,
                  })
                }
              >
                Take {formatCurrency(paygRemaining, currencyCode)} payment
              </Button>
            </div>
          )}

          {/* Other (non-PAYG) categories — Fines, Supercharger, etc. */}
          {otherCategories.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Other Charges</p>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableBody>
                    {otherCategories.map((cat) => {
                      const paid = cat.charged - cat.remaining;
                      const isPaid = cat.remaining <= 0.001;
                      return (
                        <TableRow key={cat.category}>
                          <TableCell className="text-sm py-2.5">{cat.category}</TableCell>
                          <TableCell className="text-sm text-right tabular-nums py-2.5">{formatCurrency(cat.charged, currencyCode)}</TableCell>
                          <TableCell className="text-sm text-right tabular-nums py-2.5 text-muted-foreground">
                            {paid > 0 ? `+${formatCurrency(paid, currencyCode)}` : '—'}
                          </TableCell>
                          <TableCell className="text-right py-2.5 w-32">
                            <Badge variant="outline" className={isPaid
                              ? "text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-700 dark:bg-emerald-950/30"
                              : "text-[10px] text-red-700 border-red-300 bg-red-50 dark:text-red-300 dark:border-red-700 dark:bg-red-950/30"}>
                              {isPaid ? 'Paid' : `${formatCurrency(cat.remaining, currencyCode)} due`}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PaygDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        rentalId={rentalId}
        isPayg
        rental={rental}
        currencyCode={currencyCode}
        onTakePayment={onTakePayment}
      />
    </>
  );
}
