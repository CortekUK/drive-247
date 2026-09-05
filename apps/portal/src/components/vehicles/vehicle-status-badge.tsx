import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Car, AlertTriangle, CheckCircle, XCircle, Wrench } from "lucide-react";

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
}): string {
  if (v.is_paused) return 'Paused';
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