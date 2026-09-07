"use client";

/**
 * OPERATIONS, part two — Compliance & servicing, and Keys & documents.
 *
 * Compliance & servicing is "keeping it road-legal and running" as one tab:
 * the dates that decide whether it may go out, the odometer, and the service
 * history that turns the odometer into a due reading.
 *
 * The one distinction kept from the longer version, because it changes what an
 * operator does: an expired INSPECTION stops the car going out, an expired
 * WARRANTY costs money and stops nothing. Same colour for both teaches people
 * to ignore the colour.
 */

import { useState } from "react";
import { FileText, Plus, ShieldCheck, Trash2, Upload, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionButton, EmptyHint, Field, Panel, Pill, fmtDate, inputCls, money, textareaCls } from "@/app/playground/_shared";
import {
  SERVICE_INTERVAL_MILES,
  TODAY,
  type Compliance,
  type Custody,
  type Maintenance,
  type VehicleDoc,
  daysUntil,
  miles,
  num,
} from "./_data";
import { AffixInput, DataRow, IconButton, List, NumberInput, Section, SwitchRow } from "./_ui";

/* ══════════════════════════════════════════════════════════════════════════
 * Compliance & servicing
 * ═════════════════════════════════════════════════════════════════════════ */

export type Verdict = "unset" | "valid" | "soon" | "expired";

export type ComplianceRow = {
  key: keyof Compliance;
  label: string;
  date: string;
  verdict: Verdict;
  /** Does an expiry stop the car going out, or only cost money? */
  blocking: boolean;
};

function VerdictPill({ verdict, date, blocking }: { verdict: Verdict; date: string; blocking: boolean }) {
  if (verdict === "unset") return <Pill tone="neutral">Not set</Pill>;
  if (verdict === "expired") return <Pill tone={blocking ? "warning" : "neutral"}>Expired {Math.abs(daysUntil(date))}d ago</Pill>;
  if (verdict === "soon") return <Pill tone="warning">In {daysUntil(date)}d</Pill>;
  return <Pill tone="success">Valid</Pill>;
}

