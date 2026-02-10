import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatInTimeZone } from "date-fns-tz";
import { RentalCharge } from "@/hooks/use-rental-ledger-data";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";

interface RentalChargeRowProps {
  charge: RentalCharge;
}

const getChargeStatus = (charge: RentalCharge) => {
  const allocatedAmount = charge.allocations.reduce((sum, alloc) => sum + alloc.amount_applied, 0);

  if (charge.remaining_amount === 0) {
    if (allocatedAmount >= Math.abs(charge.amount)) {
      return { label: "Paid", variant: "default", className: "bg-green-600 hover:bg-green-700" };
    } else if (allocatedAmount > 0) {
      return { label: "Partial/Written Off", variant: "secondary", className: "bg-slate-600 hover:bg-slate-700" };
    } else {
      return { label: "Written Off", variant: "secondary", className: "bg-slate-600 hover:bg-slate-700" };
    }
  } else if (allocatedAmount > 0) {
    return { label: "Partially Paid", variant: "secondary", className: "bg-amber-600 hover:bg-amber-700" };
  } else {
    return { label: "Unpaid", variant: "destructive", className: "" };
  }
};

export const RentalChargeRow = ({ charge }: RentalChargeRowProps) => {
  const { tenant } = useTenant();
  const status = getChargeStatus(charge);
  const currencyCode = tenant?.currency_code || 'GBP';

  return (
    <TableRow className="hover:bg-muted/50">
      <TableCell className="font-medium">
        {charge.rental_start_date
          ? formatInTimeZone(new Date(charge.rental_start_date), 'Europe/London', "dd MMM yyyy")
          : '-'}
      </TableCell>
      <TableCell>{charge.category}</TableCell>
      <TableCell>
        <Badge variant={status.variant as any} className={status.className}>
          {status.label}
        </Badge>
      </TableCell>
      <TableCell>
        {charge.due_date ? formatInTimeZone(new Date(charge.due_date), 'Europe/London', "dd MMM yyyy") : '-'}
      </TableCell>
      <TableCell className="text-right font-medium">
        {formatCurrency(Math.abs(Number(charge.amount)), currencyCode)}
      </TableCell>
    </TableRow>
  );
};