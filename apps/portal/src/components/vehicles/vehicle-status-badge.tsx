import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusPill, type StatusTone } from "@/components/bento";

interface VehicleStatusBadgeProps {
  status: string;
  showTooltip?: boolean;
  compact?: boolean;
}

const getStatusConfig = (status: string): { tone: StatusTone; tooltip: string } => {
  switch (status?.toLowerCase()) {
    case 'available':
      return { tone: 'success', tooltip: 'Vehicle is available for rental' };
    case 'rented':
      return { tone: 'primary', tooltip: 'Vehicle is currently rented out' };
    case 'maintenance':
      return { tone: 'warn', tooltip: 'Vehicle is in maintenance and unavailable for rental' };
    case 'disposed':
      return { tone: 'neutral', tooltip: 'Vehicle has been disposed of' };
    default:
      return { tone: 'warn', tooltip: `Status: ${status}` };
  }
};

export function VehicleStatusBadge({ status, showTooltip = true }: VehicleStatusBadgeProps) {
  const config = getStatusConfig(status);

  const badge = (
    <StatusPill tone={config.tone} dot className="capitalize">
      {status}
    </StatusPill>
  );

  if (!showTooltip) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{badge}</span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
