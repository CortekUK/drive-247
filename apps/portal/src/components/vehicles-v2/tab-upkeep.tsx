"use client";

/**
 * OPERATIONS — Compliance & servicing.
 *
 * "Keeping it road-legal and running" as one tab: the dates that decide
 * whether it may go out, the odometer, and the service history that turns the
 * odometer into a due reading.
 *
 * The one distinction kept from the longer version, because it changes what an
 * operator does: an expired INSPECTION stops the car going out; an expired
 * WARRANTY costs money and stops nothing. Painting both the same colour is how
 * an operator learns to ignore the colour.
 */

import { useState } from "react";
import { Plus, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ActionButton,
  AffixInput,
  DataRow,
  EmptyHint,
  Field,
  IconButton,
  List,
  NumberInput,
  Panel,
  Pill,
  Section,
  SwitchRow,
  daysUntil,
  fmtDate,
  inputCls,
  num,
  useFmt,
} from "./kit";
import type { ServiceRecord } from "@/hooks/use-vehicle-services";
import type { VehicleRecord } from "./use-vehicle-record";

export type Verdict = "unset" | "valid" | "soon" | "expired";

export type ComplianceRow = {
  /** The `vehicles` column this row edits. */
  key: "mot_due_date" | "tax_due_date" | "warranty_end_date";
  label: string;
  date: string | null;
  verdict: Verdict;
  /** Does an expiry stop the car going out, or only cost money? */
  blocking: boolean;
};

function VerdictPill({ verdict, date, blocking }: { verdict: Verdict; date: string | null; blocking: boolean }) {
  if (verdict === "unset") return <Pill tone="neutral">Not set</Pill>;
  if (verdict === "expired")
    return (
      <Pill tone={blocking ? "warning" : "neutral"}>Expired {Math.abs(daysUntil(date))}d ago</Pill>
    );
  if (verdict === "soon") return <Pill tone="warning">In {daysUntil(date)}d</Pill>;
  return <Pill tone="success">Valid</Pill>;
}

