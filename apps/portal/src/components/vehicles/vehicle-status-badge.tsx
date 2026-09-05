import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Car, AlertTriangle, CalendarClock, CheckCircle, XCircle, Wrench } from "lucide-react";

interface VehicleStatusBadgeProps {
  status: string;
  showTooltip?: boolean;
  compact?: boolean;
}

/**
 * The status an operator should SEE, derived from every signal that actually
 * affects bookability — not just the machine-owned `status` column.
 *
 * `vehicles.status` is written only by the system (a rental opening or closing
 * flips it Rented/Available), so an operator who switches all three hire
 * durations off has no way to change it. Before this, the badge kept reading
 * "Available" — and telling them "Vehicle is available for rental" — on a car
 * they had just taken off sale. That is what operators report as
 * "I can't switch the car to unavailable".
 */
export function resolveVehicleStatus(v: {
  status?: string | null;
  is_paused?: boolean | null;
  available_daily?: boolean | null;
  available_weekly?: boolean | null;
  available_monthly?: boolean | null;
  /**
   * Whether a rental is actually RUNNING on this car right now. Optional on
   * purpose: every existing caller omits it and keeps today's behaviour exactly.
   * Pass it only where the answer is known, and 'Rented' splits into the two
   * states it has always conflated.
   */
  has_active_rental?: boolean | null;
}): string {
  if (v.is_paused) return 'Paused';

  // 'Rented' has always meant two different things, and the badge told the
  // operator the wrong one. The column is flipped to 'Rented' the moment a
  // rental row is created -- the portal's New Rental handler does it explicitly
  // "even for pending rentals" -- but a Pending rental is the PRE-KEY-HANDOVER
  // state: booked, not yet collected. So a car booked for next week reads
  // "currently rented out" while it is sitting on the forecourt. An operator
  // then finds no one holding it, concludes the booking is a ghost, and asks
  // why the system will not let them re-book it.
  //
  // Splitting the label is deliberately done HERE, at the read layer, and not
  // by changing what gets written. Rewriting the column would move 10 live
  // vehicles across 6 tenants out of 'Rented', dropping fleet-utilisation KPIs
  // ~20% overnight with no explanation, and a blanket backfill would also
  // resurrect the one vehicle that is 'Rented' AND is_disposed. Deriving it
  // costs no write, no backfill and no audit gap.
  //
  // 'Reserved' is NOT 'Available': the car is genuinely claimed and
  // check_rental_overlap will still refuse a clashing booking. That is the
  // point -- the badge now agrees with the guard instead of contradicting it.
  if ((v.status ?? '').toLowerCase() === 'rented' && v.has_active_rental === false) {
    return 'Reserved';
  }
  // All three hire durations off = not quotable on any tier. NOTE: this is
  // "off sale", NOT "cannot be booked" — the enquiry picker and the staff New
  // Rental picker both still offer it. Only Pause closes every path.
  if (
    (v.status ?? '').toLowerCase() === 'available' &&
    v.available_daily === false &&
    v.available_weekly === false &&
    v.available_monthly === false
  ) {
    return 'Unavailable';
  }
  return v.status ?? 'Available';
}

const getStatusConfig = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'available':
      return {
        variant: 'secondary' as const,
        icon: CheckCircle,
        className: 'bg-pink-100 text-pink-700 hover:bg-pink-200',
        tooltip: 'Vehicle is available for rental'
      };
    case 'unavailable':
      return {
        variant: 'secondary' as const,
        icon: AlertTriangle,
        className: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
        tooltip: 'Off sale — no hire durations enabled, so it cannot be quoted. It can still be picked in inquiries and by staff; use Pause to remove it everywhere.'
      };
    case 'rented':
      return {
        variant: 'default' as const,
        icon: Car,
        className: 'bg-slate-800 text-slate-100 hover:bg-slate-700',
        tooltip: 'Vehicle is currently rented out'
      };
    case 'reserved':
      return {
        variant: 'secondary' as const,
        icon: CalendarClock,
        className: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200',
        tooltip: 'Booked but not yet collected. The car is here, but it is claimed by an upcoming rental, so it cannot be double-booked over those dates.'
      };
    case 'maintenance':
      return {
        variant: 'secondary' as const,
        icon: Wrench,
        className: 'bg-amber-100 text-amber-700 hover:bg-amber-200',
        tooltip: 'Vehicle is in maintenance and unavailable for rental'
      };
    case 'paused':
      return {
        variant: 'secondary' as const,
        icon: Wrench,
        className: 'bg-amber-100 text-amber-700 hover:bg-amber-200',
        tooltip: 'Paused — hidden from your booking site'
      };
    case 'disposed':
      return {
        variant: 'outline' as const,
        icon: XCircle,
        className: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
        tooltip: 'Vehicle has been disposed of'
      };
    default:
      return {
        variant: 'outline' as const,
        icon: AlertTriangle,
        className: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
        tooltip: `Status: ${status}`
      };
  }
};

export function VehicleStatusBadge({ status, showTooltip = true, compact = false }: VehicleStatusBadgeProps) {
  const config = getStatusConfig(status);
  const Icon = config.icon;

  const badge = (
    <Badge variant={config.variant} className={`flex items-center justify-center ${config.className} ${compact ? 'text-xs px-2 py-0.5' : ''}`}>
      <span className="capitalize">{status}</span>
    </Badge>
  );

  if (!showTooltip) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}