import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRentalCharges, useRentalPayments } from "@/hooks/use-rental-ledger-data";
import { RentalChargeRow } from "@/components/rentals/rental-charge-row";
import { RentalPaymentRow } from "@/components/rentals/rental-payment-row";

interface RentalLedgerProps {
  rentalId: string;
}

interface LedgerEntry {
  id: string;
  entry_date: string;
  type: 'Charge' | 'Payment';
  amount: number;
  due_date?: string;
}

export const RentalLedger = ({ rentalId }: RentalLedgerProps) => {
  const { data: charges, isLoading: chargesLoading } = useRentalCharges(rentalId);
  const { data: payments, isLoading: paymentsLoading } = useRentalPayments(rentalId);

  if (chargesLoading || paymentsLoading) {
    return <div>Loading ledger...</div>;
  }

  // Combine and sort all entries by date
  const allEntries: LedgerEntry[] = [
    ...(charges || []).map(charge => ({
      id: charge.id,
      entry_date: charge.entry_date,
      type: 'Charge' as const,
      amount: charge.amount,
      due_date: charge.due_date,
    })),
    ...(payments || []).map(payment => ({
      id: payment.id,
      entry_date: payment.payment_date,
      type: 'Payment' as const,
      amount: payment.amount,
    }))
  ].sort((a, b) => new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Rental Ledger</CardTitle>
        <CardDescription>All charges and payments with allocation details</CardDescription>
      </CardHeader>
      <CardContent>
        {allEntries && allEntries.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allEntries.map((entry) => {
                  if (entry.type === 'Charge') {
                    const charge = charges?.find(c => c.id === entry.id);
                    return charge ? <RentalChargeRow key={entry.id} charge={charge} /> : null;
                  } else {
                    const payment = payments?.find(p => p.id === entry.id);
                    return payment ? <RentalPaymentRow key={entry.id} payment={payment} /> : null;
                  }
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-center py-8">
            <h3 className="text-lg font-medium mb-2">No entries found</h3>
            <p className="text-muted-foreground">No charges or payments recorded for this rental</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};