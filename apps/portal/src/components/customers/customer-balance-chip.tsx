import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
  const formatCurrency = (amount: number) =>
    `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const tooltipContent = totalCharges !== undefined && totalPayments !== undefined
    ? `Charges ${formatCurrency(totalCharges)} • Payments ${formatCurrency(totalPayments)}`
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
              {formatCurrency(balance)}
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