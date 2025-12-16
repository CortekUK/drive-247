import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Wrench, Minus } from "lucide-react";

interface ServicePlanChipProps {
  hasServicePlan: boolean;
  compact?: boolean;
}

export function ServicePlanChip({ hasServicePlan, compact = false }: ServicePlanChipProps) {
  const config = hasServicePlan
    ? {
        icon: Wrench,
        variant: 'default' as const,
        className: 'bg-green-100 text-green-700 hover:bg-green-200',
        text: compact ? 'Plan: Yes' : 'Service Plan: Active',
        tooltip: 'Vehicle has an active service plan'
      }
    : {
        icon: Minus,
        variant: 'outline' as const,
        className: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
        text: compact ? 'Plan: No' : 'Service Plan: None',
        tooltip: 'No service plan for this vehicle'
      };

  const Icon = config.icon;

  const badge = (
    <Badge variant={config.variant} className={`flex items-center gap-1 ${config.className} ${compact ? 'text-xs px-2 py-0.5' : ''}`}>
      <Icon className="h-3 w-3" />
      <span>{config.text}</span>
    </Badge>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            {badge}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{config.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}