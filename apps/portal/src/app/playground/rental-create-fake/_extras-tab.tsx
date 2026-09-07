"use client";

/**
 * Extras & pricing — DESIGN SANDBOX. Nothing here is real.
 *
 * The add-ons, and the two numbers that only make sense next to them: what the
 * car costs per day, and what is being held against it.
 *
 * The catalogue mirrors `rental_extras`, which is tenant-authored — there is no
 * hardcoded list in the real product. What is copied faithfully is the pair of
 * orthogonal axes that make extras awkward:
 *
 *   billing_type   per_day | per_trip   — how OFTEN it is charged
 *   max_quantity   null | n             — null means it is a toggle, not a count
 *
 * So a toll pass is one flat charge you either have or you don't, and a child
 * seat is eight dollars a day and you can have three of them. A single "add-on"
 * checkbox cannot express either, which is why v1's grid has both a toggle state
 * and a stepper state and this one does too.
 *
 * OWNS: nothing.
 * Renders its own `Panel`.
 */

import { Plus, Minus, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { money, Panel, Field, inputCls, textareaCls, cardCls } from "@/app/playground/_shared";

/* ══════════════════════════════════════════════════════════════════════════
   The catalogue
   ══════════════════════════════════════════════════════════════════════════ */

export type SandboxExtra = {
  id: string;
  name: string;
  description: string;
  price: number;
  billing: "per_day" | "per_trip";
  /** `rental_extras.max_quantity` — null means a toggle, not a stepper. */
  maxQuantity: number | null;
  /** What is physically left on the shelf. Caps the stepper below max. */
  remaining: number | null;
};

export const EXTRAS: SandboxExtra[] = [
  {
    id: "seat",
    name: "Child seat",
    description: "Group 1, rear-facing up to four years",
    price: 8,
    billing: "per_day",
    maxQuantity: 3,
    remaining: 2,
  },
  {
    id: "driver",
    name: "Additional driver",
    description: "A second name on the agreement and the insurance",
    price: 12,
    billing: "per_day",
    maxQuantity: 2,
    remaining: 2,
  },
  {
    id: "toll",
    name: "Toll pass",
    description: "Transponder fitted; tolls themselves billed at cost",
    price: 25,
    billing: "per_trip",
    maxQuantity: null,
    remaining: null,
  },
  {
    id: "wifi",
    name: "Mobile hotspot",
    description: "Unlimited data for the length of the hire",
    price: 6,
    billing: "per_day",
    maxQuantity: null,
    remaining: null,
  },
];

/** What one extra costs across the whole rental. Mirrors `extraLineTotal`. */
export const extraLineTotal = (e: SandboxExtra, qty: number, days: number) =>
  e.price * qty * (e.billing === "per_day" ? Math.max(1, days) : 1);

/** Quantities keyed by extra id. Absent or 0 means not taken. */
export type ExtraSelection = Record<string, number>;

export const extrasTotal = (sel: ExtraSelection, days: number) =>
  EXTRAS.reduce((sum, e) => sum + extraLineTotal(e, sel[e.id] ?? 0, days), 0);

/** One short line for the rail. "Child seat ×2 +1 more" */
export function extrasSummary(sel: ExtraSelection): string | null {
  const taken = EXTRAS.filter((e) => (sel[e.id] ?? 0) > 0);
  if (taken.length === 0) return null;
  const first = taken[0];
  const qty = sel[first.id];
  const head = qty > 1 ? `${first.name} ×${qty}` : first.name;
  return taken.length === 1 ? head : `${head} +${taken.length - 1} more`;
}

/** The long form, written into the agreement. */
export function extrasSentence(sel: ExtraSelection): string {
  const taken = EXTRAS.filter((e) => (sel[e.id] ?? 0) > 0);
  if (taken.length === 0) return "None";
  return taken.map((e) => (sel[e.id] > 1 ? `${e.name} ×${sel[e.id]}` : e.name)).join(", ");
}

const cap = (e: SandboxExtra) => Math.min(e.remaining ?? 99, e.maxQuantity ?? 99);

/* ══════════════════════════════════════════════════════════════════════════
   Tab
   ══════════════════════════════════════════════════════════════════════════ */

export function ExtrasTab({
  selection,
  onSelection,
  days,
  dailyRate,
  onDailyRate,
  deposit,
  onDeposit,
  notes,
  onNotes,
  priceLines,
  total,
}: {
  selection: ExtraSelection;
  onSelection: (next: ExtraSelection) => void;
  days: number;
  dailyRate: number;
  onDailyRate: (n: number) => void;
  deposit: number;
  onDeposit: (n: number) => void;
  notes: string;
  onNotes: (v: string) => void;
  /** The whole rental priced, computed once on the host so nothing can disagree. */
  priceLines: { label: string; amount: number }[];
  total: number;
}) {
  const set = (id: string, qty: number) => {
    const next = { ...selection };
    if (qty <= 0) delete next[id];
    else next[id] = qty;
    onSelection(next);
  };

  const addedTotal = extrasTotal(selection, days);

  return (
    <Panel
      title="Extras & pricing"
      description="What rides along with the car, and what it all comes to. Every number here is written into the agreement."
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {EXTRAS.map((e) => (
          <ExtraCard key={e.id} extra={e} qty={selection[e.id] ?? 0} days={days} onQty={(q) => set(e.id, q)} />
        ))}
      </div>

      {addedTotal > 0 && (
        <div className="flex items-center justify-between rounded-3xl bg-muted/40 px-5 py-3.5 ring-1 ring-foreground/5">
          <p className="text-xs text-muted-foreground">Extras across the hire</p>
          <p className="text-sm font-semibold">{money(addedTotal)}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Daily rate" hint="Seeded from the vehicle. Override it and the override sticks.">
          <input
            type="number"
            value={dailyRate}
            onChange={(ev) => onDailyRate(Number(ev.target.value))}
            className={inputCls}
          />
        </Field>
        <Field label="Security deposit" hint="Held on the card, not charged.">
          <input
            type="number"
            value={deposit}
            onChange={(ev) => onDeposit(Number(ev.target.value))}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="Internal notes" hint="Never shown to the customer.">
        <textarea rows={3} value={notes} onChange={(ev) => onNotes(ev.target.value)} className={textareaCls} />
      </Field>

      {priceLines.length > 0 && (
        <div className={cn(cardCls, "p-6")}>
          <p className="mb-3 font-heading text-sm font-semibold">What the customer pays</p>
          <dl className="space-y-2 text-sm">
            {priceLines.map((l) => (
              <div key={l.label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{l.label}</dt>
                <dd>{money(l.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-foreground/10 pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>{money(total)}</dd>
            </div>
          </dl>
        </div>
      )}
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One extra
   ══════════════════════════════════════════════════════════════════════════ */

function ExtraCard({
  extra: e,
  qty,
  days,
  onQty,
}: {
  extra: SandboxExtra;
  qty: number;
  days: number;
  onQty: (q: number) => void;
}) {
  const on = qty > 0;
  const steppable = e.maxQuantity !== null;
  const max = cap(e);
  const line = extraLineTotal(e, qty, days);

  return (
    <div
      className={cn(
        "rounded-4xl p-5 transition-all",
        on ? "bg-primary-light ring-2 ring-primary/40" : "bg-card shadow-md ring-1 ring-foreground/5 dark:ring-foreground/10"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-medium">{e.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{e.description}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold">{money(e.price)}</p>
          <p className="text-[11px] text-muted-foreground">{e.billing === "per_day" ? "per day" : "one-off"}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        {steppable ? (
          <div className="flex items-center gap-2">
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => onQty(Math.max(0, qty - 1))}
              disabled={qty === 0}
              aria-label={`One fewer ${e.name}`}
            >
              <Minus />
            </Button>
            <span className="w-6 text-center text-sm font-medium tabular-nums">{qty}</span>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => onQty(Math.min(max, qty + 1))}
              disabled={qty >= max}
              aria-label={`One more ${e.name}`}
            >
              <Plus />
            </Button>
            <span className="ml-1 text-[11px] text-muted-foreground">
              {qty >= max ? `${max} is all you have` : `${max} available`}
            </span>
          </div>
        ) : (
          <Button size="sm" variant={on ? "default" : "outline"} onClick={() => onQty(on ? 0 : 1)}>
            {on ? "Added" : "Add"}
          </Button>
        )}

        {on && (
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <Package className="size-3.5 text-muted-foreground" />
            {money(line)}
          </span>
        )}
      </div>
    </div>
  );
}
