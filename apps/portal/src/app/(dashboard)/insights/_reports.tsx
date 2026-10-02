'use client';

/**
 * Insights — Reports.
 *
 * The nine reports a rental operator actually downloads, each one a click
 * from View, PDF or CSV. A 3 × 3 grid that fits the one-screen frame. Every
 * report is built from the same data as the Numbers view (see
 * `_report-builders.ts`), for the period picked at the top of the page.
 */

import { useState } from 'react';
import { ChevronRight, FileSpreadsheet, FileText, Loader2, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ReportArt } from '@/components/illustrations-v2/scenes/insights-reports';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui-v2/dialog';
import { Button } from '@/components/ui-v2/button';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import type { InsightsData, PeriodMonths } from './_data';
import {
  REPORTS,
  buildReport,
  download,
  fileName,
  toCsv,
  toPdf,
  type ReportId,
  type ReportTable,
} from './_report-builders';

function useReportActions(data: InsightsData | undefined, months: PeriodMonths, currency: string) {
  const { tenant } = useTenant();
  const company = tenant?.company_name ?? 'Drive247';
  const money = (n: number) => formatCurrency(n, currency);
  const [busy, setBusy] = useState<string | null>(null);

  const table = (id: ReportId): ReportTable | null => (data ? buildReport(id, data, months, money) : null);

  const csv = (id: ReportId) => {
    const t = table(id);
    if (!t) return;
    download(new Blob([toCsv(t)], { type: 'text/csv;charset=utf-8' }), fileName(t, company, 'csv'));
  };

  const pdf = async (id: ReportId) => {
    const t = table(id);
    if (!t) return;
    setBusy(`${id}:pdf`);
    try {
      download(await toPdf(t, company, money), fileName(t, company, 'pdf'));
    } catch (error) {
      toast.error("I couldn't build that PDF", {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  return { table, csv, pdf, busy, money };
}

export function ReportsView({
  data,
  months,
  currency,
}: {
  data: InsightsData | undefined;
  months: PeriodMonths;
  currency: string;
}) {
  const actions = useReportActions(data, months, currency);
  const [viewing, setViewing] = useState<ReportId | null>(null);

  /*
   * Regenerate = re-read the figures from the database now, then rebuild the
   * report from them. Every report is built from the one Insights query, so
   * refreshing one refreshes the numbers behind all nine — but the time stamp
   * is per card, so the card the operator clicked says it was just rebuilt.
   */
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [regenerating, setRegenerating] = useState<ReportId | null>(null);
  const [rebuiltAt, setRebuiltAt] = useState<Partial<Record<ReportId, number>>>({});
  const loadedAt = queryClient.getQueryState(['insights', tenant?.id, months])?.dataUpdatedAt ?? 0;
  const regenerate = async (id: ReportId) => {
    setRegenerating(id);
    try {
      await queryClient.refetchQueries({ queryKey: ['insights', tenant?.id, months], exact: true });
      setRebuiltAt((m) => ({ ...m, [id]: Date.now() }));
    } catch (error) {
      toast.error("I couldn't refresh those figures", {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setRegenerating(null);
    }
  };
  const stamp = (id: ReportId) => {
    const at = Math.max(rebuiltAt[id] ?? 0, loadedAt);
    return at ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null;
  };
  const viewed = viewing ? actions.table(viewing) : null;

  const opened = viewing ? REPORTS.find((r) => r.id === viewing) ?? null : null;
  const busyPdf = viewing ? actions.busy === `${viewing}:pdf` : false;

  return (
    <>
      {/*
        Fourteen cards, each just a picture and a name. Everything a report can do
        — read it, download it, rebuild it — lives in the dialog the card opens,
        so the grid stays calm. This view scrolls; the cards keep one height.
      */}
      <div className="grid gap-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((report) => (
          <button
            key={report.id}
            type="button"
            onClick={() => setViewing(report.id)}
            disabled={!data}
            className={cn(
              'group flex h-[236px] cursor-pointer flex-col overflow-hidden rounded-4xl bg-card text-left ring-1 ring-foreground/5',
              'transition-colors duration-200 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default motion-reduce:transition-none',
            )}
          >
            {/* The picture fills whatever the card has; the tint fades in on
                hover from its own layer (a gradient cannot be transitioned). */}
            <div className="relative min-h-0 flex-1 bg-muted/40 px-6 pt-4 pb-2">
              <span
                aria-hidden
                className="absolute inset-0 bg-primary/[0.06] opacity-0 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none"
              />
              <ReportArt id={report.id} className="relative mx-auto max-w-[300px]" />
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3.5">
              <span className="truncate font-heading text-[15px] font-medium tracking-tight">{report.title}</span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary motion-reduce:transition-none"
                aria-hidden
              />
            </div>
          </button>
        ))}
      </div>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="sm:max-w-4xl">
          {viewed && opened ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-4">
                  <div className="h-16 w-28 shrink-0 rounded-2xl bg-muted/40 p-1.5">
                    <ReportArt id={opened.id} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <DialogTitle>{viewed.title}</DialogTitle>
                    <DialogDescription>{opened.description}</DialogDescription>
                  </div>
                  {/* The downloads sit with the title — the reason most people
                      open a report. `mr-10` clears the dialog's close button. */}
                  <div className="mr-10 flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 gap-1 px-2.5 text-xs [&_svg]:size-3.5" onClick={() => actions.pdf(opened.id)} disabled={busyPdf}>
                      {busyPdf ? (
                          <Loader2 data-icon="inline-start" className="animate-spin" />
                      ) : (
                          <FileText data-icon="inline-start" />
                      )}
                      PDF
                    </Button>
                    <Button size="sm" className="h-7 gap-1 px-2.5 text-xs [&_svg]:size-3.5" onClick={() => actions.csv(opened.id)}>
                        <FileSpreadsheet data-icon="inline-start" /> CSV
                    </Button>
                  </div>
                </div>
              </DialogHeader>

              {/* What this copy of the report is, and every action on it. */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-muted/40 px-4 py-2.5">
                <p className="text-[13px] text-muted-foreground tabular-nums">
                  {viewed.subtitle}
                  {' · '}
                  {viewed.rows.length.toLocaleString()} {viewed.rows.length === 1 ? 'row' : 'rows'}
                  {stamp(opened.id) ? ` · figures read at ${stamp(opened.id)}` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                    onClick={() => regenerate(opened.id)}
                    disabled={regenerating !== null}
                  >
                    <RefreshCw
                      data-icon="inline-start"
                      className={cn(regenerating === opened.id && 'animate-spin motion-reduce:animate-none')}
                    />
                    {regenerating === opened.id ? 'Regenerating…' : 'Regenerate'}
                  </Button>
                </div>
              </div>

              <ReportTableView table={viewed} money={actions.money} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The portal's table pattern: indigo-tinted header, hairline rows, text-only figures. */
function ReportTableView({ table, money }: { table: ReportTable; money: (n: number) => string }) {
  const cell = (value: string | number | null | undefined, isMoney?: boolean) => {
    if (value == null || value === '') return '';
    return isMoney && typeof value === 'number' ? money(value) : String(value);
  };

  if (table.rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-3xl bg-muted/40 text-sm text-muted-foreground">
        Nothing in this period.
      </div>
    );
  }

  return (
    <div className="max-h-[50vh] overflow-auto rounded-3xl ring-1 ring-foreground/5">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-primary/[0.07] backdrop-blur">
          <tr>
            {table.columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground',
                  (c.money || c.align === 'right') && 'text-right',
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="border-t border-foreground/5">
              {table.columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-4 py-2 align-top',
                    (c.money || c.align === 'right') && 'text-right tabular-nums whitespace-nowrap',
                    c.key === 'note' && 'text-xs text-muted-foreground',
                  )}
                >
                  {cell(row[c.key], c.money)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {table.totals ? (
          <tfoot>
            <tr className="border-t-2 border-foreground/10 font-medium">
              {table.columns.map((c) => (
                <td
                  key={c.key}
                  className={cn('px-4 py-2.5', (c.money || c.align === 'right') && 'text-right tabular-nums whitespace-nowrap')}
                >
                  {cell(table.totals![c.key], c.money)}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
