import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Car, AlertTriangle, CheckCircle, XCircle } from "lucide-react";

interface VehicleStatusBadgeProps {
  status: string;
  showTooltip?: boolean;
  compact?: boolean;
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
    case 'rented':
      return {
        variant: 'default' as const,
        icon: Car,
        className: 'bg-slate-800 text-slate-100 hover:bg-slate-700',
        tooltip: 'Vehicle is currently rented out'
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
    <Badge variant={config.variant} className={`flex items-center justify-center gap-1 ${config.className} ${compact ? 'text-xs px-2 py-0.5' : ''}`}>
      <Icon className="h-3 w-3" />
      {!compact && <span className="capitalize">{status}</span>}
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