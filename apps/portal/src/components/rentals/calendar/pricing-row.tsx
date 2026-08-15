"use client";

import { VehiclePhotoThumbnail } from "@/components/vehicles/vehicle-photo-thumbnail";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";
import { DENSITY_METRICS, type DensityMetrics } from "@/hooks/use-calendar-density";

export interface PricingDateMeta {
  dateStr: string; // YYYY-MM-DD
  isPast: boolean;
  isToday: boolean;
  isWeekend: boolean;
  surchargePercent: number;
  surchargeType: "regular" | "weekend" | "holiday";
}

interface Props {
  vehicle: { id: string; reg: string; make: string; model: string; photo_url?: string };
  dateMeta: PricingDateMeta[];
  baseRate: number;
  currency: string;
  index: number;
  /** Manual price for a date for THIS vehicle (undefined if none). */
  getManual: (date: string) => number | undefined;
  onCellClick: (vehicleId: string, date: string) => void;
  /** Row metrics for the current density. Defaults to comfortable. */
  metrics?: DensityMetrics;
}

export function PricingRow({
  vehicle,
  dateMeta,
  baseRate,
  currency,
  index,
  getManual,
  onCellClick,
  metrics = DENSITY_METRICS.comfortable,
}: Props) {
  const { minRow, rowPadding, thumb } = metrics;
  const isCompact = thumb === "sm";

  return (
    <div
      className={cn("flex border-b", index % 2 === 0 ? "bg-background" : "bg-muted/20")}
      style={{ minHeight: `${minRow}px` }}
    >
      {/* Vehicle info — sticky left (mirrors the bookings row) */}
      <div
        className="sticky left-0 z-10 w-[160px] min-w-[160px] sm:w-[240px] sm:min-w-[240px] border-r bg-background px-2 sm:px-3 flex items-center gap-2 sm:gap-3 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)]"
        style={{ paddingTop: rowPadding, paddingBottom: rowPadding }}
      >
        <VehiclePhotoThumbnail
          photoUrl={vehicle.photo_url}
          vehicleReg={vehicle.reg}
          size={thumb}
          className="rounded-lg shrink-0 border-muted-foreground/10 shadow-sm"
        />
        <div className="min-w-0">
          <div className={cn("font-semibold truncate", isCompact ? "text-[13px] leading-tight" : "text-sm")}>
            {vehicle.reg}
          </div>
          <div className={cn("text-muted-foreground truncate", isCompact ? "text-[11px] leading-tight" : "text-xs")}>
            {vehicle.make} {vehicle.model}
          </div>
        </div>
      </div>

      {/* Price cells — one per date, aligned with the header columns */}
      <div className="flex-1 flex">
        {dateMeta.map((d) => {
          const manual = getManual(d.dateStr);
          const hasManual = manual != null;
          const hasRate = hasManual || baseRate > 0;
          const displayPrice = hasManual ? (manual as number) : baseRate;
          const disabled = d.isPast;
          return (
            <button
              type="button"
              key={d.dateStr}
              disabled={disabled}
              onClick={() => onCellClick(vehicle.id, d.dateStr)}
              className={cn(
                "relative flex-1 min-w-[40px] border-r last:border-r-0 flex flex-col items-center justify-center gap-0.5 transition-colors",
                disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-primary/5",
                d.isWeekend && !hasManual && "bg-muted/30",
                d.isToday && "bg-primary/5",
                hasManual && "bg-indigo-50 dark:bg-indigo-950/30",
              )}
              title={disabled ? undefined : hasManual ? "Custom price — click to edit" : "Click to set a custom price"}
            >
              <span
                className={cn(
                  "text-[11px] font-medium tabular-nums",
                  hasManual ? "text-indigo-700 dark:text-indigo-300" : hasRate ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {hasRate ? formatCurrency(displayPrice, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "—"}
              </span>
              {/* Surcharge hint only when no manual price (manual wins over surcharge) */}
              {!hasManual && d.surchargePercent > 0 && (
                <span
                  className={cn(
                    "leading-none rounded-sm px-1 text-[8px] font-bold",
                    d.surchargeType === "holiday"
                      ? "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-400/20 dark:text-amber-300",
                  )}
                >
                  +{d.surchargePercent}%
                </span>
              )}
              {hasManual && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-indigo-500" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
