'use client';

/**
 * Insights — the receipt.
 *
 * The hero of the page, and deliberately not a row of KPI tiles.
 *
 * Four tiles sitting side by side say "here are four facts" and leave the
 * operator to work out how they relate. They do relate — they are four lines of
 * one sum — and a receipt is the form that says so. Reading top to bottom you
 * can see the money arrive, see each thing that takes a bite out of it, and see
 * what survived. Nobody has to be told how to read a receipt.
 *
 * ── The rules this component follows ────────────────────────────────────────
 *
 * 1. ONE number is large. "Money you kept" is the figure the operator opened
 *    the page for; every other number on the receipt is the argument for it.
 *    If two numbers are the same size, neither is the answer.
 *
 * 2. Every label is in plain English, and so is the grey line under it. Not
 *    "Operating revenue" but "Money you took in", and under it, in words, the
 *    things that are in it. An operator should never have to hold a definition
 *    in their head to read their own P&L.
 *
 * 3. The whole row is the click target. A row with a "Details" button on the
 *    end teaches people that most of the row is dead, and then they stop
 *    looking for detail anywhere. Chevron on the right, whole row clickable.
 *
 * 4. A row worth zero still renders. Deleting it would quietly change the sum
 *    the reader is checking. It says "none this period" and stops being
 *    clickable, because a dialog onto an empty list is a small betrayal.
 */

import { useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Clock,
  SlidersHorizontal,
} from 'lucide-react';
import { Skeleton } from '@/components/ui-v2/skeleton';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import { keptShare } from './_money-model';
import type { InsightsData } from './_data';
import {
  CarPurchasesDialog,
  GaveBackDialog,
  NeverYoursDialog,
  OwedDialog,
  SpentDialog,
  TookInDialog,
} from './_receipt-dialogs';
import { CategoriesDialog } from './_categories';

/** Which dialog is open, if any. */
type Row = 'tookIn' | 'gaveBack' | 'neverYours' | 'spent' | 'owed' | 'carPurchases' | 'categories';

/**
 * U+2212 MINUS SIGN, not a hyphen.
 *
 * A hyphen is narrower than a digit and sits at the wrong height, so a column
 * of `-1,240` next to `26,115` is visibly ragged in a tabular-nums column. The
 * minus sign is digit-width by design.
 */
const MINUS = '−';

/* ────────────────────────────────────────────────────────────────────────────
 * Rows
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One line of the equation: its operator in a soft circle, the line's name
 * with a quiet sub-line, the amount on the right. The whole row opens the
 * rows behind it; a line worth nothing says "none" and does not.
 */
function EquationRow({
  op,
  tone,
  label,
  sub,
  amount,
  money,
  loading,
  onOpen,
}: {
  /** An operator, or an icon for a line that sits beside the sum, not in it. */
  op: '+' | '−' | ReactNode;
  tone?: 'owed';
  label: string;
  sub: string;
  amount: number;
  money: (n: number) => string;
  loading: boolean;
  onOpen: () => void;
}) {
  const isZero = Math.abs(amount) < 0.005;
  const clickable = !loading && !isZero;
  const plus = op === '+';
  const inner = (
    <>
      <span
        aria-hidden
        className={cn(
          'flex size-7 items-center justify-center rounded-full text-[15px] font-semibold',
          tone === 'owed'
            ? 'bg-destructive/10 text-destructive'
            : plus
              ? 'bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]'
              : 'bg-foreground/[0.05] text-muted-foreground',
        )}
      >
        {op}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-medium">{label}</span>
        <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{sub}</span>
      </span>
      {loading ? (
        <Skeleton className="h-6 w-24" />
      ) : (
        <span
          className={cn(
            'text-right font-heading text-xl leading-none font-medium tabular-nums',
            isZero && 'text-[15px] font-normal text-muted-foreground',
            !plus && !isZero && tone !== 'owed' && 'text-foreground/80',

          )}
        >
          {isZero ? 'none' : money(amount)}
        </span>
      )}
      <span className="flex size-4 items-center justify-center">
        {clickable ? (
          <ChevronRight
            className="size-4 text-muted-foreground/50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
            aria-hidden
          />
        ) : null}
      </span>
    </>
  );
  const shell = cn(
    'grid w-full grid-cols-[28px_minmax(0,1fr)_auto_16px] items-center gap-x-4 rounded-2xl px-4 py-3.5 text-left [@media(max-height:860px)]:py-2.5',
    // Owed sits on a light red wash; its text stays ink, like every line.
    tone === 'owed' && 'mt-2 bg-destructive/[0.06]',
  );
  return clickable ? (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        shell,
        'group cursor-pointer transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
        tone === 'owed' ? 'hover:bg-destructive/[0.1]' : 'hover:bg-primary/[0.05]',
      )}
    >
      {inner}
    </button>
  ) : (
    <div className={shell}>{inner}</div>
  );
}

