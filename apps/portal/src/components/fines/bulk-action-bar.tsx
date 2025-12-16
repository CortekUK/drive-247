import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CheckSquare, CreditCard, Ban, X, AlertTriangle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Fine {
  id: string;
  status: string;
  liability: string;
  amount: number;
  reference_no: string | null;
}

interface BulkActionBarProps {
  selectedFines: Fine[];
  onClearSelection: () => void;
}

export const BulkActionBar = ({ selectedFines, onClearSelection }: BulkActionBarProps) => {
  const [showChargeDialog, setShowChargeDialog] = useState(false);
  const [showWaiveDialog, setShowWaiveDialog] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filter eligible fines for each action
  const chargeableFiles = selectedFines.filter(fine => 
    fine.liability === 'Customer' && (fine.status === 'Open' || fine.status === 'Appealed')
  );

  const waivableFiles = selectedFines.filter(fine => 
    fine.status === 'Open' || fine.status === 'Appealed'
  );

  const bulkChargeMutation = useMutation({
    mutationFn: async (fineIds: string[]) => {
      const results = await Promise.allSettled(
        fineIds.map(fineId =>
          supabase.functions.invoke('apply-fine', {
            body: { fineId, action: 'charge' }
          })
        )
      );

      const successful = results.filter(result => result.status === 'fulfilled').length;
      const failed = results.length - successful;

      return { successful, failed, total: results.length };
    },
    onSuccess: ({ successful, failed, total }) => {
      toast({
        title: "Bulk Charge Complete",
        description: `${successful} fines charged successfully${failed > 0 ? `, ${failed} failed` : ''}`,
      });
      
      queryClient.invalidateQueries({ queryKey: ["fines-list"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
      onClearSelection();
      setShowChargeDialog(false);
    },
    onError: (error: any) => {
      toast({
        title: "Bulk Charge Failed",
        description: error.message || "Failed to charge selected fines",
        variant: "destructive",
      });
    },
  });

  const bulkWaiveMutation = useMutation({
    mutationFn: async (fineIds: string[]) => {
      const results = await Promise.allSettled(
        fineIds.map(fineId =>
          supabase.functions.invoke('apply-fine', {
            body: { fineId, action: 'waive' }
          })
        )
      );

      const successful = results.filter(result => result.status === 'fulfilled').length;
      const failed = results.length - successful;

      return { successful, failed, total: results.length };
    },
    onSuccess: ({ successful, failed }) => {
      toast({
        title: "Bulk Waive Complete",
        description: `${successful} fines waived successfully${failed > 0 ? `, ${failed} failed` : ''}`,
      });
      
      queryClient.invalidateQueries({ queryKey: ["fines-list"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
      onClearSelection();
      setShowWaiveDialog(false);
    },
    onError: (error: any) => {
      toast({
        title: "Bulk Waive Failed",
        description: error.message || "Failed to waive selected fines",
        variant: "destructive",
      });
    },
  });

  if (selectedFines.length === 0) {
    return null;
  }

  const totalAmount = selectedFines.reduce((sum, fine) => sum + fine.amount, 0);

  return (
    <>
      <Card className="border-primary">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <CheckSquare className="h-5 w-5 text-primary" />
                <span className="font-medium">{selectedFines.length} fines selected</span>
                <Badge variant="outline">
                  Total: ${totalAmount.toLocaleString()}
                </Badge>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {/* Charge to Customer */}
              <Button
                variant="default"
                size="sm"
                disabled={chargeableFiles.length === 0 || bulkChargeMutation.isPending}
                onClick={() => setShowChargeDialog(true)}
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Charge Selected ({chargeableFiles.length})
              </Button>

              {/* Waive Selected */}
              <Button
                variant="outline"
                size="sm"
                disabled={waivableFiles.length === 0 || bulkWaiveMutation.isPending}
                onClick={() => setShowWaiveDialog(true)}
              >
                <Ban className="h-4 w-4 mr-2" />
                Waive Selected ({waivableFiles.length})
              </Button>

              {/* Clear Selection */}
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearSelection}
              >
                <X className="h-4 w-4 mr-2" />
                Clear
              </Button>
            </div>
          </div>

          {/* Eligibility Info */}
          {selectedFines.length > chargeableFiles.length && (
            <div className="mt-2 p-2 bg-muted rounded text-sm text-muted-foreground flex items-center space-x-2">
              <AlertTriangle className="h-4 w-4" />
              <span>
                {selectedFines.length - chargeableFiles.length} fines cannot be charged 
                (Business liability or already processed)
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charge Confirmation Dialog */}
      <AlertDialog open={showChargeDialog} onOpenChange={setShowChargeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Charge {chargeableFiles.length} Fines to Customer Accounts</AlertDialogTitle>
            <AlertDialogDescription>
              This will create charges of ${chargeableFiles.reduce((sum, fine) => sum + fine.amount, 0).toLocaleString()} 
              to the respective customer accounts. This action cannot be undone.
              
              <div className="mt-4 p-3 bg-muted rounded">
                <p className="text-sm font-medium mb-2">Eligible fines ({chargeableFiles.length}):</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {chargeableFiles.map(fine => (
                    <div key={fine.id} className="text-xs flex justify-between">
                      <span>{fine.reference_no || fine.id.slice(0, 8)}</span>
                      <span>${fine.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkChargeMutation.mutate(chargeableFiles.map(f => f.id))}
              disabled={bulkChargeMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {bulkChargeMutation.isPending ? "Charging..." : "Charge to Customers"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Waive Confirmation Dialog */}
      <AlertDialog open={showWaiveDialog} onOpenChange={setShowWaiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Waive {waivableFiles.length} Selected Fines</AlertDialogTitle>
            <AlertDialogDescription>
              This will waive the selected fines totaling ${waivableFiles.reduce((sum, fine) => sum + fine.amount, 0).toLocaleString()}.
              Waived fines will not be charged to customers. This action cannot be undone.

              <div className="mt-4 p-3 bg-muted rounded">
                <p className="text-sm font-medium mb-2">Fines to waive ({waivableFiles.length}):</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {waivableFiles.map(fine => (
                    <div key={fine.id} className="text-xs flex justify-between">
                      <span>{fine.reference_no || fine.id.slice(0, 8)}</span>
                      <span>${fine.amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkWaiveMutation.mutate(waivableFiles.map(f => f.id))}
              disabled={bulkWaiveMutation.isPending}
            >
              {bulkWaiveMutation.isPending ? "Waiving..." : "Waive Fines"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};