/**
 * Screen 4 — Cancellation candidates awaiting a human decision.
 *
 * THE ASYMMETRY THAT SHAPES THIS ENTIRE SCREEN: keeping a car blocked for a
 * trip that has actually been cancelled costs one manual unblock. Releasing a
 * block for a trip that is still real sells the same car twice.
 *
 * A row only reaches `cancellation_candidate` when a database trigger has
 * already proved the observing run was authoritative, observed that exact
 * vehicle, covered the trip's window and cleared the 48h hold. So this screen
 * never has to decide whether an absence meant anything — it asks a human to
 * confirm what the evidence already supports, and it shows them that evidence.
 *
 * Nothing here is automatic. There is no bulk release, and the three safe
 * outcomes (keep blocked, reinstate, stop asking) are one click each while the
 * one dangerous outcome requires typing the trip id.
 */
"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  EyeOff,
  Lock,
  RotateCcw,
  ShieldQuestion,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  readHold,
  readTuroVehicleId,
  useResolveCancellationCandidate,
  useTuroCancellationCandidates,
  type CancellationResolution,
  type TuroBridgeRow,
} from "@/hooks/use-turo-bridge";
import { useTuroSyncJobs, type TuroSyncJob } from "@/hooks/use-turo-sync-jobs";
import {
  EmptyState,
  Notice,
  SchemaMissing,
  SectionTitle,
  SourceBadge,
  TripWindow,
  Unknown,
  fmtDateTime,
} from "./shared";

