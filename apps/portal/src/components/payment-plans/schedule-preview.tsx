"use client";

/**
 * The live preview beside the plan form: a LIST and a MONTH CALENDAR of the
 * dates the sentence produces, each with its amount and what it covers.
 *
 * It renders the ENGINE's own output (`computePreview` → `buildSchedule`), so
 * what the operator sees here is exactly what will be stored.
 *
 * The total line is the whole point of the panel and always reads
 * "N payments · $X total · rental balance $Y". When X and Y differ it says so
 * in words, and says what happens — the plan never collects more than the
 * rental owes (design D5), and anything it doesn't cover stays on the balance.
 *
 * Dates can be moved here (a list row's Move, or tap a date on the calendar
 * then the day to move it to). A move changes the DUE DATE only: the payment
 * still covers the same days and is the same amount.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, List, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import type { OccurrenceDraft, ScheduleOverride } from "@/lib/payment-plans/types";
import type { PreviewState } from "@/lib/payment-plans-ui/preview";
import type { PlanContext } from "@/lib/payment-plans-ui/plan-form-model";
import {
  addDays,
  dayNumber,
  formatCovers,
  formatDay,
  formatMoney,
  formatMonth,
  fromDayNumber,
  isoWeekday,
  plural,
  type ISODate,
} from "@/lib/payment-plans-ui/format";
import { InlineDate } from "./sentence-kit";

export interface SchedulePreviewProps {
  preview: PreviewState;
  ctx: PlanContext;
  currency: string;
  today: ISODate;
  /** What the balance is called beside the total ("rental balance", "left to pay"). */
  balanceLabel?: string;
  overrides?: ScheduleOverride[];
  /** Move payment `seq` to `to`; `null` puts it back. Omit to make the preview read-only. */
  onMove?: (seq: number, to: ISODate | null) => void;
}

