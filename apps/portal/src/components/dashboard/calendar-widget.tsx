"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  CalendarDays,
  ArrowUpFromDot,
  ArrowDownToDot,
  Car,
  ArrowRight,
  CalendarIcon,
  Loader2,
} from "lucide-react";
import { useCalendarRentals } from "@/hooks/use-calendar-rentals";
import { useCalendarToday } from "@/hooks/use-calendar-today";
import { VehiclePhotoThumbnail } from "@/components/vehicles/vehicle-photo-thumbnail";
import { RentalBar } from "@/components/rentals/calendar/rental-bar";
import { calculateBarPosition, getStatusColor } from "@/lib/calendar-utils";
import { format, startOfDay, endOfDay } from "date-fns";
import { cn } from "@/lib/utils";

const BAR_HEIGHT = 24;
const BAR_GAP = 3;
const ROW_PADDING = 6;

export function CalendarWidget() {
  const router = useRouter();
  const { data: todayData, isLoading: todayLoading } = useCalendarToday();

  const rangeStart = useMemo(() => startOfDay(new Date()), []);
  const rangeEnd = useMemo(() => endOfDay(new Date()), []);

  const { data: calendarData, isLoading: calendarLoading } = useCalendarRentals(
    rangeStart,
    rangeEnd
  );

  const isLoading = todayLoading || calendarLoading;
  const grouped = calendarData?.grouped || [];

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />
            Today's Schedule
          </CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {format(new Date(), "EEEE, MMM d")}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 px-2"
              onClick={() => router.push("/rentals?view=calendar")}
            >
              Full Calendar
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="flex items-center gap-2 p-2 rounded-md bg-cyan-100 dark:bg-cyan-500/10">
            <ArrowUpFromDot className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            <div>
              <div className="text-lg font-bold">{todayData?.pickupsToday ?? 0}</div>
              <div className="text-[10px] text-muted-foreground">Pickups</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-md bg-amber-100 dark:bg-amber-500/10">
            <ArrowDownToDot className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <div>
              <div className="text-lg font-bold">{todayData?.returnsToday ?? 0}</div>
              <div className="text-[10px] text-muted-foreground">Returns</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-md bg-emerald-100 dark:bg-emerald-500/10">
            <Car className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <div>
              <div className="text-lg font-bold">{todayData?.activeCount ?? 0}</div>
              <div className="text-[10px] text-muted-foreground">Active</div>
            </div>
          </div>
        </div>

        {/* Mini timeline */}
        {grouped.length === 0 ? (
          <div className="text-center py-8">
            <CalendarIcon className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">No rentals active today</p>
          </div>
        ) : (
          <TooltipProvider delayDuration={200}>
            <div className="border rounded-lg overflow-hidden bg-card">
              <div className="max-h-[320px] overflow-y-auto">
                {grouped.map((vehicleData, index) => {
                  const { vehicle, rentals } = vehicleData;
                  const barCount = Math.max(1, rentals.length);
                  const contentHeight =
                    barCount * BAR_HEIGHT + (barCount - 1) * BAR_GAP + ROW_PADDING * 2;
                  const rowHeight = Math.max(56, contentHeight);

                  return (
                    <div
                      key={vehicle.id}
                      className={cn(
                        "flex border-b last:border-b-0",
                        index % 2 === 0 ? "bg-background" : "bg-muted/20"
                      )}
                      style={{ minHeight: `${rowHeight}px` }}
                    >
                      {/* Vehicle info */}
                      <div
                        className="w-[180px] min-w-[180px] border-r bg-inherit px-2.5 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => router.push(`/vehicles/${vehicle.id}`)}
                      >
                        <VehiclePhotoThumbnail
                          photoUrl={vehicle.photo_url}
                          vehicleReg={vehicle.reg}
                          size="sm"
                          className="rounded-md shrink-0 border-muted-foreground/10"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{vehicle.reg}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {vehicle.make} {vehicle.model}
                          </div>
                        </div>
                      </div>

                      {/* Rental bars */}
                      <div className="flex-1 relative" style={{ minHeight: `${rowHeight}px` }}>
                        {rentals.map((rental, i) => {
                          const position = calculateBarPosition(
                            rental.start_date,
                            rental.end_date,
                            rangeStart,
                            rangeEnd
                          );
                          const topOffset = ROW_PADDING + i * (BAR_HEIGHT + BAR_GAP);
                          return (
                            <RentalBar
                              key={rental.id}
                              rental={rental}
                              position={position}
                              topOffset={topOffset}
                              barHeight={BAR_HEIGHT}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
