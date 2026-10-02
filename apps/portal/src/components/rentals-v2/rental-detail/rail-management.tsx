"use client";

/**
 * Management — the first tab of the right rail: how this booking is planned.
 *
 * Replaces the Payment Plan calendar (Oct 2 2026). The tab is a stack of
 * cards, one per PLAN on the rental: the original booking first, then — as
 * they are built — extensions, payments on specific periods and other custom
 * plans. Above them sits an Overview card, and only when there is something
 * to overview: two or more plan cards. A rental that is just its booking shows
 * just its booking.
 *
 * Today the stack holds the original booking only; extension and custom-plan
 * cards are the next step. `plans` is the one list both the Overview rule and
 * the stack read, so adding a card kind is adding entries to it.
 */

import { cn } from "@/lib/utils";
import { useState } from "react";
import { CalendarPlus, Plus, Repeat } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { differenceInCalendarDays } from "date-fns";
import { AddPeriodDialog } from "./add-period-dialog";
import { EXTENSION_TITLE, extensionHref, overviewHref, periodHref, readExtension, readOverview, readPeriod } from "./extension-flow";
import { stageHref } from "./stages";
import { previewPeriods } from "./rail-preview";
import { useV2 } from "@/lib/v2-context";
import { fmtDate, money } from "./_kit";
import type { RentalDetailV2 } from "./use-rental-detail-v2";

type Plan = {
  id: string;
  kind: "booking" | "extension";
  /** An extension still being set up (the flow is open), not yet saved. */
  draft?: boolean;
  /** Auto extension: renews on this cadence; `next` is the next renewal day. */
  cadence?: "week" | "month";
  next?: string;
  title: string;
  start: string | null;
  end: string | null;
  startTime: string | null;
  endTime: string | null;
  days: number | null;
  amount: number | null;
};

/** The thin connector between cards in the chain. */
const LINK = "h-4 w-px shrink-0 bg-primary/25 dark:bg-[hsl(var(--v2-link,var(--primary))/0.35)]";

/**
 * A clickable card in the chain. A real 1px border, not a ring: rings are box
 * shadows, which the scrolling middle band clips at its sides and the focus
 * ring paints over. Selected = an accent border; keyboard focus = an accent
 * outline outside it. The white ground never changes.
 */
const CARD_BTN =
  "relative block w-full cursor-pointer rounded-2xl border bg-card px-4 py-3.5 text-left outline-none transition-colors duration-200 " +
  "hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60";
const CARD_ON = "border-primary/70 dark:border-[hsl(var(--v2-link,var(--primary))/0.8)]";

const CARD = "rounded-2xl bg-card p-4 ring-1 ring-foreground/5 dark:ring-foreground/10";

/** "Mar 1" — a calendar day at local midnight (see `fmtDate`). */
const day = (iso: string | null) =>
  iso
    ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "Open-ended";

function plansOf(detail: RentalDetailV2): Plan[] {
  const r = detail.rental;
  return [
    {
      id: "booking",
      kind: "booking",
      title: "Original booking",
      start: r.start_date ?? null,
      end: r.end_date ?? null,
      startTime: r.pickup_time ?? null,
      endTime: r.return_time ?? null,
      days: detail.days,
      amount: r.total_amount != null ? Number(r.total_amount) : null,
    },
  ];
}

/**
 * The original booking — the one card that is always there, so it is the one
 * that stands out: a solid accent card (white type on the tenant's colour),
 * the dates as its headline, length and money. Flat — one soft wash in the
 * corner, no shadow. Selected = an outline just outside it.
 */
