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
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/invoice-utils";
import { useAuditLog } from "@/hooks/use-audit-log";

interface Invoice {
  id: string;
  invoice_number: string;
  total_amount: number;
  customers?: {
    name: string;
  };
  vehicles?: {
    reg: string;
    make: string;
    model: string;
  };
}

interface DeleteInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}

export const DeleteInvoiceDialog = ({
  open,
  onOpenChange,
  invoice,
}: DeleteInvoiceDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();

  const deleteInvoiceMutation = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error("No invoice selected");
      if (!tenant?.id) throw new Error("No tenant context");

      const { error } = await supabase
        .from("invoices")
        .delete()
        .eq("id", invoice.id)
        .eq("tenant_id", tenant.id);

      if (error) {
        console.error("Error deleting invoice:", error);
        throw new Error(`Failed to delete invoice: ${error.message}`);
      }
    },
    onSuccess: () => {
      toast({
        title: "Invoice Deleted",
        description: `Invoice ${invoice?.invoice_number} has been permanently deleted.`,
      });

      // Audit log for invoice deletion
      if (invoice?.id) {
        logAction({
          action: "invoice_deleted",
          entityType: "invoice",
          entityId: invoice.id,
          details: {
            invoice_number: invoice.invoice_number,
            amount: invoice.total_amount,
            customer_name: invoice.customers?.name
          }
        });
      }

      queryClient.invalidateQueries({ queryKey: ["invoices-list"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      console.error("Error deleting invoice:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete invoice. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Delete Invoice
          </DialogTitle>
          <DialogDescription>
            This will permanently delete invoice {invoice.invoice_number}. This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert className="border-destructive/50 bg-destructive/10">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <AlertDescription className="text-destructive">
              <strong>Warning:</strong> This will permanently delete this invoice
              record. This action cannot be undone.
            </AlertDescription>
          </Alert>

          <div className="rounded-lg bg-muted p-4 space-y-2">
            <h3 className="font-medium">Invoice Details</h3>
            <div className="text-sm space-y-1">
              <p>
                <span className="font-medium">Invoice:</span>{" "}
                {invoice.invoice_number}
              </p>
              <p>
                <span className="font-medium">Customer:</span>{" "}
                {invoice.customers?.name || "—"}
              </p>
              {invoice.vehicles && (
                <p>
                  <span className="font-medium">Vehicle:</span>{" "}
                  {invoice.vehicles.reg} ({invoice.vehicles.make} {invoice.vehicles.model})
                </p>
              )}
              <p>
                <span className="font-medium">Amount:</span>{" "}
                {formatCurrency(invoice.total_amount)}
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
              onClick={() => deleteInvoiceMutation.mutate()}
              disabled={deleteInvoiceMutation.isPending}
            >
              {deleteInvoiceMutation.isPending ? "Deleting..." : "Delete Invoice"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
