import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";

interface CustomerBalanceChipProps {
  balance: number;
  status: 'In Credit' | 'Settled' | 'In Debt';
  totalCharges?: number;
  totalPayments?: number;
  className?: string;
  size?: 'small' | 'default';
}

export const CustomerBalanceChip = ({
  balance,
  status,
  totalCharges,
  totalPayments,
  className = "",
  size = "default"
}: CustomerBalanceChipProps) => {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';

  const tooltipContent = totalCharges !== undefined && totalPayments !== undefined
    ? `Charges ${formatCurrency(totalCharges, currencyCode)} • Payments ${formatCurrency(totalPayments, currencyCode)}`
    : status;

  const isSmall = size === 'small';

  // Settled state
  if (status === 'Settled' || balance === 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(
              "text-muted-foreground",
              isSmall ? "text-xs" : "text-sm",
              className
            )}>
              Settled
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{tooltipContent}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // In Debt or In Credit
  const isDebt = status === 'In Debt';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex flex-col items-start gap-0.5",
            className
          )}>
            <span className={cn(
              "font-semibold tabular-nums",
              isDebt ? "text-red-500" : "text-green-500",
              isSmall ? "text-xs" : "text-sm"
            )}>
              {formatCurrency(balance, currencyCode)}
            </span>
            <span className={cn(
              "text-muted-foreground",
              isSmall ? "text-[10px]" : "text-xs"
            )}>
              {isDebt ? "outstanding" : "credit"}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipContent}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};