function BookingCard({ plan, onOpen, active }: { plan: Plan; onOpen?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={plan.title}
      aria-current={active ? "true" : undefined}
      className={cn(
        "relative block w-full cursor-pointer overflow-hidden rounded-2xl px-4 py-4 text-left text-primary-foreground outline-none",
        "bg-primary transition-[filter] duration-200 hover:brightness-110",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60",
        active && "outline outline-2 outline-offset-2 outline-primary/40"
      )}
    >
      {/* One quiet wash in the corner — depth without an effect. */}
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 size-36 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-primary-foreground/70">{plan.title}</p>
          <p className="mt-1.5 text-[17px] font-semibold tracking-tight">
            {day(plan.start)} → {day(plan.end)}
          </p>
          <p className="mt-0.5 text-[12px] text-primary-foreground/75">
            {plan.days != null ? `${plan.days} ${plan.days === 1 ? "day" : "days"}` : "Open-ended"}
          </p>
        </div>
        {plan.amount != null && plan.amount > 0 && (
          <span className="shrink-0 pt-5 text-[15px] font-semibold tabular-nums">{money(plan.amount)}</span>
        )}
      </div>
    </button>
  );
}

/**
 * An extension in the chain: one compact row — its kind as an icon, its
 * dates, a short line, its money. Neutral and white, so the original booking
 * (a solid accent card) stays the one that stands out. A draft is dashed and
 * opens its flow again on click.
 */
