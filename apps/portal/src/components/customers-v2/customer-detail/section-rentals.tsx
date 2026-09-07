"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Rentals — every rental this customer has had with this operator.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Car } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { moneyIn } from "./derive";
import {
  EmptyHint,
  Panel,
  Pill,
  ProducedFrom,
  Section,
  Segmented,
  Stat,
  dayCount,
  fmtDate,
  listCls,
} from "./kit";
import type { SectionProps } from "./sections";

const RENTAL_TONE = {
  Active: "primary",
  Completed: "success",
  Cancelled: "neutral",
  Pending: "warning",
  Upcoming: "neutral",
} as const;

export function SectionRentals({ c, onJump, currency }: SectionProps) {
  const [view, setView] = useState<"booking" | "car">("booking");
  const router = useRouter();
  const money = moneyIn(currency);

  const settled = c.rentals.filter((r) => r.status !== "Cancelled");
  const lifetime = settled.reduce((s, r) => s + r.total, 0);
  const withDates = settled.filter((r) => r.end);
  const avgLength = withDates.length
    ? withDates.reduce((s, r) => s + dayCount(r.start, r.end), 0) / withDates.length
    : 0;

  /** The same rows, asked a different question: not "what did they book?" but
   *  "which of my cars have they had, and how did that go?" */
  const byCar = settled.reduce<Record<string, { reg: string; times: number; days: number; spend: number }>>(
    (acc, r) => {
      const key = r.vehicle;
      const prev = acc[key] ?? { reg: r.reg, times: 0, days: 0, spend: 0 };
      acc[key] = {
        reg: r.reg,
        times: prev.times + 1,
        days: prev.days + (r.end ? dayCount(r.start, r.end) : 0),
        spend: prev.spend + r.total,
      };
      return acc;
    },
    {}
  );

  return (
    <Panel title="Rentals" description="Every booking this customer has held, and every car they have had out.">
      <ProducedFrom sources={[{ key: "identity", label: "Identity" }]} onJump={onJump} />

      {c.rentals.length === 0 ? (
        <EmptyHint>No rentals yet. This customer has an account but has never booked.</EmptyHint>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Rentals"
              value={String(c.rentals.length)}
              hint={
                settled.length === c.rentals.length
                  ? "None cancelled"
                  : `${c.rentals.length - settled.length} cancelled`
              }
            />
            <Stat label="Lifetime value" value={money(lifetime)} hint="Excludes cancellations" />
            <Stat
              label="Average length"
              value={avgLength ? `${avgLength.toFixed(1)} days` : "—"}
              hint="Across rentals with an end date"
            />
          </div>

          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "booking", label: "By booking" },
              { value: "car", label: "By car" },
            ]}
          />

          {view === "booking" ? (
            <Section>
              <div className={listCls}>
                {c.rentals.map((r) => (
                  <div key={r.id} className="flex items-center gap-4 px-5 py-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-card ring-1 ring-foreground/5">
                      <Car className="size-4 text-muted-foreground" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {r.vehicle} <span className="text-muted-foreground">· {r.reg}</span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {r.ref} · {fmtDate(r.start)} → {fmtDate(r.end)}
                        {r.end && ` · ${dayCount(r.start, r.end)} days`}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">{money(r.total)}</p>
                      {/* "Settled" is only true of a rental that has actually
                          run. A Pending booking with nothing owed has not been
                          settled — it has not been invoiced. */}
                      {r.outstanding > 0 ? (
                        <p className="mt-0.5 text-xs font-medium tabular-nums text-primary">
                          {money(r.outstanding)} owed
                        </p>
                      ) : r.status === "Active" || r.status === "Completed" ? (
                        <p className="mt-0.5 text-xs text-success">Settled</p>
                      ) : (
                        <p className="mt-0.5 text-xs text-muted-foreground">—</p>
                      )}
                    </div>

                    <Pill tone={RENTAL_TONE[r.status]}>{r.status}</Pill>

                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => router.push(`/rentals/${r.id}`)}
                    >
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            </Section>
          ) : (
            <Section
              title="Cars they have had"
              description="Useful before handing over the same car again — or deliberately not."
            >
              <div className={listCls}>
                {Object.entries(byCar).map(([name, v]) => (
                  <div key={name} className="flex items-center gap-4 px-5 py-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-card ring-1 ring-foreground/5">
                      <Car className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{v.reg}</p>
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground">
                      {v.times}× · {v.days} days
                    </p>
                    <p className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">{money(v.spend)}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </Panel>
  );
}
