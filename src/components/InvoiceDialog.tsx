import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";
import { format } from "date-fns";
import { useRef } from "react";
import { useReactToPrint } from "react-to-print";

interface InvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    invoice_number: string;
    invoice_date: string;
    due_date?: string;
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    notes?: string;
  };
  customer: {
    name: string;
    email?: string;
    phone?: string;
  };
  vehicle: {
    reg: string;
    make?: string;
    model?: string;
  };
  rental: {
    start_date: string;
    end_date: string;
    monthly_amount: number;
  };
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

// Separate printable component
const PrintableInvoice = ({ invoice, customer, vehicle, rental }: Omit<InvoiceDialogProps, "open" | "onOpenChange">) => {
  const vehicleName = vehicle.make && vehicle.model ? `${vehicle.make} ${vehicle.model}` : vehicle.reg;

  return (
    <div className="p-8 bg-white text-black">
      {/* Company Header */}
      <div className="border-b border-gray-300 pb-6 mb-6">
        <h1 className="text-3xl font-bold" style={{ color: '#06b6d4' }}>DRIVE 917</h1>
        <p className="text-sm text-gray-600 mt-2">Luxury Vehicle Rental Services</p>
      </div>

      {/* Invoice Details */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="font-semibold mb-2">Bill To:</h3>
          <div className="text-sm space-y-1">
            <p className="font-medium">{customer.name}</p>
            {customer.email && <p>{customer.email}</p>}
            {customer.phone && <p>{customer.phone}</p>}
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

      {/* Vehicle & Rental Info */}
      <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 mb-6">
        <h3 className="font-semibold mb-3">Rental Information</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-600">Vehicle:</p>
            <p className="font-medium">{vehicleName}</p>
            <p className="text-gray-500 text-xs">Reg: {vehicle.reg}</p>
          </div>
          <div>
            <p className="text-gray-600">Rental Period:</p>
            <p className="font-medium">
              {format(new Date(rental.start_date), 'PP')} - {format(new Date(rental.end_date), 'PP')}
            </p>
          </div>
        </div>
      </div>

      {/* Invoice Items */}
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
                  <p className="text-xs text-gray-600">
                    {vehicleName} ({vehicle.reg})
                  </p>
                </div>
              </td>
              <td className="p-3 text-sm text-right font-medium">
                {formatCurrency(invoice.subtotal)}
              </td>
            </tr>
            {invoice.tax_amount > 0 && (
              <tr className="border-b border-gray-300">
                <td className="p-3 text-sm">Taxes & Fees</td>
                <td className="p-3 text-sm text-right">{formatCurrency(invoice.tax_amount)}</td>
              </tr>
            )}
            <tr className="bg-gray-100">
              <td className="p-3 text-sm font-bold">Total</td>
              <td className="p-3 text-lg font-bold text-right" style={{ color: '#06b6d4' }}>
                {formatCurrency(invoice.total_amount)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 mb-6">
          <h3 className="font-semibold mb-2 text-sm">Notes:</h3>
          <p className="text-sm text-gray-600">{invoice.notes}</p>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-sm text-gray-600 border-t border-gray-300 pt-4">
        <p>Thank you for your business!</p>
        <p className="text-xs mt-1">This is a computer-generated invoice.</p>
      </div>
    </div>
  );
};

export const InvoiceDialog = ({
  open,
  onOpenChange,
  invoice,
  customer,
  vehicle,
  rental,
}: InvoiceDialogProps) => {
  const printRef = useRef<HTMLDivElement>(null);
  const vehicleName = vehicle.make && vehicle.model ? `${vehicle.make} ${vehicle.model}` : vehicle.reg;

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Invoice-${invoice.invoice_number}`,
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

  return (
    <>
      {/* Hidden printable component */}
      <div style={{ display: 'none' }}>
        <div ref={printRef}>
          <PrintableInvoice
            invoice={invoice}
            customer={customer}
            vehicle={vehicle}
            rental={rental}
          />
        </div>
      </div>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-accent" />
                Invoice
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="space-y-6">
            {/* Company Header */}
            <div className="border-b pb-6">
              <h1 className="text-3xl font-bold text-accent">DRIVE 917</h1>
              <p className="text-sm text-muted-foreground mt-2">Luxury Vehicle Rental Services</p>
            </div>

            {/* Invoice Details */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold mb-2">Bill To:</h3>
                <div className="text-sm space-y-1">
                  <p className="font-medium">{customer.name}</p>
                  {customer.email && <p>{customer.email}</p>}
                  {customer.phone && <p>{customer.phone}</p>}
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
            <div className="border rounded-lg p-4 bg-muted/30">
              <h3 className="font-semibold mb-3">Rental Information</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Vehicle:</p>
                  <p className="font-medium">{vehicleName}</p>
                  <p className="text-muted-foreground text-xs">Reg: {vehicle.reg}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Rental Period:</p>
                  <p className="font-medium">
                    {format(new Date(rental.start_date), 'PP')} - {format(new Date(rental.end_date), 'PP')}
                  </p>
                </div>
              </div>
            </div>

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
                          {vehicleName} ({vehicle.reg})
                        </p>
                      </div>
                    </td>
                    <td className="p-3 text-sm text-right font-medium">
                      {formatCurrency(invoice.subtotal)}
                    </td>
                  </tr>
                  {invoice.tax_amount > 0 && (
                    <tr className="border-b">
                      <td className="p-3 text-sm">Taxes & Fees</td>
                      <td className="p-3 text-sm text-right">{formatCurrency(invoice.tax_amount)}</td>
                    </tr>
                  )}
                  <tr className="bg-muted/50">
                    <td className="p-3 text-sm font-bold">Total</td>
                    <td className="p-3 text-lg font-bold text-right text-accent">
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
              Close
            </Button>
            <Button onClick={handlePrint} className="gradient-accent">
              <Download className="h-4 w-4 mr-2" />
              Print / Save PDF
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