function ExtensionCard({ plan, onOpen, active }: { plan: Plan; onOpen?: () => void; active?: boolean }) {
  const Icon = plan.cadence ? Repeat : CalendarPlus;
  const what = plan.cadence ? "Auto" : "Manual";
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      aria-label={plan.title}
      className={cn(
        CARD_BTN,
        "flex items-center gap-3 py-3",
        !onOpen && "cursor-default",
        active ? CARD_ON : plan.draft ? "border-dashed border-primary/40" : "border-foreground/[0.07] dark:border-foreground/10"
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          active || plan.draft
            ? "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
            : "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold tracking-tight">
          {day(plan.start)} →{" "}
          {plan.end ? day(plan.end) : plan.cadence ? "ongoing" : <span className="text-muted-foreground">pick an end date</span>}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
          {plan.draft
            ? `${what} · setting up`
            : plan.cadence
              ? `${what} · every ${plan.cadence}${plan.next ? ` · next ${day(plan.next)}` : ""}`
              : `${what} · ${plan.days} ${plan.days === 1 ? "day" : "days"}`}
        </span>
      </span>
      {plan.amount != null && plan.amount > 0 && (
        <span className="shrink-0 text-right">
          <span className="block text-[13px] font-semibold tabular-nums">{money(plan.amount)}</span>
          {plan.cadence && <span className="block text-[10.5px] text-muted-foreground">per {plan.cadence}</span>}
        </span>
      )}
    </button>
  );
}

/** Shown only above two or more plans: the whole rental at a glance. */
function OverviewCard({ plans, onOpen, active }: { plans: Plan[]; onOpen: () => void; active: boolean }) {
  const first = plans[0];
  const last = plans[plans.length - 1];
  const total = plans.reduce((n, p) => n + (p.amount ?? 0), 0);
  const days = plans.reduce((n, p) => n + (p.days ?? 0), 0);
  return (
    /* Opens the whole rental at a glance (rental-overview.tsx). */
    <button
      type="button"
      onClick={onOpen}
      aria-label="Overview"
      aria-current={active ? "true" : undefined}
      className={cn(CARD_BTN, "bg-primary/[0.04] p-4", active ? CARD_ON : "border-transparent")}
    >
      <p className="text-[14px] font-semibold tracking-tight">Overview</p>
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
        {plans.length} plans · {fmtDate(first.start)} → {last.end ? fmtDate(last.end) : "Open-ended"}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">
          {plans.some((p) => p.cadence || !p.end) ? `${days} days so far · then ongoing` : `${days} days in all`}
        </span>
        <span className="text-[14px] font-semibold tabular-nums">{money(total)}</span>
      </div>
    </button>
  );
}

export function RailManagement({ detail }: { detail: RentalDetailV2 }) {
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const open = readExtension(searchParams);
  const viewing = open ? null : readPeriod(searchParams);
  const overviewOpen = !open && !viewing && readOverview(searchParams);

  /* The extension being set up appears in the chain the moment it is created,
     as a draft card, and follows the flow as its end date is picked. */
  const draft: Plan | null = open
    ? {
        id: "draft",
        kind: "extension",
        draft: true,
        title: EXTENSION_TITLE[open.kind],
        start: detail.rental.end_date ?? null,
        end: open.end,
        startTime: null,
        endTime: null,
        days:
          open.end && detail.rental.end_date
            ? differenceInCalendarDays(
                new Date(`${open.end}T00:00:00`),
                new Date(`${String(detail.rental.end_date).slice(0, 10)}T00:00:00`)
              )
            : null,
        amount: null,
      }
    : null;
  /* northwind preview — see rail-preview.ts. Real extensions are not read here
     yet, so on the v2 canary the chain borrows two manual extensions and one
     auto extension to be judged against. */
  const preview = useV2("chrome");
  const borrowed: Plan[] = preview
    ? previewPeriods(detail).map((x) => ({
        id: x.id,
        kind: "extension",
        title: EXTENSION_TITLE[x.kind],
        start: x.start,
        end: x.end,
        startTime: null,
        endTime: null,
        days: x.days,
        amount: x.amount,
        cadence: x.cadence,
        next: x.next,
      }))
    : [];
  /* A draft continues from the last period's end, not the booking's. */
  if (draft && borrowed.length) {
    const last = borrowed[borrowed.length - 1];
    draft.start = last.end ?? last.next ?? draft.start;
  }
  const plans = [...plansOf(detail), ...borrowed, ...(draft ? [draft] : [])];

  return (
    /* Three bands (Oct 2 2026): Overview and the original booking pinned at
       the top, Add period pinned at the bottom — always in view — and only
       the extensions between them scroll. */
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3">
        {plans.length >= 2 && (
          <OverviewCard
            plans={plans}
            active={overviewOpen}
            onOpen={() => router.replace(overviewHref(detail.rental.id), { scroll: false })}
          />
        )}
        {/* The booking IS the rental: it leads back to the rental's own stages. */}
        <BookingCard
          plan={plans[0]}
          active={!open && !viewing && !overviewOpen}
          onOpen={() => router.replace(stageHref(detail.rental.id, "when"), { scroll: false })}
        />
      </div>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1 no-scrollbar">
        {plans.slice(1).map((p) => (
          <div key={p.id} className="flex flex-col items-center">
            <span aria-hidden className={LINK} />
            <ExtensionCard
              plan={p}
              active={p.draft ? !!open : viewing?.period === p.id}
              onOpen={
                p.draft
                  ? open ? () => router.replace(extensionHref(detail.rental.id, open), { scroll: false }) : undefined
                  : () => router.replace(periodHref(detail.rental.id, { period: p.id, step: viewing?.step ?? "when" }), { scroll: false })
              }
            />
          </div>
        ))}
        {/* The chain runs on into Add period: this line takes whatever room
            the band has left, so it always meets the box below — never a
            short stub floating in the gap. */}
        {!draft && <span aria-hidden className="min-h-4 w-px flex-1 shrink-0 self-center bg-primary/25 dark:bg-[hsl(var(--v2-link,var(--primary))/0.35)]" />}
      </div>

      {/* The one place a new period is added — manual extension, auto-renew,
          pay as you go, installments or set dates. Not a plan, so it never
          counts toward Overview; hidden while one is being set up. */}
      {!draft && (
        <div className="flex shrink-0 flex-col items-center pb-1">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="group flex w-full cursor-pointer flex-col items-center gap-1 rounded-2xl border border-dashed border-primary/35 px-4 py-3.5 text-center transition-colors duration-200 hover:border-primary/60 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-[hsl(var(--v2-link,var(--primary))/0.4)]"
          >
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
              <Plus className="size-4" />
              Add period
            </span>
            <span className="text-[11.5px] text-muted-foreground">Extend, auto-renew, pay as you go or set dates.</span>
          </button>
        </div>
      )}

      {/* Continue opens the extension flow: the left rail swaps to its steps and
          the main pane shows When (extension-flow.ts). */}
      <AddPeriodDialog
        open={adding}
        onOpenChange={setAdding}
        onContinue={(kind) => {
          setAdding(false);
          router.replace(extensionHref(detail.rental.id, { kind, step: "when", end: null }), { scroll: false });
        }}
      />
    </div>
  );
}

export default RailManagement;
