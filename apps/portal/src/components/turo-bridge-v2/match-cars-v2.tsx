"use client";

/**
 * Match Turo cars — the minimal v2 dialog body (Ghulam, Oct 2 2026).
 *
 * One row per Turo car still waiting: what Turo calls it, how many trips are
 * behind it, a picker of the operator's own cars with the best guess chosen,
 * and Match. The write is the SAME server confirm the full screen uses
 * (`useConfirmTuroVehicleMapping` → `turo-bridge-confirm-vehicle-map`), with
 * the operator's own choice recorded as the evidence — a suggestion is only
 * ever preselected, never applied without the click.
 */

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui-v2/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import {
  useConfirmTuroVehicleMapping,
  useTuroVehicleCandidates,
  useTuroVehicleMapQueue,
  type TuroVehicleMapQueueEntry,
} from "@/hooks/use-turo-vehicle-map";

export function MatchCarsV2() {
  const queue = useTuroVehicleMapQueue();
  const cars = useTuroVehicleCandidates().data ?? [];
  const entries = queue.entries.filter((e) => !e.unmappable);

  if (queue.isLoading) return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  if (entries.length === 0) {
    return (
      <p className="flex items-center justify-center gap-2 py-8 text-sm text-success">
        <Check className="size-4" /> Every Turo car is matched to your fleet.
      </p>
    );
  }
  return (
    <div className="divide-y rounded-2xl border">
      {entries.map((e) => (
        <MatchRow key={e.matchKey ?? e.displayLabelNorm} entry={e} cars={cars} />
      ))}
    </div>
  );
}

function MatchRow({
  entry,
  cars,
}: {
  entry: TuroVehicleMapQueueEntry;
  cars: ReturnType<typeof useTuroVehicleCandidates>["data"] & object;
}) {
  const confirm = useConfirmTuroVehicleMapping();
  const suggestion = entry.suggestions[0];
  const [vehicleId, setVehicleId] = useState<string>(suggestion?.vehicle.id ?? "");

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{entry.displayLabel || "Turo car"}</p>
        <p className="text-xs text-muted-foreground">
          {entry.reservationCount} trip{entry.reservationCount === 1 ? "" : "s"} waiting
          {suggestion ? ` · best guess ${suggestion.vehicle.reg}` : ""}
        </p>
      </div>
      <Select value={vehicleId} onValueChange={setVehicleId}>
        <SelectTrigger className="h-9 w-56 rounded-full">
          <SelectValue placeholder="Pick your car" />
        </SelectTrigger>
        <SelectContent>
          {cars.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {[c.make, c.model].filter(Boolean).join(" ")} · {c.reg}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        className="h-9 rounded-full px-4"
        disabled={!vehicleId || confirm.isPending}
        onClick={() =>
          confirm.mutate({
            entry,
            vehicleId,
            evidence: suggestion && suggestion.vehicle.id === vehicleId ? suggestion.evidence : "operator_choice",
          })
        }
      >
        {confirm.isPending ? <Loader2 className="animate-spin" /> : null}
        Match
      </Button>
      {confirm.isError && <p className="w-full text-xs text-destructive">{(confirm.error as Error).message}</p>}
    </div>
  );
}