export function MoneyReceipt({
  data,
  loading,
  currency,
}: {
  data: InsightsData | undefined;
  loading: boolean;
  currency: string;
}) {
  const [openRow, setOpenRow] = useState<Row | null>(null);

  /*
   * Whole units on the receipt. This is the headline; the dialogs behind each
   * row carry the pennies, and a headline quoting $26,115.47 reads as precision
   * nobody asked for and nobody checks.
   *
   * BOTH fraction-digit options, and do not "tidy" the minimum away. `Intl`
   * defaults a currency's minimum to 2 and THROWS RangeError when the minimum
   * exceeds the maximum, which `formatCurrency` swallows into its
   * `USD 25409.37` fallback — so passing the maximum alone silently turns every
   * figure on the page into an unformatted string with a currency code stuck on
   * the front. It is not a crash, which is why it survives review.
   */
  const money = (amount: number) =>
    formatCurrency(amount, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const receipt = data?.receipt;
  const kept = receipt?.kept ?? 0;

  const shareKept = receipt ? keptShare(receipt) : null;

  const owed = data?.aging.total ?? 0;
  const owedCount = data?.receivables.length ?? 0;

  const dialogProps = { data, loading, currency };
  const close = () => setOpenRow(null);

  return (
    <>
      {/*
        Plain on the page, not in a card. The receipt is the page's answer, and
        a box around it made it read as one widget among several. `-mx-3` lines
        the labels up with the page title while the rows keep the 12px inset
        their hover wash needs.
      */}
      <div className="-mx-3 space-y-1 xl:flex xl:h-full xl:flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 px-3 pb-2">
          <h2 className="font-heading text-lg font-medium tracking-tight">
            Where your money went
          </h2>

          <div className="flex items-center gap-1">
            {/*
              Which ledger categories land on which line. The period picker
              that used to sit here moved to the page header: it governs every
              view now, not just this one.
            */}
            <button
              type="button"
              onClick={() => setOpenRow('categories')}
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
            >
              <SlidersHorizontal className="size-3.5" aria-hidden />
              What counts where
            </button>
          </div>
        </header>

        {/*
          Calm by design (Ghulam, 2026-10-02: "I want the user to not be
          overwhelmed"): the receipt is one card, written as the sum it is.
        */}
        <div className="space-y-3 px-3 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
          {/*
            The sum, written as a sum — one card, top to bottom: what came in,
            each thing taken off it, a double rule, and what is left. The
            operators sit in small circles in their own column so the eye
            reads "+ − − − =" down the left and the amounts down the right.
          */}
          <section className="flex flex-col rounded-3xl bg-card p-2 ring-1 ring-foreground/[0.07] xl:min-h-0 xl:flex-1">
            <div className="flex flex-col xl:flex-1 xl:justify-evenly">
              <EquationRow
                op="+"
                label="Money you took in"
                sub="rentals, extras, delivery, insurance"
                amount={receipt?.tookIn ?? 0}
                money={money}
                loading={loading}
                onOpen={() => setOpenRow('tookIn')}
              />
              <EquationRow
                op="−"
                label="Money you gave back"
                sub="refunds to customers"
                amount={receipt?.gaveBack ?? 0}
                money={money}
                loading={loading}
                onOpen={() => setOpenRow('gaveBack')}
              />
              <EquationRow
                op="−"
                label="Money that was never yours"
                sub="sales tax and refundable deposits"
                amount={receipt?.neverYours ?? 0}
                money={money}
                loading={loading}
                onOpen={() => setOpenRow('neverYours')}
              />
              <EquationRow
                op="−"
                label="Money you spent"
                sub="servicing, repairs, running the cars"
                amount={receipt?.spent ?? 0}
                money={money}
                loading={loading}
                onOpen={() => setOpenRow('spent')}
              />
            </div>

            {/* the rule a paper receipt draws before its total */}
            <div className="mx-4 my-1 border-t-[3px] border-double border-foreground/15" />

            {/* The answer: the same row as every other line, on a light green
                wash (light red for a loss) — the tint marks it, not the type. */}
            <div
              className={cn(
                'mt-1 grid grid-cols-[28px_minmax(0,1fr)_auto_16px] items-center gap-x-4 rounded-2xl px-4 py-3.5 [@media(max-height:860px)]:py-2.5',
                kept < 0 ? 'bg-destructive/[0.07]' : 'bg-success/[0.09]',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-[15px] font-semibold',
                  kept < 0 ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success',
                )}
              >
                =
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium">Money you kept</span>
                <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
                  {loading ? '' : shareKept == null ? 'Nothing came in this period' : `${shareKept.toFixed(0)}% of what you took in`}
                </span>
              </span>
              {loading ? (
                <Skeleton className="h-6 w-24" />
              ) : (
                <span className="text-right font-heading text-xl leading-none font-medium tabular-nums">
                  {kept < 0 ? `${MINUS} ${money(Math.abs(kept))}` : money(kept)}
                </span>
              )}
              <span />
            </div>

            {/* Beside the sum, not in it: what is still owed, as of today. */}
            <EquationRow
              op={<Clock className="size-3.5" />}
              tone="owed"
              label="Still owed to you"
              sub={owed > 0 ? `${owedCount} ${owedCount === 1 ? 'customer' : 'customers'} · as of today · not in the sum` : 'as of today'}
              amount={owed}
              money={money}
              loading={loading}
              onOpen={() => setOpenRow('owed')}
            />
          </section>

          {/*
            Fleet investment, stated plainly and OUTSIDE the sum — the most
            common way to misread "kept" would be to assume it already allows
            for the cars bought. See `_money-model.ts`.
          */}
          <CapitalFootnote data={data} loading={loading} money={money} onOpen={() => setOpenRow('carPurchases')} />
        </div>

        {/*
          Said on the receipt itself: these figures include the operator's own
          corrections, and nobody should have to remember that they made some.
        */}
        {!loading && data && data.adjustedCount > 0 ? (
          <p className="px-3 pt-2 text-[13px] text-muted-foreground">
            Includes your changes to{' '}
            <span className="font-medium tabular-nums text-foreground">
              {data.adjustedCount.toLocaleString()} {data.adjustedCount === 1 ? 'entry' : 'entries'}
            </span>
            . Open a line above to see or undo them.
          </p>
        ) : null}
      </div>

      <TookInDialog open={openRow === 'tookIn'} onOpenChange={close} {...dialogProps} />
      <GaveBackDialog open={openRow === 'gaveBack'} onOpenChange={close} {...dialogProps} />
      <NeverYoursDialog open={openRow === 'neverYours'} onOpenChange={close} {...dialogProps} />
      <SpentDialog open={openRow === 'spent'} onOpenChange={close} {...dialogProps} />
      <OwedDialog open={openRow === 'owed'} onOpenChange={close} {...dialogProps} />
      <CategoriesDialog
        open={openRow === 'categories'}
        onOpenChange={close}
        data={data}
        currency={currency}
      />
      <CarPurchasesDialog
        open={openRow === 'carPurchases'}
        onOpenChange={close}
        {...dialogProps}
      />
    </>
  );
}

/**
 * The one-line note about money spent on the fleet itself.
 *
 * Only rendered when there is any. A tenant who has not booked a vehicle
 * purchase does not need a line telling them it was zero — unlike the rows
 * above it, this one is not part of a sum the reader is checking, so leaving it
 * out changes nothing.
 */
function CapitalFootnote({
  data,
  loading,
  money,
  onOpen,
}: {
  data: InsightsData | undefined;
  loading: boolean;
  money: (amount: number) => string;
  onOpen: () => void;
}) {
  if (loading || !data || data.receipt.carPurchases <= 0) return null;

  // "Purchases" only when that is all it was. A period that also sold a car
  // would be mislabelled by it, and mislabelling a number is the exact fault
  // this whole screen exists to correct.
  const soldSomething = data.ledger.some(
    (row) => row.bucket === 'capital_cost' && row.category === 'Disposal',
  );
  const label = soldSomething ? 'Buying and selling cars this period' : 'Car purchases this period';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group mt-2 grid w-full grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-4',
        'cursor-pointer rounded-3xl px-3 py-2.5 text-left text-[13px] transition-colors',
        'hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      )}
    >
      <span className="text-muted-foreground">
        {label}:{' '}
        <span className="font-medium tabular-nums text-foreground">
          {money(data.receipt.carPurchases)}
        </span>{' '}
        — not counted above
      </span>
      <ChevronRight
        className="size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden
      />
    </button>
  );
}
