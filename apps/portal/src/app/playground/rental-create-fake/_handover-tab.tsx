"use client";

/**
 * Handover & condition — DESIGN SANDBOX. Nothing here is real.
 *
 * The one stage that is mostly empty before the car goes out, and that is shown
 * honestly rather than hidden. A rental you have not handed over yet HAS a
 * handover stage; it is simply blank, and a blank shot list is a to-do list.
 *
 * Two mirrored halves again, matching When & where and matching the real
 * product's two `rental_key_handovers` rows:
 *
 *   giving     "Vehicle collection"  before the rental
 *   receiving  "Vehicle return"      after it
 *
 * Each carries photographs, an odometer reading and notes, and each is confirmed
 * with a timestamp that can be undone. The return half stays locked until the
 * car has actually gone out, because you cannot receive a car you never gave.
 *
 * ONE DELIBERATE DEPARTURE FROM v1. The live product takes free-form photos —
 * up to ten, any angle, in any order — and the damage model then compares them
 * by index and lowers its own confidence when the angles do not line up. This
 * screen prescribes a six-shot list instead, the same six on both sides. It
 * costs the operator nothing, it turns an empty grid into an instruction, and it
 * is what makes a before/after comparison mean anything at all.
 *
 * The damage report is treated as exactly what it is: another OUTPUT produced
 * from inputs that can move underneath it. Add a photograph after running it and
 * it goes out of date and says so, in the same amber banner the agreement and
 * the insurance use. That is not a coincidence — it is the whole thesis of the
 * screen applied to the last stage.
 *
 * OWNS: nothing.
 * Renders its own `Panel`.
 */

import {
  Camera,
  Check,
  KeyRound,
  Gauge,
  ScanSearch,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  Undo2,
  RefreshCw,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Badge } from "@/components/ui-v2/badge";
import {
  money,
  fmtDateTime,
  Panel,
  Field,
  inputCls,
  textareaCls,
  cardCls,
  OutOfDateBanner,
  EmptyHint,
  type Drift,
} from "@/app/playground/_shared";

/* ══════════════════════════════════════════════════════════════════════════
   The shot list
   ══════════════════════════════════════════════════════════════════════════ */

export const SHOT_LIST = [
  { id: "front", label: "Front" },
  { id: "driver", label: "Driver side" },
  { id: "rear", label: "Rear" },
  { id: "passenger", label: "Passenger side" },
  { id: "interior", label: "Interior" },
  { id: "odometer", label: "Odometer" },
] as const;

/* ══════════════════════════════════════════════════════════════════════════
   A handover
   ══════════════════════════════════════════════════════════════════════════ */

/** One row of `rental_key_handovers`, plus the photographs hanging off it. */
export type HandoverLeg = {
  /** Which shots from the list have been taken. */
  shots: string[];
  odometer: string;
  notes: string;
  /** `handed_at` — the moment the keys actually moved. Null until confirmed. */
  at: Date | null;
};

export const emptyHandover = (): HandoverLeg => ({ shots: [], odometer: "", notes: "", at: null });

/* ══════════════════════════════════════════════════════════════════════════
   The damage report
   ══════════════════════════════════════════════════════════════════════════ */

export type DamageSeverity = "minor" | "moderate" | "severe";

export type DamageFinding = {
  location: string;
  description: string;
  severity: DamageSeverity;
  /** 0–1, as the real model returns it. */
  confidence: number;
};

export type DamageReport = {
  summary: string;
  hasNewDamage: boolean;
  findings: DamageFinding[];
  /** What the report was run against. Compared to now, this is what goes stale. */
  counts: { before: number; after: number };
  generatedAt: Date;
  reviewedAt: Date | null;
};

/**
 * Findings are anchored to angles, and an angle only produces a finding when it
 * was photographed on BOTH sides. That is the real model's own rule — it lowers
 * confidence rather than speculating about an angle it cannot compare — and it
 * makes the sandbox honest: shoot only the front and it finds nothing, shoot
 * everything and it finds three things.
 */
const CANDIDATES: (DamageFinding & { angle: string })[] = [
  {
    angle: "rear",
    location: "Rear bumper, offside corner",
    description: "A 12 cm scuff through the lacquer that is not present in the collection photograph.",
    severity: "moderate",
    confidence: 0.82,
  },
  {
    angle: "driver",
    location: "Driver side front alloy",
    description: "Kerbing along the outer rim edge. Cosmetic, no deformation of the spokes.",
    severity: "minor",
    confidence: 0.64,
  },
  {
    angle: "interior",
    location: "Rear bench, nearside",
    description: "Staining on the fabric roughly the size of a hand, absent at collection.",
    severity: "minor",
    confidence: 0.51,
  },
];

