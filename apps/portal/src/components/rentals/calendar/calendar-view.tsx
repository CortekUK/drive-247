"use client";

import { useState, useMemo } from "react";
import { addWeeks, addMonths, subWeeks, subMonths, isToday, format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CalendarIcon, Loader2 } from "lucide-react";
import { useCalendarRentals } from "@/hooks/use-calendar-rentals";
import { useCalendarBlocks } from "@/hooks/use-calendar-blocks";
import { useTenantHolidays } from "@/hooks/use-tenant-holidays";
import { useWeekendPricing } from "@/hooks/use-weekend-pricing";
import { useFleetDailyPrices } from "@/hooks/use-fleet-daily-prices";
import { useTenant } from "@/contexts/TenantContext";
import { RentalFilters } from "@/hooks/use-enhanced-rentals";
import {
  ViewType,
  CalendarBlock,
  getDateRange,
  getDatesInRange,
  classifyDatePricing,
} from "@/lib/calendar-utils";
import { CalendarHeader } from "./calendar-header";
import { VehicleRow } from "./vehicle-row";
import { PricingRow, type PricingDateMeta } from "./pricing-row";
import { PricingPanel } from "./pricing-panel";
import { AIInsightsPanel } from "./ai-insights-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CalendarViewProps {
  filters: RentalFilters;
}

