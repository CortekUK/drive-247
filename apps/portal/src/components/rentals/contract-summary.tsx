import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, DollarSign, FileText, Clock } from "lucide-react";
import { differenceInMonths, format } from "date-fns";

interface Customer {
  id: string;
  name: string;
  customer_type?: string;
  type?: string;
}

interface Vehicle {
  id: string;
  reg: string;
  make: string;
  model: string;
}

interface ContractSummaryProps {
  customer?: Customer;
  vehicle?: Vehicle;
  startDate?: Date;
  endDate?: Date;
  rentalPeriodType?: "Daily" | "Weekly" | "Monthly";
  monthlyAmount?: number;
  initialFee?: number;
}

export const ContractSummary = ({
  customer,
  vehicle,
  startDate,
  endDate,
  rentalPeriodType = "Monthly",
  monthlyAmount,
  initialFee,
}: ContractSummaryProps) => {
  const termMonths = startDate && endDate ? differenceInMonths(endDate, startDate) : 0;
  const totalRentalCharges = termMonths * (monthlyAmount || 0);
  const totalInitialFee = initialFee || 0;

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5 text-primary" />
          Contract Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Customer */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <div className="w-2 h-2 bg-primary rounded-full" />
            Customer
          </div>
          {customer ? (
            <div className="pl-4">
              <div className="font-medium">{customer.name}</div>
              <Badge variant="secondary" className="text-xs">
                {customer.customer_type || customer.type}
              </Badge>
            </div>
          ) : (
            <div className="pl-4 text-sm text-muted-foreground">Not selected</div>
          )}
        </div>

        {/* Vehicle */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <div className="w-2 h-2 bg-primary rounded-full" />
            Vehicle
          </div>
          {vehicle ? (
            <div className="pl-4">
              <div className="font-medium">{vehicle.reg}</div>
              <div className="text-sm text-muted-foreground">{vehicle.make} {vehicle.model}</div>
            </div>
          ) : (
            <div className="pl-4 text-sm text-muted-foreground">Not selected</div>
          )}
        </div>

        {/* Rental Period Type */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Clock className="h-4 w-4" />
            Period Type
          </div>
          <div className="pl-6">
            <Badge variant="outline" className="font-medium">
              {rentalPeriodType}
            </Badge>
          </div>
        </div>

        {/* Term */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
            Term
          </div>
          <div className="pl-6">
            {termMonths > 0 ? (
              <div className="font-medium">{termMonths} month{termMonths !== 1 ? 's' : ''}</div>
            ) : (
              <div className="text-sm text-muted-foreground">Select dates to calculate</div>
            )}
          </div>
        </div>

        {/* Financial Summary */}
        <div className="space-y-3 pt-2 border-t">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            Financial Summary
          </div>
          
          <div className="space-y-2 pl-6">
            <div className="flex justify-between items-center">
              <span className="text-sm">{rentalPeriodType} Amount:</span>
              <span className="font-medium">
                {monthlyAmount ? `$${monthlyAmount.toFixed(2)}` : '$0.00'}
              </span>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-sm">Initial Fee:</span>
              <span className="font-medium">
                {totalInitialFee > 0 ? `$${totalInitialFee.toFixed(2)}` : 'None'}
              </span>
            </div>
            
            {termMonths > 0 && (
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-sm font-medium">Total Rental Charges:</span>
                <span className="font-semibold text-primary">
                  ${totalRentalCharges.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Charge Schedule */}
        {startDate && endDate && (
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              Charge Schedule
            </div>
            <div className="space-y-1 pl-6">
              <div className="flex justify-between items-center text-sm">
                <span>First Charge:</span>
                <span className="font-medium">{format(startDate, 'dd MMM yyyy')}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span>Last Charge:</span>
                <span className="font-medium">{format(endDate, 'dd MMM yyyy')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Helper Text */}
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            {rentalPeriodType} charges will be generated automatically from the start date to the end date.
            Payments are applied automatically to outstanding charges.
          </p>
          {initialFee && initialFee > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Initial fee will be recorded as a payment on the start date and will appear in Payments & P&L.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};