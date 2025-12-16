import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CreditCard, ShoppingCart } from "lucide-react";

interface AcquisitionBadgeProps {
  acquisitionType: string;
}

export const AcquisitionBadge = ({ acquisitionType, showTooltip = true }: AcquisitionBadgeProps & { showTooltip?: boolean }) => {
  const config = {
    Purchase: {
      variant: 'default' as const,
      icon: ShoppingCart,
      className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
      tooltip: "Purchased vehicle"
    },
    Finance: {
      variant: 'secondary' as const,
      icon: CreditCard,
      className: "bg-blue-100 text-blue-700 hover:bg-blue-200",
      tooltip: "Contract total used in P&L (no monthly breakdown)"
    }
  };

  const { variant, icon: Icon, className, tooltip } = config[acquisitionType as keyof typeof config] || config.Purchase;

  const badge = (
    <Badge variant={variant} className={`flex items-center justify-center gap-1 ${className}`}>
      <Icon className="h-3 w-3" />
      {acquisitionType}
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
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
};