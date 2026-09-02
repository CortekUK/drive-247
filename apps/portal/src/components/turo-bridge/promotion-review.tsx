/**
 * Screen 3 — Review and confirm, before anything is created.
 *
 * PROMOTION MUST NEVER FEEL SILENT OR AUTOMATIC. It is two phases and the
 * first one writes nothing:
 *
 *   PHASE 1  `useTuroPromotionPlan()` asks the server what an import WOULD do.
 *            Nothing is written to rentals, vehicles, customers or
 *            blocked_dates. The operator reads it row by row.
 *   PHASE 2  `useApplyTuroPromotion()` sends back the approved `plan_hash`.
 *            The server re-runs the plan and refuses on ANY drift — a vehicle
 *            reassigned, a trip re-synced with new dates, a row promoted in
 *            another tab. Approving a stale plan is how the wrong car gets
 *            blocked, so the refusal is the feature.
 *
 * COUNTERS ARE ABSOLUTE AND COME FROM OUR OWN STAGED TABLE. There is no
 * percentage on this screen, no processed/total, and the word "complete" never
 * appears about the Turo read — a truncated sync must not be able to render as
 * finished.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  CircleAlert,
  Hash,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import {
  useTuroPromotion,
  type TuroPromotionPlan,
  type TuroPromotionPlanRow,
} from "@/hooks/use-turo-bridge";
import { EmptyState, Notice, SectionTitle, TripWindow, Unknown, fmtDateTime } from "./shared";

export function PromotionReviewScreen({
  stagedCount,
  needsVehicleCount,
  onGoToMapping,
}: {
  /** From our own table, for the "there is work here" prompt before a plan exists. */
  stagedCount: number;
  needsVehicleCount: number;
  onGoToMapping: () => void;
}) {
  const { plan, apply, currentPlan, reset } = useTuroPromotion();

  const [rowChecked, setRowChecked] = useState<Record<string, boolean>>({});
  const [ackPlaceholders, setAckPlaceholders] = useState(false);
  const [ackNoInvoices, setAckNoInvoices] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Any new plan invalidates every acknowledgement. Consent is given to a
  // specific set of rows and bindings, never to "whatever is on screen".
  useEffect(() => {
    /* A NEW PLAN INVALIDATES CONSENT — approval must never carry over onto rows
       the operator has not seen. The one thing that DOES survive is a vehicle
       the operator explicitly named, because that choice is what produced this
       plan; it is re-derived from the plan itself rather than from stale local
       state, so the ticks on screen always describe the plan on screen. */
    const fromPlan: Record<string, boolean> = {};
    for (const id of Object.keys(currentPlan?.vehicle_choices ?? {})) fromPlan[id] = true;
    setRowChecked(fromPlan);
    setAckPlaceholders(false);
    setAckNoInvoices(false);
  }, [currentPlan?.plan_hash]);

  const readyRows = useMemo(
    () => (currentPlan?.rows ?? []).filter((r) => r.blockers.length === 0),
    [currentPlan],
  );
  const blockedRows = useMemo(
    () => (currentPlan?.rows ?? []).filter((r) => r.blockers.length > 0),
    [currentPlan],
  );
  const needsReview = useMemo(
    () => readyRows.filter((r) => r.requires_review),
    [readyRows],
  );
  const allRowsChecked = needsReview.every((r) => rowChecked[r.staged_id]);
  const acknowledgedRowIds = Object.entries(rowChecked)
    .filter(([, v]) => v)
    .map(([k]) => k);

  /**
   * ⚠ TICKING A ROW HAS TO REACH THE SERVER, AND IT DID NOT.
   *
   * The planner only puts a row in its `ready` set when the vehicle was matched
   * by plate OR the caller NAMED the car in `vehicle_choices`
   * (turo-bridge-promote/index.ts:468, :537). A tick held only in this
   * component's state changed nothing: the confirmed rows stayed out of `ready`,
   * out of the plan hash and out of the import, while this screen enabled the
   * Import button and then reported a count that had never included them. The
   * operator confirmed twelve cars and got eight bookings, with nothing on
   * screen to say which four were missing or why.
   *
   * So a tick REBUILDS THE PLAN with that car named. The row comes back matched
   * `manual`, needing no further confirmation, and the plan hash now covers it —
   * which is also what makes apply able to import it without refusing its own
   * plan as drifted. Rebuilding writes nothing; it is a read.
   */
  const confirmRowVehicle = (row: TuroPromotionPlanRow, ticked: boolean) => {
    setRowChecked((prev) => ({ ...prev, [row.staged_id]: ticked }));
    if (!currentPlan) return;
    const next = { ...currentPlan.vehicle_choices };
    if (ticked && row.matched_vehicle_id) next[row.staged_id] = row.matched_vehicle_id;
    else delete next[row.staged_id];
    // Untouched rows keep whatever the planner decided; only this row moves.
    plan.mutate({ vehicleChoices: next });
  };

  const canApply =
    !!currentPlan &&
    readyRows.length > 0 &&
    allRowsChecked &&
    ackPlaceholders &&
    ackNoInvoices &&
    !apply.isPending;

  const handleApply = async () => {
    if (!currentPlan) return;
    try {
      const res = await apply.mutateAsync({
        plan: currentPlan,
        acknowledgements: {
          vehiclesConfirmed: allRowsChecked,
          placeholderGuests: ackPlaceholders,
          noInvoices: ackNoInvoices,
        },
        acknowledgedRowIds,
      });
      setConfirmOpen(false);
      /* The server reports `counts.imported` and `counts.conflicts`
         (turo-bridge-promote/index.ts:790); there is no top-level `promoted`,
         so the old read rendered "0 bookings were created" after a successful
         import of 12. A clash is reported in the SAME sentence rather than
         swallowed — a car that was already booked is exactly what the operator
         needs to hear about. */
      const imported = res?.counts?.imported ?? 0;
      const clashed = res?.counts?.conflicts ?? 0;
      toast({
        title: res?.nothing_to_do ? "Nothing to import" : "Import finished",
        description:
          `${imported} ${imported === 1 ? "booking was" : "bookings were"} created in Drive247.` +
          (clashed > 0
            ? ` ${clashed} could not be imported because the car is already booked — nothing was changed for those.`
            : ""),
      });
    } catch (e) {
      setConfirmOpen(false);
      toast({
        variant: "destructive",
        title: "Nothing was imported",
        description: (e as Error)?.message ?? "The import was refused.",
      });
    }
  };

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Review and confirm"
        description="Exactly what will be created in Drive247 if you go ahead. Building a plan writes nothing."
        action={
          <Button
            variant={currentPlan ? "outline" : "default"}
            size="sm"
            onClick={() => {
              reset();
              plan.mutate({});
            }}
            disabled={plan.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${plan.isPending ? "animate-spin" : ""}`} />
            {currentPlan ? "Rebuild the plan" : "Build the import plan"}
          </Button>
        }
      />

      {plan.isError && (
        <Notice tone="danger">
          <span className="font-medium text-foreground">The plan could not be built. </span>
          {(plan.error as Error)?.message}
        </Notice>
      )}

      {apply.data && <ApplyResult result={apply.data} />}

      {!currentPlan ? (
        <EmptyState
          icon={<CalendarCheck className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />}
          title={
            stagedCount > 0
              ? `${stagedCount} ${stagedCount === 1 ? "trip is" : "trips are"} ready to review`
              : "Nothing is waiting to be imported"
          }
          body={
            stagedCount > 0 ? (
              <>
                Build a plan to see, row by row, which car each trip would block and what would
                be created. Building a plan changes nothing — you approve it afterwards.
              </>
            ) : needsVehicleCount > 0 ? (
              <>
                {needsVehicleCount} Turo{" "}
                {needsVehicleCount === 1 ? "vehicle still needs" : "vehicles still need"} to be
                matched to one of your cars before any trip can be imported.
              </>
            ) : (
              <>
                Once trips have been synced and their vehicles mapped, they appear here for
                review before anything is created in Drive247.
              </>
            )
          }
          action={
            needsVehicleCount > 0 && stagedCount === 0 ? (
              <Button variant="outline" size="sm" onClick={onGoToMapping}>
                Go to the mapping queue
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <PlanCounts plan={currentPlan} onGoToMapping={onGoToMapping} />

          <Notice tone="info">
            These counts describe the trips{" "}
            <span className="font-medium text-foreground">we hold</span>, not your Turo calendar.
            If your last sync was partial, trips you have never seen are not counted here — check{" "}
            <span className="font-medium text-foreground">Sync history</span> before treating
            this as the full picture.
          </Notice>

          {currentPlan.warnings.length > 0 && (
            <Notice tone="warn">
              <ul className="space-y-1">
                {currentPlan.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}

          {readyRows.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-foreground">
                Will be created ({readyRows.length})
              </h3>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                        <TableHead className="w-24">Right car?</TableHead>
                        <TableHead>Turo trip</TableHead>
                        <TableHead>Turo vehicle</TableHead>
                        <TableHead>Will block</TableHead>
                        <TableHead>Dates</TableHead>
                        <TableHead>What gets created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {readyRows.map((r) => (
                        <PlanRow
                          key={r.staged_id}
                          row={r}
                          checked={!!rowChecked[r.staged_id]}
                          // Rebuilds the plan with this car named — see
                          // confirmRowVehicle. A tick that stayed local was a
                          // tick that never imported anything.
                          onToggle={(v) => confirmRowVehicle(r, v)}
                          busy={plan.isPending}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {blockedRows.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-foreground">
                Not being imported ({blockedRows.length})
              </h3>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                        <TableHead>Turo trip</TableHead>
                        <TableHead>Turo vehicle</TableHead>
                        <TableHead>Dates</TableHead>
                        <TableHead>Why not</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {blockedRows.map((r) => (
                        <TableRow key={r.staged_id}>
                          <TableCell className="align-top font-medium">
                            {r.reservation_id}
                          </TableCell>
                          <TableCell className="align-top text-sm">
                            {r.vehicle_label ?? <Unknown />}
                          </TableCell>
                          <TableCell className="align-top">
                            <TripWindow startsAt={r.starts_at} endsAt={r.ends_at} />
                          </TableCell>
                          <TableCell className="align-top">
                            <ul className="space-y-0.5">
                              {r.blockers.map((b, i) => (
                                <li
                                  key={i}
                                  className="text-sm text-[#d97706] dark:text-orange-400 flex items-start gap-1.5"
                                >
                                  <CircleAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                  {b}
                                </li>
                              ))}
                            </ul>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {readyRows.length > 0 && (
            <Card>
              <CardContent className="p-5 space-y-4">
                <h3 className="text-sm font-medium text-foreground">
                  Before you import, confirm you understand
                </h3>

                {needsReview.length > 0 && (
                  <div
                    className={`text-sm ${
                      allRowsChecked
                        ? "text-[#16a34a] dark:text-green-400"
                        : "text-[#d97706] dark:text-orange-400"
                    }`}
                  >
                    {allRowsChecked
                      ? `All ${needsReview.length} vehicle matches confirmed above.`
                      : `${
                          needsReview.filter((r) => !rowChecked[r.staged_id]).length
                        } of ${needsReview.length} rows still need you to confirm the vehicle in the table above — they were not matched by licence plate.`}
                  </div>
                )}

                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={ackPlaceholders}
                    onCheckedChange={(c) => setAckPlaceholders(c === true)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-[#404040] dark:text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Placeholder guests will be created
                    </span>{" "}
                    with a name only — no email and no phone number, because Turo does not give
                    us contact details. They will appear in your customers list and can never be
                    emailed or texted.
                  </span>
                </label>

                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={ackNoInvoices}
                    onCheckedChange={(c) => setAckNoInvoices(c === true)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-[#404040] dark:text-muted-foreground">
                    <span className="font-medium text-foreground">
                      No invoice, charge or receivable will be raised
                    </span>{" "}
                    for these bookings. Turo already collected the money; the trip total is
                    recorded for reference only.
                  </span>
                </label>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Hash className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-mono" title={currentPlan.plan_hash}>
                      plan {currentPlan.plan_hash.slice(0, 12)} · built{" "}
                      {fmtDateTime(currentPlan.generated_at)} — the server checks this still
                      matches before it creates anything
                    </span>
                  </div>
                  <Button onClick={() => setConfirmOpen(true)} disabled={!canApply}>
                    Import {readyRows.length}{" "}
                    {readyRows.length === 1 ? "booking" : "bookings"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        rows={readyRows}
        pending={apply.isPending}
        onConfirm={handleApply}
      />
    </div>
  );
}

/**
 * ABSOLUTE COUNTERS. Five independent integers from our own staged table,
 * never a fraction, never a percentage, and never a "total" borrowed from the
 * Turo feed that produced them.
 */
function PlanCounts({
  plan,
  onGoToMapping,
}: {
  plan: TuroPromotionPlan;
  onGoToMapping: () => void;
}) {
  const c = plan.counts;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <CountTile label="Ready to import" value={c.ready} tone="good" />
      <CountTile
        label="Need a vehicle"
        value={c.needs_vehicle}
        tone={c.needs_vehicle > 0 ? "warn" : "muted"}
        onClick={c.needs_vehicle > 0 ? onGoToMapping : undefined}
      />
      <CountTile
        label="Clash with a booking"
        value={c.conflicts}
        tone={c.conflicts > 0 ? "danger" : "muted"}
      />
      <CountTile label="Already imported" value={c.already_promoted} tone="muted" />
      <CountTile label="Staged in total" value={c.total_staged} tone="muted" />
    </div>
  );
}

function CountTile({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "danger" | "muted";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "good"
      ? "text-[#16a34a] dark:text-green-400"
      : tone === "warn"
        ? "text-[#d97706] dark:text-orange-400"
        : tone === "danger"
          ? "text-[#dc2626] dark:text-red-400"
          : "text-foreground";

  const inner = (
    <CardContent className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      {/* A bare integer. No denominator exists that we would trust. */}
      <p className={`text-2xl font-medium mt-1 tabular-nums ${toneClass}`}>{value}</p>
      {onClick && <p className="text-xs text-[#6366f1] mt-1">Go to the mapping queue →</p>}
    </CardContent>
  );

  if (onClick) {
    return (
      <Card className="cursor-pointer transition-colors hover:border-[#e0e7ff]" onClick={onClick}>
        {inner}
      </Card>
    );
  }
  return <Card>{inner}</Card>;
}

function PlanRow({
  row,
  checked,
  onToggle,
  busy,
}: {
  row: TuroPromotionPlanRow;
  checked: boolean;
  onToggle: (v: boolean) => void;
  /** The plan is being rebuilt around this tick; a second click would race it. */
  busy?: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="align-top">
        {row.requires_review ? (
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={checked}
              disabled={busy}
              onCheckedChange={(c) => onToggle(c === true)}
              aria-label={`Confirm the vehicle for trip ${row.reservation_id}`}
            />
            <span className="text-xs text-[#d97706] dark:text-orange-400">confirm</span>
          </label>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-[#16a34a] dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            plate
          </span>
        )}
      </TableCell>

      <TableCell className="align-top">
        <div className="font-medium">{row.reservation_id}</div>
        <div className="text-xs text-muted-foreground">{row.guest_name ?? "no guest name"}</div>
      </TableCell>

      <TableCell className="align-top text-sm">
        {row.vehicle_label ?? <Unknown />}
      </TableCell>

      <TableCell className="align-top">
        {row.matched_vehicle_reg ? (
          <>
            <div className="font-mono text-sm font-medium">{row.matched_vehicle_reg}</div>
            <div
              className={`text-xs mt-0.5 ${
                row.requires_review
                  ? "text-[#d97706] dark:text-orange-400"
                  : "text-[#16a34a] dark:text-green-400"
              }`}
            >
              matched by {row.match_basis}
              {row.requires_review ? " — needs your confirmation" : ""}
            </div>
          </>
        ) : (
          <Unknown why="No vehicle bound to this trip" />
        )}
      </TableCell>

      <TableCell className="align-top">
        <TripWindow startsAt={row.starts_at} endsAt={row.ends_at} />
      </TableCell>

      {/*
        Said in full, per row, because "import" is a word that hides work. The
        operator should be able to read this column and predict every row the
        import will write. The sentences come from the server's plan, so they
        describe what it will actually do rather than what this screen assumes.
      */}
      <TableCell className="align-top text-sm">
        {row.will_create.length === 0 ? (
          <Unknown why="The planner did not say what this row would create" />
        ) : (
          <ul className="space-y-1">
            {row.will_create.map((line, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
      </TableCell>
    </TableRow>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  rows,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: TuroPromotionPlanRow[];
  pending: boolean;
  onConfirm: () => void;
}) {
  const vehicleCount = new Set(rows.map((r) => r.matched_vehicle_id).filter(Boolean)).size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Create {rows.length} {rows.length === 1 ? "booking" : "bookings"}?
          </DialogTitle>
          <DialogDescription>
            This writes to your live Drive247 fleet.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm text-[#404040] dark:text-muted-foreground">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-[#6366f1]" />
            {rows.length} {rows.length === 1 ? "booking" : "bookings"} across {vehicleCount}{" "}
            {vehicleCount === 1 ? "vehicle" : "vehicles"} will be created, and those cars come
            off sale for those dates.
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-[#6366f1]" />
            Placeholder contacts will be created for the guests. Nobody will be emailed or
            texted.
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-[#6366f1]" />
            No invoices, charges or payment requests are raised.
          </li>
          <li className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-[#d97706]" />
            If anything has changed since this plan was built, the import will be refused rather
            than guessing — you will be told what moved.
          </li>
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? "Importing…" : "Yes, create them"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What actually happened, including the refusals. Never summarised away. */
function ApplyResult({
  result,
}: {
  result: {
    batch_id?: string;
    promoted?: number;
    conflicts?: number;
    skipped?: number;
    message?: string;
  };
}) {
  const promoted = result.promoted ?? 0;
  const conflicts = result.conflicts ?? 0;
  const skipped = result.skipped ?? 0;

  return (
    <Notice tone={conflicts > 0 || skipped > 0 ? "warn" : "info"}>
      <span className="font-medium text-foreground">
        {promoted} {promoted === 1 ? "booking" : "bookings"} created.
      </span>
      {conflicts > 0 && (
        <>
          {" "}
          {conflicts} {conflicts === 1 ? "row" : "rows"} clashed with a booking you already have
          and {conflicts === 1 ? "was" : "were"} left alone — nothing was written for{" "}
          {conflicts === 1 ? "it" : "them"}, and nobody picks a winner but you.
        </>
      )}
      {skipped > 0 && (
        <>
          {" "}
          {skipped} {skipped === 1 ? "row was" : "rows were"} skipped.
        </>
      )}
      {result.message && <> {result.message}</>}
      {result.batch_id && (
        <span className="text-xs font-mono ml-2">batch {result.batch_id.slice(0, 8)}</span>
      )}
    </Notice>
  );
}
