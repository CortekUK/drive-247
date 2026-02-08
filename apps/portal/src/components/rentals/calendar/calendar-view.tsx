"use client";

import { useState, useMemo } from "react";
import { addWeeks, addMonths, subWeeks, subMonths, isToday, format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CalendarIcon, Loader2 } from "lucide-react";
import { useCalendarRentals } from "@/hooks/use-calendar-rentals";
import { RentalFilters } from "@/hooks/use-enhanced-rentals";
import {
  ViewType,
  getDateRange,
  getDatesInRange,
} from "@/lib/calendar-utils";
import { CalendarHeader } from "./calendar-header";
import { VehicleRow } from "./vehicle-row";
import { AIInsightsPanel } from "./ai-insights-panel";
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

  // Filter grouped data by active statuses
  const filteredGrouped = useMemo(() => {
    if (!data?.grouped) return [];
    return data.grouped
      .map((v) => ({
        ...v,
        rentals: v.rentals.filter((r) => activeStatuses.has(r.computed_status)),
      }))
      .filter((v) => v.rentals.length > 0);
  }, [data?.grouped, activeStatuses]);

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

        {/* Status filter buttons */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground font-medium mr-1">Status:</span>
          {[
            { label: "Active", bg: "bg-emerald-500/20", border: "border-emerald-500/40", text: "text-emerald-400", activeBg: "bg-emerald-500/30" },
            { label: "Upcoming", bg: "bg-cyan-500/15", border: "border-cyan-500/30", text: "text-cyan-400", activeBg: "bg-cyan-500/25" },
            { label: "Pending", bg: "bg-amber-400/15", border: "border-amber-400/30", text: "text-amber-300", activeBg: "bg-amber-400/25" },
            { label: "Completed", bg: "bg-violet-500/15", border: "border-violet-500/30", text: "text-violet-400", activeBg: "bg-violet-500/25" },
            { label: "Cancelled", bg: "bg-rose-500/15", border: "border-rose-500/30", text: "text-rose-400", activeBg: "bg-rose-500/25" },
          ].map((s) => {
            const isActive = activeStatuses.has(s.label);
            return (
              <button
                key={s.label}
                onClick={() => toggleStatus(s.label)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-all",
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
              <h3 className="text-sm font-medium mb-1">No rentals found</h3>
              <p className="text-xs text-muted-foreground">
                No rentals match the current filters for this date range.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              {/* Date header row */}
              <div className="flex border-b sticky top-0 z-20 bg-background">
                <div className="sticky left-0 z-30 w-[240px] min-w-[240px] border-r bg-background px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Vehicle
                  </span>
                </div>
                <div className="flex-1 flex relative">
                  {dates.map((date, i) => {
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    return (
                      <div
                        key={i}
                        className={cn(
                          "flex-1 min-w-[40px] text-center py-1.5 border-r last:border-r-0 text-[10px]",
                          isWeekend && "bg-muted/40",
                          isToday(date) && "bg-primary/10 font-semibold"
                        )}
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
                        left: `calc(240px + ${((todayIndex + 0.5) / totalDays) * 100}% * (100% - 240px) / 100%)`,
                      }}
                    />
                  )}

                  {filteredGrouped.map((vehicleData, index) => (
                    <VehicleRow
                      key={vehicleData.vehicle.id}
                      data={vehicleData}
                      rangeStart={rangeStart}
                      rangeEnd={rangeEnd}
                      index={index}
                    />
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
