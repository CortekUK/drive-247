import { Mail, Send } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
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

interface Invoice {
  id: string;
  invoice_number: string;
  total_amount: number;
  customers?: {
    name: string;
    email?: string;
  };
  vehicles?: {
    reg: string;
    make: string;
    model: string;
  };
}

interface SendInvoiceEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
}

export const SendInvoiceEmailDialog = ({
  open,
  onOpenChange,
  invoice,
}: SendInvoiceEmailDialogProps) => {
  const { toast } = useToast();
  const { tenant } = useTenant();

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error("No invoice selected");
      if (!tenant?.id) throw new Error("No tenant context");

      const { data, error } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          invoiceId: invoice.id,
          tenantId: tenant.id,
        },
      });

      if (error) throw error;
      if (data && !data.success) {
        throw new Error(data.error || "Failed to send email");
      }
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Email Sent",
        description: `Invoice ${invoice?.invoice_number} has been sent to ${invoice?.customers?.email}.`,
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      console.error("Error sending invoice email:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to send invoice email. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (!invoice) return null;

  const hasEmail = !!invoice.customers?.email;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Send Invoice Email
          </DialogTitle>
          <DialogDescription>
            Send invoice {invoice.invoice_number} to the customer via email with a PDF attachment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!hasEmail && (
            <Alert className="border-destructive/50 bg-destructive/10">
              <AlertDescription className="text-destructive">
                <strong>Warning:</strong> No email address on file for this customer.
                Please add an email address before sending.
              </AlertDescription>
            </Alert>
          )}

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
              <p>
                <span className="font-medium">Email:</span>{" "}
                {invoice.customers?.email || "No email on file"}
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
              onClick={() => sendEmailMutation.mutate()}
              disabled={sendEmailMutation.isPending || !hasEmail}
            >
              <Send className="h-4 w-4 mr-2" />
              {sendEmailMutation.isPending ? "Sending..." : "Send Email"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
