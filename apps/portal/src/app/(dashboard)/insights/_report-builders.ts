/**
 * Insights — the reports, as plain tables.
 *
 * Every report is built from the same `InsightsData` the Numbers view shows,
 * so a downloaded file always agrees with the screen: the tenant's "what
 * counts where" rules decide which rows land in which report, left-out rows
 * are left out, and a corrected amount is the amount (with the recorded
 * figure noted beside it, so the file never hides that it was changed).
 *
 * One shape for all of them — columns + rows + an optional totals row — so
 * the view dialog, the CSV writer and the PDF writer are each written once.
 */

import { toNumber } from './_money-model';
import { vehicleName, periodRange, type InsightsData, type LedgerRow, type PeriodMonths } from './_data';

export type Column = {
  key: string;
  label: string;
  /** Money columns are right-aligned, formatted on screen and in the PDF, raw in the CSV. */
  money?: boolean;
  align?: 'left' | 'right';
};

export type Row = Record<string, string | number | null>;

export type ReportTable = {
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Row[];
  totals?: Row;
};

export type ReportId =
  | 'pnl'
  | 'monthly'
  | 'sales-tax'
  | 'income'
  | 'expenses'
  | 'vehicle-profit'
  | 'refunds'
  | 'receivables'
  | 'fleet-capital'
  | 'payments-in'
  | 'rentals'
  | 'due-back'
  | 'utilisation'
  | 'top-customers';

export type ReportDef = {
  id: ReportId;
  title: string;
  /** Who reaches for it, in one line. */
  description: string;
  /** Not period-scoped — said on the card so it does not read as a bug. */
  asOfToday?: boolean;
};

/**
 * Ordered by how often a rental operator actually reaches for each one: the
 * P&L and the tax report every month, the ledgers for the bookkeeper, the
 * rest when a specific question comes up.
 */
export const REPORTS: ReportDef[] = [
  { id: 'pnl', title: 'Profit & loss', description: 'The receipt as a statement: took in, gave back, never yours, spent, kept.' },
  { id: 'monthly', title: 'Monthly profit & loss', description: 'Money in, spent and kept for each month — the one your accountant asks for.' },
  { id: 'payments-in', title: 'Payments received', description: 'Every payment taken, by date, customer and method — to match against the bank.' },
  { id: 'rentals', title: 'Rental register', description: 'Every rental in the period: who, which car, when, and where it stands.' },
  { id: 'sales-tax', title: 'Sales tax collected', description: 'Every tax line, with the total you owe onward. For your tax filing.' },
  { id: 'receivables', title: 'Who owes you', description: 'Aged balances by customer — for chasing payments.', asOfToday: true },
  { id: 'due-back', title: 'Cars due back', description: 'Cars out now, and when each is due back — overdue first.', asOfToday: true },
  { id: 'income', title: 'Income ledger', description: 'Every charge to a customer, by date, kind and car.' },
  { id: 'expenses', title: 'Expense report', description: 'Every running cost, by date, kind and car.' },
  { id: 'vehicle-profit', title: 'Profit by car', description: 'What each car brought in, cost and kept.' },
  { id: 'utilisation', title: 'Utilisation by car', description: 'How many days each car was out, and what each rented day earned.' },
  { id: 'top-customers', title: 'Revenue by customer', description: 'Who your business earns from, biggest first.' },
  { id: 'refunds', title: 'Refunds', description: 'Every refund paid back to a customer, with the reason.' },
  { id: 'fleet-capital', title: 'Cars bought and sold', description: 'Fleet purchases and disposals — kept out of profit.' },
];