export function analyse(before: HandoverLeg, after: HandoverLeg): DamageReport {
  const findings = CANDIDATES.filter(
    (c) => before.shots.includes(c.angle) && after.shots.includes(c.angle)
  ).map(({ angle: _angle, ...f }) => f);

  return {
    summary: findings.length
      ? `${findings.length} thing${findings.length === 1 ? "" : "s"} in the return photographs that were not there at collection.`
      : "Nothing in the return photographs that was not already in the collection set.",
    hasNewDamage: findings.length > 0,
    findings,
    counts: { before: before.shots.length, after: after.shots.length },
    generatedAt: new Date(),
    reviewedAt: null,
  };
}

export const reportStale = (r: DamageReport, before: HandoverLeg, after: HandoverLeg) =>
  r.counts.before !== before.shots.length || r.counts.after !== after.shots.length;

/** A weight ramp, not a colour code: outline reads lighter than a filled grey,
 *  which reads lighter than the destructive tone. Amber is not available here —
 *  on this screen it means "out of date" and nothing else. */
const SEVERITY: Record<DamageSeverity, { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  minor: { label: "Minor", variant: "outline" },
  moderate: { label: "Moderate", variant: "secondary" },
  severe: { label: "Severe", variant: "destructive" },
};

/* ══════════════════════════════════════════════════════════════════════════
   Tab
   ══════════════════════════════════════════════════════════════════════════ */

