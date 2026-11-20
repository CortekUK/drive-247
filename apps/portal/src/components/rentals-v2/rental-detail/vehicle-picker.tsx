"use client";

/**
 * Picking the car — the Vehicle stage's "cleared" state.
 *
 * The same shape as the Customer stage's picker (`customer-picker.tsx`): no
 * dialog. "Clear vehicle" puts the stage back in the main pane — a search bar
 * across the top, an illustrated empty state until something is typed, then a
 * list with enough on each row to decide, and "Use {car}" on the one picked.
 * Nothing is written by clearing; the rental keeps its car until another one
 * is used.
 *
 * Saving goes through v1's `swap_rental_vehicle` RPC via `useVehicleSwap`,
 * reused as it stands rather than copied: it is the one route that moves the
 * car, frees the old one, marks the new one rented on an active hire and
 * records the swap history. The same hook's candidate read supplies what makes
 * a car UNusable for these dates — booked, blocked, not road legal — so the
 * list can say why before anyone clicks.
 *
 * Note it does NOT re-price the rental; the charges stay as they were.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Car, ShieldAlert, Ban, CalendarX, PauseCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency, formatDistance, type DistanceUnit } from "@/lib/format-utils";
import { useVehicleSwap } from "@/hooks/use-vehicle-swap";
import { Button } from "@/components/ui-v2/button";
import { VehiclesEmptyArt } from "@/components/illustrations-v2/empty-scenes";
import { cardCls } from "./_kit";

/** The presentational columns the swap hook's candidate read does not carry. */
function useFleetLook() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["vehicle-picker-look-v2", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, photo_url, year, colour, category, current_mileage, is_paused, paused_reason, available_daily, available_weekly, available_monthly")
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
      return new Map(((data ?? []) as any[]).map((v) => [v.id as string, v]));
    },
    enabled: !!tenant?.id,
  });
}