/** `YYYY-MM-DD` → the same date, unshifted by the reader's timezone. */
function day(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/** "was $X" — the only trace a correction leaves, and it must leave one. */
function noteFor(row: { originalAmount?: number }, money: (n: number) => string): string {
  return row.originalAmount != null ? `Changed on Insights (recorded ${money(row.originalAmount)})` : '';
}

const counted = (rows: LedgerRow[]) => rows.filter((r) => !r.excluded);

/** Days from one calendar date to another, both ends counted. */
function dayCount(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}
const sum = (rows: Row[], key: string) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
const byNewest = (a: LedgerRow, b: LedgerRow) => (b.entry_date ?? '').localeCompare(a.entry_date ?? '');

/** Drop the Note column when nothing in the report was corrected. */
function withNotes(columns: Column[], rows: Row[]): Column[] {
  return rows.some((r) => r.note) ? [...columns, { key: 'note', label: 'Note' }] : columns;
}

export function periodLabel(months: PeriodMonths): string {
  const { from, to } = periodRange(months);
  return `${from} to ${to}`;
}

export function buildReport(
  id: ReportId,
  data: InsightsData,
  months: PeriodMonths,
  money: (n: number) => string,
): ReportTable {
  const period = periodLabel(months);
  const labels = data.vehicleLabels;
  const car = (vid: string | null) => (vid ? vehicleName(labels, vid) : '');

  switch (id) {
    case 'pnl': {
      const r = data.receipt;
      const rows: Row[] = [
        { line: 'Money you took in', detail: 'Everything charged to customers', amount: r.tookIn },
        { line: 'Money you gave back', detail: 'Refunds to customers', amount: -r.gaveBack },
        { line: 'Money that was never yours', detail: 'Sales tax and refundable deposits', amount: -r.neverYours },
        { line: 'Money you spent', detail: 'Running the business', amount: -r.spent },
        { line: 'Money you kept', detail: 'What is left', amount: r.kept },
        { line: 'Car purchases and sales', detail: 'Capital — not counted above', amount: r.carPurchases },
        { line: 'Still owed to you', detail: 'As of today, every invoice', amount: data.aging.total },
      ];
      return {
        title: 'Profit & loss',
        subtitle: period,
        columns: [
          { key: 'line', label: 'Line' },
          { key: 'detail', label: 'What it is' },
          { key: 'amount', label: 'Amount', money: true },
        ],
        rows,
      };
    }

    case 'monthly': {
      const rows: Row[] = data.monthly.map((m) => ({
        month: m.label,
        revenue: m.revenue,
        cost: m.cost,
        profit: m.profit,
        margin: m.revenue > 0 ? `${((m.profit / m.revenue) * 100).toFixed(0)}%` : '',
      }));
      const revenue = sum(rows, 'revenue');
      const profit = sum(rows, 'profit');
      return {
        title: 'Monthly profit & loss',
        subtitle: `${period} · your own revenue, tax and deposits removed`,
        columns: [
          { key: 'month', label: 'Month' },
          { key: 'revenue', label: 'Money in', money: true },
          { key: 'cost', label: 'Spent', money: true },
          { key: 'profit', label: 'Kept', money: true },
          { key: 'margin', label: 'Kept %', align: 'right' },
        ],
        rows,
        totals: {
          month: 'Total',
          revenue,
          cost: sum(rows, 'cost'),
          profit,
          margin: revenue > 0 ? `${((profit / revenue) * 100).toFixed(0)}%` : '',
        },
      };
    }

    case 'sales-tax': {
      // Tax is what is in the "never yours" bucket that is not a deposit.
      const lines = counted(data.ledger)
        .filter((r) => r.bucket === 'non_revenue' && r.category !== 'Security Deposit')
        .sort(byNewest);
      const rows: Row[] = lines.map((r) => ({
        date: day(r.entry_date),
        kind: r.category ?? 'Tax',
        car: car(r.vehicle_id),
        amount: toNumber(r.amount),
        note: noteFor(r, money),
      }));
      return {
        title: 'Sales tax collected',
        subtitle: `${period} · collected for the state, owed onward`,
        columns: withNotes(
          [
            { key: 'date', label: 'Date' },
            { key: 'kind', label: 'Kind' },
            { key: 'car', label: 'Car' },
            { key: 'amount', label: 'Amount', money: true },
          ],
          rows,
        ),
        rows,
        totals: { date: 'Total', amount: sum(rows, 'amount') },
      };
    }

    case 'income':
    case 'expenses':
    case 'fleet-capital': {
      const buckets =
        id === 'income'
          ? ['operating_revenue', 'non_revenue']
          : id === 'expenses'
            ? ['operating_cost']
            : ['capital_cost'];
      const lines = counted(data.ledger)
        .filter((r) => buckets.includes(r.bucket ?? ''))
        .sort(byNewest);
      const rows: Row[] = lines.map((r) => ({
        date: day(r.entry_date),
        kind: r.category ?? '',
        car: car(r.vehicle_id) || 'Not tied to a car',
        amount: toNumber(r.amount),
        note: noteFor(r, money),
      }));
      const title = id === 'income' ? 'Income ledger' : id === 'expenses' ? 'Expense report' : 'Cars bought and sold';
      return {
        title,
        subtitle: period,
        columns: withNotes(
          [
            { key: 'date', label: 'Date' },
            { key: 'kind', label: 'Kind' },
            { key: 'car', label: 'Car' },
            { key: 'amount', label: 'Amount', money: true },
          ],
          rows,
        ),
        rows,
        totals: { date: 'Total', amount: sum(rows, 'amount') },
      };
    }

    case 'vehicle-profit': {
      // Revenue and cost per car, from the same counted, classified rows.
      const per = new Map<string, { revenue: number; cost: number }>();
      for (const r of counted(data.ledger)) {
        if (!r.vehicle_id) continue;
        const t = per.get(r.vehicle_id) ?? { revenue: 0, cost: 0 };
        if (r.bucket === 'operating_revenue') t.revenue += toNumber(r.amount);
        else if (r.bucket === 'operating_cost') t.cost += toNumber(r.amount);
        else continue;
        per.set(r.vehicle_id, t);
      }
      const rows: Row[] = [...per.entries()]
        .map(([vid, t]) => ({ car: car(vid), revenue: t.revenue, cost: t.cost, profit: t.revenue - t.cost }))
        .sort((a, b) => (b.profit as number) - (a.profit as number));
      return {
        title: 'Profit by car',
        subtitle: `${period} · your own revenue less each car's running costs`,
        columns: [
          { key: 'car', label: 'Car' },
          { key: 'revenue', label: 'Money in', money: true },
          { key: 'cost', label: 'Spent', money: true },
          { key: 'profit', label: 'Kept', money: true },
        ],
        rows,
        totals: { car: 'Total', revenue: sum(rows, 'revenue'), cost: sum(rows, 'cost'), profit: sum(rows, 'profit') },
      };
    }

    case 'refunds': {
      const rows: Row[] = data.refunds
        .filter((r) => !r.excluded)
        .map((r) => ({
          date: day(r.date),
          customer: r.customerName ?? 'Customer no longer on record',
          car: r.vehicleId ? car(r.vehicleId) : '',
          reason: r.reason?.replace(/\s+/g, ' ').trim() || 'No reason recorded',
          amount: r.amount,
          note: noteFor(r, money),
        }));
      return {
        title: 'Refunds',
        subtitle: period,
        columns: withNotes(
          [
            { key: 'date', label: 'Date' },
            { key: 'customer', label: 'Customer' },
            { key: 'car', label: 'Car' },
            { key: 'reason', label: 'Reason' },
            { key: 'amount', label: 'Amount', money: true },
          ],
          rows,
        ),
        rows,
        totals: { date: 'Total', amount: sum(rows, 'amount') },
      };
    }

    case 'payments-in': {
      const rows: Row[] = data.paymentsIn.map((p) => ({
        date: day(p.date),
        customer: p.customerName ?? '',
        car: p.vehicleId ? car(p.vehicleId) : '',
        method: p.method ?? '',
        type: p.type ?? '',
        status: p.status ?? '',
        amount: p.amount,
      }));
      return {
        title: 'Payments received',
        subtitle: `${period} · every payment dated in the period, as recorded`,
        columns: [
          { key: 'date', label: 'Date' },
          { key: 'customer', label: 'Customer' },
          { key: 'car', label: 'Car' },
          { key: 'method', label: 'Method' },
          { key: 'type', label: 'Type' },
          { key: 'status', label: 'Status' },
          { key: 'amount', label: 'Amount', money: true },
        ],
        rows,
        totals: { date: 'Total', amount: sum(rows, 'amount') },
      };
    }

    case 'rentals': {
      const rows: Row[] = data.rentals.map((r) => ({
        ref: r.number ?? r.id.slice(0, 8),
        customer: r.customerName ?? '',
        car: r.vehicleId ? car(r.vehicleId) : '',
        start: day(r.start),
        end: day(r.end),
        days: dayCount(r.start, r.end) ?? '',
        status: r.status ?? '',
        source: r.source ?? '',
      }));
      return {
        title: 'Rental register',
        subtitle: `${period} · every rental that overlaps the period`,
        columns: [
          { key: 'ref', label: 'Rental' },
          { key: 'customer', label: 'Customer' },
          { key: 'car', label: 'Car' },
          { key: 'start', label: 'Start' },
          { key: 'end', label: 'End' },
          { key: 'days', label: 'Days', align: 'right' },
          { key: 'status', label: 'Status' },
          { key: 'source', label: 'Source' },
        ],
        rows,
      };
    }

    case 'due-back': {
      // Cars out right now: an Active rental that has started. Overdue first,
      // then soonest due — the order an operator works the phone in.
      const today = periodRange(months).to;
      const rows: Row[] = data.rentals
        .filter((r) => r.status === 'Active' && r.start && r.start <= today && r.end)
        .map((r) => {
          const left = dayCount(today, r.end) ?? 0; // inclusive count
          const diff = left - 1; // days from today to the due date
          return {
            due: day(r.end),
            when: diff < 0 ? `Overdue ${-diff} ${-diff === 1 ? 'day' : 'days'}` : diff === 0 ? 'Today' : `In ${diff} ${diff === 1 ? 'day' : 'days'}`,
            ref: r.number ?? r.id.slice(0, 8),
            customer: r.customerName ?? '',
            car: r.vehicleId ? car(r.vehicleId) : '',
            sort: diff,
          };
        })
        .sort((a, b) => (a.sort as number) - (b.sort as number))
        .map(({ sort: _sort, ...rest }) => rest);
      return {
        title: 'Cars due back',
        subtitle: `As of ${today} · cars out now, overdue first`,
        columns: [
          { key: 'due', label: 'Due back' },
          { key: 'when', label: 'When' },
          { key: 'ref', label: 'Rental' },
          { key: 'customer', label: 'Customer' },
          { key: 'car', label: 'Car' },
        ],
        rows,
      };
    }

    case 'utilisation': {
      const { from, to, days } = periodRange(months);
      const rented = new Map<string, number>();
      for (const r of data.rentals) {
        if (!r.vehicleId || !(r.status === 'Active' || r.status === 'Closed') || !r.start || !r.end) continue;
        const s0 = r.start > from ? r.start : from;
        const e0 = r.end < to ? r.end : to;
        const n = dayCount(s0, e0);
        if (n && n > 0) rented.set(r.vehicleId, (rented.get(r.vehicleId) ?? 0) + n);
      }
      const earned = new Map<string, number>();
      for (const r of counted(data.ledger)) {
        if (r.bucket !== 'operating_revenue' || !r.vehicle_id) continue;
        earned.set(r.vehicle_id, (earned.get(r.vehicle_id) ?? 0) + toNumber(r.amount));
      }
      const ids = new Set([...data.vehicleLabels.keys(), ...rented.keys(), ...earned.keys()]);
      const rows: Row[] = [...ids]
        .map((vid) => {
          const out = Math.min(days, rented.get(vid) ?? 0);
          const got = earned.get(vid) ?? 0;
          return {
            car: car(vid),
            out,
            available: days,
            pct: `${((out / days) * 100).toFixed(0)}%`,
            revenue: got,
            perDay: out > 0 ? got / out : null,
          };
        })
        .sort((a, b) => (b.out as number) - (a.out as number));
      return {
        title: 'Utilisation by car',
        subtitle: `${period} · days out against days in the period`,
        columns: [
          { key: 'car', label: 'Car' },
          { key: 'out', label: 'Days out', align: 'right' },
          { key: 'available', label: 'Days in period', align: 'right' },
          { key: 'pct', label: 'Utilisation', align: 'right' },
          { key: 'revenue', label: 'Money in', money: true },
          { key: 'perDay', label: 'Per rented day', money: true },
        ],
        rows,
        totals: { car: 'Total', out: sum(rows, 'out'), revenue: sum(rows, 'revenue') },
      };
    }

    case 'top-customers': {
      const per = new Map<string, { money: number; rentals: Set<string> }>();
      for (const r of counted(data.ledger)) {
        if (r.bucket !== 'operating_revenue' || !r.customer_id) continue;
        const t = per.get(r.customer_id) ?? { money: 0, rentals: new Set<string>() };
        t.money += toNumber(r.amount);
        if (r.rental_id) t.rentals.add(r.rental_id);
        per.set(r.customer_id, t);
      }
      const total = [...per.values()].reduce((s, t) => s + t.money, 0);
      const rows: Row[] = [...per.entries()]
        .map(([cid, t]) => ({
          customer: data.customerNames.get(cid) ?? 'Customer no longer on record',
          rentals: t.rentals.size,
          revenue: t.money,
          share: total > 0 ? `${((t.money / total) * 100).toFixed(1)}%` : '',
        }))
        .sort((a, b) => (b.revenue as number) - (a.revenue as number));
      return {
        title: 'Revenue by customer',
        subtitle: `${period} · your own revenue, tax and deposits removed`,
        columns: [
          { key: 'customer', label: 'Customer' },
          { key: 'rentals', label: 'Rentals', align: 'right' },
          { key: 'revenue', label: 'Money in', money: true },
          { key: 'share', label: 'Share', align: 'right' },
        ],
        rows,
        totals: { customer: 'Total', rentals: sum(rows, 'rentals'), revenue: total },
      };
    }

    case 'receivables': {
      const rows: Row[] = data.receivables.map((r) => ({
        customer: r.customerName ?? 'Customer no longer on record',
        d0: r.bucket_0_30,
        d31: r.bucket_31_60,
        d61: r.bucket_61_90,
        d90: r.bucket_90_plus,
        total: r.total,
      }));
      return {
        title: 'Who owes you',
        subtitle: `As of ${periodRange(months).to} · oldest debt first`,
        columns: [
          { key: 'customer', label: 'Customer' },
          { key: 'd0', label: '0–30 days', money: true },
          { key: 'd31', label: '31–60 days', money: true },
          { key: 'd61', label: '61–90 days', money: true },
          { key: 'd90', label: '90+ days', money: true },
          { key: 'total', label: 'Total', money: true },
        ],
        rows,
        totals: {
          customer: 'Total',
          d0: data.aging.bucket_0_30,
          d31: data.aging.bucket_31_60,
          d61: data.aging.bucket_61_90,
          d90: data.aging.bucket_90_plus,
          total: data.aging.total,
        },
      };
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Writers
 * ──────────────────────────────────────────────────────────────────────────── */

/** RFC 4180: quote everything that needs it, double the quotes inside. */
function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = typeof value === 'number' ? value.toFixed(2) : value;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(table: ReportTable): string {
  const lines = [table.columns.map((c) => csvCell(c.label)).join(',')];
  for (const row of [...table.rows, ...(table.totals ? [table.totals] : [])]) {
    lines.push(table.columns.map((c) => csvCell(row[c.key] as string | number | null)).join(','));
  }
  // BOM so Excel opens a UTF-8 file (the en dash, the minus) as UTF-8.
  return '﻿' + lines.join('\r\n');
}

export function fileName(table: ReportTable, company: string, ext: 'csv' | 'pdf'): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const date = new Date().toISOString().slice(0, 10);
  return `${slug(company || 'drive247')}-${slug(table.title)}-${date}.${ext}`;
}

export function download(content: Blob, name: string): void {
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A clean, flat PDF table: company and title on top, an indigo-tinted header
 * row (the portal's table header), zebra-free rows with hairline rules, a
 * bold totals row, page numbers. Landscape when there are many columns.
 * jsPDF is loaded on demand — it is only needed the moment someone clicks.
 */
export async function toPdf(table: ReportTable, company: string, money: (n: number) => string): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const landscape = table.columns.length > 5;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const usable = W - M * 2;

  // Column widths: money columns fixed, text columns share the rest.
  const moneyW = 84;
  const textCols = table.columns.filter((c) => !c.money);
  const textW = (usable - (table.columns.length - textCols.length) * moneyW) / Math.max(1, textCols.length);
  const widths = table.columns.map((c) => (c.money ? moneyW : textW));

  const cell = (row: Row, c: Column) => {
    const v = row[c.key];
    if (v == null || v === '') return '';
    return c.money && typeof v === 'number' ? money(v) : String(v);
  };

  let y = M;
  const header = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(115, 115, 115);
    doc.text(company.toUpperCase(), M, y);
    y += 20;
    doc.setFontSize(18);
    doc.setTextColor(8, 8, 18);
    doc.text(table.title, M, y);
    y += 16;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(115, 115, 115);
    doc.text(table.subtitle, M, y);
    y += 22;
  };
  const headRow = () => {
    doc.setFillColor(238, 242, 255);
    doc.rect(M, y - 13, usable, 20, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(64, 64, 64);
    let x = M;
    table.columns.forEach((c, i) => {
      const right = c.money || c.align === 'right';
      doc.text(c.label, right ? x + widths[i] - 6 : x + 6, y, { align: right ? 'right' : 'left' });
      x += widths[i];
    });
    y += 18;
  };
  const line = (row: Row, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(9);
    doc.setTextColor(8, 8, 18);
    const wrapped = table.columns.map((c, i) => doc.splitTextToSize(cell(row, c), widths[i] - 12) as string[]);
    const h = Math.max(1, ...wrapped.map((w) => w.length)) * 11 + 6;
    if (y + h > H - M - 10) {
      doc.addPage();
      y = M;
      headRow();
    }
    let x = M;
    table.columns.forEach((c, i) => {
      const right = c.money || c.align === 'right';
      doc.text(wrapped[i], right ? x + widths[i] - 6 : x + 6, y, { align: right ? 'right' : 'left' });
      x += widths[i];
    });
    y += h - 6;
    doc.setDrawColor(241, 245, 249);
    doc.line(M, y - 4, M + usable, y - 4);
    y += 8;
  };

  header();
  headRow();
  if (table.rows.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(115, 115, 115);
    doc.text('Nothing in this period.', M + 6, y);
  }
  table.rows.forEach((r) => line(r));
  if (table.totals) line(table.totals, true);

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated ${new Date().toLocaleString()} · Drive247`, M, H - 20);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 20, { align: 'right' });
  }
  return doc.output('blob');
}
