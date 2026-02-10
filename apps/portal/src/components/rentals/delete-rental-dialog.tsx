import { AlertTriangle, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";

interface Rental {
  id: string;
  rental_number: string;
  customer: {
    id: string;
    name: string;
  };
  vehicle: {
    id: string;
    reg: string;
    make: string;
    model: string;
  };
  start_date: string;
  monthly_amount: number;
  computed_status?: string;
}

interface DeleteRentalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: Rental | null;
}

export const DeleteRentalDialog = ({
  open,
  onOpenChange,
  rental,
}: DeleteRentalDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  const deleteRentalMutation = useMutation({
    mutationFn: async () => {
      if (!rental) throw new Error("No rental selected");

      // Use the database function to delete rental and all related records
      const { error } = await supabase.rpc("delete_rental_cascade", {
        rental_uuid: rental.id,
      });

      if (error) {
        console.error("Error deleting rental:", error);
        throw new Error(`Failed to delete rental: ${error.message}`);
      }
    },
    onSuccess: () => {
      toast({
        title: "Rental Deleted",
        description: `Rental ${rental?.rental_number} has been permanently deleted.`,
      });

      // Invalidate all relevant queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["rentals"] });
      queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["customer-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-list"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["rental-ledger"] });
      queryClient.invalidateQueries({ queryKey: ["ledger-entries"] });

      if (rental) {
        logAction({
          action: "rental_deleted",
          entityType: "rental",
          entityId: rental.id,
          details: { rental_number: rental.rental_number, customer: rental.customer.name, vehicle_reg: rental.vehicle.reg },
        });
      }

      onOpenChange(false);
    },
    onError: (error: Error) => {
      console.error("Error deleting rental:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete rental. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (!rental) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Delete Rental Agreement
          </DialogTitle>
          <DialogDescription>
            This will permanently delete rental {rental.rental_number}. This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert className="border-destructive/50 bg-destructive/10">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <AlertDescription className="text-destructive">
              <strong>Warning:</strong> This will permanently delete the rental
              agreement and all associated records including payments, ledger
              entries, invoices, and protection selections.
            </AlertDescription>
          </Alert>

          {/* Rental Details */}
          <div className="rounded-lg bg-muted p-4 space-y-2">
            <h3 className="font-medium">Rental Details</h3>
            <div className="text-sm space-y-1">
              <p>
                <span className="font-medium">Rental:</span>{" "}
                {rental.rental_number}
              </p>
              <p>
                <span className="font-medium">Customer:</span>{" "}
                {rental.customer.name}
              </p>
              <p>
                <span className="font-medium">Vehicle:</span> {rental.vehicle.reg}{" "}
                ({rental.vehicle.make} {rental.vehicle.model})
              </p>
              <p>
                <span className="font-medium">Start Date:</span>{" "}
                {new Date(rental.start_date).toLocaleDateString()}
              </p>
              <p>
                <span className="font-medium">Monthly Amount:</span> $
                {rental.monthly_amount.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleteRentalMutation.mutate()}
              disabled={deleteRentalMutation.isPending}
            >
              {deleteRentalMutation.isPending ? "Deleting..." : "Delete Rental"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
