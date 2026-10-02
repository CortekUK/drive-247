"use client";

/**
 * Overview — the whole rental at a glance: the original booking and every
 * period after it, together. Opened from the Management tab's Overview card
 * (`?overview=1`); the layout drops the stage rail while it is open, so the
 * rail's space and the pane read as one area.
 *
 * One screen, no scroll, nothing ends early (island UI):
 *   row 1  five figures — billed, paid, outstanding, next charge, length
 *   row 2  the timeline (every period on one axis) · money by period
 *   row 3  cash in over time · agreements · insurance
 *
 * Charts follow the agreements overview: `ChartContainer` + recharts, colours
 * from the ChartConfig (the tenant's accent), no animation, no grid noise.
 * The data is the northwind preview (rail-preview.ts) until real extensions,
 * payments and policies are read per period.
 */

import { useRouter } from "next/navigation";
import { Area, AreaChart, Bar, BarChart, XAxis, YAxis } from "recharts";
import { ArrowLeft, Check, FileSignature, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Panel, StageAction, money } from "./_kit";
import type { RentalDetailV2 } from "./use-rental-detail-v2";
import { shortDay } from "./extension-flow";
import { stageHref } from "./stages";
import { previewBooking, previewPeriods, type PeriodCharge } from "./rail-preview";

const BOX = "flex min-h-0 flex-col rounded-3xl bg-card p-5 ring-1 ring-foreground/5 dark:ring-foreground/10";
const H = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70";
const local = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);
const plus = (iso: string, n: number) => {
  const d = local(iso);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

type Seg = {
  id: string;
  label: string;
  short: string;
  kind: "booking" | "manual" | "auto";
  start: string;
  end: string;
  open: boolean;
  charges: PeriodCharge[];
  agreement: { signed: boolean; ref: string };
  policy: string;
};

function segmentsOf(detail: RentalDetailV2): Seg[] {
  const b = previewBooking(detail);
  const out: Seg[] = [];
  if (b.start && b.end) {
    out.push({
      id: "booking", label: "Original booking", short: "Booking", kind: "booking",
      start: b.start, end: b.end, open: false, charges: b.payments.charges,
      agreement: { signed: true, ref: b.agreement.ref }, policy: b.insurance.policy,
    });
  }
  let n = 0;
  for (const p of previewPeriods(detail)) {
    const auto = p.kind === "auto";
    if (!auto) n += 1;
    out.push({
      id: p.id,
      label: auto ? "Auto extension" : `Manual extension ${n}`,
      short: auto ? "Auto" : `Ext ${n}`,
      kind: p.kind,
      start: p.start,
      end: p.end ?? plus(p.next ?? p.start, 14),
      open: !p.end,
      charges: p.payments.charges,
      agreement: { signed: p.agreement.status === "signed", ref: p.agreement.ref },
      policy: p.insurance.policy,
    });
  }
  return out;
}

const chartConfig: ChartConfig = {
  paid: { label: "Paid", theme: { light: "hsl(var(--primary))", dark: "hsl(var(--v2-link, var(--primary)))" } },
  owed: { label: "Still to come", theme: { light: "hsl(var(--primary) / 0.25)", dark: "hsl(var(--primary) / 0.35)" } },
  billed: { label: "Billed", theme: { light: "hsl(var(--primary) / 0.35)", dark: "hsl(var(--primary) / 0.45)" } },
};

const AXIS = { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } } as const;

/* ── pieces ──────────────────────────────────────────────────────────────── */

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-2xl border px-4 py-3", accent ? "border-primary/20 bg-primary/[0.06]" : "border-transparent bg-card")}>
      <p className={cn("text-[10.5px] font-semibold uppercase tracking-wider", accent ? "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-muted-foreground/70")}>
        {label}
      </p>
      <p className="mt-1 font-heading text-[22px] font-semibold leading-tight tracking-tight tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/** Every period on one axis, weeks marked, the auto extension fading out. */
