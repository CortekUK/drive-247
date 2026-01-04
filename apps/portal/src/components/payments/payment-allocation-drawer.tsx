import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatInTimeZone } from "date-fns-tz";
import { ExternalLink, CreditCard, Calendar, Hash, FileText } from "lucide-react";

interface PaymentAllocationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string | null;
}

interface PaymentAllocation {
  id: string;
  amount_applied: number;
  charge_entry_id: string;
  ledger_entries: {
    category: string;
    due_date: string | null;
    rental_id: string | null;
    vehicle_id: string | null;
  };
}

interface PaymentDetail {
  id: string;
  amount: number;
  payment_date: string;
  method: string | null;
  payment_type: string;
  status: string;
  remaining_amount: number;
  customers: {
    id: string;
    name: string;
  };
  vehicles: {
    id: string;
    reg: string;
    make: string | null;
    model: string | null;
  } | null;
  rentals: {
    id: string;
    rental_number: string | null;
  } | null;
}

export const PaymentAllocationDrawer = ({
  open,
  onOpenChange,
  paymentId
}: PaymentAllocationDrawerProps) => {
  const { tenant } = useTenant();

  const { data: paymentDetail } = useQuery({
    queryKey: ["payment-detail", paymentId, tenant?.id],
    queryFn: async () => {
      if (!paymentId || !tenant?.id) return null;

      const { data, error } = await supabase
        .from("payments")
        .select(`
          *,
          customers!payments_customer_id_fkey(id, name),
          vehicles!payments_vehicle_id_fkey(id, reg, make, model),
          rentals!payments_rental_id_fkey(id, rental_number)
        `)
        .eq("tenant_id", tenant.id)
        .eq("id", paymentId)
        .single();

      if (error) throw error;
      return data as PaymentDetail;
    },
    enabled: !!paymentId && !!tenant?.id && open,
  });

  const { data: allocations } = useQuery({
    queryKey: ["payment-allocations", paymentId],
    queryFn: async () => {
      if (!paymentId) return [];

      const { data, error } = await supabase
        .from("payment_applications")
        .select(`
          *,
          ledger_entries!charge_entry_id(
            category,
            due_date,
            rental_id,
            vehicle_id
          )
        `)
        .eq("payment_id", paymentId)
        .order("amount_applied", { ascending: false });

      if (error) throw error;
      return data as PaymentAllocation[];
    },
    enabled: !!paymentId && open,
  });

  const openCustomerLedger = () => {
    if (paymentDetail?.customers?.id) {
      window.open(`/customers/${paymentDetail.customers.id}?tab=ledger`, '_blank');
    }
  };

  const openRentalDetails = () => {
    if (paymentDetail?.rentals?.id) {
      window.open(`/rentals/${paymentDetail.rentals.id}`, '_blank');
    }
  };

  const openVehicleDetails = () => {
    if (paymentDetail?.vehicles?.id) {
      window.open(`/vehicles/${paymentDetail.vehicles.id}`, '_blank');
    }
  };

  const getAllocationStatus = () => {
    if (!paymentDetail) return null;
    
    const remaining = paymentDetail.remaining_amount || 0;
    
    if (remaining === 0) {
      return { status: 'Applied', variant: 'default' as const, color: 'green' };
    } else if (remaining > 0) {
      return { 
        status: `Credit $${remaining.toFixed(2)}`, 
        variant: 'secondary' as const, 
        color: 'blue' 
      };
    }
    return null;
  };

  if (!paymentDetail) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Payment Details
            </SheetTitle>
          </SheetHeader>
          <div className="animate-pulse space-y-4 mt-6">
            <div className="h-6 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-1/2"></div>
            <div className="space-y-2">
              <div className="h-4 bg-muted rounded"></div>
              <div className="h-4 bg-muted rounded w-2/3"></div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const allocationStatus = getAllocationStatus();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Payment Details
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Payment Summary */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Amount</div>
                <div className="text-2xl font-bold">
                  ${paymentDetail.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Status</div>
                {allocationStatus && (
                  <Badge variant={allocationStatus.variant} className="mt-1">
                    {allocationStatus.status}
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Date</div>
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  {formatInTimeZone(new Date(paymentDetail.payment_date), 'Europe/London', 'dd/MM/yyyy')}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Method</div>
                <div>{paymentDetail.method || 'Not specified'}</div>
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground">Reference ID</div>
              <div className="flex items-center gap-1 font-mono text-sm">
                <Hash className="h-4 w-4 text-muted-foreground" />
                {paymentDetail.id.slice(0, 8)}
              </div>
            </div>
          </div>

          <Separator />

          {/* Customer & Vehicle Info */}
          <div className="space-y-3">
            <h4 className="font-medium">Associated Records</h4>
            
            <div className="space-y-2">
              <Button
                variant="ghost"
                className="w-full justify-between h-auto p-3"
                onClick={openCustomerLedger}
              >
                <div className="text-left">
                  <div className="font-medium">{paymentDetail.customers.name}</div>
                  <div className="text-sm text-muted-foreground">Customer</div>
                </div>
                <ExternalLink className="h-4 w-4" />
              </Button>

              {paymentDetail.vehicles && (
                <Button
                  variant="ghost"
                  className="w-full justify-between h-auto p-3"
                  onClick={openVehicleDetails}
                >
                  <div className="text-left">
                    <div className="font-medium">
                      {paymentDetail.vehicles.reg}
                      {paymentDetail.vehicles.make && paymentDetail.vehicles.model && 
                        ` • ${paymentDetail.vehicles.make} ${paymentDetail.vehicles.model}`}
                    </div>
                    <div className="text-sm text-muted-foreground">Vehicle</div>
                  </div>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              )}

              {paymentDetail.rentals && (
                <Button
                  variant="ghost"
                  className="w-full justify-between h-auto p-3"
                  onClick={openRentalDetails}
                >
                  <div className="text-left">
                    <div className="font-medium">
                      {paymentDetail.rentals.rental_number || `Rental #${paymentDetail.rentals.id.slice(0, 8)}`}
                    </div>
                    <div className="text-sm text-muted-foreground">Rental Agreement</div>
                  </div>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <Separator />

          {/* Allocations */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Allocation Breakdown</h4>
              {allocations && allocations.length > 0 && (
                <Badge variant="outline">{allocations.length} allocation{allocations.length !== 1 ? 's' : ''}</Badge>
              )}
            </div>

            {allocations && allocations.length > 0 ? (
              <div className="space-y-2">
                {allocations.map((allocation) => (
                  <div
                    key={allocation.id}
                    className="border rounded-lg p-3 space-y-2"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">
                          {allocation.ledger_entries.category} Charge
                        </div>
                        {allocation.ledger_entries.due_date && (
                          <div className="text-sm text-muted-foreground">
                            Due: {formatInTimeZone(new Date(allocation.ledger_entries.due_date), 'Europe/London', 'dd/MM/yyyy')}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-medium">
                          ${allocation.amount_applied.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                        <Badge variant="outline" className="text-xs">
                          Applied
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-2" />
                <div>No allocations found</div>
                <div className="text-sm">This payment hasn't been allocated yet</div>
              </div>
            )}

            {/* Remaining Credit */}
            {paymentDetail.remaining_amount > 0 && (
              <div className="border border-blue-200 bg-blue-50/50 rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium text-blue-900">Remaining Credit</div>
                    <div className="text-sm text-blue-700">
                      Will auto-apply to next due charges
                    </div>
                  </div>
                  <div className="text-lg font-bold text-blue-900">
                    ${paymentDetail.remaining_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};