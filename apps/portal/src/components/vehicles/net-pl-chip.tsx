import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/vehicle-utils";

interface NetPLChipProps {
  revenue: number;
  costs: number;
  net: number;
  compact?: boolean;
  showTooltip?: boolean;
}

export function NetPLChip({ revenue, costs, net, compact = false, showTooltip = true }: NetPLChipProps) {
  const isPositive = net >= 0;
  const chipClassName = isPositive 
    ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" 
    : "bg-red-100 text-red-700 hover:bg-red-200";

  const badge = (
    <Badge 
      variant="secondary" 
      className={`flex items-center justify-center gap-1 ${chipClassName} ${compact ? 'text-xs px-2 py-0.5' : ''}`}
    >
      <span className="font-medium">
        {isPositive ? '+' : ''}{formatCurrency(net)}
      </span>
    </Badge>
  );

  if (!showTooltip) {
    return badge;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {badge}
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1">
          <p>Revenue: {formatCurrency(revenue)}</p>
          <p>Costs: {formatCurrency(costs)}</p>
          <hr className="border-border" />
          <p className="font-medium">Net: {formatCurrency(net)}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}