export function UpkeepTab({
  rows,
  compliance,
  onCompliance,
  maintenance,
  onMaintenance,
  nextServiceMileage,
  milesToService,
  overdue,
  makeId,
}: {
  rows: ComplianceRow[];
  compliance: Compliance;
  onCompliance: (fn: (c: Compliance) => Compliance) => void;
  maintenance: Maintenance;
  onMaintenance: (fn: (m: Maintenance) => Maintenance) => void;
  nextServiceMileage: number | null;
  milesToService: number | null;
  overdue: boolean;
  makeId: () => string;
}) {
  const [draft, setDraft] = useState({ date: "", type: "", cost: "", mileage: "" });
  const canAdd = Boolean(draft.date && draft.type && draft.mileage);

  const add = () => {
    if (!canAdd) return;
    onMaintenance((m) => ({
      ...m,
      services: [{ id: makeId(), date: draft.date, type: draft.type, cost: num(draft.cost), mileage: num(draft.mileage) }, ...m.services],
    }));
    setDraft({ date: "", type: "", cost: "", mileage: "" });
  };

  const blocked = rows.filter((r) => r.blocking && r.verdict === "expired");
  const soon = rows.filter((r) => r.verdict === "soon");
  const spend = maintenance.services.reduce((sum, s) => sum + s.cost, 0);

  return (
    <Panel
      title="Compliance & servicing"
      description={`Measured against ${fmtDate(TODAY)}. An expired inspection or registration takes the car off the site on its own.`}
    >
      <Section
        title="Certificates"
        action={
          blocked.length ? (
            <Pill tone="warning">Off the road</Pill>
          ) : soon.length ? (
            <Pill tone="warning">{soon.length} expiring</Pill>
          ) : (
            <Pill tone="success">
              <ShieldCheck className="size-3" />
              In date
            </Pill>
          )
        }
      >
        <List>
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-4 px-5 py-3">
              <p className="min-w-0 flex-1 text-sm font-medium">
                {r.label}
                {!r.blocking && (
                  <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">doesn&rsquo;t block hire</span>
                )}
              </p>
              <input
                type="date"
                value={r.date}
                onChange={(e) => onCompliance((c) => ({ ...c, [r.key]: e.target.value }))}
                className={cn(inputCls, "w-40 shrink-0 py-2 text-xs")}
              />
              <span className="w-32 shrink-0 text-right">
                <VerdictPill verdict={r.verdict} date={r.date} blocking={r.blocking} />
              </span>
            </div>
          ))}
          <div className="flex items-center gap-4 px-5 py-3">
            <p className="min-w-0 flex-1 text-sm font-medium text-muted-foreground">Warranty started</p>
            <input
              type="date"
              value={compliance.warrantyStart}
              onChange={(e) => onCompliance((c) => ({ ...c, warrantyStart: e.target.value }))}
              className={cn(inputCls, "w-40 shrink-0 py-2 text-xs")}
            />
            <span className="w-32 shrink-0" />
          </div>
        </List>
      </Section>

      <Section title="Servicing" hint={`Every ${SERVICE_INTERVAL_MILES.toLocaleString("en-US")} miles, from the last service logged.`}>
        <div className="grid grid-cols-[10rem_1fr] items-end gap-5">
          <Field label="Odometer">
            <NumberInput value={maintenance.odometer} onChange={(n) => onMaintenance((m) => ({ ...m, odometer: n }))} suffix="mi" placeholder="0" />
          </Field>
          <div
            className={cn(
              "flex h-9 items-center gap-3 rounded-3xl px-4 text-sm ring-1",
              overdue ? "bg-warning-light/60 ring-warning/30" : "bg-muted/40 ring-foreground/5",
            )}
          >
            <Wrench className={cn("size-4 shrink-0", overdue ? "text-warning" : "text-muted-foreground")} />
            {nextServiceMileage === null ? (
              <span className="text-muted-foreground">No service history yet</span>
            ) : overdue ? (
              <span>
                <span className="font-medium">{miles(Math.abs(milesToService!))} overdue</span>
                <span className="text-muted-foreground"> · was due at {miles(nextServiceMileage)}</span>
              </span>
            ) : (
              <span>
                <span className="font-medium">Next in {miles(milesToService!)}</span>
                <span className="text-muted-foreground"> · at {miles(nextServiceMileage)}</span>
              </span>
            )}
          </div>
        </div>

        <div className="mt-5">
          <List>
            <SwitchRow
              checked={maintenance.servicePlan}
              onChange={(v) => onMaintenance((m) => ({ ...m, servicePlan: v }))}
              label="Servicing is on a prepaid plan"
            />
          </List>
        </div>
      </Section>

      <Section
        title="Service history"
        action={maintenance.services.length ? <span className="text-xs text-muted-foreground">{money(spend)} across {maintenance.services.length}</span> : undefined}
      >
        {maintenance.services.length === 0 ? (
          <EmptyHint>Nothing logged yet.</EmptyHint>
        ) : (
          <List className="mb-4">
            {maintenance.services.map((s) => (
              <DataRow
                key={s.id}
                label={s.type}
                sub={`${fmtDate(s.date)} · ${miles(s.mileage)}`}
                right={
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium tabular-nums">{money(s.cost)}</span>
                    <IconButton title="Remove" onClick={() => onMaintenance((m) => ({ ...m, services: m.services.filter((r) => r.id !== s.id) }))}>
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </div>
                }
              />
            ))}
          </List>
        )}
        <div className="grid grid-cols-2 items-end gap-3 xl:grid-cols-[1fr_1.6fr_0.9fr_1fr_auto]">
          <AffixInput type="date" value={draft.date} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} />
          <AffixInput value={draft.type} onChange={(v) => setDraft((d) => ({ ...d, type: v }))} placeholder="Work done" />
          <AffixInput value={draft.cost} onChange={(v) => setDraft((d) => ({ ...d, cost: v }))} prefix="$" placeholder="0" />
          <AffixInput value={draft.mileage} onChange={(v) => setDraft((d) => ({ ...d, mileage: v }))} suffix="mi" placeholder="Odometer" />
          <ActionButton onClick={add} disabled={!canAdd} variant="outline">
            <Plus className="size-4" />
            Log
          </ActionButton>
        </div>
      </Section>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Keys & documents
 * ═════════════════════════════════════════════════════════════════════════ */

