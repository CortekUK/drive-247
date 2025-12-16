import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { RentalCharge } from "@/hooks/use-rental-ledger-data";

interface RentalChargeRowProps {
  charge: RentalCharge;
}

const getChargeStatus = (charge: RentalCharge) => {
  const allocatedAmount = charge.allocations.reduce((sum, alloc) => sum + alloc.amount_applied, 0);

  if (charge.remaining_amount === 0) {
    // Check if there are actual payment allocations that cover the charge
    if (allocatedAmount >= Math.abs(charge.amount)) {
      return { label: "Paid", variant: "default", className: "bg-green-600 hover:bg-green-700" };
    } else if (allocatedAmount > 0) {
      // Partially paid but written off the rest
      return { label: "Partial/Written Off", variant: "secondary", className: "bg-slate-600 hover:bg-slate-700" };
    } else {
      // No allocations but remaining is 0 = written off (e.g., rejected payment)
      return { label: "Written Off", variant: "secondary", className: "bg-slate-600 hover:bg-slate-700" };
    }
  } else if (allocatedAmount > 0) {
    return { label: "Partially Paid", variant: "secondary", className: "bg-amber-600 hover:bg-amber-700" };
  } else {
    return { label: "Unpaid", variant: "destructive", className: "" };
  }
};

export const RentalChargeRow = ({ charge }: RentalChargeRowProps) => {
  const [showAllocations, setShowAllocations] = useState(false);
  const status = getChargeStatus(charge);
  const allocatedAmount = charge.allocations.reduce((sum, alloc) => sum + alloc.amount_applied, 0);

  return (
    <>
      <TableRow className="hover:bg-muted/50">
        <TableCell className="font-medium">
          {formatInTimeZone(new Date(charge.entry_date), 'Europe/London', "dd/MM/yyyy")}
        </TableCell>
        <TableCell>
          <Badge variant="destructive">Charge</Badge>
        </TableCell>
        <TableCell>{charge.category}</TableCell>
        <TableCell>
          <Badge variant={status.variant as any} className={status.className}>
            {status.label}
          </Badge>
        </TableCell>
        <TableCell>
          {charge.due_date ? formatInTimeZone(new Date(charge.due_date), 'Europe/London', "dd/MM/yyyy") : '-'}
        </TableCell>
        <TableCell className="text-right">
          <div className="space-y-1">
            <div className="font-medium">
              ${Math.abs(Number(charge.amount)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {charge.allocations.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {charge.allocations.length === 1 ? (
                  <div>
                    Allocated ${charge.allocations[0].amount_applied.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} from payment on {formatInTimeZone(new Date(charge.allocations[0].payment_date), 'Europe/London', "dd/MM/yyyy")}
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAllocations(!showAllocations)}
                  >
                    {showAllocations ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                    {charge.allocations.length} allocations (${allocatedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                  </Button>
                )}
              </div>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right font-medium">
          ${Math.abs(Number(charge.remaining_amount)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </TableCell>
      </TableRow>
      
      {showAllocations && charge.allocations.length > 1 && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={7} className="py-2">
            <div className="ml-4 space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Allocation Details:</div>
              {charge.allocations.map((allocation, index) => (
                <div key={index} className="text-xs text-muted-foreground flex justify-between">
                  <span>Payment on {formatInTimeZone(new Date(allocation.payment_date), 'Europe/London', "dd/MM/yyyy")}</span>
                  <span>${allocation.amount_applied.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};