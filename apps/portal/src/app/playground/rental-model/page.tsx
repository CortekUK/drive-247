"use client";

/**
 * The simpler rental model, as diagrams — DESIGN SANDBOX.
 *
 * FAKE. No Supabase, no tenant, no auth, no network: every figure below is a
 * hardcoded example of a $200-a-week car. It explains a proposal; nothing about
 * how rentals really work has changed.
 *
 * The argument: extensions, auto extension, pay as you go and installments are
 * not four models. They are one list of payments, filled in differently.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── the example ────────────────────────────────────────────────────────── */

const DAYS = 28;
const WEEK = 200;
const MONTH = WEEK * 4;
const DAY = 29; // shown as "about"; $200 a week is $28.57 a day

type Timing = "before" | "after";

type Block = {
  start: number; // day index, 0-27
  span: number; // days
  label?: string;
  tone?: "plain" | "added" | "paid" | "due" | "cancelled";
};

const toneCls: Record<NonNullable<Block["tone"]>, string> = {
  plain: "bg-primary/10 text-primary",
  added: "bg-primary text-primary-foreground",
  paid: "bg-green-100 text-green-700",
  due: "bg-amber-100 text-amber-700",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const dotCls: Record<NonNullable<Block["tone"]>, string> = {
  plain: "bg-primary",
  added: "bg-primary-foreground",
  paid: "bg-green-600",
  due: "bg-amber-600",
  cancelled: "bg-muted-foreground/40",
};

const weekly = (): Block[] => [0, 7, 14, 21].map((start) => ({ start, span: 7, label: `$${WEEK}` }));

const daily = (): Block[] => Array.from({ length: DAYS }, (_, start) => ({ start, span: 1, tone: "plain" as const }));

/* ── pieces ─────────────────────────────────────────────────────────────── */

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h2 className="font-heading text-lg font-semibold tracking-tight">
        <span className="mr-2 text-muted-foreground">{n}</span>
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** The four-week ruler every timeline sits under. */
function WeekRuler() {
  return (
    <div className="grid grid-cols-4 text-[11px] font-medium text-muted-foreground">
      {[1, 2, 3, 4].map((w) => (
        <span key={w} className="border-l border-border pl-1.5">
          Week {w}
        </span>
      ))}
    </div>
  );
}

/**
 * One rental drawn as its payments. A block is the time a payment covers; the
 * dot on it is the moment the money is taken.
 */
function Lane({
  blocks,
  timing = "before",
  open = false,
  statusOnly = false,
}: {
  blocks: Block[];
  timing?: Timing;
  open?: boolean;
  /** Blocks that name a status: no money dots, and small enough to fit a phone. */
  statusOnly?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="grid h-9 min-w-0 flex-1 gap-0.5"
        style={{ gridTemplateColumns: `repeat(${DAYS}, minmax(0, 1fr))` }}
      >
        {blocks.map((b) => {
          const tone = b.tone ?? "plain";
          return (
            <div
              key={b.start}
              className={cn(
                "relative flex items-center justify-center rounded-md font-semibold",
                statusOnly ? "text-[10px] md:text-xs" : "text-xs",
                toneCls[tone],
              )}
              style={{ gridColumn: `${b.start + 1} / span ${b.span}` }}
            >
              {b.label}
              {!statusOnly && (
                <span
                  className={cn(
                    "absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full",
                    b.span === 1 ? "left-1/2 -translate-x-1/2" : timing === "before" ? "left-1.5" : "right-1.5",
                    dotCls[tone],
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Always reserves its width, so every lane lines up with the ruler. */}
      <ArrowRight
        aria-label={open ? "Keeps going until the car comes back" : undefined}
        aria-hidden={!open}
        className={cn("size-4 shrink-0 text-primary", !open && "invisible")}
      />
    </div>
  );
}

function RulerRow() {
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <WeekRuler />
      </div>
      <span className="size-4 shrink-0" />
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[13px] [transition:background-color_200ms_ease-out,color_200ms_ease-out,border-color_200ms_ease-out] motion-reduce:transition-none",
              value === o.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-primary/10",
              o.disabled && "cursor-not-allowed opacity-40 hover:bg-card",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── diagram 1: four systems become one ─────────────────────────────────── */

const FOUR = ["Extensions", "Auto extension", "Pay as you go", "Installments"];

function Today() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <p className="mb-3 text-[13px] font-medium text-muted-foreground">Today: four systems</p>
        <div className="flex items-center gap-3">
          <span className="rounded-lg border border-border px-3 py-2 text-[13px] font-medium">Rental</span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          <ul className="min-w-0 flex-1 space-y-1.5">
            {FOUR.map((f) => (
              <li key={f} className="rounded-lg bg-muted px-3 py-1.5 text-[13px]">
                {f}
                <span className="block text-[11px] text-muted-foreground">its own code and rules</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <p className="mb-3 text-[13px] font-medium text-primary">New idea: one system</p>
        <ol className="flex flex-col items-start gap-1.5">
          {[
            { t: "Rental", s: "Customer, car, dates" },
            { t: "Payment list", s: "When, and how much" },
            { t: "One job", s: "Collects whatever is due" },
            { t: "Ledger", s: "The books you already have" },
          ].map((x, i) => (
            <li key={x.t} className="contents">
              {i > 0 && <ArrowDown className="ml-4 size-4 text-primary" />}
              <span className="w-full rounded-lg bg-primary/10 px-3 py-1.5 text-[13px] font-medium text-primary">
                {x.t}
                <span className="block text-[11px] font-normal text-primary/70">{x.s}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ── diagram 2: every model is the same list ────────────────────────────── */

const MODELS: { name: string; note: string; blocks: Block[]; timing?: Timing; open?: boolean }[] = [
  {
    name: "Simple rental",
    note: "One payment at the start.",
    blocks: [{ start: 0, span: 28, label: `$${MONTH}` }],
  },
  {
    name: "Manual extension",
    note: "Same rental, one payment added later.",
    blocks: [
      { start: 0, span: 21, label: `$${WEEK * 3}` },
      { start: 21, span: 7, label: `+$${WEEK}`, tone: "added" },
    ],
  },
  {
    name: "Installments",
    note: "End date known, total split up.",
    blocks: weekly(),
  },
  {
    name: "Auto extension",
    note: "No end date. Next payment added each week until the car comes back.",
    blocks: weekly(),
    open: true,
  },
  {
    name: "Pay as you go",
    note: `About $${DAY} a day, charged after each day is used.`,
    blocks: daily(),
    timing: "after",
    open: true,
  },
];

function SameList() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 md:flex-row md:items-center md:gap-4">
        <span className="hidden md:block md:w-40 md:shrink-0" />
        <div className="min-w-0 flex-1">
          <RulerRow />
        </div>
      </div>
      {MODELS.map((m) => (
        <div key={m.name} className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-4">
          <div className="md:w-40 md:shrink-0">
            <p className="text-[13px] font-semibold">{m.name}</p>
            <p className="text-[12px] leading-snug text-muted-foreground">{m.note}</p>
          </div>
          <div className="min-w-0 flex-1">
            <Lane blocks={m.blocks} timing={m.timing} open={m.open} />
          </div>
        </div>
      ))}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-6 rounded-sm bg-primary/10" /> Time a payment covers
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-primary" /> When the money is taken
        </span>
        <span className="flex items-center gap-1.5">
          <ArrowRight className="size-3.5 text-primary" /> Keeps going
        </span>
      </p>
    </div>
  );
}

/* ── diagram 3: try it ──────────────────────────────────────────────────── */

type Ends = "date" | "open";
type Pays = "once" | "month" | "week" | "day";

function matchFor(ends: Ends, pays: Pays, when: Timing): string {
  if (ends === "date") {
    if (pays === "once" || pays === "month") return when === "before" ? "Simple rental" : "A new option: pay at the end";
    return when === "before" ? "Installments" : "A new option: split, paid after each part";
  }
  if (pays === "day") return when === "after" ? "Pay as you go" : "A new option: rolling, paid daily in advance";
  return when === "before" ? "Auto extension" : "A new option: rolling, paid after each period";
}

function blocksFor(pays: Pays): Block[] {
  if (pays === "week") return weekly();
  if (pays === "day") return daily();
  return [{ start: 0, span: 28, label: `$${MONTH}` }];
}

function TryIt() {
  const [ends, setEnds] = useState<Ends>("date");
  const [pays, setPays] = useState<Pays>("once");
  const [when, setWhen] = useState<Timing>("before");

  const chooseEnds = (v: Ends) => {
    setEnds(v);
    // A rental with no end date has no total to take all at once.
    if (v === "open" && pays === "once") setPays("week");
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Choice
          label="When does it end?"
          value={ends}
          onChange={chooseEnds}
          options={[
            { value: "date", label: "On a date" },
            { value: "open", label: "When the car comes back" },
          ]}
        />
        <Choice
          label="How does the customer pay?"
          value={pays}
          onChange={setPays}
          options={[
            { value: "once", label: "All at once", disabled: ends === "open" },
            { value: "month", label: "Monthly" },
            { value: "week", label: "Weekly" },
            { value: "day", label: "Daily" },
          ]}
        />
        <Choice
          label="When is it charged?"
          value={when}
          onChange={setWhen}
          options={[
            { value: "before", label: "Before" },
            { value: "after", label: "After" },
          ]}
        />
      </div>

      <div className="rounded-xl bg-muted/50 p-4">
        <RulerRow />
        <div className="mt-1.5">
          <Lane blocks={blocksFor(pays)} timing={when} open={ends === "open"} />
        </div>
        <p className="mt-3 text-[13px]">
          <span className="text-muted-foreground">That is: </span>
          <span className="font-semibold">{matchFor(ends, pays, when)}</span>
        </p>
      </div>
    </div>
  );
}

/* ── diagram 4: the list the operator sees ──────────────────────────────── */

const LIST = [
  { covers: "Week 1", amount: WEEK, status: "Paid", cls: "text-green-600" },
  { covers: "Week 2", amount: WEEK, status: "Paid", cls: "text-green-600" },
  { covers: "Week 3", amount: WEEK, status: "Due", cls: "text-amber-600" },
  { covers: "Week 4", amount: WEEK, status: "Scheduled", cls: "text-muted-foreground" },
];

function OperatorList() {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-[13px]">
        <thead className="bg-primary/10 text-left text-primary">
          <tr>
            <th className="px-4 py-2 font-medium">Payment</th>
            <th className="px-4 py-2 font-medium">Covers</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {LIST.map((r) => (
            <tr key={r.covers} className="border-t border-border">
              <td className="px-4 py-2">${r.amount}</td>
              <td className="px-4 py-2">{r.covers}</td>
              <td className={cn("px-4 py-2 font-medium", r.cls)}>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── diagram 5: one payment's life ──────────────────────────────────────── */

function Stage({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium", tone)}>{children}</span>;
}

function PaymentLife() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Stage tone="bg-muted text-muted-foreground">Scheduled</Stage>
        <ArrowRight className="size-4 text-muted-foreground" />
        <Stage tone="bg-amber-100 text-amber-700">Due</Stage>
        <ArrowRight className="size-4 text-muted-foreground" />
        <Stage tone="bg-green-100 text-green-700">Paid</Stage>
      </div>

      <ul className="space-y-2 text-[13px]">
        <li className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">If the card fails:</span>
          <Stage tone="bg-red-100 text-red-700">Failed</Stage>
          <ArrowRight className="size-4 text-muted-foreground" />
          <span>try again, or send a pay link</span>
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">If the car comes back early:</span>
          <Stage tone="bg-muted text-muted-foreground line-through">Cancelled</Stage>
        </li>
      </ul>

      <div>
        <p className="mb-2 text-[13px] font-medium">Example: the car comes back halfway through week 3</p>
        <RulerRow />
        <div className="mt-1.5">
          <Lane
            statusOnly
            blocks={[
              { start: 0, span: 7, label: "Paid", tone: "paid" },
              { start: 7, span: 7, label: "Paid", tone: "paid" },
              { start: 14, span: 3, label: "Paid", tone: "paid" },
              { start: 17, span: 4, label: "Refund", tone: "due" },
              { start: 21, span: 7, label: "Cancelled", tone: "cancelled" },
            ]}
          />
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          One rule for every rental: cancel the future payments and refund the unused part of the current one.
        </p>
      </div>
    </div>
  );
}

/* ── the page ───────────────────────────────────────────────────────────── */

export default function RentalModelPage() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-10 md:px-6 md:py-14">
        <Link
          href="/playground"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-3.5" /> Playground
        </Link>

        <header className="pb-2">
          <h1 className="font-heading text-3xl font-medium tracking-tight">A simpler rental model</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Every rental gets one list of payments. The only thing that changes between models is how the list is
            filled in. Example figures: a car at ${WEEK} a week. This is a proposal, not how rentals work today.
          </p>
        </header>

        <Section n={1} title="Four systems become one">
          <Today />
        </Section>
        <Section n={2} title="Every model is the same list">
          <SameList />
        </Section>
        <Section n={3} title="Try it: three questions build any rental">
          <TryIt />
        </Section>
        <Section n={4} title="What the operator sees">
          <OperatorList />
        </Section>
        <Section n={5} title="The life of one payment">
          <PaymentLife />
        </Section>
      </div>
    </div>
  );
}