export function KeysDocsTab({
  custody,
  onCustody,
  docs,
  onDocs,
  makeId,
}: {
  custody: Custody;
  onCustody: (fn: (c: Custody) => Custody) => void;
  docs: VehicleDoc[];
  onDocs: (fn: (d: VehicleDoc[]) => VehicleDoc[]) => void;
  makeId: () => string;
}) {
  const [draft, setDraft] = useState({ name: "", kind: "" });
  const set = (k: keyof Custody) => (v: boolean | string) => onCustody((c) => ({ ...c, [k]: v }));

  const add = () => {
    if (!draft.name.trim()) return;
    onDocs((list) => [{ id: makeId(), name: draft.name.trim(), kind: draft.kind.trim() || "Other", addedOn: TODAY, size: "—" }, ...list]);
    setDraft({ name: "", kind: "" });
  };

  return (
    <Panel title="Keys & documents" description="Custody of the physical car and its papers. Nothing here is shown to a customer.">
      <Section title="Keys & security">
        <List>
          <SwitchRow checked={custody.hasSpareKey} onChange={set("hasSpareKey")} label="Spare key" hint={custody.hasSpareKey ? custody.spareKeyHolder || "No holder recorded" : undefined} />
          <SwitchRow checked={custody.hasLogbook} onChange={set("hasLogbook")} label="Title / logbook on file" />
          <SwitchRow checked={custody.hasTracker} onChange={set("hasTracker")} label="GPS tracker fitted" />
          <SwitchRow checked={custody.hasImmobiliser} onChange={set("hasImmobiliser")} label="Remote immobiliser fitted" />
        </List>

        {custody.hasSpareKey && (
          <div className="mt-4 grid grid-cols-2 gap-5">
            <Field label="Spare key held by">
              <AffixInput value={custody.spareKeyHolder} onChange={set("spareKeyHolder")} placeholder="Denver Downtown Hub — key safe" />
            </Field>
            <Field label="Notes">
              <AffixInput value={custody.spareKeyNotes} onChange={set("spareKeyNotes")} placeholder="Tagged 6HNA118" />
            </Field>
          </div>
        )}

        <div className="mt-4">
          <Field label="Security notes">
            <textarea value={custody.securityNotes} onChange={(e) => set("securityNotes")(e.target.value)} rows={2} className={textareaCls} />
          </Field>
        </div>
      </Section>

      <Section title="Documents" action={docs.length ? <span className="text-xs text-muted-foreground">{docs.length} on file</span> : undefined}>
        {docs.length > 0 && (
          <List className="mb-4">
            {docs.map((d) => (
              <DataRow
                key={d.id}
                label={
                  <span className="flex items-center gap-2">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    {d.name}
                  </span>
                }
                sub={`${d.kind} · ${fmtDate(d.addedOn)} · ${d.size}`}
                right={
                  <IconButton title="Remove" onClick={() => onDocs((list) => list.filter((x) => x.id !== d.id))}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                }
              />
            ))}
          </List>
        )}
        <div className="grid grid-cols-[2fr_1.2fr_auto] items-end gap-3">
          <AffixInput value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder="Document name" />
          <AffixInput value={draft.kind} onChange={(v) => setDraft((d) => ({ ...d, kind: v }))} placeholder="Kind" />
          <ActionButton onClick={add} disabled={!draft.name.trim()} variant="outline">
            <Upload className="size-4" />
            File it
          </ActionButton>
        </div>
      </Section>
    </Panel>
  );
}
