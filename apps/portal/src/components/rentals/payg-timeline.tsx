'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Calendar,
  CircleDollarSign,
  Mail,
  Undo2,
  Clock,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Pause,
  Lock,
  Activity,
  CreditCard,
  Receipt,
  TrendingUp,
} from 'lucide-react';
import { formatCurrency } from '@/lib/format-utils';
import { usePaygTimeline } from '@/hooks/use-payg-timeline';

interface PaygTimelineProps {
  rentalId: string;
  isPayg: boolean;
  rental: {
    payg_start_ts?: string | null;
    payg_next_accrual_at?: string | null;
    payg_last_reminder_sent_at?: string | null;
    payg_reminder_count?: number | null;
    payg_reminder_interval_days?: number | null;
    payg_paused?: boolean | null;
    payg_closed_at?: string | null;
  };
  currencyCode: string;
  onTakePayment?: (args: { categories: string[]; amount: number }) => void;
  asCard?: boolean;
}

// ─── Countdown primitives ──────────────────────────────────────────────────

function useCountdown(targetIso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [targetIso]);

  if (!targetIso) return null;
  const target = new Date(targetIso).getTime();
  const diff = target - now;
  if (diff <= 0) {
    const overdueMs = -diff;
    const totalSec = Math.floor(overdueMs / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const label = days > 0 ? `${days}d ${hours}h overdue` : hours > 0 ? `${hours}h ${mins}m overdue` : `${mins}m overdue`;
    return { overdue: true, label, diffMs: diff };
  }
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const label =
    days > 0 ? `${days}d ${hours}h ${mins}m`
    : hours > 0 ? `${hours}h ${mins}m ${String(secs).padStart(2, '0')}s`
    : `${mins}m ${String(secs).padStart(2, '0')}s`;
  return { overdue: false, label, diffMs: diff };
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const mins = Math.floor(abs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const core =
    days > 0 ? `${days} day${days === 1 ? '' : 's'}`
    : hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'}`
    : `${Math.max(1, mins)} min${mins === 1 ? '' : 's'}`;
  return future ? `in ${core}` : `${core} ago`;
}

function CountdownCard({
  label, targetIso, helper, icon, emptyText, tone,
}: {
  label: string;
  targetIso: string | null;
  helper?: string;
  icon: React.ReactNode;
  emptyText?: string;
  tone?: 'indigo' | 'blue';
}) {
  const cd = useCountdown(targetIso);
  const accent = tone === 'blue' ? 'border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20' : 'border-indigo-200 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20';
  return (
    <div className={`rounded-lg border p-4 flex flex-col gap-1.5 ${accent}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-semibold">
        {icon}
        <span>{label}</span>
      </div>
      {!cd ? (
        <div className="text-sm text-muted-foreground italic">{emptyText || 'Not scheduled'}</div>
      ) : cd.overdue ? (
        <div>
          <div className="text-xl font-mono font-bold tabular-nums text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <CircleAlert className="h-4 w-4" /> {cd.label}
          </div>
          {targetIso && <div className="text-xs text-muted-foreground mt-0.5">was due {fmtDateTime(targetIso)}</div>}
        </div>
      ) : (
        <div>
          <div className="text-xl font-mono font-bold tabular-nums">{cd.label}</div>
          {targetIso && <div className="text-xs text-muted-foreground mt-0.5">at {fmtDateTime(targetIso)}</div>}
        </div>
      )}
      {helper && <p className="text-[11px] text-muted-foreground mt-0.5">{helper}</p>}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function PaygTimeline({ rentalId, isPayg, rental, currencyCode, onTakePayment, asCard = true }: PaygTimelineProps) {
  const { timeline, isLoading } = usePaygTimeline(rentalId, isPayg, rental);

  if (!isPayg) return null;

  const { totals, next, events } = timeline;
  const accruals = events.filter((e): e is Extract<typeof events[number], { kind: 'accrual' }> => e.kind === 'accrual');
  const payments = events.filter((e): e is Extract<typeof events[number], { kind: 'payment' }> => e.kind === 'payment');
  const refunds = events.filter((e): e is Extract<typeof events[number], { kind: 'refund' }> => e.kind === 'refund');
  const reminders = events.filter((e): e is Extract<typeof events[number], { kind: 'reminder' }> => e.kind === 'reminder');

  const paidPct = totals.totalCharged > 0
    ? Math.min(100, Math.round(((totals.totalPaid - totals.totalRefunded) / totals.totalCharged) * 100))
    : 0;
  const refundPct = totals.totalCharged > 0
    ? Math.round((totals.totalRefunded / totals.totalCharged) * 100)
    : 0;

  const header = (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="text-base font-semibold flex items-center gap-2">
        <Activity className="h-4 w-4 text-indigo-500" />
        PAYG Activity
      </div>
      <div className="flex items-center gap-2">
        {next.paused && (
          <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:bg-amber-950/30">
            <Pause className="h-3 w-3 mr-1" /> Paused
          </Badge>
        )}
        {next.closed && (
          <Badge variant="outline" className="text-slate-600 border-slate-300 bg-slate-50 dark:text-slate-400 dark:border-slate-700 dark:bg-slate-900/30">
            <Lock className="h-3 w-3 mr-1" /> Closed
          </Badge>
        )}
      </div>
    </div>
  );

  const body = (
    <div className="space-y-6">
      {/* ── Countdowns ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <CountdownCard
          label="Next Accrual"
          targetIso={next.accrualAt}
          icon={<CircleDollarSign className="h-3.5 w-3.5" />}
          helper="Cron checks every 15 minutes"
          emptyText={next.closed ? 'Rental closed' : next.paused ? 'Accrual paused' : 'Pending activation'}
          tone="indigo"
        />
        <CountdownCard
          label="Next Reminder"
          targetIso={next.reminderAt}
          icon={<Mail className="h-3.5 w-3.5" />}
          helper={`Interval every ${totals.reminderIntervalDays} day${totals.reminderIntervalDays === 1 ? '' : 's'} · grace ${totals.graceDays}d · cap ${totals.maxReminders}`}
          emptyText={
            next.reminderCapReached
              ? `Cap reached (${totals.remindersSent}/${totals.maxReminders})`
              : totals.totalOutstanding <= 0
                ? 'No outstanding balance'
                : next.closed ? 'Rental closed'
                : next.paused ? 'Paused'
                : 'Reminders pending balance'
          }
          tone="blue"
        />
      </div>

      {/* ── Financial Summary ────────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5" /> Financial Summary
        </h3>
        <div className="rounded-lg border p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Charged</div>
              <div className="text-xl font-semibold tabular-nums">{formatCurrency(totals.totalCharged, currencyCode)}</div>
              <div className="text-[11px] text-muted-foreground">{totals.daysAccrued} day{totals.daysAccrued === 1 ? '' : 's'} accrued</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Paid</div>
              <div className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(totals.totalPaid, currencyCode)}</div>
              <div className="text-[11px] text-muted-foreground">{payments.length} payment{payments.length === 1 ? '' : 's'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Refunded</div>
              <div className={`text-xl font-semibold tabular-nums ${totals.totalRefunded > 0 ? 'text-purple-600 dark:text-purple-400' : 'text-muted-foreground/60'}`}>
                {formatCurrency(totals.totalRefunded, currencyCode)}
              </div>
              <div className="text-[11px] text-muted-foreground">{refunds.length} refund{refunds.length === 1 ? '' : 's'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Outstanding</div>
              <div className={`text-xl font-semibold tabular-nums ${totals.totalOutstanding > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {formatCurrency(totals.totalOutstanding, currencyCode)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {totals.daysUnpaid > 0 ? `${totals.daysUnpaid} unpaid` : ''}
                {totals.daysUnpaid > 0 && totals.daysPartial > 0 ? ' · ' : ''}
                {totals.daysPartial > 0 ? `${totals.daysPartial} partial` : ''}
                {totals.daysUnpaid === 0 && totals.daysPartial === 0 ? 'All paid' : ''}
              </div>
            </div>
          </div>

          {/* Progress bar: paid + refunded + outstanding */}
          {totals.totalCharged > 0 && (
            <div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
                <span>Collection Progress</span>
                <span className="tabular-nums">{paidPct}% paid{refundPct > 0 ? ` · ${refundPct}% refunded` : ''}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                <div className="bg-emerald-500 h-full" style={{ width: `${paidPct}%` }} />
                {refundPct > 0 && <div className="bg-purple-400 h-full" style={{ width: `${refundPct}%` }} />}
                <div className="bg-red-400/50 h-full flex-1" />
              </div>
            </div>
          )}

          {onTakePayment && totals.totalOutstanding > 0 && (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => onTakePayment({
                  categories: ['Rental', 'Tax', 'Service Fee'],
                  amount: totals.totalOutstanding,
                })}
              >
                <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                Take {formatCurrency(totals.totalOutstanding, currencyCode)}
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* ── Daily Charges ────────────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5" /> Daily Charges ({accruals.length})
        </h3>
        {accruals.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No accruals yet. The first day will post when the rental is Active and the cron runs.
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-xs">Day</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs text-right">Rental</TableHead>
                  <TableHead className="text-xs text-right">Tax</TableHead>
                  <TableHead className="text-xs text-right">Service Fee</TableHead>
                  <TableHead className="text-xs text-right">Total</TableHead>
                  <TableHead className="text-xs text-right">Paid</TableHead>
                  <TableHead className="text-xs text-right">Remaining</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right w-28">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accruals.map((a) => {
                  const rentalAmt = a.charges.find((c) => c.category === 'Rental')?.amount || 0;
                  const taxAmt = a.charges.find((c) => c.category === 'Tax')?.amount || 0;
                  const sfAmt = a.charges.find((c) => c.category === 'Service Fee')?.amount || 0;
                  const paidAmt = a.total - a.remaining;
                  const statusChip =
                    a.status === 'paid' ? (
                      <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-700 dark:bg-emerald-950/30">
                        <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Paid
                      </Badge>
                    ) : a.status === 'partial' ? (
                      <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-700 dark:bg-amber-950/30">
                        Partial
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-red-700 border-red-300 bg-red-50 dark:text-red-300 dark:border-red-700 dark:bg-red-950/30">
                        Unpaid
                      </Badge>
                    );

                  return (
                    <TableRow key={a.dayIndex} className={a.status === 'paid' ? 'opacity-70' : ''}>
                      <TableCell className="text-sm font-medium">#{a.dayIndex}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(a.windowStart)}
                        {a.isPartial && <span className="ml-1 text-amber-600">({a.hoursCovered.toFixed(1)}h)</span>}
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">{formatCurrency(rentalAmt, currencyCode)}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(taxAmt, currencyCode)}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-muted-foreground">{formatCurrency(sfAmt, currencyCode)}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums font-semibold">{formatCurrency(a.total, currencyCode)}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums text-emerald-600 dark:text-emerald-400">{paidAmt > 0 ? formatCurrency(paidAmt, currencyCode) : '—'}</TableCell>
                      <TableCell className={`text-sm text-right tabular-nums ${a.remaining > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground/60'}`}>
                        {a.remaining > 0 ? formatCurrency(a.remaining, currencyCode) : '—'}
                      </TableCell>
                      <TableCell>{statusChip}</TableCell>
                      <TableCell className="text-right">
                        {a.status !== 'paid' && onTakePayment ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => onTakePayment({
                              categories: Array.from(new Set(a.charges.filter((c) => c.remainingAmount > 0).map((c) => c.category))),
                              amount: a.remaining,
                            })}
                          >
                            Pay {formatCurrency(a.remaining, currencyCode)}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ── Payment History ──────────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <Receipt className="h-3.5 w-3.5" /> Payment History ({payments.length})
        </h3>
        {payments.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No customer payments recorded for this rental yet.
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => {
              const dayLabel =
                p.appliedToDayIndices.length === 0 ? 'no day attribution'
                : p.appliedToDayIndices.length === 1 ? `day ${p.appliedToDayIndices[0]}`
                : `days ${p.appliedToDayIndices[0]}–${p.appliedToDayIndices[p.appliedToDayIndices.length - 1]}`;
              return (
                <div key={p.paymentId} className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10 p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold">
                          {formatCurrency(p.amount, currencyCode)}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">via {p.method || 'unknown'}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDateTime(p.at)} · applied to {dayLabel}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{p.status || 'Posted'}</Badge>
                      {p.remaining > 0.001 && (
                        <Badge variant="outline" className="text-[10px] text-blue-700 border-blue-300 bg-blue-50 dark:text-blue-300 dark:border-blue-700 dark:bg-blue-950/30">
                          Credit {formatCurrency(p.remaining, currencyCode)}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Refunds ──────────────────────────────────────────────────── */}
      {refunds.length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Undo2 className="h-3.5 w-3.5" /> Refunds ({refunds.length})
          </h3>
          <div className="space-y-2">
            {refunds.map((r, i) => (
              <div key={`${r.paymentId}-${i}`} className="rounded-lg border border-purple-200 dark:border-purple-900 bg-purple-50/30 dark:bg-purple-950/10 p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-950/50 flex items-center justify-center text-purple-600 dark:text-purple-400">
                      <Undo2 className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">
                        −{formatCurrency(r.amount, currencyCode)}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">refunded</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDateTime(r.at)}
                        {r.stripeRefundId && <span className="ml-1">· {r.stripeRefundId}</span>}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-purple-700 border-purple-300 bg-purple-50 dark:text-purple-300 dark:border-purple-700 dark:bg-purple-950/30">
                    {r.status || 'Refunded'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Reminder Schedule ────────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <Mail className="h-3.5 w-3.5" /> Reminder Schedule
        </h3>
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">Reminders sent</span>
              <span className="font-semibold tabular-nums">{totals.remindersSent} / {totals.maxReminders}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Interval {totals.reminderIntervalDays}d · grace {totals.graceDays}d
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all ${next.reminderCapReached ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${Math.min(100, (totals.remindersSent / Math.max(1, totals.maxReminders)) * 100)}%` }}
            />
          </div>

          {reminders.length > 0 ? (
            <div className="space-y-1.5 pt-2">
              {reminders.map((r) => (
                <div key={r.at + r.reminderNumber} className="flex items-center justify-between text-xs border-l-2 border-l-blue-400 pl-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] min-w-[32px] justify-center">#{r.reminderNumber}</Badge>
                    <span className="text-muted-foreground">{fmtRelative(r.at)} · {r.channel}</span>
                    <span className="text-muted-foreground">to {r.recipient}</span>
                    {r.daysOverdue > 0 && (
                      <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300">
                        {r.daysOverdue}d overdue
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-muted-foreground">{formatCurrency(r.outstandingAmount, currencyCode)} due at send</span>
                    {r.success ? (
                      <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-700 dark:bg-emerald-950/30">
                        Sent
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-red-700 border-red-300 bg-red-50">
                        Failed
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic pt-1">No reminders sent yet.</div>
          )}

          {/* Next scheduled */}
          <div className="pt-2 border-t flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Next reminder</span>
            {next.reminderCapReached ? (
              <span className="flex items-center gap-1.5 text-red-700 dark:text-red-400 font-medium">
                <AlertTriangle className="h-3 w-3" />
                Cap reached — none scheduled
              </span>
            ) : next.reminderAt ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-3 w-3" />
                {fmtRelative(next.reminderAt)} · {fmtDateTime(next.reminderAt)}
              </span>
            ) : totals.totalOutstanding <= 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400 text-xs italic">No outstanding balance — reminders paused</span>
            ) : (
              <span className="text-muted-foreground italic">Not scheduled</span>
            )}
          </div>
        </div>
      </section>
    </div>
  );

  if (isLoading && events.length === 0) {
    return asCard ? (
      <Card>
        <CardHeader className="pb-3"><CardTitle className="p-0 m-0 font-medium">{header}</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-muted-foreground py-6 text-center">Loading timeline...</div></CardContent>
      </Card>
    ) : (
      <div className="space-y-4">
        {header}
        <div className="text-sm text-muted-foreground py-6 text-center">Loading timeline...</div>
      </div>
    );
  }

  if (!asCard) {
    return (
      <div className="space-y-4">
        {header}
        {body}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="p-0 m-0 font-medium">{header}</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