interface Gate {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

/**
 * A PREVIEW of the five checks `public.turo_release_block()` re-proves in SQL
 * at the moment of deletion. It is never a substitute: if this screen got a
 * check wrong the result is a confusing refusal, not a wrong release. Rendering
 * them is what turns a greyed-out button into an explanation, which is the
 * question an operator will actually have.
 */
function buildGates(row: TuroBridgeRow, job: TuroSyncJob | null, now: Date): Gate[] {
  const hold = readHold(row, now);
  const turoVehicleId = readTuroVehicleId(row).value;

  const jobExists = !!job;
  /* ⚠ observed_complete, NOT is_authoritative — and the DATABASE draws the line
     here, not us (turo-bridge-poc/sql/03-foundation-schema.sql:1337:
     `IF v_job.id IS NULL OR NOT v_job.observed_complete THEN ... RAISE`).

     The two predicates differ by one term, `parsed_count > 0`, and that term is
     the entire defence against the WAF case: turo.com answers the trips feed
     HTTP 200 with a valid but empty body, the walk terminates on its own because
     an empty page carries no next link, /api/vehicles/me answers normally so the
     vehicle-observation check passes too — and the run reads as succeeded, saw
     the end of the feed, no degraded reason, no errors, a window on both ends.
     is_authoritative is TRUE for that run. It parsed nothing.

     Showing this preview gate as passed on is_authoritative meant offering a
     release the database was always going to refuse, and offering it on the one
     class of run where absence means nothing at all. */
  const authoritative = !!job?.observed_complete && !!job?.is_authoritative;
  const observed =
    !!job && !!turoVehicleId && (job.observed_turo_vehicle_ids ?? []).includes(turoVehicleId);
  const covered =
    !!job &&
    !!job.window_start &&
    !!job.window_end &&
    !!row.starts_at &&
    !!row.ends_at &&
    new Date(row.starts_at) >= new Date(job.window_start) &&
    new Date(row.ends_at) <= new Date(job.window_end);
  const holdDone = !hold.active && !!hold.holdUntil;

  return [
    {
      key: "evidence_job_exists",
      label: "A sync run is on record as having missed this trip",
      passed: jobExists,
      detail: jobExists
        ? `Run ${job!.id.slice(0, 8)} (${job!.job_kind}), started ${fmtDateTime(job!.started_at)}.`
        : "No evidence run is linked. Absence with no run behind it is not evidence of anything, and the database will refuse a release.",
    },
    {
      key: "job_authoritative",
      label: "That run read the whole feed",
      passed: authoritative,
      detail: !job
        ? "No run to judge."
        : authoritative
          ? "It reached the end of the feed with no errors, no unreadable trips and a known date range."
          : `Not authoritative — the database records its coverage as "${job.completeness}"${
              job.degraded_reason ? `, degraded: ${job.degraded_reason}` : ""
            }. A partial read cannot prove a trip is gone.`,
    },
    {
      key: "vehicle_observed",
      label: "That run actually looked at this vehicle",
      passed: observed,
      detail: !turoVehicleId
        ? "This trip carries no Turo vehicle id, so no run can prove it looked at the right car."
        : observed
          ? `Turo vehicle ${turoVehicleId} was among the vehicles that run read.`
          : `Turo vehicle ${turoVehicleId} was not among the vehicles that run read. It may simply never have looked.`,
    },
    {
      key: "window_covers_trip",
      label: "The run's date range covers the trip",
      passed: covered,
      detail:
        !job || !job.window_start || !job.window_end
          ? "The run did not record a date range, so it covers nothing."
          : covered
            ? "The trip falls entirely inside the range the run proved it read."
            : "The trip falls outside the range that run read, so its absence there means nothing.",
    },
    {
      key: "hold_expired",
      label: "The 48-hour post-trip hold has expired",
      passed: holdDone,
      detail: !hold.holdUntil
        ? "No end date on this trip, so the hold cannot be calculated."
        : holdDone
          ? `Hold ended ${fmtDateTime(hold.holdUntil)}.`
          : `Held until ${fmtDateTime(hold.holdUntil)}. Guests can extend up to 24h after a trip ends and Turo auto-accepts.`,
    },
  ];
}

export function CancellationScreen() {
  const candidates = useTuroCancellationCandidates();
  const jobsQuery = useTuroSyncJobs({ limit: 50, kind: "trips" });
  const [active, setActive] = useState<TuroBridgeRow | null>(null);

  const jobById = useMemo(
    () => new Map(jobsQuery.rows.map((j) => [j.id, j])),
    [jobsQuery.rows],
  );
  /* The citation a release will carry. Same rule as the gate above and as
     turo_release_block(): a run that parsed nothing cannot testify that a trip
     is gone, however clean its shape. Picking on is_authoritative alone handed
     the operator a job id the database would then reject. */
  const latestAuthoritative = useMemo(
    () => jobsQuery.rows.find((j) => j.observed_complete === true && j.is_authoritative === true) ?? null,
    [jobsQuery.rows],
  );

  if (!candidates.foundationApplied && candidates.allRows.length > 0) {
    return (
      <SchemaMissing
        what="The cancellation queue"
        message={candidates.filterUnavailableReason}
      />
    );
  }

  const rows = candidates.rows;

  /** The run this row's absence is attributed to, else the latest clean run. */
  const evidenceFor = (row: TuroBridgeRow): TuroSyncJob | null =>
    (row.missing_evidence_job_id ? jobById.get(row.missing_evidence_job_id) : null) ??
    latestAuthoritative;

  const now = new Date();
  const releasableCount = rows.filter((r) =>
    buildGates(r, evidenceFor(r), now).every((g) => g.passed),
  ).length;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Possibly cancelled"
        description="Trips a sync run did not find. Every one of these still has its car blocked, and will keep it blocked until you decide."
      />

      <Notice tone="info">
        <span className="font-medium text-foreground">
          A trip missing from a sync is not proof it was cancelled.
        </span>{" "}
        Turo&apos;s bot protection can return an empty-but-valid answer, a session can expire, and
        a renamed field can hide a trip that is still very much running. Nothing here is ever
        released automatically — releasing a block on a live trip sells the same car twice.
      </Notice>

      {jobsQuery.schemaMissing && (
        <Notice tone="warn">
          Sync run history cannot be read, so no run can be cited as evidence. Nothing on this
          screen can be released until that is fixed — which is the safe direction.
        </Notice>
      )}

      {!jobsQuery.schemaMissing && !latestAuthoritative && rows.length > 0 && (
        <Notice tone="warn">
          <span className="font-medium text-foreground">
            No sync run has ever read your Turo calendar all the way through.
          </span>{" "}
          A release has to cite a run that did, so nothing here can be released yet. Run a sync
          from the extension while signed in to Turo and let it finish.
        </Notice>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />}
          title="No trips are in question"
          body="Every trip we have seen is still showing up in your Turo feed. If one stops appearing, it will wait here for your decision rather than quietly releasing the car."
        />
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "trip" : "trips"} waiting ·{" "}
            <span
              className={
                releasableCount > 0
                  ? "text-[#16a34a] dark:text-green-400 font-medium"
                  : "text-muted-foreground"
              }
            >
              {releasableCount} {releasableCount === 1 ? "has" : "have"} enough evidence to
              release
            </span>
          </div>

          <div className="space-y-3">
            {rows.map((row) => (
              <CandidateCard
                key={row.id}
                row={row}
                job={evidenceFor(row)}
                now={now}
                onDecide={() => setActive(row)}
              />
            ))}
          </div>
        </>
      )}

      <DecisionDialog
        row={active}
        job={active ? evidenceFor(active) : null}
        onClose={() => setActive(null)}
      />
    </div>
  );
}

