import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link2 } from "lucide-react";
import { useRentalCharges } from "@/hooks/use-rental-ledger-data";
import { RentalChargeRow } from "@/components/rentals/rental-charge-row";

const EXTENSION_CATEGORIES = ['Extension', 'Extension Rental', 'Extension Tax', 'Extension Service Fee'];

interface RentalLedgerProps {
  rentalId: string;
}

export const RentalLedger = ({ rentalId }: RentalLedgerProps) => {
  const { data: charges, isLoading: chargesLoading } = useRentalCharges(rentalId);

  if (chargesLoading) {
    return <div>Loading ledger...</div>;
  }

  // Split into original and extension charges
  const allCharges = [...(charges || [])].sort(
    (a, b) => new Date(b.entry_date).getTime() - new Date(a.entry_date).getTime()
  );
  const originalCharges = allCharges.filter(c => !EXTENSION_CATEGORIES.includes(c.category));
  const extensionCharges = allCharges.filter(c => EXTENSION_CATEGORIES.includes(c.category));

  const chargeTableHeaders = (
    <TableHeader>
      <TableRow>
        <TableHead>Date</TableHead>
        <TableHead>Category</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Due Date</TableHead>
        <TableHead className="text-right">Amount</TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Charges</CardTitle>
        <CardDescription>All charges for this rental</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {allCharges.length > 0 ? (
          <>
            {/* Original charges */}
            {originalCharges.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  {chargeTableHeaders}
                  <TableBody>
                    {originalCharges.map((charge) => (
                      <RentalChargeRow key={charge.id} charge={charge} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Extension groups - separated by extension number */}
            {extensionCharges.length > 0 && (() => {
              // Group by extension number from reference
              const groups: Record<number, typeof extensionCharges> = {};
              let nextLegacyNum = 1;
              extensionCharges.forEach(charge => {
                const numMatch = (charge as any).reference?.match(/Extension #(\d+)/);
                const extNum = numMatch ? parseInt(numMatch[1], 10) : nextLegacyNum++;
                if (!groups[extNum]) groups[extNum] = [];
                groups[extNum].push(charge);
              });
              const sortedGroups = Object.entries(groups).sort(([a], [b]) => parseInt(a) - parseInt(b));

              return sortedGroups.map(([num, groupCharges]) => (
                <div key={`ext-group-${num}`} className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-border" />
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/80 border">
                      <Link2 className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Extension #{num}</span>
                    </div>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <div className="rounded-md border">
                    <Table>
                      {chargeTableHeaders}
                      <TableBody>
                        {groupCharges.map((charge) => (
                          <RentalChargeRow key={charge.id} charge={charge} />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ));
            })()}
          </>
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