export function UpkeepTab({
  vehicle,
  patch,
  patchNow,
  rows,
  services,
  onAddService,
  onDeleteService,
  serviceInterval,
  nextServiceMileage,
  distToService,
  overdue,
  readOnly,
}: {
  vehicle: VehicleRecord;
  patch: (fields: Partial<VehicleRecord>) => void;
  patchNow: (fields: Partial<VehicleRecord>) => void;
  rows: ComplianceRow[];
  services: ServiceRecord[];
  onAddService: (input: {
    service_date: string;
    service_type: string;
    cost: number;
    mileage: number | null;
  }) => void;
  onDeleteService: (id: string) => void;
  serviceInterval: number;
  nextServiceMileage: number | null;
  distToService: number | null;
  overdue: boolean;
  readOnly: boolean;
}) {
  const fmt = useFmt();
  const [draft, setDraft] = useState({ date: "", type: "", cost: "", mileage: "" });
  const canAdd = Boolean(draft.date && draft.type);

  const blocked = rows.filter((r) => r.blocking && r.verdict === "expired");
  const soon = rows.filter((r) => r.verdict === "soon");
  const spend = services.reduce((sum, s) => sum + (Number(s.cost) || 0), 0);

  return (
    <Panel
      title="Compliance & servicing"
      description="An expired inspection or registration takes the car off the booking site on its own."
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
                  <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    doesn&rsquo;t block hire
                  </span>
                )}
              </p>
              <input
                type="date"
                value={r.date ?? ""}
                disabled={readOnly}
                onChange={(e) => patchNow({ [r.key]: e.target.value || null } as Partial<VehicleRecord>)}
                className={cn(inputCls, "w-40 shrink-0 py-2 text-xs")}
              />
              <span className="w-36 shrink-0 text-right">
                <VerdictPill verdict={r.verdict} date={r.date} blocking={r.blocking} />
              </span>
            </div>
          ))}
          <div className="flex items-center gap-4 px-5 py-3">
            <p className="min-w-0 flex-1 text-sm font-medium text-muted-foreground">
              Warranty started
            </p>
            <input
              type="date"
              value={vehicle.warranty_start_date ?? ""}
              disabled={readOnly}
              onChange={(e) => patchNow({ warranty_start_date: e.target.value || null })}
              className={cn(inputCls, "w-40 shrink-0 py-2 text-xs")}
            />
            <span className="w-36 shrink-0" />
          </div>
        </List>
      </Section>

      <Section
        title="Servicing"
        hint={`Counted every ${serviceInterval.toLocaleString("en-US")} ${fmt.distUnit} from the last service logged.`}
      >
        <div className="grid grid-cols-[10rem_1fr] items-end gap-5">
          <Field label="Odometer">
            <NumberInput
              value={vehicle.current_mileage}
              onChange={(n) => patch({ current_mileage: n || null })}
              suffix={fmt.distUnit}
              placeholder="0"
              disabled={readOnly}
            />
          </Field>
          <div
            className={cn(
              "flex h-9 items-center gap-3 rounded-3xl px-4 text-sm ring-1",
              overdue ? "bg-warning-light/60 ring-warning/30" : "bg-muted/40 ring-foreground/5",
            )}
          >
            <Wrench className={cn("size-4 shrink-0", overdue ? "text-warning" : "text-muted-foreground")} />
            {nextServiceMileage === null ? (
              <span className="text-muted-foreground">
                No service history yet — log one below and the next reading is worked out from it
              </span>
            ) : overdue ? (
              <span>
                <span className="font-medium">{fmt.dist(Math.abs(distToService ?? 0))} overdue</span>
                <span className="text-muted-foreground">
                  {" "}
                  · was due at {fmt.dist(nextServiceMileage)}
                </span>
              </span>
            ) : (
              <span>
                <span className="font-medium">Next in {fmt.dist(distToService ?? 0)}</span>
                <span className="text-muted-foreground"> · at {fmt.dist(nextServiceMileage)}</span>
              </span>
            )}
          </div>
        </div>

        <div className="mt-5">
          <List>
            <SwitchRow
              checked={!!vehicle.has_service_plan}
              disabled={readOnly}
              onChange={(v) => patchNow({ has_service_plan: v })}
              label="Servicing is on a prepaid plan"
            />
          </List>
        </div>
      </Section>

      <Section
        title="Service history"
        hint="Each one posts its cost to this car's P&L."
        action={
          services.length ? (
            <span className="text-xs text-muted-foreground">
              {fmt.money(spend)} across {services.length}
            </span>
          ) : undefined
        }
      >
        {services.length === 0 ? (
          <EmptyHint>Nothing logged yet.</EmptyHint>
        ) : (
          <List className="mb-4">
            {services.map((s) => (
              <DataRow
                key={s.id}
                label={s.service_type || s.description || "Service"}
                sub={`${fmtDate(s.service_date)}${s.mileage ? ` · ${fmt.dist(s.mileage)}` : ""}`}
                right={
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium tabular-nums">{fmt.money(s.cost)}</span>
                    {!readOnly && (
                      <IconButton title="Remove" onClick={() => onDeleteService(s.id)}>
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    )}
                  </div>
                }
              />
            ))}
          </List>
        )}
        {!readOnly && (
          <div className="grid grid-cols-2 items-end gap-3 xl:grid-cols-[1fr_1.6fr_0.9fr_1fr_auto]">
            <AffixInput
              type="date"
              value={draft.date}
              onChange={(v) => setDraft((d) => ({ ...d, date: v }))}
            />
            <AffixInput
              value={draft.type}
              onChange={(v) => setDraft((d) => ({ ...d, type: v }))}
              placeholder="Work done"
            />
            <AffixInput
              value={draft.cost}
              onChange={(v) => setDraft((d) => ({ ...d, cost: v }))}
              prefix={fmt.currencySymbol}
              placeholder="0"
            />
            <AffixInput
              value={draft.mileage}
              onChange={(v) => setDraft((d) => ({ ...d, mileage: v }))}
              suffix={fmt.distUnit}
              placeholder="Odometer"
            />
            <ActionButton
              variant="outline"
              disabled={!canAdd}
              onClick={() => {
                onAddService({
                  service_date: draft.date,
                  service_type: draft.type.trim(),
                  cost: num(draft.cost),
                  mileage: draft.mileage.trim() === "" ? null : num(draft.mileage),
                });
                setDraft({ date: "", type: "", cost: "", mileage: "" });
              }}
            >
              <Plus className="size-4" />
              Log
            </ActionButton>
          </div>
        )}
      </Section>
    </Panel>
  );
}
