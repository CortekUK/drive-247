import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreditCard, Plus } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { useState } from "react";
import { AddPaymentDialog } from "./add-payment-dialog";

interface PaymentEntry {
  id: string;
  customer_id: string;
  rental_id: string;
  vehicle_id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  method?: string;
  status?: string;
  remaining_amount?: number;
  customers: {
    name: string;
  };
  vehicles: {
    reg: string;
  };
}

const PaymentTypeBadge = ({ payment_type }: { payment_type: string }) => {
  // Show simplified payment types for customer payments
  const displayType = payment_type === 'Payment' ? 'Customer Payment' : 
                      payment_type === 'InitialFee' ? 'Initial Fee' : payment_type;

  const getVariant = () => {
    switch (payment_type) {
      case 'InitialFee':
        return 'secondary';
      case 'Payment':
        return 'default';
      default:
        return 'outline';
    }
  };

  return (
    <Badge variant={getVariant() as any} className="badge-status">
      {displayType}
    </Badge>
  );
};

const PaymentStatusBadge = ({ status, remaining_amount }: { status?: string; remaining_amount?: number }) => {
  const getStatusInfo = () => {
    if (remaining_amount === 0 || status === 'Applied') {
      return { variant: 'default', text: 'Applied' };
    } else if (remaining_amount && remaining_amount > 0 && status === 'Partial') {
      return { variant: 'secondary', text: 'Partial' };
    } else if (remaining_amount && remaining_amount > 0 && status === 'Credit') {
      return { variant: 'secondary', text: 'Credit' };
    } else {
      return { variant: 'outline', text: status || 'Unknown' };
    }
  };

  const statusInfo = getStatusInfo();
  return (
    <Badge variant={statusInfo.variant as any} className="badge-status">
      {statusInfo.text}
    </Badge>
  );
};

export const PaymentManagement = () => {
  const [showAddDialog, setShowAddDialog] = useState(false);

  const { data: payments, isLoading } = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select(`
          *,
          customers(name),
          vehicles(reg)
        `)
        .order("payment_date", { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return <div>Loading payments...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl font-semibold">Payment Management</CardTitle>
            <CardDescription>Track all payments and receipts</CardDescription>
          </div>
          <Button 
            onClick={() => setShowAddDialog(true)}
            className="bg-gradient-primary hover:opacity-90 transition-opacity rounded-lg"
          >
            <Plus className="h-4 w-4 mr-2" />
            Record Payment
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {payments && payments.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium">
                      {formatInTimeZone(new Date(payment.payment_date), 'Europe/London', "dd/MM/yyyy")}
                    </TableCell>
                    <TableCell>{payment.customers?.name}</TableCell>
                    <TableCell>{payment.vehicles?.reg}</TableCell>
                    <TableCell>
                      <PaymentTypeBadge payment_type={payment.payment_type} />
                    </TableCell>
                    <TableCell>{payment.method || 'N/A'}</TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={payment.status} remaining_amount={payment.remaining_amount} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${Number(payment.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${Number(payment.remaining_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-center py-8">
            <CreditCard className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No payments recorded</h3>
            <p className="text-muted-foreground mb-4">Start recording payments to track your cash flow</p>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Record Payment
            </Button>
          </div>
        )}
      </CardContent>
      <AddPaymentDialog 
        open={showAddDialog} 
        onOpenChange={setShowAddDialog}
      />
    </Card>
  );
};