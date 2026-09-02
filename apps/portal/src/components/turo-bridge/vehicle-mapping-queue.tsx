/**
 * Screen 2 — the vehicle mapping queue.
 *
 * THIS IS THE HUMAN STEP THAT UNBLOCKS EVERYTHING. A Turo trip cannot be
 * imported, cannot block a car and cannot be released until somebody has said
 * which Drive247 vehicle it is about.
 *
 * Three rules are visible in the UI rather than merely enforced underneath:
 *
 *  1. TURO BRIDGE NEVER CREATES A VEHICLE. `vehicles.reg` is globally unique
 *     with no tenant in the key (461/461 distinct live), so auto-creating from
 *     a Turo plate would either collide with another operator's row or poison a
 *     platform-wide namespace. If the car is not in Drive247 yet, the operator
 *     adds it under Vehicles first. The screen says so instead of offering a
 *     tempting "create" button.
 *
 *  2. VIN IS A HINT, NEVER A KEY. 400 non-null VINs across the live fleet give
 *     only 326 distinct values — 74 vehicles share a VIN with another row. The
 *     hook already caps a VIN match at `strength: "plausible"`; this screen
 *     renders plausible suggestions unticked, always.
 *
 *  3. EVERY MAPPING HAS A NAMED HUMAN BEHIND IT. `turo_vehicle_map.confirmed_by`
 *     is NOT NULL in the schema; there is no code path to an auto-created
 *     mapping, so there is no "confirm all" button here either.
 */
"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Car,
  CheckCircle2,
  Fingerprint,
  Link2,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  normalisePlate,
  useConfirmTuroVehicleMapping,
  useTuroVehicleCandidates,
  useTuroVehicleMapQueue,
  type TuroMatchObstacle,
  type TuroVehicleCandidate,
  type TuroVehicleMapQueueEntry,
  type TuroVehicleSuggestion,
} from "@/hooks/use-turo-vehicle-map";
import {
  EmptyState,
  LoadFailed,
  Notice,
  SchemaMissing,
  SectionTitle,
  Unknown,
  fmtDate,
} from "./shared";

/**
 * Every obstacle is a FACT about what the feed gave us, phrased so the operator
 * knows what to do next. None of them is an apology, and none of them invites a
 * guess — "we could not tell" is a complete answer here.
 */
const OBSTACLE_COPY: Record<TuroMatchObstacle, string> = {
  no_plate_observed:
    "Turo did not give a licence plate for this vehicle, and none could be read out of its label. The plate is the only thing that identifies a car safely, so you will have to pick it yourself.",
  plate_matched_no_vehicle:
    "The plate Turo gave is not on any vehicle in your fleet. Add the car under Vehicles first — Turo Bridge never creates one.",
  plate_belongs_to_another_tenant:
    "That plate is registered to another operator on Drive247. It cannot be matched here. If this really is your car, contact support.",
  vin_ambiguous:
    "More than one of your vehicles carries this VIN, so the VIN cannot identify the car. Pick it by plate.",
  label_ambiguous:
    "Several of your vehicles match this description. Pick the right one by plate.",
  no_identity:
    "This trip carries neither a Turo vehicle id nor a usable label, so there is nothing stable to map. Re-sync once the feed returns vehicle details rather than mapping it by hand.",
};

