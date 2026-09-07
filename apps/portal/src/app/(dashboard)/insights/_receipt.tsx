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

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui-v2/card';
import { Skeleton } from '@/components/ui-v2/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui-v2/select';
import { formatCurrency } from '@/lib/format-utils';
import { cn } from '@/lib/utils';
import { keptShare } from './_money-model';
import { PERIOD_OPTIONS, type InsightsData, type PeriodMonths } from './_data';
import {
  CarPurchasesDialog,
  GaveBackDialog,
  NeverYoursDialog,
  OwedDialog,
  SpentDialog,
  TookInDialog,
} from './_receipt-dialogs';

/** Which dialog is open, if any. */
type Row = 'tookIn' | 'gaveBack' | 'neverYours' | 'spent' | 'owed' | 'carPurchases';

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
 * One line of the receipt.
 *
 * Rendered as a `<button>` when there is something behind it and a plain `<div>`
 * when there is not, rather than a disabled button — a disabled control implies
 * "not right now", and this is "there is nothing here, permanently". The
 * chevron column keeps its width either way so the amounts stay in one line
 * down the page.
 */
function ReceiptRow({
  label,
  sub,
  amount,
  money,
  negative,
  loading,
  zeroLabel = 'none this period',
  onOpen,
}: {
  label: string;
  sub: string;
  amount: number;
  money: (amount: number) => string;
  negative?: boolean;
  loading: boolean;
  zeroLabel?: string;
  onOpen: () => void;
}) {
  /*
   * Below half a penny, not exactly zero.
   *
   * These are sums of `numeric` columns crossing a JS float, so a row that is
   * genuinely empty can land on 1e-13 — and `=== 0` would then call that a real
   * amount, print "$0" and open a dialog onto nothing.
   *
   * Half a penny and not, say, half a dollar: the dialogs report to the penny,
   * so anything they could show is treated as real here. A 40¢ refund does
   * round to "$0" on this line, which looks odd — but it is odd because it
   * happened, and the row stays clickable so the reader can find out why. The
   * alternative is a screen that says "none this period" about money that
   * genuinely moved.
   */
  const isZero = Math.abs(amount) < 0.005;
  const clickable = !loading && !isZero;

  const body = (
    <>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{sub}</span>
      </span>

      {loading ? (
        <Skeleton className="h-6 w-24 justify-self-end" />
      ) : isZero ? (
        <span className="justify-self-end text-[15px] text-muted-foreground">{zeroLabel}</span>
      ) : (
        <span className="justify-self-end font-heading text-xl leading-none font-medium tabular-nums">
          {negative ? `${MINUS} ` : ''}
          {money(amount)}
        </span>
      )}

      <span className="flex size-4 items-center justify-center">
        {clickable ? (
          <ChevronRight
            className="size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
            aria-hidden
          />
        ) : null}
      </span>
    </>
  );

  /*
   * The same box either way.
   *
   * Both variants carry the identical padding, so a clickable row and a zeroed
   * one line their labels and their amounts up to the pixel. Pulling the button
   * out with a negative margin to widen its hover target would shift its text
   * 12px left of every row that is not clickable, and a column of numbers that
   * steps in and out depending on whether a row happens to be zero this month is
   * exactly the sort of thing that makes a money screen feel untrustworthy
   * without anyone being able to say why.
   */
  const shell = 'grid w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-4 px-3 py-3.5';

  if (!clickable) {
    return <div className={cn(shell, 'text-left')}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        shell,
        'group cursor-pointer rounded-3xl text-left transition-colors',
        'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      )}
    >
      {body}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * The receipt
 * ──────────────────────────────────────────────────────────────────────────── */

export function MoneyReceipt({
  data,
  loading,
  currency,
  months,
  onMonthsChange,
}: {
  data: InsightsData | undefined;
  loading: boolean;
  currency: string;
  months: PeriodMonths;
  onMonthsChange: (months: PeriodMonths) => void;
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
  const owedOver90 = data?.aging.bucket_90_plus ?? 0;

  /*
   * The grey line under "Still owed to you", built from the data rather than
   * written down. It also carries "as of today", because this row alone ignores
   * the period selector — the same qualifier the ageing chart already uses.
   */
  const owedSub = loading
    ? // Not "everyone has paid" — while the read is in flight `owed` is 0, and
      // a placeholder that states a fact about the business is worse than one
      // that states nothing.
      'as of today, across every invoice'
    : owed <= 0
      ? 'as of today, everyone has paid'
      : [
          `${owedCount.toLocaleString()} ${owedCount === 1 ? 'customer' : 'customers'}`,
          owedOver90 > 0 ? `${money(owedOver90)} of it over 90 days` : null,
          'as of today',
        ]
          .filter(Boolean)
          .join(' · ');

  const dialogProps = { data, loading, currency };
  const close = () => setOpenRow(null);

  return (
    <>
      <Card>
        {/*
          The card is as wide as the charts below it; the receipt inside is not.

          A receipt read across 1,500px is a label stranded on the far left and a
          number stranded on the far right, with the eye given nothing to follow
          between them. Capped to a reading measure and centred, the label, the
          amount and the chevron stay in one glance — which is the entire reason
          this is a receipt rather than four tiles.
        */}
        <CardContent className="mx-auto w-full max-w-3xl space-y-1">
          <header className="flex flex-wrap items-center justify-between gap-4 px-3 pb-2">
            <h2 className="font-heading text-lg font-medium tracking-tight">
              Where your money went
            </h2>

            {/*
              The period control lives on the receipt, not in the page header,
              because the receipt is what an operator is reading when they think
              "and what about the last three months?". It still governs the whole
              page — the charts below read the same query.
            */}
            <Select
              value={String(months)}
              onValueChange={(value) => onMonthsChange(Number(value) as PeriodMonths)}
            >
              <SelectTrigger className="w-[170px]" aria-label="Reporting period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </header>

          <ReceiptRow
            label="Money you took in"
            sub="rentals, extras, delivery, insurance"
            amount={receipt?.tookIn ?? 0}
            money={money}
            loading={loading}
            onOpen={() => setOpenRow('tookIn')}
          />

          <ReceiptRow
            label="Money you gave back"
            sub="refunds to customers"
            amount={receipt?.gaveBack ?? 0}
            money={money}
            negative
            loading={loading}
            onOpen={() => setOpenRow('gaveBack')}
          />

          <ReceiptRow
            label="Money that was never yours"
            sub="sales tax and refundable deposits"
            amount={receipt?.neverYours ?? 0}
            money={money}
            negative
            loading={loading}
            onOpen={() => setOpenRow('neverYours')}
          />

          <ReceiptRow
            label="Money you spent"
            sub="servicing, repairs, running the cars"
            amount={receipt?.spent ?? 0}
            money={money}
            negative
            loading={loading}
            onOpen={() => setOpenRow('spent')}
          />

          {/*
            A double rule, as a paper receipt uses before its total. It is doing
            real work: it marks where the list of deductions stops and the answer
            starts, which is the one boundary in this component that must not be
            missed at a glance.
          */}
          <div className="mx-3 mt-3 border-t-4 border-double border-foreground/20" />

          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-3 pt-5 pb-6">
            <div>
              <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Money you kept
              </p>
              {/*
                The share is the second half of this number's meaning: keeping
                $18,545 on $26,115 taken in and on $2M taken in are different
                businesses, and only one of them is worth celebrating.
              */}
              <p className="mt-1.5 min-h-[1.25rem] text-[13px] text-muted-foreground">
                {loading
                  ? ''
                  : shareKept == null
                    ? 'Nothing came in this period'
                    : `${shareKept.toFixed(0)}% of the money you took in`}
              </p>
            </div>

            {loading ? (
              <Skeleton className="h-12 w-52" />
            ) : (
              <p
                className={cn(
                  'font-heading text-4xl leading-none font-semibold tracking-tight tabular-nums sm:text-5xl',
                  // Plain ink when there is a profit — a green number would be
                  // the page congratulating the operator, which is not its job.
                  // Red only when the answer is genuinely a loss, which IS its
                  // job to say clearly.
                  kept < 0 && 'text-destructive',
                )}
              >
                {kept < 0 ? `${MINUS} ${money(Math.abs(kept))}` : money(kept)}
              </p>
            )}
          </div>

          <div className="mx-3 border-t border-foreground/10" />

          <div className="pt-1">
            <ReceiptRow
              label="Still owed to you"
              sub={owedSub}
              amount={owed}
              money={money}
              loading={loading}
              zeroLabel="nothing outstanding"
              onOpen={() => setOpenRow('owed')}
            />
          </div>

          {/*
            Fleet investment, stated plainly and OUTSIDE the sum.

            The single most common way to misread this page would be to assume
            "money you kept" already accounts for the cars bought — so the line
            says, in the same breath as the number, that it does not. It is
            never hidden and it is never inside the total. See `_money-model.ts`.
          */}
          <CapitalFootnote
            data={data}
            loading={loading}
            money={money}
            onOpen={() => setOpenRow('carPurchases')}
          />

          {/*
            Fleet utilisation, demoted from a KPI tile to a sentence.

            It is not money, so it does not belong in the sum above — but it is
            the first thing an operator asks after "what did I keep", so it sits
            here rather than three charts down. `null` renders as an em dash and
            never as 0%: see `computeUtilisation`.
          */}
          {!loading && data ? (
            <p className="px-3 pt-4 text-[13px] text-muted-foreground">
              Your cars were earning{' '}
              <span className="font-medium tabular-nums text-foreground">
                {data.utilisation == null ? '—' : `${data.utilisation.toFixed(0)}%`}
              </span>{' '}
              of the time
              {data.fleetSize > 0
                ? ` across ${data.fleetSize.toLocaleString()} ${data.fleetSize === 1 ? 'car' : 'cars'}.`
                : ', once there are cars on the fleet to measure.'}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <TookInDialog open={openRow === 'tookIn'} onOpenChange={close} {...dialogProps} />
      <GaveBackDialog open={openRow === 'gaveBack'} onOpenChange={close} {...dialogProps} />
      <NeverYoursDialog open={openRow === 'neverYours'} onOpenChange={close} {...dialogProps} />
      <SpentDialog open={openRow === 'spent'} onOpenChange={close} {...dialogProps} />
      <OwedDialog open={openRow === 'owed'} onOpenChange={close} {...dialogProps} />
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
  const soldSomething = data.ledger.some((row) => row.category === 'Disposal');
  const label = soldSomething ? 'Buying and selling cars this period' : 'Car purchases this period';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group mt-2 grid w-full grid-cols-[minmax(0,1fr)_1rem] items-center gap-x-4',
        'cursor-pointer rounded-3xl px-3 py-2.5 text-left text-[13px] transition-colors',
        'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
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
