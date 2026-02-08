"use client";

import { useRouter } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { User, Car, CalendarDays, DollarSign } from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";
import {
  CalendarRental,
  BarPosition,
  getStatusColor,
} from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";

interface RentalBarProps {
  rental: CalendarRental;
  position: BarPosition;
  topOffset: number;
  barHeight: number;
}

function formatDate(dateStr: string) {
  return format(parseISO(dateStr), "dd MMM yyyy");
}

function getDuration(start: string, end: string | null) {
  if (!end) return "Ongoing";
  const days = differenceInDays(parseISO(end), parseISO(start));
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  const remaining = days % 30;
  return remaining > 0 ? `${months}mo ${remaining}d` : `${months}mo`;
}

export function RentalBar({ rental, position, topOffset, barHeight }: RentalBarProps) {
  const router = useRouter();
  const colors = getStatusColor(rental.computed_status);
  const isInactive =
    rental.computed_status === "Completed" ||
    rental.computed_status === "Cancelled" ||
    rental.computed_status === "Rejected";

  const label =
    rental.rental_number || rental.customer?.name?.split(" ")[0] || "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            "absolute rounded-md border cursor-pointer transition-all hover:brightness-125 flex items-center px-2 overflow-hidden text-[11px] font-semibold whitespace-nowrap backdrop-blur-sm",
            colors.bg,
            colors.border,
            colors.text,
            isInactive && "opacity-40",
            position.isClipped && "rounded-none",
            !position.isClipped && "rounded-md"
          )}
          style={{
            left: position.left,
            width: position.width,
            top: `${topOffset}px`,
            height: `${barHeight}px`,
            minWidth: "8px",
          }}
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/rentals/${rental.id}`);
          }}
        >
          <span className="truncate">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="p-0 w-[280px]" sideOffset={8}>
        <div className="rounded-lg overflow-hidden">
          {/* Header */}
          <div className={cn("px-3 py-2 flex items-center justify-between", colors.bg)}>
            <span className={cn("text-sm font-bold tracking-wide", colors.text)}>
              {rental.rental_number}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-semibold px-2 py-0.5 border-0 rounded-full",
                colors.bg,
                colors.text,
                "brightness-125"
              )}
            >
              {rental.computed_status}
            </Badge>
          </div>

          {/* Body */}
          <div className="px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <span className="text-xs font-medium text-foreground">{rental.customer.name}</span>
            </div>

            <div className="flex items-center gap-2">
              <Car className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground/80">{rental.vehicle.reg}</span>
                {" "}&middot;{" "}{rental.vehicle.make} {rental.vehicle.model}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <span className="text-xs text-muted-foreground">
                {formatDate(rental.start_date)}
                <span className="mx-1 text-muted-foreground/40">&rarr;</span>
                {rental.end_date ? formatDate(rental.end_date) : "Ongoing"}
                <span className="ml-1.5 text-[10px] text-muted-foreground/50">
                  ({getDuration(rental.start_date, rental.end_date)})
                </span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
              <span className="text-xs font-semibold text-foreground">
                ${rental.monthly_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                <span className="text-muted-foreground/60 font-normal">/mo</span>
              </span>
            </div>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
