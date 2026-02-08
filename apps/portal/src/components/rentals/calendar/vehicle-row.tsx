"use client";

import { useRouter } from "next/navigation";
import { VehicleTimelineData, calculateBarPosition } from "@/lib/calendar-utils";
import { VehiclePhotoThumbnail } from "@/components/vehicles/vehicle-photo-thumbnail";
import { RentalBar } from "./rental-bar";
import { cn } from "@/lib/utils";

const BAR_HEIGHT = 28;
const BAR_GAP = 4;
const ROW_PADDING = 8;

interface VehicleRowProps {
  data: VehicleTimelineData;
  rangeStart: Date;
  rangeEnd: Date;
  index: number;
}

export function VehicleRow({ data, rangeStart, rangeEnd, index }: VehicleRowProps) {
  const router = useRouter();
  const { vehicle, rentals } = data;

  // Calculate row height based on number of rentals (stacked)
  const barCount = Math.max(1, rentals.length);
  const contentHeight = barCount * BAR_HEIGHT + (barCount - 1) * BAR_GAP + ROW_PADDING * 2;
  const rowHeight = Math.max(80, contentHeight);

  return (
    <div
      className={cn(
        "flex border-b",
        index % 2 === 0 ? "bg-background" : "bg-muted/20"
      )}
      style={{ minHeight: `${rowHeight}px` }}
    >
      {/* Vehicle info — sticky left */}
      <div
        className="sticky left-0 z-10 w-[240px] min-w-[240px] border-r bg-inherit px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => router.push(`/vehicles/${vehicle.id}`)}
      >
        <VehiclePhotoThumbnail
          photoUrl={vehicle.photo_url}
          vehicleReg={vehicle.reg}
          size="md"
          className="rounded-lg shrink-0 border-muted-foreground/10 shadow-sm"
        />
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{vehicle.reg}</div>
          <div className="text-xs text-muted-foreground truncate">
            {vehicle.make} {vehicle.model}
          </div>
        </div>
      </div>

      {/* Timeline area — bars stacked vertically */}
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
}