export function HandoverTab({
  giving,
  receiving,
  onGiving,
  onReceiving,
  report,
  onAnalyse,
  onReview,
  onAcceptStale,
  vehicleLabel,
  keysByLockbox,
  allowance,
  excessRate,
  tierLabel,
  setupComplete,
}: {
  giving: HandoverLeg;
  receiving: HandoverLeg;
  onGiving: (patch: Partial<HandoverLeg>) => void;
  onReceiving: (patch: Partial<HandoverLeg>) => void;
  report: DamageReport | null;
  onAnalyse: () => void;
  onReview: () => void;
  /** Keep the report but stop it nagging — the same escape the agreement has. */
  onAcceptStale: () => void;
  vehicleLabel: string | null;
  keysByLockbox: boolean;
  /** Miles included across the whole hire. Null when the mileage is unlimited. */
  allowance: number | null;
  excessRate: number;
  tierLabel: string;
  setupComplete: boolean;
}) {
  const out = giving.at !== null;
  const back = receiving.at !== null;

  const stale = report ? reportStale(report, giving, receiving) : false;
  const canAnalyse = giving.shots.length > 0 && receiving.shots.length > 0;

  const drift: Drift[] = report
    ? [
        report.counts.before !== giving.shots.length && {
          label: "Collection set",
          was: `${report.counts.before} photos`,
          now: `${giving.shots.length} photos`,
        },
        report.counts.after !== receiving.shots.length && {
          label: "Return set",
          was: `${report.counts.after} photos`,
          now: `${receiving.shots.length} photos`,
        },
      ].filter(Boolean as unknown as (d: Drift | false) => d is Drift)
    : [];

  return (
    <Panel
      title="Handover & condition"
      description="What the car looked like when it left, what it looked like when it came back, and what changed in between."
    >
      {!setupComplete && (
        <EmptyHint>
          The car has not been booked in yet. Finish the customer, the vehicle and the when-and-where, then come back
          on the day.
        </EmptyHint>
      )}

      <HandoverCard
        kind="giving"
        leg={giving}
        onChange={onGiving}
        vehicleLabel={vehicleLabel}
        keysByLockbox={keysByLockbox}
        locked={false}
      />

      <HandoverCard
        kind="receiving"
        leg={receiving}
        onChange={onReceiving}
        vehicleLabel={vehicleLabel}
        keysByLockbox={keysByLockbox}
        locked={!out}
        mileage={
          out && back && giving.odometer && receiving.odometer
            ? { from: Number(giving.odometer), to: Number(receiving.odometer), allowance, excessRate, tierLabel }
            : undefined
        }
      />

      {/* ── the analysis ─────────────────────────────────────────────────── */}
      <div className={cn(cardCls, "p-6")}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ScanSearch className="size-4 text-primary" />
            <div>
              <p className="font-heading text-sm font-semibold">Damage analysis</p>
              <p className="text-[11px] text-muted-foreground">
                The two sets of photographs, compared angle by angle.
              </p>
            </div>
          </div>
          {report && (
            <Badge
              variant={report.hasNewDamage ? "destructive" : "success"}
              className="gap-1.5"
            >
              {report.hasNewDamage ? <AlertTriangle /> : <ShieldCheck />}
              {report.hasNewDamage ? "New damage flagged" : "No new damage"}
            </Badge>
          )}
        </div>

        {stale && drift.length > 0 && (
          <div className="mb-5">
            <OutOfDateBanner
              title="This analysis was run on a different set of photographs"
              meta={report ? `Run ${fmtDateTime(report.generatedAt)}` : undefined}
              drift={drift}
              primaryLabel="Re-run the analysis"
              onPrimary={onAnalyse}
              secondaryLabel="Keep this report"
              onSecondary={onAcceptStale}
            />
          </div>
        )}

        {!report ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {canAnalyse
                ? `Ready to compare ${giving.shots.length} collection photo${giving.shots.length === 1 ? "" : "s"} against ${receiving.shots.length} return photo${receiving.shots.length === 1 ? "" : "s"}.`
                : "Photograph the car on both sides of the rental and the comparison unlocks itself."}
            </p>
            <Button onClick={onAnalyse} disabled={!canAnalyse}>
              <Sparkles className="size-4" />
              Analyse the photographs
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div
              className={cn(
                "flex items-start gap-3 rounded-3xl p-5 ring-1",
                report.hasNewDamage
                  ? "bg-destructive-light ring-destructive/20"
                  : "bg-success-light ring-success/20"
              )}
            >
              {report.hasNewDamage ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : (
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
              )}
              <div className="min-w-0">
                <p className={cn("text-sm font-medium", report.hasNewDamage ? "text-destructive" : "text-success")}>
                  {report.summary}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Run {fmtDateTime(report.generatedAt)} · {report.counts.before} before / {report.counts.after} after
                  {report.reviewedAt && ` · reviewed ${fmtDateTime(report.reviewedAt)}`}
                </p>
              </div>
            </div>

            {report.findings.map((f) => {
              const sev = SEVERITY[f.severity];
              return (
                <div key={f.location} className="rounded-3xl bg-muted/40 p-5 ring-1 ring-foreground/5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={sev.variant}>{sev.label}</Badge>
                    <span className="text-sm font-medium">{f.location}</span>
                    <span className="text-xs text-muted-foreground">
                      {Math.round(f.confidence * 100)}% confident
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{f.description}</p>
                </div>
              );
            })}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onReview} disabled={!!report.reviewedAt}>
                <Check className="size-4" />
                {report.reviewedAt ? "Reviewed" : "Mark as reviewed"}
              </Button>
              <Button variant="ghost" onClick={onAnalyse}>
                <RefreshCw className="size-4" />
                Re-run
              </Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   One handover
   ══════════════════════════════════════════════════════════════════════════ */

function HandoverCard({
  kind,
  leg,
  onChange,
  vehicleLabel,
  keysByLockbox,
  locked,
  mileage,
}: {
  kind: "giving" | "receiving";
  leg: HandoverLeg;
  onChange: (patch: Partial<HandoverLeg>) => void;
  vehicleLabel: string | null;
  keysByLockbox: boolean;
  /** The return cannot happen before the collection. */
  locked: boolean;
  mileage?: {
    from: number;
    to: number;
    allowance: number | null;
    excessRate: number;
    tierLabel: string;
  };
}) {
  const giving = kind === "giving";
  const done = leg.at !== null;

  const toggleShot = (id: string) =>
    onChange({ shots: leg.shots.includes(id) ? leg.shots.filter((s) => s !== id) : [...leg.shots, id] });

  return (
    <div className={cn(cardCls, "p-6", locked && "opacity-60")}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-full",
              done ? "bg-success-light text-success" : "bg-muted text-muted-foreground"
            )}
          >
            {locked ? <Lock className="size-4" /> : <KeyRound className="size-4" />}
          </span>
          <div>
            <p className="font-heading text-sm font-semibold">
              {giving ? "Vehicle collection" : "Vehicle return"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {giving
                ? "Before the rental — document the condition before the keys leave"
                : "After the rental — document the condition when the keys come back"}
            </p>
          </div>
        </div>

        {done && leg.at && (
          <p className="text-[11px] text-muted-foreground">
            {giving ? "Collected" : "Returned"} {fmtDateTime(leg.at)}
          </p>
        )}
      </div>

      {locked ? (
        <p className="rounded-3xl bg-muted/40 px-5 py-4 text-sm text-muted-foreground ring-1 ring-foreground/5">
          The car has not gone out yet. Confirm the collection above and this opens.
        </p>
      ) : (
        <div className="space-y-6">
          {/* ── the shot list ────────────────────────────────────────────── */}
          <Field
            label={`Photographs — ${leg.shots.length} of ${SHOT_LIST.length}`}
            hint="The same six angles on both sides. That is what makes the comparison mean anything."
          >
            <div className="grid grid-cols-3 gap-3">
              {SHOT_LIST.map((s) => {
                const taken = leg.shots.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleShot(s.id)}
                    aria-pressed={taken}
                    className={cn(
                      "group relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-3xl transition-all",
                      taken
                        ? "bg-muted ring-2 ring-primary/40"
                        : "bg-muted/40 ring-1 ring-foreground/5 hover:ring-primary/30"
                    )}
                  >
                    {taken ? (
                      <span className="flex size-6 items-center justify-center rounded-full bg-primary">
                        <Check className="size-3.5 text-primary-foreground" strokeWidth={3} />
                      </span>
                    ) : (
                      <Camera className="size-5 text-muted-foreground/60" />
                    )}
                    <span
                      className={cn(
                        "px-2 text-center text-[11px] leading-tight",
                        taken ? "font-medium" : "text-muted-foreground"
                      )}
                    >
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* ── odometer + notes ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Odometer reading">
              <div className="relative">
                <Gauge className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="number"
                  value={leg.odometer}
                  onChange={(e) => onChange({ odometer: e.target.value })}
                  placeholder={giving ? "Mileage at pickup" : "Mileage at return"}
                  className={cn(inputCls, "pl-9")}
                />
              </div>
            </Field>
            <Field label="Vehicle">
              <div className={cn(inputCls, "items-center bg-muted/40 text-muted-foreground")}>
                {vehicleLabel ?? "No car chosen yet"}
              </div>
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              rows={2}
              value={leg.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              placeholder={
                giving
                  ? "Fuel level, existing marks, anything worth recording"
                  : "Condition on return, fuel level, anything the photographs miss"
              }
              className={textareaCls}
            />
          </Field>

          {/* ── mileage reckoning ────────────────────────────────────────── */}
          {mileage && <MileageSummary {...mileage} />}

          {/* ── the moment itself ────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            {done ? (
              <Button variant="outline" onClick={() => onChange({ at: null })}>
                <Undo2 className="size-4" />
                Undo {giving ? "collection" : "return"}
              </Button>
            ) : (
              <Button onClick={() => onChange({ at: new Date() })}>
                <KeyRound className="size-4" />
                {giving
                  ? keysByLockbox
                    ? "Confirm collection & send the code"
                    : "Confirm collection"
                  : "Confirm return"}
              </Button>
            )}
            {!done && leg.shots.length === 0 && (
              <span className="text-xs text-muted-foreground">
                You can confirm without photographs, but nothing will be comparable afterwards.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Mileage at return
   ══════════════════════════════════════════════════════════════════════════ */

function MileageSummary({
  from,
  to,
  allowance,
  excessRate,
  tierLabel,
}: {
  from: number;
  to: number;
  allowance: number | null;
  excessRate: number;
  tierLabel: string;
}) {
  const driven = Math.max(0, to - from);
  const excess = allowance === null ? 0 : Math.max(0, driven - allowance);
  const charge = excess * excessRate;

  const rows: { label: string; value: string }[] = [
    { label: "At collection", value: `${from.toLocaleString("en-US")} mi` },
    { label: "At return", value: `${to.toLocaleString("en-US")} mi` },
    { label: "Driven", value: `${driven.toLocaleString("en-US")} mi` },
    {
      label: `Allowed · ${tierLabel}`,
      value: allowance === null ? "Unlimited" : `${allowance.toLocaleString("en-US")} mi`,
    },
  ];

  return (
    <div className="overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5">
      <dl className="divide-y divide-foreground/5">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between px-5 py-2.5 text-xs">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="font-medium tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p
        className={cn(
          "px-5 py-3 text-xs font-medium",
          excess > 0 ? "bg-destructive-light text-destructive" : "text-success"
        )}
      >
        {allowance === null
          ? "Unlimited mileage — nothing to charge."
          : excess > 0
            ? `${excess.toLocaleString("en-US")} mi over · ${money(charge)} at ${excessRate.toFixed(2)} a mile`
            : "Within the allowance — nothing to charge."}
      </p>
    </div>
  );
}
