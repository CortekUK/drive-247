import { Mail, Send, Download } from "lucide-react";
import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useReactToPrint } from "react-to-print";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { formatCurrency } from "@/lib/invoice-utils";
import { format } from "date-fns";

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date?: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  notes?: string;
  customers?: {
    name: string;
    email?: string;
    phone?: string;
  };
  vehicles?: {
    reg: string;
    make: string;
    model: string;
  };
  rentals?: {
    start_date: string;
    end_date: string;
    monthly_amount: number;
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
  const { branding } = useTenantBranding();
  const { logAction } = useAuditLog();
  const printRef = useRef<HTMLDivElement>(null);
  const companyName = branding?.app_name || tenant?.company_name || 'Invoice';
  const logoUrl = branding?.logo_url;
  const accentColor = branding?.accent_color || '#C5A572';

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: invoice ? `Invoice-${invoice.invoice_number}` : "Invoice",
    pageStyle: `
      @page {
        size: A4;
        margin: 0.5in;
      }
      @media print {
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    `,
  });

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
      if (invoice) {
        logAction({
          action: "invoice_sent",
          entityType: "invoice",
          entityId: invoice.id,
          details: { invoice_number: invoice.invoice_number, recipient: invoice.customers?.email },
        });
      }
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
  const vehicleName = invoice.vehicles?.make && invoice.vehicles?.model
    ? `${invoice.vehicles.make} ${invoice.vehicles.model}`
    : invoice.vehicles?.reg || "";

  return (
    <>
      {/* Hidden printable component */}
      <div style={{ display: 'none' }}>
        <div ref={printRef}>
          <div className="p-8 bg-white text-black">
            <div className="border-b border-gray-300 pb-6 mb-6">
              {logoUrl ? (
                <img src={logoUrl} alt={companyName} style={{ height: '48px', objectFit: 'contain' }} />
              ) : (
                <h1 className="text-3xl font-bold" style={{ color: accentColor }}>{companyName}</h1>
              )}
            </div>
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div>
                <h3 className="font-semibold mb-2">Bill To:</h3>
                <div className="text-sm space-y-1">
                  <p className="font-medium">{invoice.customers?.name}</p>
                  {invoice.customers?.email && <p>{invoice.customers.email}</p>}
                  {invoice.customers?.phone && <p>{invoice.customers.phone}</p>}
                </div>
              </div>
              <div className="text-right">
                <h3 className="font-semibold mb-2">Invoice Details:</h3>
                <div className="text-sm space-y-1">
                  <p><span className="text-gray-600">Invoice #:</span> <strong>{invoice.invoice_number}</strong></p>
                  <p><span className="text-gray-600">Date:</span> {format(new Date(invoice.invoice_date), 'PPP')}</p>
                  {invoice.due_date && (
                    <p><span className="text-gray-600">Due Date:</span> {format(new Date(invoice.due_date), 'PPP')}</p>
                  )}
                </div>
              </div>
            </div>
            {invoice.vehicles && invoice.rentals && (
              <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 mb-6">
                <h3 className="font-semibold mb-3">Rental Information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Vehicle:</p>
                    <p className="font-medium">{invoice.vehicles.make} {invoice.vehicles.model}</p>
                    <p className="text-gray-500 text-xs">Reg: {invoice.vehicles.reg}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Rental Period:</p>
                    <p className="font-medium">
                      {format(new Date(invoice.rentals.start_date), 'PP')} - {format(new Date(invoice.rentals.end_date), 'PP')}
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div className="border border-gray-300 rounded-lg overflow-hidden mb-6">
              <table className="w-full border-collapse">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="text-left p-3 text-sm font-semibold border-b border-gray-300">Description</th>
                    <th className="text-right p-3 text-sm font-semibold border-b border-gray-300">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-300">
                    <td className="p-3 text-sm">
                      <div>
                        <p className="font-medium">Rental Fee</p>
                        <p className="text-xs text-gray-600">{vehicleName} ({invoice.vehicles?.reg})</p>
                      </div>
                    </td>
                    <td className="p-3 text-sm text-right font-medium">{formatCurrency(invoice.subtotal)}</td>
                  </tr>
                  {invoice.tax_amount > 0 && (
                    <tr className="border-b border-gray-300">
                      <td className="p-3 text-sm">Tax</td>
                      <td className="p-3 text-sm text-right">{formatCurrency(invoice.tax_amount)}</td>
                    </tr>
                  )}
                  <tr className="bg-gray-100">
                    <td className="p-3 text-sm font-bold">Total</td>
                    <td className="p-3 text-lg font-bold text-right" style={{ color: accentColor }}>
                      {formatCurrency(invoice.total_amount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {invoice.notes && (
              <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 mb-6">
                <h3 className="font-semibold mb-2 text-sm">Notes:</h3>
                <p className="text-sm text-gray-600">{invoice.notes}</p>
              </div>
            )}
            <div className="text-center text-sm text-gray-600 border-t border-gray-300 pt-4">
              <p>Thank you for your business!</p>
              <p className="text-xs mt-1">This is a computer-generated invoice.</p>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Send Invoice Email
            </DialogTitle>
          </DialogHeader>

          {!hasEmail && (
            <Alert className="border-destructive/50 bg-destructive/10">
              <AlertDescription className="text-destructive">
                <strong>Warning:</strong> No email address on file for this customer.
                Please add an email address before sending.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-6">
            {/* Company Header */}
            <div className="border-b pb-6">
              {logoUrl ? (
                <img src={logoUrl} alt={companyName} className="h-12 object-contain" />
              ) : (
                <h1 className="text-3xl font-bold text-primary">{companyName}</h1>
              )}
            </div>

            {/* Invoice Details */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-2">Bill To:</h3>
                <div className="text-sm space-y-1">
                  <p className="font-medium">{invoice.customers?.name}</p>
                  {invoice.customers?.email && <p>{invoice.customers.email}</p>}
                  {invoice.customers?.phone && <p>{invoice.customers.phone}</p>}
                </div>
              </div>
              <div className="text-right">
                <h3 className="font-semibold mb-2">Invoice Details:</h3>
                <div className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Invoice #:</span> <strong>{invoice.invoice_number}</strong></p>
                  <p><span className="text-muted-foreground">Date:</span> {format(new Date(invoice.invoice_date), 'PPP')}</p>
                  {invoice.due_date && (
                    <p><span className="text-muted-foreground">Due Date:</span> {format(new Date(invoice.due_date), 'PPP')}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Vehicle & Rental Info */}
            {invoice.vehicles && invoice.rentals && (
              <div className="border rounded-lg p-4 bg-muted/30">
                <h3 className="font-semibold mb-3">Rental Information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Vehicle:</p>
                    <p className="font-medium">{invoice.vehicles.make} {invoice.vehicles.model}</p>
                    <p className="text-muted-foreground text-xs">Reg: {invoice.vehicles.reg}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Rental Period:</p>
                    <p className="font-medium">
                      {format(new Date(invoice.rentals.start_date), 'PP')} - {format(new Date(invoice.rentals.end_date), 'PP')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Invoice Items */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-3 text-sm font-semibold">Description</th>
                    <th className="text-right p-3 text-sm font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="p-3 text-sm">
                      <div>
                        <p className="font-medium">Rental Fee</p>
                        <p className="text-xs text-muted-foreground">
                          {vehicleName} ({invoice.vehicles?.reg})
                        </p>
                      </div>
                    </td>
                    <td className="p-3 text-sm text-right font-medium">
                      {formatCurrency(invoice.subtotal)}
                    </td>
                  </tr>
                  {invoice.tax_amount > 0 && (
                    <tr className="border-b">
                      <td className="p-3 text-sm">Tax</td>
                      <td className="p-3 text-sm text-right">{formatCurrency(invoice.tax_amount)}</td>
                    </tr>
                  )}
                  <tr className="bg-muted/50">
                    <td className="p-3 text-sm font-bold">Total</td>
                    <td className="p-3 text-lg font-bold text-right text-primary">
                      {formatCurrency(invoice.total_amount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Notes */}
            {invoice.notes && (
              <div className="border rounded-lg p-4 bg-muted/30">
                <h3 className="font-semibold mb-2 text-sm">Notes:</h3>
                <p className="text-sm text-muted-foreground">{invoice.notes}</p>
              </div>
            )}

            {/* Footer */}
            <div className="text-center text-sm text-muted-foreground border-t pt-4">
              <p>Thank you for your business!</p>
              <p className="text-xs mt-1">This is a computer-generated invoice.</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={handlePrint}>
              <Download className="h-4 w-4 mr-2" />
              Print / Save PDF
            </Button>
            <Button
              onClick={() => sendEmailMutation.mutate()}
              disabled={sendEmailMutation.isPending || !hasEmail}
            >
              <Send className="h-4 w-4 mr-2" />
              {sendEmailMutation.isPending ? "Sending..." : "Send Email"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