export function SchedulePreview({
  preview,
  ctx,
  currency,
  today,
  balanceLabel = "rental balance",
  overrides = [],
  onMove,
}: SchedulePreviewProps) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const $ = (c: number) => formatMoney(c, currency);

  if (preview.ok === false) {
    return (
      <div className="rounded-3xl bg-muted/40 px-5 py-6 ring-1 ring-foreground/5" data-preview-state="invalid">
        <p className="font-heading text-sm font-semibold">No dates yet</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{preview.message}</p>
      </div>
    );
  }

  const { drafts, totalCents, differenceCents, dueNowCount } = preview;
  return (
    <div className="space-y-3" data-preview-state="ok">
      {/* ── the total line ─────────────────────────────────────────────── */}
      <div className="rounded-3xl bg-muted/40 px-5 py-4 ring-1 ring-foreground/5">
        <p className="text-[13px] font-medium tabular-nums" data-preview-total="">
          {plural(drafts.length, "payment")} · {$(totalCents)} total · {balanceLabel} {$(ctx.balanceCents)}
        </p>
        {differenceCents !== 0 && (
          <p
            role="status"
            className="mt-2 flex items-start gap-1.5 text-xs font-medium leading-relaxed text-destructive"
            data-preview-mismatch={differenceCents > 0 ? "over" : "under"}
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {differenceCents > 0
              ? `These payments add up to ${$(differenceCents)} more than is owed. A plan never takes more than the rental owes, so collection stops once the balance is paid.`
              : `These payments add up to ${$(-differenceCents)} less than is owed. That ${$(-differenceCents)} stays on the rental's balance.`}
          </p>
        )}
        {dueNowCount > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {dueNowCount === 1 ? "1 payment falls" : `${dueNowCount} payments fall`} on or before today and{" "}
            {dueNowCount === 1 ? "is" : "are"} collected as soon as the plan is set up.
          </p>
        )}
      </div>

      {/* ── list / calendar ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">Schedule</p>
        <div className="inline-flex rounded-full bg-muted/60 p-0.5" role="tablist" aria-label="Schedule view">
          {(
            [
              ["list", List, "List"],
              ["calendar", CalendarDays, "Calendar"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors",
                view === id
                  ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/5"
                  : "text-muted-foreground hover:text-primary dark:hover:text-[hsl(var(--v2-link,var(--primary)))]",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "list" ? (
        <PreviewList drafts={drafts} currency={currency} overrides={overrides} ctx={ctx} onMove={onMove} />
      ) : (
        <PreviewCalendar drafts={drafts} currency={currency} ctx={ctx} today={today} overrides={overrides} onMove={onMove} />
      )}
    </div>
  );
}

/* ── the list ──────────────────────────────────────────────────────────── */

function PreviewList({
  drafts,
  currency,
  overrides,
  ctx,
  onMove,
}: {
  drafts: OccurrenceDraft[];
  currency: string;
  overrides: ScheduleOverride[];
  ctx: PlanContext;
  onMove?: (seq: number, to: ISODate | null) => void;
}) {
  const moved = new Set(overrides.map((o) => o.seq));
  return (
    <ol className="max-h-[420px] divide-y divide-foreground/5 overflow-y-auto no-scrollbar rounded-3xl bg-muted/40 ring-1 ring-foreground/5" data-preview-list="">
      {drafts.map((d) => (
        <li key={d.seq} className="flex items-center gap-3 px-4 py-2.5" data-preview-row={d.seq}>
          <span className="w-6 shrink-0 text-[11px] tabular-nums text-muted-foreground">#{d.seq}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium leading-snug">
              {formatDay(d.dueDate)}
              {d.isStub && <span className="ml-1.5 text-[11px] font-normal text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">short first period</span>}
              {moved.has(d.seq) && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">moved</span>}
            </span>
            <span className="block truncate text-[11px] leading-snug text-muted-foreground">
              covers {formatCovers(d.periodStart, d.periodEnd)} · {plural(d.days, "day")}
            </span>
          </span>
          <span className="shrink-0 text-[13px] font-medium tabular-nums">{formatMoney(d.amountCents, currency)}</span>
          {onMove && (
            <span className="shrink-0">
              {moved.has(d.seq) ? (
                <Button type="button" variant="ghost" size="icon-xs" aria-label={`Put payment #${d.seq} back`} title="Put it back" onClick={() => onMove(d.seq, null)}>
                  <RotateCcw />
                </Button>
              ) : (
                <MoveButton seq={d.seq} value={d.dueDate} min={ctx.rentalStart} onMove={onMove} />
              )}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function MoveButton({ seq, value, min, onMove }: { seq: number; value: ISODate; min: ISODate; onMove: (seq: number, to: ISODate) => void }) {
  return (
    <span className="[&_button]:h-6 [&_button]:px-2 [&_button]:text-[11px]">
      <InlineDate label={`Move payment #${seq}`} value={null} placeholder="Move" min={min} onChange={(to) => to !== value && onMove(seq, to)} />
    </span>
  );
}

/* ── the calendar ──────────────────────────────────────────────────────── */

const WEEK_HEAD = ["M", "T", "W", "T", "F", "S", "S"];

function monthStart(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

function addMonths(first: ISODate, n: number): ISODate {
  const y = Number(first.slice(0, 4));
  const m = Number(first.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}

function PreviewCalendar({
  drafts,
  currency,
  ctx,
  today,
  overrides,
  onMove,
}: {
  drafts: OccurrenceDraft[];
  currency: string;
  ctx: PlanContext;
  today: ISODate;
  overrides: ScheduleOverride[];
  onMove?: (seq: number, to: ISODate | null) => void;
}) {
  const [month, setMonth] = useState(() => monthStart(drafts[0]?.dueDate ?? ctx.rentalStart));
  const [picked, setPicked] = useState<number | null>(null);
  const bySeq = useMemo(() => new Map(drafts.map((d) => [d.seq, d])), [drafts]);
  const byDate = useMemo(() => {
    const m = new Map<ISODate, OccurrenceDraft[]>();
    for (const d of drafts) m.set(d.dueDate, [...(m.get(d.dueDate) ?? []), d]);
    return m;
  }, [drafts]);
  const moved = new Set(overrides.map((o) => o.seq));

  const first = month;
  const lead = isoWeekday(first) - 1;
  const gridStart = dayNumber(first) - lead;
  const nextMonth = addMonths(first, 1);
  const cells = Math.ceil((lead + (dayNumber(nextMonth) - dayNumber(first))) / 7) * 7;

  const inRental = (iso: ISODate) =>
    dayNumber(iso) >= dayNumber(ctx.rentalStart) && (!ctx.rentalEnd || dayNumber(iso) < dayNumber(ctx.rentalEnd));

  const pickedDraft = picked !== null ? bySeq.get(picked) : undefined;

  return (
    <div className="rounded-3xl bg-muted/40 p-3 ring-1 ring-foreground/5" data-preview-calendar="">
      <div className="mb-2 flex items-center justify-between">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft />
        </Button>
        <p className="text-sm font-semibold">{formatMonth(month)}</p>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEK_HEAD.map((w, i) => (
          <span key={i} className="pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {w}
          </span>
        ))}
        {Array.from({ length: cells }, (_, i) => {
          const iso = fromDayNumber(gridStart + i);
          const inMonth = iso.slice(0, 7) === month.slice(0, 7);
          const due = byDate.get(iso);
          const isToday = iso === today;
          const selectable = !!onMove && (due ? true : picked !== null && dayNumber(iso) >= dayNumber(ctx.rentalStart));
          const label = due
            ? `${formatDay(iso)}: ${due.map((d) => `payment #${d.seq}, ${formatMoney(d.amountCents, currency)}`).join("; ")}`
            : formatDay(iso);
          return (
            <button
              key={iso}
              type="button"
              aria-label={label}
              disabled={!selectable}
              onClick={() => {
                if (!onMove) return;
                if (due && picked === null) {
                  setPicked(due[0].seq);
                  return;
                }
                if (picked !== null) {
                  if (due && due.some((d) => d.seq === picked)) {
                    setPicked(null);
                    return;
                  }
                  onMove(picked, iso);
                  setPicked(null);
                }
              }}
              className={cn(
                "relative flex min-h-12 flex-col items-center justify-start rounded-xl px-0.5 pt-1 text-[12px] tabular-nums transition-colors disabled:cursor-default",
                !inMonth && "opacity-40",
                inRental(iso) && !due && "bg-primary/[0.04]",
                due && "bg-primary/10 text-primary dark:bg-[hsl(var(--v2-hover,var(--muted)))] dark:text-[hsl(var(--v2-link,var(--primary)))]",
                due && picked !== null && due.some((d) => d.seq === picked) && "ring-2 ring-primary",
                selectable && !due && "cursor-pointer hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]",
                selectable && due && "cursor-pointer",
                isToday && "font-semibold underline decoration-primary/50 underline-offset-2",
              )}
            >
              <span>{Number(iso.slice(8, 10))}</span>
              {due && (
                <span className="mt-0.5 w-full truncate text-[9px] font-medium leading-tight">
                  {formatMoney(due.reduce((s, d) => s + d.amountCents, 0), currency).replace(/\.00$/, "")}
                  {due.some((d) => d.isStub) ? "*" : ""}
                  {due.some((d) => moved.has(d.seq)) ? "•" : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {pickedDraft ? (
          <>
            Moving payment #{pickedDraft.seq} ({formatDay(pickedDraft.dueDate)}) <ArrowRight className="inline size-3" /> tap the new day, or
            tap it again to cancel. It still covers {formatCovers(pickedDraft.periodStart, pickedDraft.periodEnd)}.
          </>
        ) : (
          <>
            Shaded days are the rental. * marks the short first period{moved.size ? ", • a moved date" : ""}.
            {onMove ? " Tap a payment date to move it." : ""}
          </>
        )}
      </p>
      {picked === null && drafts.length > 0 && dayNumber(drafts[drafts.length - 1].dueDate) > dayNumber(addDays(nextMonth, -1)) && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          The schedule runs to {formatDay(drafts[drafts.length - 1].dueDate)} — use the arrows to see later months.
        </p>
      )}
    </div>
  );
}
