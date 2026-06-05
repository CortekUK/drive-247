"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  VehicleTimelineData,
  CalendarBlock,
  calculateBarPosition,
} from "@/lib/calendar-utils";
import { VehiclePhotoThumbnail } from "@/components/vehicles/vehicle-photo-thumbnail";
import { RentalBar } from "./rental-bar";
import { BlockBar } from "./block-bar";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { addMinutes, format } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const BAR_HEIGHT = 28;
const BAR_GAP = 4;
const ROW_PADDING = 8;

interface VehicleRowProps {
  data: VehicleTimelineData;
  rangeStart: Date;
  rangeEnd: Date;
  index: number;
  /** Phase 2 inline editing — invoked when the user click-drags an empty span. */
  onCreateBlock?: (vehicleId: string, startDate: string, endDate: string) => void;
  onRemoveBlock?: (block: CalendarBlock) => void;
  removingBlockId?: string | null;
  /** Ordered list of date columns in the visible range (for drag → date mapping). */
  dates?: Date[];
}

export function VehicleRow({
  data,
  rangeStart,
  rangeEnd,
  index,
  onCreateBlock,
  onRemoveBlock,
  removingBlockId,
  dates,
}: VehicleRowProps) {
  const router = useRouter();
  const { tenant } = useTenant();
  const { vehicle, rentals, blocks } = data;
  const bufferMinutes = (tenant as any)?.buffer_time_minutes || 0;

  // Calculate row height based on rentals + blocks (stacked)
  const barCount = Math.max(1, rentals.length + blocks.length);
  const contentHeight = barCount * BAR_HEIGHT + (barCount - 1) * BAR_GAP + ROW_PADDING * 2;
  const rowHeight = Math.max(80, contentHeight);

  // Phase 2 — drag-to-block. Selection is tracked as start/end column indices.
  const canEdit = !!onCreateBlock && !!dates && dates.length > 0;
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);

  const colFromClientX = (clientX: number, el: HTMLElement): number => {
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const col = Math.floor(ratio * (dates?.length || 1));
    return Math.max(0, Math.min((dates?.length || 1) - 1, col));
  };

  const handleDragDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!canEdit || e.button !== 0) return;
    const col = colFromClientX(e.clientX, e.currentTarget);
    setDrag({ start: col, end: col });
  };

  const handleDragMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!drag) return;
    const col = colFromClientX(e.clientX, e.currentTarget);
    setDrag((d) => (d ? { ...d, end: col } : d));
  };

  const handleDragUp = () => {
    if (!drag || !dates || !onCreateBlock) {
      setDrag(null);
      return;
    }
    const lo = Math.min(drag.start, drag.end);
    const hi = Math.max(drag.start, drag.end);
    const startStr = format(dates[lo], "yyyy-MM-dd");
    const endStr = format(dates[hi], "yyyy-MM-dd");
    setDrag(null);
    onCreateBlock(vehicle.id, startStr, endStr);
  };

  const totalCols = dates?.length || 1;
  const dragLo = drag ? Math.min(drag.start, drag.end) : 0;
  const dragHi = drag ? Math.max(drag.start, drag.end) : 0;

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
        className="sticky left-0 z-10 w-[160px] min-w-[160px] sm:w-[240px] sm:min-w-[240px] border-r bg-inherit px-2 sm:px-3 py-2 flex items-center gap-2 sm:gap-3 cursor-pointer hover:bg-accent/50 transition-colors"
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

      {/* Timeline area — bars stacked vertically. Drag move/up live on this outer
          container so a drag survives crossing over existing bars (the bars are
          siblings of the drag layer, so releasing over a bar still lands here). */}
      <div
        className="flex-1 relative"
        style={{ minHeight: `${rowHeight}px` }}
        onMouseMove={canEdit ? handleDragMove : undefined}
        onMouseUp={canEdit ? handleDragUp : undefined}
        onMouseLeave={canEdit ? () => setDrag(null) : undefined}
      >
        {/* Drag-to-block start layer (Phase 2). Sits behind the bars so a drag only
            STARTS on empty space; bars intercept their own pointer events (open trip). */}
        {canEdit && (
          <div
            className="absolute inset-0 cursor-cell"
            onMouseDown={handleDragDown}
            title="Drag to block these dates"
          >
            {drag && (
              <div
                className="absolute top-1 bottom-1 rounded-md bg-slate-400/30 border border-dashed border-slate-500/60 pointer-events-none"
                style={{
                  left: `${(dragLo / totalCols) * 100}%`,
                  width: `${((dragHi - dragLo + 1) / totalCols) * 100}%`,
                }}
              />
            )}
          </div>
        )}

        {rentals.map((rental, i) => {
          const position = calculateBarPosition(
            rental.start_date,
            rental.end_date,
            rangeStart,
            rangeEnd
          );
          const topOffset = ROW_PADDING + i * (BAR_HEIGHT + BAR_GAP);

          // Calculate buffer bar position if buffer is configured and rental has ended
          const showBuffer = bufferMinutes > 0 && rental.end_date &&
            ['Closed', 'Completed'].includes(rental.computed_status || rental.status);
          const bufferEnd = showBuffer
            ? addMinutes(new Date(`${rental.end_date}T23:59:00`), bufferMinutes)
            : null;
          const bufferPosition = showBuffer && bufferEnd
            ? calculateBarPosition(
                rental.end_date!,
                bufferEnd.toISOString().split('T')[0],
                rangeStart,
                rangeEnd
              )
            : null;

          return (
            <div key={rental.id}>
              <RentalBar
                rental={rental}
                position={position}
                topOffset={topOffset}
                barHeight={BAR_HEIGHT}
              />
              {bufferPosition && bufferEnd && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="absolute rounded-sm bg-orange-200/60 dark:bg-orange-900/30 border border-dashed border-orange-300 dark:border-orange-700 cursor-default"
                      style={{
                        left: bufferPosition.left,
                        width: bufferPosition.width,
                        top: `${topOffset}px`,
                        height: `${BAR_HEIGHT}px`,
                      }}
                    >
                      <span className="text-[10px] text-orange-600 dark:text-orange-400 px-1.5 leading-[28px] truncate block">
                        Buffer
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Buffer: {bufferMinutes}min cooldown until {format(bufferEnd, 'MMM dd, HH:mm')}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          );
        })}

        {/* Manual blocks (e.g. car rented out on Turo) — stacked below rentals */}
        {blocks.map((block, i) => {
          const position = calculateBarPosition(
            block.start_date,
            block.end_date,
            rangeStart,
            rangeEnd
          );
          const topOffset =
            ROW_PADDING + (rentals.length + i) * (BAR_HEIGHT + BAR_GAP);
          return (
            <BlockBar
              key={block.id}
              block={block}
              position={position}
              topOffset={topOffset}
              barHeight={BAR_HEIGHT}
              onRemove={onRemoveBlock}
              isRemoving={removingBlockId === block.id}
            />
          );
        })}
      </div>
    </div>
  );
}