function CandidateCard({
  row,
  job,
  now,
  onDecide,
}: {
  row: TuroBridgeRow;
  job: TuroSyncJob | null;
  now: Date;
  onDecide: () => void;
}) {
  const gates = buildGates(row, job, now);
  const failing = gates.filter((g) => !g.passed);
  const releasable = failing.length === 0;
  const streak = row.missing_streak ?? row.missing_run_count ?? 0;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-medium text-foreground">{row.reservation_id}</h3>
              <SourceBadge source={row.source} />
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {row.vehicle_label ?? <Unknown why="No vehicle label" />}
              {row.guest_name ? ` · ${row.guest_name}` : ""}
            </div>
            <div className="mt-2">
              <TripWindow startsAt={row.starts_at} endsAt={row.ends_at} />
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="flex items-center justify-end gap-1.5 text-sm text-[#d97706] dark:text-orange-400">
              <Lock className="h-3.5 w-3.5" />
              Car still blocked
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Missing since {row.missing_since ? fmtDateTime(row.missing_since) : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {streak} {streak === 1 ? "run has" : "runs have"} not seen it
            </div>
          </div>
        </div>

        {/*
          The number of runs is shown but is explicitly NOT evidence. A bot
          filter that returns an empty 200 does so every single time, so
          repeating an unreliable observation never makes it reliable.
        */}
        {streak >= 3 && !releasable && (
          <p className="text-xs text-muted-foreground mt-3">
            It has been missing from several runs. That still is not evidence on its own — an
            unreliable read repeated is an unreliable read. The checks below are what count.
          </p>
        )}

        <div className="mt-4 rounded-md border border-[#f1f5f9] dark:border-border divide-y divide-[#f1f5f9] dark:divide-border">
          {gates.map((g) => (
            <GateRow key={g.key} gate={g} />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {releasable ? (
              <span className="text-[#16a34a] dark:text-green-400 font-medium">
                All checks pass — a release can be requested.
              </span>
            ) : (
              <span className="text-muted-foreground">
                {failing.length} {failing.length === 1 ? "check is" : "checks are"} not
                satisfied, so this car stays blocked.
              </span>
            )}
          </div>
          <Button size="sm" variant={releasable ? "default" : "outline"} onClick={onDecide}>
            Decide
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GateRow({ gate }: { gate: Gate }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      {gate.passed ? (
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-[#16a34a] dark:text-green-400" />
      ) : (
        <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-[#d97706] dark:text-orange-400" />
      )}
      <div className="min-w-0">
        <div
          className={`text-sm ${
            gate.passed ? "text-foreground" : "text-[#d97706] dark:text-orange-400 font-medium"
          }`}
        >
          {gate.label}
        </div>
        <div className="text-xs text-muted-foreground">{gate.detail}</div>
      </div>
    </div>
  );
}

/**
 * The decision.
 *
 * Four outcomes; the three safe ones are the easy ones:
 *   KEEP BLOCKED — one click. This is the default posture and always available.
 *   REINSTATE    — the trip is real and still on; send it back to staged.
 *   IGNORE       — stop asking, keep the block.
 *   RELEASE      — requires every check to pass, a cited run, AND the operator
 *                  to type the trip id. A checkbox is something you tick past;
 *                  typing an identifier is something you have to look at.
 *
 * Even then this only ASKS. `turo_release_block()` re-proves all five checks in
 * SQL and refuses if anything moved since this dialog rendered, and a
 * BEFORE DELETE trigger refuses any other route to removing a Turo block.
 */
function DecisionDialog({
  row,
  job,
  onClose,
}: {
  row: TuroBridgeRow | null;
  job: TuroSyncJob | null;
  onClose: () => void;
}) {
  const resolve = useResolveCancellationCandidate();
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [lastId, setLastId] = useState<string | null>(null);

  if (row && row.id !== lastId) {
    setLastId(row.id);
    setTyped("");
    setNote("");
  }

  if (!row) return null;

  const gates = buildGates(row, job, new Date());
  const releasable = gates.every((g) => g.passed);
  const typedOk = typed.trim() === row.reservation_id;
  const canRelease = releasable && typedOk && !!job && !resolve.isPending;

  const run = (resolution: CancellationResolution) => {
    resolve.mutate(
      {
        reservationRowId: row.id,
        resolution,
        jobId: resolution === "release" ? (job?.id ?? undefined) : undefined,
        note: note.trim() || undefined,
        typedConfirmation: resolution === "release" ? typed.trim() : undefined,
      },
      {
        onSuccess: () => {
          toast({
            title:
              resolution === "release"
                ? "Block released"
                : resolution === "reinstate"
                  ? "Trip reinstated"
                  : resolution === "ignore"
                    ? "Trip ignored"
                    : "Kept blocked",
            description:
              resolution === "release"
                ? `${row.vehicle_label ?? "The vehicle"} is back on sale for those dates.`
                : "The car stays blocked. Nothing was released.",
          });
          onClose();
        },
        onError: (e: unknown) => {
          toast({
            variant: "destructive",
            title: "Nothing was changed",
            description: (e as Error)?.message ?? "The decision could not be recorded.",
          });
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Is Turo trip {row.reservation_id} really cancelled?</DialogTitle>
          <DialogDescription>
            {row.vehicle_label ?? "This vehicle"} is blocked from{" "}
            {row.starts_at ? fmtDateTime(row.starts_at) : "—"} to{" "}
            {row.ends_at ? fmtDateTime(row.ends_at) : "—"}. Releasing puts it back on sale for
            those dates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-[#f1f5f9] dark:border-border divide-y divide-[#f1f5f9] dark:divide-border">
            {gates.map((g) => (
              <GateRow key={g.key} gate={g} />
            ))}
          </div>

          {job && (
            <p className="text-xs text-muted-foreground">
              A release will cite run {job.id.slice(0, 8)} ({job.job_kind}), started{" "}
              {fmtDateTime(job.started_at)}, which read {job.records_seen} trips. The database
              re-checks that run&apos;s authority before it removes anything.
            </p>
          )}

          <div>
            <Label htmlFor="turo-decision-note" className="text-sm">
              Note (optional, kept on the record)
            </Label>
            <Textarea
              id="turo-decision-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1.5"
              placeholder="e.g. guest cancelled in the Turo app on Tuesday"
            />
          </div>

          {releasable ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 px-4 py-3 space-y-2">
              <p className="text-sm text-[#404040] dark:text-muted-foreground">
                To put this car back on sale, type the trip id{" "}
                <span className="font-mono font-medium text-foreground">
                  {row.reservation_id}
                </span>{" "}
                below. If the trip is in fact still running, this double-books the car.
              </p>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={row.reservation_id}
                className="font-mono"
                autoComplete="off"
              />
            </div>
          ) : (
            <Notice tone="warn">
              <span className="font-medium text-foreground">
                This trip cannot be released yet.
              </span>{" "}
              The checks above are the ones the database itself enforces, and it will refuse a
              release while any of them fails. You can still keep it blocked, reinstate it, or
              stop being asked about it.
            </Notice>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex flex-wrap gap-2 sm:mr-auto">
            <Button variant="outline" onClick={() => run("ignore")} disabled={resolve.isPending}>
              <EyeOff className="h-4 w-4 mr-1.5" />
              Stop asking
            </Button>
            <Button
              variant="outline"
              onClick={() => run("reinstate")}
              disabled={resolve.isPending}
            >
              <RotateCcw className="h-4 w-4 mr-1.5" />
              It&apos;s still on
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => run("keep_block")}
            disabled={resolve.isPending}
          >
            <Clock className="h-4 w-4 mr-1.5" />
            Keep blocked
          </Button>
          <Button
            variant="destructive"
            onClick={() => run("release")}
            disabled={!canRelease}
            title={
              releasable
                ? undefined
                : "The evidence checks above have not been satisfied."
            }
          >
            <ShieldQuestion className="h-4 w-4 mr-1.5" />
            {resolve.isPending ? "Working…" : "Release the block"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
