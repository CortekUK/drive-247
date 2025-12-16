import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { RentalPayment } from "@/hooks/use-rental-ledger-data";

interface RentalPaymentRowProps {
  payment: RentalPayment;
}

export const RentalPaymentRow = ({ payment }: RentalPaymentRowProps) => {
  const [showAllocations, setShowAllocations] = useState(false);
  const totalAllocated = payment.allocations.reduce((sum, alloc) => sum + alloc.amount_applied, 0);

  const getAllocationSummary = () => {
    const grouped = payment.allocations.reduce((acc, alloc) => {
      if (!acc[alloc.charge_category]) {
        acc[alloc.charge_category] = 0;
      }
      acc[alloc.charge_category] += alloc.amount_applied;
      return acc;
    }, {} as Record<string, number>);

    const summary = Object.entries(grouped)
      .map(([category, amount]) => `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} → ${category}`)
      .join(', ');

    return `Allocated: ${summary}. Remaining: $${payment.remaining_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  };

  return (
    <>
      <TableRow className="hover:bg-muted/50">
        <TableCell className="font-medium">
          {formatInTimeZone(new Date(payment.payment_date), 'Europe/London', "dd/MM/yyyy")}
        </TableCell>
        <TableCell>
          <Badge variant="default" className="bg-green-600 hover:bg-green-700">Payment</Badge>
        </TableCell>
        <TableCell>{payment.payment_type}</TableCell>
        <TableCell>
          <Badge variant="secondary">Applied</Badge>
        </TableCell>
        <TableCell>-</TableCell>
        <TableCell className="text-right">
          <div className="space-y-1">
            <div className="font-medium text-green-600">
              +${Math.abs(Number(payment.amount)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {payment.allocations.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {payment.allocations.length <= 2 ? (
                  <div>{getAllocationSummary()}</div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAllocations(!showAllocations)}
                  >
                    {showAllocations ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                    View allocation details (${totalAllocated.toLocaleString('en-US', { minimumFractionDigits: 2 })})
                  </Button>
                )}
              </div>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right font-medium">
          ${payment.remaining_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </TableCell>
      </TableRow>
      
      {showAllocations && payment.allocations.length > 2 && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={7} className="py-2">
            <div className="ml-4 space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Allocation Details:</div>
              {payment.allocations.map((allocation, index) => (
                <div key={index} className="text-xs text-muted-foreground flex justify-between">
                  <span>
                    {allocation.charge_category} 
                    {allocation.charge_due_date && ` (due ${formatInTimeZone(new Date(allocation.charge_due_date), 'Europe/London', "dd/MM/yyyy")})`}
                  </span>
                  <span>${allocation.amount_applied.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              ))}
              <div className="text-xs text-muted-foreground border-t pt-1 mt-1">
                <div className="flex justify-between font-medium">
                  <span>Remaining Credit:</span>
                  <span>${payment.remaining_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};