import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { KeyRound, Minus, Info } from "lucide-react";

interface SpareKeyChipProps {
  hasSpareKey: boolean;
  spareKeyHolder?: string | null;
  spareKeyNotes?: string | null;
  compact?: boolean;
}

export function SpareKeyChip({ hasSpareKey, spareKeyHolder, spareKeyNotes, compact = false }: SpareKeyChipProps) {
  if (!hasSpareKey) {
    const badge = (
      <Badge variant="outline" className={`flex items-center gap-1 bg-gray-100 text-gray-700 hover:bg-gray-200 ${compact ? 'text-xs px-2 py-0.5' : ''}`}>
        <Minus className="h-3 w-3" />
        <span>{compact ? 'Key: None' : 'Spare Key: None'}</span>
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
            <p>No spare key for this vehicle</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const config = spareKeyHolder === 'Customer'
    ? {
        className: 'bg-purple-100 text-purple-700 hover:bg-purple-200',
        text: compact ? 'Customer' : 'Spare Key: Customer',
        tooltip: 'Spare key is with customer'
      }
    : {
        className: 'bg-blue-100 text-blue-700 hover:bg-blue-200',
        text: compact ? 'Company' : 'Spare Key: Company',
        tooltip: 'Spare key is with company'
      };

  const badge = (
    <Badge variant="default" className={`flex items-center gap-1 ${config.className} ${compact ? 'text-xs px-2 py-0.5' : ''}`}>
      <KeyRound className="h-3 w-3" />
      <span>{config.text}</span>
      {spareKeyNotes && <Info className="h-3 w-3" />}
    </Badge>
  );

  const tooltipContent = (
    <div>
      <p>{config.tooltip}</p>
      {spareKeyNotes && (
        <>
          <p className="mt-1 text-xs text-muted-foreground">Notes:</p>
          <p className="text-xs">{spareKeyNotes}</p>
        </>
      )}
    </div>
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
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}