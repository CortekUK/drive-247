import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRentalCharges } from "@/hooks/use-rental-ledger-data";
import { RentalChargeRow } from "@/components/rentals/rental-charge-row";

interface RentalLedgerProps {
  rentalId: string;
}

export const RentalLedger = ({ rentalId }: RentalLedgerProps) => {
  const { data: charges, isLoading: chargesLoading } = useRentalCharges(rentalId);

  if (chargesLoading) {
    return <div>Loading ledger...</div>;
  }

  // Sort charges by date (newest first)
  const sortedCharges = [...(charges || [])].sort(
    (a, b) => new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime()
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Charges</CardTitle>
        <CardDescription>All charges for this rental</CardDescription>
      </CardHeader>
      <CardContent>
        {sortedCharges.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCharges.map((charge) => (
                  <RentalChargeRow key={charge.id} charge={charge} />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-center py-8">
            <h3 className="text-lg font-medium mb-2">No charges found</h3>
            <p className="text-muted-foreground">No charges recorded for this rental</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};