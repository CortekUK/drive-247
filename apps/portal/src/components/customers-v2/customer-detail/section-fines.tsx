"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Fines — tickets and charges raised against this customer's rentals.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { Gavel, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { AddFineDialog } from "@/components/fines/add-fine-dialog";
import { moneyIn } from "./derive";
import { EmptyHint, Meta, Panel, Pill, ProducedFrom, Section, Stat, fmtDate, listCls } from "./kit";
import type { SectionProps } from "./sections";

export function SectionFines({ c, onJump, canEdit, currency }: SectionProps) {
  const [addOpen, setAddOpen] = useState(false);
  const money = moneyIn(currency);
  const unpaid = c.fines.filter((f) => f.status === "Open");
  const unpaidTotal = unpaid.reduce((s, f) => s + f.amount, 0);

  return (
    <Panel
      title="Fines"
      description="Citations and tolls that arrived against a car while this customer had it."
      right={
        canEdit ? (
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add a fine
          </Button>
        ) : undefined
      }
    >
      <ProducedFrom sources={[{ key: "rentals", label: "Rentals" }]} onJump={onJump} />

      {c.fines.length === 0 ? (
        <EmptyHint>Nothing has come in against this customer.</EmptyHint>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="On record" value={String(c.fines.length)} />
            <Stat
              label="Unpaid"
              value={String(unpaid.length)}
              hint={unpaid.length ? money(unpaidTotal) : "Nothing outstanding"}
              tone={unpaid.length ? "warning" : undefined}
            />
            <Stat
              label="Settled"
              value={String(c.fines.filter((f) => f.status !== "Open").length)}
              hint="Paid or waived"
            />
          </div>

          <Section title="All fines">
            <div className="space-y-3">
              {c.fines.map((f) => (
                <div key={f.id} className={cn(listCls, "divide-y-0")}>
                  <div className="flex items-center gap-4 px-5 py-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-card ring-1 ring-foreground/5">
                      <Gavel className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{f.type}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {f.reference} · {f.vehicle}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{money(f.amount)}</p>
                    <Pill tone={f.status === "Open" ? "warning" : f.status === "Paid" ? "success" : "neutral"}>
                      {f.status}
                    </Pill>
                  </div>
                  <div className="grid grid-cols-3 gap-3 border-t border-foreground/5 px-5 py-3">
                    <Meta label="Issued" value={fmtDate(f.issuedOn)} />
                    <Meta label="Due" value={fmtDate(f.dueOn)} />
                    <Meta label="Liability" value={f.liability} />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      <AddFineDialog open={addOpen} onOpenChange={setAddOpen} preselectedCustomerId={c.id} />
    </Panel>
  );
}