export function VehiclePicker({
  rentalId,
  currentVehicleId,
  startDate,
  endDate,
  keptPrice,
  afterHandover = false,
  onDone,
}: {
  rentalId: string;
  currentVehicleId: string | null;
  startDate: string | null;
  endDate: string | null;
  /**
   * On a swap: what the rental is priced at, e.g. "$150.00 for 3 days". A swap
   * does not re-price, and the screen says so before anyone picks (QA R4.8).
   */
  keptPrice?: string | null;
  /**
   * The keys are already with the customer (handed over, not yet returned).
   * A swap is still allowed — it is how a car that breaks down mid-rental is
   * replaced — but only as a breakdown replacement: staff tick that it is one
   * and type why, and the reason is saved on the swap record (QA R4.9).
   */
  afterHandover?: boolean;
  /** Leave the picker — after a swap lands, or to keep the current car. */
  onDone: (changed: boolean) => void;
}) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [isBreakdown, setIsBreakdown] = useState(false);
  const [why, setWhy] = useState("");
  const [blockOld, setBlockOld] = useState(true);
  /** After handover a swap needs the breakdown tick and a reason; before it, nothing extra. */
  const swapReady = !afterHandover || (isBreakdown && why.trim().length >= 3);
  const currency = tenant?.currency_code || "USD";
  const unit = (tenant?.distance_unit || "miles") as DistanceUnit;

  const { candidates, isLoadingCandidates, swap, isSwapping } = useVehicleSwap({
    rentalId,
    currentVehicleId: currentVehicleId ?? "",
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
  });
  const { data: look } = useFleetLook();

  /*
   * Which hire length these dates fall in — the same tiers the price uses
   * (under 7 days daily, then weekly, then monthly from the tenant's monthly
   * day). Open-ended dates have no length yet, so nothing is checked.
   */
  const lengthTier = useMemo<"daily" | "weekly" | "monthly" | null>(() => {
    if (!startDate || !endDate) return null;
    const days = Math.round(
      (Date.UTC(+endDate.slice(0, 4), +endDate.slice(5, 7) - 1, +endDate.slice(8, 10)) -
        Date.UTC(+startDate.slice(0, 4), +startDate.slice(5, 7) - 1, +startDate.slice(8, 10))) /
        86_400_000,
    );
    if (!(days > 0)) return null;
    const monthlyFrom = (tenant as any)?.monthly_tier_days ?? 30;
    return days >= monthlyFrom ? "monthly" : days >= 7 ? "weekly" : "daily";
  }, [startDate, endDate, tenant]);

  const q = term.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!q) return [];
    return (candidates ?? []).filter((v: any) =>
      [v.make, v.model, v.reg, `${v.make ?? ""} ${v.model ?? ""}`]
        .filter(Boolean)
        .some((s: string) => s.toLowerCase().includes(q))
    );
  }, [candidates, q]);

  /* `swap` is the hook's `mutate`: it raises its own error toast and
     invalidates v1's keys — this screen's key is refreshed here. */
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const use = (vehicleId: string) => {
    if (!swapReady) return;
    const blocking = afterHandover && blockOld && !!endDate && endDate >= today;
    swap(
      {
        newVehicleId: vehicleId,
        reason: afterHandover ? `Breakdown replacement: ${why.trim()}` : undefined,
        blockOldStart: blocking ? today : null,
        blockOldEnd: blocking ? endDate : null,
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ["rental-detail-v2", rentalId] });
          onDone(true);
        },
      } as any
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* ── search, across the top ─────────────────────────────────────── */}
      <label className={cn(cardCls, "flex h-14 shrink-0 items-center gap-3 px-5 text-sm focus-within:ring-3 focus-within:ring-ring/30")}>
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setPicked(null);
          }}
          placeholder="Which car goes out? Search by make, model or plate"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
        />
        {q && !isLoadingCandidates && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "match" : "matches"}
          </span>
        )}
      </label>
      {currentVehicleId && keptPrice && (
        <p className="shrink-0 rounded-2xl bg-muted px-4 py-2.5 text-xs text-muted-foreground">
          Swapping keeps this rental&apos;s price: <span className="font-semibold text-foreground">{keptPrice}</span>. The
          new car&apos;s own rates are not applied, and the charges stay as they are.
        </p>
      )}
      {currentVehicleId && afterHandover && (
        <div className="shrink-0 space-y-2.5 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-xs">
          <p className="flex items-start gap-2 font-medium text-foreground">
            <AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
            <span>
              The keys are already with the customer. Swap the car now only to replace one that has broken down.
            </span>
          </p>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={isBreakdown}
              onChange={(e) => setIsBreakdown(e.target.checked)}
              className="size-4 accent-[hsl(var(--primary))]"
            />
            <span>This is a breakdown replacement</span>
          </label>
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            rows={2}
            placeholder="What happened? e.g. Engine warning light on the motorway, car recovered to the garage"
            aria-label="Reason for the swap"
            className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/30"
          />
          {endDate && endDate >= today && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={blockOld}
                onChange={(e) => setBlockOld(e.target.checked)}
                className="size-4 accent-[hsl(var(--primary))]"
              />
              <span>Block the old car for maintenance until the rental&apos;s return date, so nobody else books it</span>
            </label>
          )}
          {!swapReady && (
            <p className="text-muted-foreground">Tick the box and say what happened to swap the car. The reason is saved with the swap.</p>
          )}
        </div>
      )}

      {!q ? (
        /* ── nothing typed: the illustrated empty state ─────────────────── */
        <div className={cn(cardCls, "flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center")}>
          <VehiclesEmptyArt className="w-full max-w-[320px]" />
          <div>
            <p className="font-heading text-base font-semibold">Which car goes out?</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Start typing a make, model or plate. Nothing changes until you put a car on the rental.
            </p>
          </div>
        </div>
      ) : (
        /* ── typed: the list, with enough on each row to decide ─────────── */
        <div className={cn(cardCls, "min-h-0 flex-1 overflow-hidden p-0")}>
          <div className="h-full overflow-y-auto no-scrollbar p-2">
            {isLoadingCandidates ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Looking…</p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">No car matches “{term.trim()}”.</p>
            ) : (
              rows.map((v: any) => {
                const extra = look?.get(v.id);
                const name = [v.make, v.model].filter(Boolean).join(" ") || v.reg;
                const reason: string | undefined = v.unavailable || v.blocked || v.notRoadLegal ? v.conflictReason : undefined;
                const usable = !reason;
                /* Warnings, not refusals: staff may knowingly put a paused car,
                   or one not offered for this length, on a rental — but never
                   blind. Neither was shown before. */
                const warnings: string[] = [];
                if (extra?.is_paused) {
                  warnings.push(`Paused${extra.paused_reason ? ` — ${extra.paused_reason}` : ""}. You can still use it.`);
                }
                if (lengthTier && extra && extra[`available_${lengthTier}`] === false) {
                  warnings.push(
                    `Not offered by the ${lengthTier === "daily" ? "day" : lengthTier === "weekly" ? "week" : "month"} — this rental is a ${lengthTier} hire.`,
                  );
                }
                const active = picked === v.id;
                const rates = [
                  v.daily_rent ? `${formatCurrency(Number(v.daily_rent), currency)}/day` : null,
                  v.weekly_rent ? `${formatCurrency(Number(v.weekly_rent), currency)}/wk` : null,
                ].filter(Boolean);
                return (
                  <div
                    key={v.id}
                    role="button"
                    tabIndex={usable ? 0 : -1}
                    aria-pressed={active}
                    aria-disabled={!usable}
                    onClick={() => usable && setPicked(v.id)}
                    onKeyDown={(e) => {
                      if (usable && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        setPicked(v.id);
                      }
                    }}
                    title={reason}
                    className={cn(
                      "relative grid grid-cols-1 items-center gap-2 rounded-2xl sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-6 px-4 py-3 outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none",
                      !usable ? "cursor-not-allowed opacity-55" : active ? "cursor-pointer bg-primary/10" : "cursor-pointer hover:bg-foreground/[0.04]"
                    )}
                  >
                    {/* which car */}
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="relative flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground">
                        {extra?.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={extra.photo_url} alt="" className="absolute inset-0 size-full object-cover" />
                        ) : (
                          <Car className="size-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {[v.reg, extra?.year, extra?.colour].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>

                    {/* free for these dates? */}
                    <div className="min-w-0">
                      {usable ? (
                        <p className="truncate text-xs font-medium text-success">Free for these dates</p>
                      ) : (
                        <p className="flex items-center gap-1.5 truncate text-xs font-medium text-destructive">
                          {v.notRoadLegal ? <ShieldAlert className="size-3.5 shrink-0" /> : v.blocked ? <Ban className="size-3.5 shrink-0" /> : <CalendarX className="size-3.5 shrink-0" />}
                          {reason}
                        </p>
                      )}
                      <p className="truncate text-[11px] text-muted-foreground">
                        {v.healthStatus === "overdue" ? "Service overdue" : v.status || "No status"}
                      </p>
                      {warnings.map((w) => (
                        <p key={w} className="mt-0.5 flex items-start gap-1.5 text-[11px] font-medium text-warning">
                          {w.startsWith("Paused") ? (
                            <PauseCircle className="mt-px size-3.5 shrink-0" />
                          ) : (
                            <AlertTriangle className="mt-px size-3.5 shrink-0" />
                          )}
                          <span>{w}</span>
                        </p>
                      ))}
                    </div>

                    {/* price */}
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{rates[0] ?? "No rate set"}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{rates[1] ?? ""}</p>
                    </div>

                    {/* the car itself */}
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">
                        {extra?.current_mileage != null ? formatDistance(extra.current_mileage, unit) : "No reading"}
                      </p>
                      <p className="truncate text-[11px] capitalize text-muted-foreground">{extra?.category || "—"}</p>
                    </div>

                    {/* the decision — over the row's right end, so nothing shifts */}
                    {active && (
                      <div className="absolute inset-y-0 right-0 flex items-center rounded-r-2xl pl-20 pr-3 [background:linear-gradient(to_left,hsl(var(--primary)/0.1)_65%,transparent),linear-gradient(to_left,hsl(var(--card))_65%,transparent)]">
                        <Button
                          size="sm"
                          disabled={isSwapping || !swapReady}
                          title={swapReady ? undefined : "Tick \"This is a breakdown replacement\" and say what happened first"}
                          onClick={(e) => {
                            e.stopPropagation();
                            use(v.id);
                          }}
                        >
                          {isSwapping ? "Saving…" : `Use ${v.model || v.reg}`}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