export function VehicleMappingScreen() {
  const queue = useTuroVehicleMapQueue();
  const vehiclesQuery = useTuroVehicleCandidates();
  const [active, setActive] = useState<TuroVehicleMapQueueEntry | null>(null);

  const vehicles = useMemo(() => vehiclesQuery.data ?? [], [vehiclesQuery.data]);
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  if (queue.schemaMissing) {
    return (
      <SchemaMissing what="The vehicle mapping queue" message={queue.schemaMissingMessage} />
    );
  }
  if (queue.isError) {
    return <LoadFailed what="The vehicle mapping queue" error={queue.error} />;
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Vehicle mapping queue"
        description="Turo identifies your cars its own way. Tell us which Drive247 vehicle each one is, once — every trip on that car then flows through automatically."
      />

      {vehiclesQuery.isError && (
        <Notice tone="danger">
          Your fleet could not be loaded, so the picker below has nothing to offer.{" "}
          {(vehiclesQuery.error as Error)?.message}
        </Notice>
      )}

      {queue.entries.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />}
          title="Every Turo vehicle is mapped"
          body={
            <>
              Nothing is waiting on you here. New Turo vehicles appear in this queue the first
              time a trip on them is synced.
              {queue.confirmedMappings.length > 0 && (
                <>
                  {" "}
                  You have {queue.confirmedMappings.length} confirmed{" "}
                  {queue.confirmedMappings.length === 1 ? "mapping" : "mappings"} below.
                </>
              )}
            </>
          }
        />
      ) : (
        <>
          {/*
            Absolute counters straight from the hook, over our own rows. No
            fraction and no percentage: the denominator would have to come from
            the same Turo read these entries came from.
          */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MiniCount label="Waiting to be matched" value={queue.counts.awaiting} tone="warn" />
            <MiniCount
              label="Plate match ready"
              value={queue.counts.readyToConfirm}
              tone="good"
            />
            <MiniCount label="Need your judgement" value={queue.counts.needsJudgement} />
            <MiniCount
              label="Trips blocked behind them"
              value={queue.counts.reservationsBlocked}
              tone="warn"
            />
          </div>

          <Notice tone="warn">
            <span className="font-medium text-foreground">
              {queue.counts.reservationsBlocked}{" "}
              {queue.counts.reservationsBlocked === 1 ? "trip is" : "trips are"} waiting on{" "}
              {queue.counts.awaiting} {queue.counts.awaiting === 1 ? "decision" : "decisions"}.
            </span>{" "}
            They have been read and stored, but they are not blocking anything in Drive247 and
            cannot be imported until you say which car they are.
          </Notice>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                    <TableHead>Turo vehicle</TableHead>
                    <TableHead>Identifiers</TableHead>
                    <TableHead>Trips waiting</TableHead>
                    <TableHead>Earliest trip</TableHead>
                    <TableHead>Our best guess</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.entries.map((entry) => (
                    <TableRow key={entry.matchKey ?? entry.displayLabelNorm ?? "no-identity"}>
                      <TableCell className="align-top">
                        <div className="flex items-start gap-2">
                          <Car className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium truncate max-w-[260px]">
                              {entry.displayLabel ?? (
                                <Unknown why="Turo gave no label for this vehicle" />
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {entry.matchKey ?? "no stable identity"}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="align-top text-xs space-y-0.5">
                        {entry.plateObserved ? (
                          <div>
                            <span className="text-muted-foreground">plate </span>
                            <span className="font-mono text-foreground">
                              {entry.plateObserved}
                            </span>
                            {/*
                              A plate READ from a field and a plate MINED out of
                              a display string are different levels of evidence,
                              and the difference decides whether a suggestion can
                              be pre-ticked. So it is shown, not hidden.
                            */}
                            {entry.plateSource === "parsed_from_label" && (
                              <span className="text-muted-foreground">
                                {" "}
                                (read out of the label)
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-muted-foreground">no plate in the feed</div>
                        )}
                        {entry.vinHint && (
                          <div title="VIN is not unique in Drive247 and can never identify a car on its own.">
                            <span className="text-muted-foreground">VIN </span>
                            <span className="font-mono text-foreground">{entry.vinHint}</span>
                            <span className="text-muted-foreground"> (hint only)</span>
                          </div>
                        )}
                        {entry.turoVehicleId && (
                          <div>
                            <span className="text-muted-foreground">turo id </span>
                            <span className="font-mono text-foreground">
                              {entry.turoVehicleId}
                            </span>
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="align-top">
                        <span className="text-sm font-medium tabular-nums">
                          {entry.reservationCount}
                        </span>
                      </TableCell>

                      <TableCell className="align-top text-sm">
                        {entry.earliestStartsAt ? (
                          fmtDate(entry.earliestStartsAt)
                        ) : (
                          <Unknown why="No usable start date on any waiting trip" />
                        )}
                      </TableCell>

                      <TableCell className="align-top">
                        <GuessCell entry={entry} />
                      </TableCell>

                      <TableCell className="align-top text-right">
                        <Button
                          size="sm"
                          variant={entry.preselect ? "default" : "outline"}
                          onClick={() => setActive(entry)}
                          disabled={entry.unmappable || vehicles.length === 0}
                          title={
                            entry.unmappable
                              ? OBSTACLE_COPY.no_identity
                              : vehicles.length === 0
                                ? "You have no vehicles in Drive247 to map onto yet."
                                : undefined
                          }
                        >
                          <Link2 className="h-3.5 w-3.5 mr-1.5" />
                          Match
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {queue.confirmedMappings.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">
            Confirmed mappings ({queue.confirmedMappings.length})
          </h3>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#eef2ff] dark:bg-muted hover:bg-[#eef2ff] dark:hover:bg-muted">
                    <TableHead>Turo vehicle</TableHead>
                    <TableHead>Drive247 vehicle</TableHead>
                    <TableHead>Confirmed</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.confirmedMappings.map((m) => {
                    const v = vehicleById.get(m.vehicle_id);
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="align-top">
                          <div className="truncate max-w-[260px]">
                            {m.display_label ?? <Unknown />}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {m.match_key ?? "—"}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          {v ? (
                            <>
                              <span className="font-mono font-medium">{v.reg}</span>
                              <div className="text-xs text-muted-foreground">
                                {[v.year, v.make, v.model].filter(Boolean).join(" ")}
                              </div>
                            </>
                          ) : (
                            <Unknown why="This vehicle is no longer in your active fleet" />
                          )}
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground">
                          {fmtDate(m.confirmed_at)}
                          {!m.is_active && (
                            <div className="text-xs text-[#dc2626] dark:text-red-400">
                              retired
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground">
                          {m.confirmation_note ?? <Unknown why="No note left" />}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <MappingDialog entry={active} vehicles={vehicles} onClose={() => setActive(null)} />
    </div>
  );
}

function MiniCount({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "good" | "warn";
}) {
  const toneClass =
    tone === "good"
      ? "text-[#16a34a] dark:text-green-400"
      : tone === "warn"
        ? "text-[#d97706] dark:text-orange-400"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-2xl font-medium mt-1 tabular-nums ${toneClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

/** The strongest suggestion, or the reason there isn't one. */
function GuessCell({ entry }: { entry: TuroVehicleMapQueueEntry }) {
  const best = entry.suggestions[0] ?? null;

  if (!best) {
    return (
      <div className="max-w-[300px]">
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          No match
        </div>
        <ul className="mt-0.5 space-y-0.5">
          {(entry.obstacles.length ? entry.obstacles : (["no_plate_observed"] as const)).map(
            (o) => (
              <li key={o} className="text-xs text-muted-foreground">
                {OBSTACLE_COPY[o as TuroMatchObstacle]}
              </li>
            ),
          )}
        </ul>
      </div>
    );
  }

  const Icon =
    best.strength === "exact"
      ? BadgeCheck
      : best.evidence === "vin_unique"
        ? Fingerprint
        : ShieldAlert;

  return (
    <div className="max-w-[300px]">
      <div
        className={`flex items-center gap-1.5 text-sm font-medium ${
          best.strength === "exact"
            ? "text-[#16a34a] dark:text-green-400"
            : "text-[#d97706] dark:text-orange-400"
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {best.strength === "exact" ? "Plate match" : "Suggestion only"}
      </div>
      <div className="text-sm text-foreground mt-0.5">
        <span className="font-mono font-medium">{best.vehicle.reg}</span>
        <span className="text-muted-foreground">
          {" "}
          {[best.vehicle.year, best.vehicle.make, best.vehicle.model].filter(Boolean).join(" ")}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{best.explanation}</p>
      {entry.suggestions.length > 1 && (
        <p className="text-xs text-muted-foreground mt-0.5">
          {entry.suggestions.length - 1} other possible{" "}
          {entry.suggestions.length - 1 === 1 ? "match" : "matches"} — open to compare.
        </p>
      )}
    </div>
  );
}

/**
 * The picker.
 *
 * Deliberate design choices:
 *  - only an EXACT plate match is pre-selected (`entry.preselect`). A plausible
 *    suggestion is shown and never pre-ticked, because a default selection you
 *    can click past without reading is not a human decision.
 *  - the confirm button stays disabled until the operator ticks a box that
 *    names the registration they are agreeing to, and changing the selected car
 *    clears that tick.
 *  - there is no "create vehicle" affordance at all.
 */
function MappingDialog({
  entry,
  vehicles,
  onClose,
}: {
  entry: TuroVehicleMapQueueEntry | null;
  vehicles: TuroVehicleCandidate[];
  onClose: () => void;
}) {
  const confirmMutation = useConfirmTuroVehicleMapping();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState("");
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Reset per-entry. Keyed on matchKey so opening a second row never carries
  // the previous row's acknowledgement across — that would be a consent the
  // operator never gave.
  const entryKey = entry?.matchKey ?? entry?.displayLabelNorm ?? null;
  if (entry && entryKey !== lastKey) {
    setLastKey(entryKey);
    setSelectedId(entry.preselect ? (entry.suggestions[0]?.vehicle.id ?? null) : null);
    setAcknowledged(false);
    setNote("");
    setQuery("");
  }

  const filteredVehicles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vehicles.slice(0, 80);
    const qNorm = normalisePlate(q);
    return vehicles
      .filter((v) => {
        const hay = [v.reg, v.make, v.model, v.year, v.vin]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q) || (!!qNorm && v.reg_norm.includes(qNorm));
      })
      .slice(0, 80);
  }, [vehicles, query]);

  if (!entry) return null;

  const selected = vehicles.find((v) => v.id === selectedId) ?? null;
  const observedPlateNorm = normalisePlate(entry.plateObserved);
  const chosenEvidence =
    entry.suggestions.find((s) => s.vehicle.id === selectedId)?.evidence ?? "operator_choice";
  const canConfirm = !!selected && acknowledged && !confirmMutation.isPending;

  const handleConfirm = () => {
    if (!selected) return;
    confirmMutation.mutate(
      {
        entry: {
          matchKey: entry.matchKey,
          turoVehicleId: entry.turoVehicleId,
          displayLabel: entry.displayLabel,
          plateObserved: entry.plateObserved,
          vinHint: entry.vinHint,
        },
        vehicleId: selected.id,
        evidence: chosenEvidence,
        confirmationNote: note.trim() || undefined,
      },
      {
        onSuccess: (data) => {
          const restaged = (data as { reservations_restaged?: number })?.reservations_restaged;
          toast({
            title: "Vehicle mapped",
            description:
              typeof restaged === "number"
                ? `${restaged} ${restaged === 1 ? "trip" : "trips"} on this Turo vehicle now point at ${selected.reg}.`
                : `Turo trips on this vehicle now point at ${selected.reg}.`,
          });
          onClose();
        },
        onError: (e: unknown) => {
          toast({
            variant: "destructive",
            title: "Nothing was changed",
            description: (e as Error)?.message ?? "The mapping could not be saved.",
          });
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Which car is this?</DialogTitle>
          <DialogDescription>
            Turo calls it{" "}
            <span className="font-medium text-foreground">
              {entry.displayLabel ?? entry.matchKey}
            </span>
            {entry.plateObserved && (
              <>
                {" "}
                (plate <span className="font-mono text-foreground">{entry.plateObserved}</span>)
              </>
            )}
            . {entry.reservationCount}{" "}
            {entry.reservationCount === 1 ? "trip is" : "trips are"} waiting on this answer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {entry.suggestions.length > 0 && (
            <div className="space-y-2">
              {entry.suggestions.map((s) => (
                <SuggestionRow
                  key={s.vehicle.id}
                  suggestion={s}
                  selected={s.vehicle.id === selectedId}
                  onPick={() => {
                    setSelectedId(s.vehicle.id);
                    setAcknowledged(false);
                  }}
                />
              ))}
            </div>
          )}

          {entry.obstacles.length > 0 && (
            <Notice tone="warn">
              <ul className="space-y-1">
                {entry.obstacles.map((o) => (
                  <li key={o}>{OBSTACLE_COPY[o]}</li>
                ))}
              </ul>
            </Notice>
          )}

          <div>
            <Label className="text-sm">
              {entry.suggestions.length > 0 ? "Or pick another vehicle" : "Pick the Drive247 vehicle"}
            </Label>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search your fleet by plate, make or model..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-[#f1f5f9] dark:border-border divide-y divide-[#f1f5f9] dark:divide-border">
              {filteredVehicles.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {vehicles.length === 0
                    ? "You have no vehicles in Drive247 yet. Add this car under Vehicles first — Turo Bridge never creates one."
                    : "No vehicle matches that search."}
                </div>
              ) : (
                filteredVehicles.map((v) => {
                  const isSelected = v.id === selectedId;
                  const plateMatches = !!observedPlateNorm && v.reg_norm === observedPlateNorm;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(v.id);
                        // Changing the car invalidates the acknowledgement: the
                        // operator agreed to a specific plate, not to whatever
                        // happens to be selected next.
                        setAcknowledged(false);
                      }}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                        isSelected
                          ? "bg-[#eef2ff] dark:bg-indigo-950/40"
                          : "hover:bg-[#f8fafc] dark:hover:bg-muted/50"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-medium text-foreground">
                          {v.reg}
                          {plateMatches && (
                            <span className="ml-2 text-xs font-sans font-medium text-[#16a34a] dark:text-green-400">
                              plate matches
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {[v.year, v.make, v.model].filter(Boolean).join(" ") || "—"}
                          {v.status ? ` · ${v.status}` : ""}
                          {v.is_paused ? " · paused" : ""}
                        </div>
                      </div>
                      {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0 text-[#6366f1]" />}
                    </button>
                  );
                })
              )}
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              Not in the list? Add the vehicle under{" "}
              <span className="font-medium text-foreground">Vehicles</span> first. Turo Bridge
              never creates a vehicle, because number plates are unique across all of Drive247 and
              a wrong one cannot be undone cleanly.
            </p>
          </div>

          <div>
            <Label htmlFor="turo-map-note" className="text-sm">
              Note (optional)
            </Label>
            <Textarea
              id="turo-map-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. relisted on Turo in June under a new listing"
              className="mt-1.5"
              rows={2}
            />
          </div>

          {/*
            The acknowledgement names the plate. A generic "I confirm" is a box
            people tick; naming the registration makes it a decision they have
            to actually read.
          */}
          <label className="flex items-start gap-3 rounded-md border border-[#f1f5f9] dark:border-border px-3 py-3 cursor-pointer">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(c) => setAcknowledged(c === true)}
              disabled={!selected}
              className="mt-0.5"
            />
            <span className="text-sm text-[#404040] dark:text-muted-foreground">
              {selected ? (
                <>
                  I have checked this: Turo&apos;s{" "}
                  <span className="font-medium text-foreground">
                    {entry.displayLabel ?? entry.matchKey}
                  </span>{" "}
                  is our{" "}
                  <span className="font-mono font-medium text-foreground">{selected.reg}</span>.
                  Every future Turo trip on it will block that car.
                </>
              ) : (
                "Pick a vehicle above first."
              )}
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {confirmMutation.isPending ? "Saving…" : "Confirm mapping"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuggestionRow({
  suggestion,
  selected,
  onPick,
}: {
  suggestion: TuroVehicleSuggestion;
  selected: boolean;
  onPick: () => void;
}) {
  const exact = suggestion.strength === "exact";
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full text-left rounded-md border px-3 py-2.5 transition-colors ${
        selected
          ? "border-[#6366f1] bg-[#eef2ff] dark:border-indigo-500 dark:bg-indigo-950/40"
          : "border-[#f1f5f9] hover:border-[#e0e7ff] dark:border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-foreground">
              {suggestion.vehicle.reg}
            </span>
            <span
              className={`text-xs font-medium ${
                exact
                  ? "text-[#16a34a] dark:text-green-400"
                  : "text-[#d97706] dark:text-orange-400"
              }`}
            >
              {exact ? "exact plate match" : "suggestion — check before confirming"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {[suggestion.vehicle.year, suggestion.vehicle.make, suggestion.vehicle.model]
              .filter(Boolean)
              .join(" ")}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{suggestion.explanation}</p>
        </div>
        {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-[#6366f1] mt-0.5" />}
      </div>
    </button>
  );
}