export function CalendarView({ filters }: CalendarViewProps) {
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [viewType, setViewType] = useState<ViewType>("week");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(
    new Set(["Active", "Upcoming", "Pending", "Completed", "Cancelled"])
  );
  // Bookings (bar timeline) vs Pricing (Turo-style per-day price grid).
  const [mode, setMode] = useState<"bookings" | "pricing">("bookings");
  const [pricingCell, setPricingCell] = useState<{ vehicleId: string; date: string } | null>(null);
  const { tenant } = useTenant();
  const currency = tenant?.currency_code || "USD";

  const toggleStatus = (status: string) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        if (next.size > 1) next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const { start: rangeStart, end: rangeEnd } = useMemo(
    () => getDateRange(viewType, anchorDate),
    [viewType, anchorDate]
  );

  const dates = useMemo(
    () => getDatesInRange(rangeStart, rangeEnd),
    [rangeStart, rangeEnd]
  );

  const { data, isLoading } = useCalendarRentals(rangeStart, rangeEnd, filters);

  // Phase 2 — inline availability editing
  const { createBlock, removeBlock } = useCalendarBlocks();
  const [pendingBlock, setPendingBlock] = useState<{
    vehicleId: string;
    startDate: string;
    endDate: string;
    reason: string;
  } | null>(null);

  // Phase 3 — per-day pricing strip data (weekend + holiday surcharges)
  const { holidays } = useTenantHolidays();
  const { settings: weekendSettings } = useWeekendPricing();
  const weekendConfig = useMemo(
    () =>
      weekendSettings && weekendSettings.weekend_surcharge_percent > 0
        ? weekendSettings
        : null,
    [weekendSettings]
  );

  // Filter grouped data by active statuses. A vehicle row stays visible if it has
  // matching rentals OR any blocks (blocks aren't subject to the status filter).
  const filteredGrouped = useMemo(() => {
    if (!data?.grouped) return [];
    // Show the whole fleet — every vehicle row stays visible. The status filter
    // only hides individual rental bars, never the vehicle row itself.
    return data.grouped.map((v) => ({
      ...v,
      rentals: v.rentals.filter((r) => activeStatuses.has(r.computed_status)),
    }));
  }, [data?.grouped, activeStatuses]);

  // Pricing mode — fleet-wide per-day prices for the visible vehicles + range.
  // Only fetched when the operator is in Pricing mode (empty ids skips the query).
  const vehicleIds = useMemo(() => filteredGrouped.map((v) => v.vehicle.id), [filteredGrouped]);
  const rangeStartStr = format(rangeStart, "yyyy-MM-dd");
  const rangeEndStr = format(rangeEnd, "yyyy-MM-dd");
  const { baseRateMap, priceMap, setPrices, isSetting, clearPrices, isClearing } =
    useFleetDailyPrices(mode === "pricing" ? vehicleIds : [], rangeStartStr, rangeEndStr);

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const dateMeta = useMemo<PricingDateMeta[]>(
    () =>
      dates.map((d) => {
        const p = classifyDatePricing(d, weekendConfig, holidays);
        const ds = format(d, "yyyy-MM-dd");
        return {
          dateStr: ds,
          isPast: ds < todayStr,
          isToday: isToday(d),
          isWeekend: d.getDay() === 0 || d.getDay() === 6,
          surchargePercent: p.surchargePercent,
          surchargeType: p.type,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dates, weekendConfig, holidays, todayStr]
  );

  const getManualFor = (vehicleId: string) => (date: string) => priceMap[`${vehicleId}::${date}`];
  const pricingVehicle = pricingCell
    ? filteredGrouped.find((v) => v.vehicle.id === pricingCell.vehicleId)?.vehicle ?? null
    : null;
  const pricingBaseRate = pricingCell ? baseRateMap[pricingCell.vehicleId] ?? 0 : 0;

  const handleCreateBlock = (
    vehicleId: string,
    startDate: string,
    endDate: string
  ) => {
    setPendingBlock({ vehicleId, startDate, endDate, reason: "" });
  };

  // Open the block dialog from the "+ Block" button (no drag) — prefill today,
  // operator types the real dates.
  const handleAddBlockForVehicle = (vehicleId: string) => {
    const today = format(new Date(), "yyyy-MM-dd");
    setPendingBlock({ vehicleId, startDate: today, endDate: today, reason: "" });
  };

  const blockDatesInvalid =
    !!pendingBlock &&
    !!pendingBlock.startDate &&
    !!pendingBlock.endDate &&
    pendingBlock.endDate < pendingBlock.startDate;

  const handleRemoveBlock = (block: CalendarBlock) => {
    removeBlock.mutate(block.id);
  };

  const confirmCreateBlock = () => {
    if (!pendingBlock) return;
    createBlock.mutate({
      vehicleId: pendingBlock.vehicleId,
      startDate: pendingBlock.startDate,
      endDate: pendingBlock.endDate,
      reason: pendingBlock.reason,
    });
    setPendingBlock(null);
  };

  const handlePrev = () => {
    setAnchorDate((d) => (viewType === "week" ? subWeeks(d, 1) : subMonths(d, 1)));
  };

  const handleNext = () => {
    setAnchorDate((d) => (viewType === "week" ? addWeeks(d, 1) : addMonths(d, 1)));
  };

  const handleToday = () => {
    setAnchorDate(new Date());
  };

  const totalDays = dates.length;
  const todayIndex = dates.findIndex((d) => isToday(d));

  // Break out of parent container to go full-width
  // Parent has `container mx-auto p-4 md:p-6`, so we use negative margins + full viewport width
  const fullWidthClass = isFullscreen
    ? "fixed inset-0 z-50 bg-background p-4 overflow-auto"
    : "-mx-4 md:-mx-6 px-4 md:px-6";

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("space-y-4", fullWidthClass)}>
        <CalendarHeader
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          viewType={viewType}
          onViewTypeChange={setViewType}
          onPrev={handlePrev}
          onNext={handleNext}
          onToday={handleToday}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen((f) => !f)}
        />

        {/* AI Insights — above calendar, hidden in fullscreen */}
        {!isFullscreen && (
          <AIInsightsPanel grouped={data?.grouped || []} />
        )}

        {/* Mode toggle — Bookings (bar timeline) vs Pricing (per-day price grid) */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="inline-flex rounded-md border p-0.5 bg-muted/30">
            {(["bookings", "pricing"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "px-3 py-1 rounded text-xs font-medium capitalize transition-colors",
                  mode === m
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m}
              </button>
            ))}
          </div>
          {mode === "pricing" && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-indigo-500 inline-block" /> Custom price
              </span>
              <span>Click a day to set a price</span>
            </div>
          )}
        </div>

        {/* Status filter buttons (bookings mode only) */}
        {mode === "bookings" && (
        <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-thin">
          <span className="text-[11px] text-muted-foreground font-medium mr-1 shrink-0">Status:</span>
          {[
            { label: "Active", bg: "bg-emerald-500", border: "border-emerald-300 dark:border-emerald-500/40", text: "text-emerald-700 dark:text-emerald-400", activeBg: "bg-emerald-100 dark:bg-emerald-500/30" },
            { label: "Upcoming", bg: "bg-cyan-500", border: "border-cyan-300 dark:border-cyan-500/30", text: "text-cyan-700 dark:text-cyan-400", activeBg: "bg-cyan-100 dark:bg-cyan-500/25" },
            { label: "Pending", bg: "bg-amber-400", border: "border-amber-300 dark:border-amber-400/30", text: "text-amber-700 dark:text-amber-300", activeBg: "bg-amber-100 dark:bg-amber-400/25" },
            { label: "Completed", bg: "bg-violet-500", border: "border-violet-300 dark:border-violet-500/30", text: "text-violet-700 dark:text-violet-400", activeBg: "bg-violet-100 dark:bg-violet-500/25" },
            { label: "Cancelled", bg: "bg-rose-500", border: "border-rose-300 dark:border-rose-500/30", text: "text-rose-700 dark:text-rose-400", activeBg: "bg-rose-100 dark:bg-rose-500/25" },
          ].map((s) => {
            const isActive = activeStatuses.has(s.label);
            return (
              <button
                key={s.label}
                onClick={() => toggleStatus(s.label)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all shrink-0",
                  isActive
                    ? cn(s.activeBg, s.border, s.text)
                    : "border-muted bg-muted/30 text-muted-foreground/50 opacity-50"
                )}
              >
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  isActive ? s.bg.replace("/20", "").replace("/15", "") : "bg-muted-foreground/30"
                )} />
                {s.label}
              </button>
            );
          })}
        </div>
        )}

        {/* Calendar grid */}
        <div className={cn(
          "border rounded-lg overflow-hidden bg-card",
          isFullscreen && "flex-1"
        )}>
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !filteredGrouped.length ? (
            <div className="text-center py-16">
              <CalendarIcon className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <h3 className="text-sm font-medium mb-1">
                {mode === "pricing" ? "No vehicles found" : "No rentals found"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {mode === "pricing"
                  ? "Add a vehicle to your fleet to set per-day prices."
                  : "No rentals match the current filters for this date range."}
              </p>
            </div>
          ) : (
            <div
              className="overflow-x-auto [--vehicle-col:160px] sm:[--vehicle-col:240px]"
            >
              {/* Date header row */}
              <div className="flex border-b sticky top-0 z-20 bg-background">
                <div className="sticky left-0 z-30 w-[160px] min-w-[160px] sm:w-[240px] sm:min-w-[240px] border-r bg-background px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Vehicle
                  </span>
                </div>
                <div className="flex-1 flex relative">
                  {dates.map((date, i) => {
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    // Per-day pricing signal (weekend / holiday surcharge)
                    const pricing = classifyDatePricing(date, weekendConfig, holidays);
                    const hasSurcharge = pricing.surchargePercent > 0;
                    return (
                      <div
                        key={i}
                        className={cn(
                          "flex-1 min-w-[40px] text-center py-1.5 border-r last:border-r-0 text-[10px]",
                          isWeekend && "bg-muted/40",
                          isToday(date) && "bg-primary/10 font-semibold"
                        )}
                        title={
                          pricing.type === "holiday"
                            ? `${pricing.label}: +${pricing.surchargePercent}%`
                            : pricing.type === "weekend"
                            ? `Weekend: +${pricing.surchargePercent}%`
                            : undefined
                        }
                      >
                        <div className="text-muted-foreground">
                          {format(date, "EEE")}
                        </div>
                        <div className={cn(
                          "font-medium",
                          isToday(date) && "text-primary"
                        )}>
                          {format(date, "d")}
                        </div>
                        {/* Surcharge marker — fleet-wide per-day pricing signal */}
                        <div className="h-3.5 mt-0.5 flex items-center justify-center">
                          {hasSurcharge && (
                            <span
                              className={cn(
                                "inline-block leading-none rounded-sm px-1 py-0.5 text-[8px] font-bold",
                                pricing.type === "holiday"
                                  ? "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-400/20 dark:text-amber-300"
                              )}
                            >
                              +{pricing.surchargePercent}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Vehicle rows */}
              <div
                className={cn(
                  "overflow-y-auto",
                  isFullscreen ? "max-h-[calc(100vh-120px)]" : "max-h-[calc(100vh-380px)]"
                )}
              >
                <div className="relative">
                  {/* Today indicator line */}
                  {todayIndex >= 0 && (
                    <div
                      className="absolute top-0 bottom-0 w-px bg-primary z-10 pointer-events-none"
                      style={{
                        left: `calc(var(--vehicle-col) + ${((todayIndex + 0.5) / totalDays) * 100}% * (100% - var(--vehicle-col)) / 100%)`,
                      }}
                    />
                  )}

                  {filteredGrouped.map((vehicleData, index) =>
                    mode === "pricing" ? (
                      <PricingRow
                        key={vehicleData.vehicle.id}
                        vehicle={vehicleData.vehicle}
                        dateMeta={dateMeta}
                        baseRate={baseRateMap[vehicleData.vehicle.id] ?? 0}
                        currency={currency}
                        index={index}
                        getManual={getManualFor(vehicleData.vehicle.id)}
                        onCellClick={(vehicleId, date) => setPricingCell({ vehicleId, date })}
                      />
                    ) : (
                      <VehicleRow
                        key={vehicleData.vehicle.id}
                        data={vehicleData}
                        rangeStart={rangeStart}
                        rangeEnd={rangeEnd}
                        index={index}
                        dates={dates}
                        onCreateBlock={handleCreateBlock}
                        onAddBlock={handleAddBlockForVehicle}
                        onRemoveBlock={handleRemoveBlock}
                        removingBlockId={removeBlock.isPending ? (removeBlock.variables as string) : null}
                      />
                    )
                  )}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>

      {/* Phase 2 — confirm new block from drag-to-block */}
      <AlertDialog
        open={!!pendingBlock}
        onOpenChange={(o) => !o && setPendingBlock(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block dates</AlertDialogTitle>
            <AlertDialogDescription>
              Mark this vehicle unavailable so customers can&apos;t book it for the window
              below. Type the exact dates, or drag on the calendar to fill them in.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Editable dates — typed entry is the precise method (handles long
              bookings the drag can't reach, and lets the operator correct the
              drag selection before saving). */}
          <div className="grid grid-cols-2 gap-3 py-1">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Start date</label>
              <Input
                type="date"
                value={pendingBlock?.startDate ?? ""}
                max={pendingBlock?.endDate || undefined}
                onChange={(e) =>
                  setPendingBlock((p) => (p ? { ...p, startDate: e.target.value } : p))
                }
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">End date</label>
              <Input
                type="date"
                value={pendingBlock?.endDate ?? ""}
                min={pendingBlock?.startDate || undefined}
                onChange={(e) =>
                  setPendingBlock((p) => (p ? { ...p, endDate: e.target.value } : p))
                }
                className="mt-1"
              />
            </div>
          </div>
          <div className="pb-1">
            <label className="text-xs font-medium text-muted-foreground">
              Reason (optional)
            </label>
            <Input
              placeholder="e.g. Rented on Turo, maintenance…"
              value={pendingBlock?.reason ?? ""}
              onChange={(e) =>
                setPendingBlock((p) => (p ? { ...p, reason: e.target.value } : p))
              }
              className="mt-1"
            />
          </div>
          {blockDatesInvalid && (
            <p className="text-xs text-destructive">End date must be on or after the start date.</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={blockDatesInvalid || !pendingBlock?.startDate || !pendingBlock?.endDate}
              onClick={(e) => {
                if (blockDatesInvalid || !pendingBlock?.startDate || !pendingBlock?.endDate) {
                  e.preventDefault();
                  return;
                }
                confirmCreateBlock();
              }}
            >
              Block dates
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pricing mode — right-side panel to set/adjust a vehicle day's price */}
      <PricingPanel
        open={!!pricingCell}
        onOpenChange={(o) => !o && setPricingCell(null)}
        vehicle={pricingVehicle}
        baseRate={pricingBaseRate}
        startDate={pricingCell?.date ?? null}
        currency={currency}
        getManual={pricingCell ? getManualFor(pricingCell.vehicleId) : () => undefined}
        onApply={(vehicleId, entries) => setPrices({ vehicleId, entries })}
        onClear={(vehicleId, dates) => clearPrices({ vehicleId, dates })}
        isSetting={isSetting}
        isClearing={isClearing}
      />
    </TooltipProvider>
  );
}