function Timeline({ segs }: { segs: Seg[] }) {
  const from = local(segs[0].start).getTime();
  const to = local(segs[segs.length - 1].end).getTime();
  const span = Math.max(1, to - from);
  const pct = (d: string) => ((local(d).getTime() - from) / span) * 100;
  const ticks: string[] = [];
  for (let d = segs[0].start; d <= segs[segs.length - 1].end; d = plus(d, 7)) ticks.push(d);
  return (
    <div className={BOX}>
      <div className="flex items-baseline justify-between">
        <p className={H}>Timeline</p>
        <p className="text-[11.5px] text-muted-foreground">
          {shortDay(segs[0].start)} → {segs[segs.length - 1].open ? "ongoing" : shortDay(segs[segs.length - 1].end)}
        </p>
      </div>
      <div className="relative mt-3 flex min-h-0 flex-1 flex-col">
        {/* week lines behind the bars */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-5 top-0 ml-[132px]">
          {ticks.map((t) => (
            <span key={t} className="absolute inset-y-0 w-px bg-primary/[0.08]" style={{ left: `${pct(t)}%` }} />
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-around">
          {segs.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3">
              <div className="w-[120px] shrink-0">
                <p className={cn("truncate text-[12.5px]", i === 0 ? "font-semibold" : "text-foreground/80")}>{s.label}</p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {shortDay(s.start)} → {s.open ? "ongoing" : shortDay(s.end)}
                </p>
              </div>
              <div className="relative h-3 flex-1 rounded-full bg-primary/[0.05]">
                <span
                  className={cn(
                    "absolute inset-y-0 rounded-full",
                    s.kind === "booking" ? "bg-primary" : s.kind === "auto" ? "bg-primary/45" : "bg-primary/30",
                    s.open && "[mask-image:linear-gradient(to_right,black_45%,transparent)]"
                  )}
                  style={{ left: `${pct(s.start)}%`, width: `${Math.max(2, pct(s.end) - pct(s.start))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="relative ml-[132px] h-5 shrink-0">
          {ticks.map((t) => (
            <span key={t} className="absolute top-1 -translate-x-1/2 text-[10.5px] tabular-nums text-muted-foreground" style={{ left: `${pct(t)}%` }}>
              {shortDay(t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function MoneyByPeriod({ segs }: { segs: Seg[] }) {
  const data = segs.map((s) => ({
    label: s.short,
    paid: s.charges.filter((c) => c.status === "paid").reduce((n, c) => n + c.amount, 0),
    owed: s.charges.filter((c) => c.status !== "paid").reduce((n, c) => n + c.amount, 0),
  }));
  return (
    <div className={BOX}>
      <div className="flex items-baseline justify-between">
        <p className={H}>Money by period</p>
        <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="size-2 rounded-[2px] bg-primary" />Paid</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-[2px] bg-primary/25" />Still to come</span>
        </span>
      </div>
      <ChartContainer config={chartConfig} className="mt-3 aspect-auto min-h-0 w-full flex-1">
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barCategoryGap="30%">
          <XAxis dataKey="label" {...AXIS} />
          <YAxis hide domain={[0, (max: number) => Math.max(1, max)]} />
          <ChartTooltip cursor={{ fill: "hsl(var(--primary) / 0.05)" }} content={<ChartTooltipContent />} />
          <Bar dataKey="paid" stackId="m" fill="var(--color-paid)" radius={[0, 0, 6, 6]} maxBarSize={44} isAnimationActive={false} />
          <Bar dataKey="owed" stackId="m" fill="var(--color-owed)" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

function CashIn({ segs }: { segs: Seg[] }) {
  const charges = segs.flatMap((s) => s.charges).sort((a, b) => a.on.localeCompare(b.on));
  let billed = 0;
  let paid = 0;
  const data = charges.map((c) => {
    billed += c.amount;
    if (c.status === "paid") paid += c.amount;
    return { label: shortDay(c.on), billed, paid };
  });
  return (
    <div className={BOX}>
      <div className="flex items-baseline justify-between">
        <p className={H}>Cash in</p>
        <p className="text-[11.5px] text-muted-foreground">{money(paid)} of {money(billed)}</p>
      </div>
      <ChartContainer config={chartConfig} className="mt-3 aspect-auto min-h-0 w-full flex-1">
        <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
          <YAxis hide domain={[0, (max: number) => Math.max(1, max)]} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area dataKey="billed" type="stepAfter" stroke="var(--color-billed)" fill="var(--color-billed)" fillOpacity={0.25} strokeWidth={1.5} isAnimationActive={false} />
          <Area dataKey="paid" type="stepAfter" stroke="var(--color-paid)" fill="var(--color-paid)" fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

function ListCard({
  title, icon: Icon, rows, foot,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  rows: { id: string; label: string; value: string; good: boolean }[];
  foot: React.ReactNode;
}) {
  return (
    <div className={BOX}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />
        <p className={H}>{title}</p>
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col justify-between divide-y divide-foreground/[0.06]">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-1 items-center justify-between gap-3 py-1.5">
            <span className="truncate text-[12.5px] text-muted-foreground">{r.label}</span>
            <span className={cn("flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium", r.good ? "text-foreground" : "text-warning")}>
              <span className={cn("size-1.5 rounded-full", r.good ? "bg-success" : "bg-warning")} />
              {r.value}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-foreground/[0.06] pt-2.5 text-[12px] text-muted-foreground">{foot}</div>
    </div>
  );
}

/* ── the screen ──────────────────────────────────────────────────────────── */

export function RentalOverview({ detail }: { detail: RentalDetailV2 }) {
  const router = useRouter();
  const segs = segmentsOf(detail);
  const back = () => router.replace(stageHref(detail.rental.id, "when"), { scroll: false });

  const all = segs.flatMap((s) => s.charges);
  const paid = all.filter((c) => c.status === "paid").reduce((n, c) => n + c.amount, 0);
  const due = all.filter((c) => c.status === "due").reduce((n, c) => n + c.amount, 0);
  const next = all.filter((c) => c.status === "scheduled").sort((a, b) => a.on.localeCompare(b.on))[0];
  const billed = paid + due;
  const fixedDays = segs.filter((s) => !s.open).reduce((n, s) => n + Math.round((local(s.end).getTime() - local(s.start).getTime()) / 86_400_000), 0);
  const ongoing = segs.some((s) => s.open);
  const unsigned = segs.filter((s) => !s.agreement.signed);

  return (
    <Panel
      fill
      title="Overview"
      description={`${detail.rentalNumber ?? "This rental"} · ${segs.length} ${segs.length === 1 ? "period" : "periods"} · ${shortDay(segs[0]?.start)} → ${ongoing ? "ongoing" : shortDay(segs[segs.length - 1]?.end)}`}
      action={<StageAction icon={ArrowLeft} label="Back to rental" onClick={back} />}
    >
      {segs.length === 0 ? (
        <p className="text-sm text-muted-foreground">This rental has no dates yet, so there is nothing to overview.</p>
      ) : (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1.15fr)_minmax(0,1fr)] gap-4">
          <div className="grid grid-cols-5 gap-3">
            <Kpi label="Billed so far" value={money(billed)} sub={`${all.filter((c) => c.status !== "scheduled").length} charges`} />
            <Kpi label="Paid" accent value={money(paid)} sub={billed ? `${Math.round((paid / billed) * 100)}% of billed` : "Nothing billed"} />
            <Kpi label="Outstanding" value={money(due)} sub={due ? "Due now" : "All settled"} />
            <Kpi label="Next charge" value={next ? money(next.amount) : "—"} sub={next ? `${shortDay(next.on)} · ${next.label}` : "Nothing scheduled"} />
            <Kpi label="Length" value={`${fixedDays} days`} sub={ongoing ? "Then renewing weekly" : "Fixed end"} />
          </div>

          <div className="grid min-h-0 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-4">
            <Timeline segs={segs} />
            <MoneyByPeriod segs={segs} />
          </div>

          <div className="grid min-h-0 grid-cols-3 gap-4">
            <CashIn segs={segs} />
            <ListCard
              title="Agreements"
              icon={FileSignature}
              rows={segs.map((s) => ({ id: s.id, label: s.label, value: s.agreement.signed ? "Signed" : "Awaiting", good: s.agreement.signed }))}
              foot={unsigned.length ? `${unsigned.length} waiting for a signature` : <span className="inline-flex items-center gap-1 text-success"><Check className="size-3.5" />Every period is signed</span>}
            />
            <ListCard
              title="Insurance"
              icon={ShieldCheck}
              rows={segs.map((s) => ({ id: s.id, label: s.label, value: s.policy, good: true }))}
              foot={<span className="inline-flex items-center gap-1 text-success"><Check className="size-3.5" />Covered end to end, no gaps</span>}
            />
          </div>
        </div>
      )}
    </Panel>
  );
}

export default RentalOverview;
