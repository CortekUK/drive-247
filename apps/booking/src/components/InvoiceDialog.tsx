import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Download, Shield, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { useRef } from "react";
import { useReactToPrint } from "react-to-print";
import { useTenant } from "@/contexts/TenantContext";

interface InvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignAgreement?: () => void;
  invoice: {
    invoice_number: string;
    invoice_date: string;
    due_date?: string;
    subtotal: number;
    tax_amount: number;
    service_fee?: number;
    security_deposit?: number;
    insurance_premium?: number;
    delivery_fee?: number;
    extras_total?: number;
    total_amount: number;
    notes?: string;
    discount_amount?: number;
    promo_code?: string;
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
  // Enquiry-based booking props
  isEnquiry?: boolean;
  payableAmount?: number;
  // Promo details for display
  promoDetails?: {
    code: string;
    type: "percentage" | "fixed_amount";
    value: number;
  } | null;
  // Selected extras for invoice line items
  selectedExtras?: { name: string; quantity: number; price: number }[];
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

// Separate printable component
const PrintableInvoice = ({ invoice, customer, vehicle, rental, promoDetails, selectedExtras, companyName, logoUrl, accentColor }: Omit<InvoiceDialogProps, "open" | "onOpenChange"> & { companyName: string; logoUrl?: string | null; accentColor: string }) => {
  const vehicleName = vehicle.make && vehicle.model ? `${vehicle.make} ${vehicle.model}` : vehicle.reg;
  // If there's a discount, subtotal is the discounted amount, so we need to calculate original
  const discountAmount = invoice.discount_amount || 0;
  const originalRentalFee = invoice.subtotal + discountAmount;
  const rentalFee = invoice.subtotal;

  return (
    <div className="p-8 bg-white text-black">
      {/* Company Header */}
      <div className="border-b border-gray-300 pb-6 mb-6">
        {logoUrl ? (
          <img src={logoUrl} alt={companyName} style={{ height: '48px', objectFit: 'contain' }} />
        ) : (
          <h1 className="text-3xl font-bold" style={{ color: accentColor }}>{companyName}</h1>
        )}
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
                {discountAmount > 0 ? (
                  <span style={{ textDecoration: 'line-through', color: '#9ca3af' }}>
                    {formatCurrency(originalRentalFee)}
                  </span>
                ) : (
                  formatCurrency(rentalFee)
                )}
              </td>
            </tr>
            {/* Promo Discount Line */}
            {discountAmount > 0 && promoDetails && (
              <tr className="border-b border-gray-300" style={{ backgroundColor: '#f0fdf4' }}>
                <td className="p-3 text-sm">
                  <div>
                    <p className="font-medium" style={{ color: '#16a34a' }}>Promo Discount</p>
                    <p className="text-xs" style={{ color: '#22c55e' }}>
                      Code: {promoDetails.code} ({promoDetails.type === 'percentage' ? `${promoDetails.value}%` : formatCurrency(promoDetails.value)} off)
                    </p>
                  </div>
                </td>
                <td className="p-3 text-sm text-right font-medium" style={{ color: '#16a34a' }}>
                  -{formatCurrency(discountAmount)}
                </td>
              </tr>
            )}
            {/* Discounted Subtotal */}
            {discountAmount > 0 && (
              <tr className="border-b border-gray-300">
                <td className="p-3 text-sm font-medium">Subtotal (after discount)</td>
                <td className="p-3 text-sm text-right font-medium">{formatCurrency(rentalFee)}</td>
              </tr>
            )}
            {/* Extras */}
            {selectedExtras && selectedExtras.map((extra, i) => (
              <tr key={i} className="border-b border-gray-300">
                <td className="p-3 text-sm">
                  {extra.name}{extra.quantity > 1 ? ` x${extra.quantity}` : ''}
                </td>
                <td className="p-3 text-sm text-right">{formatCurrency(extra.price * extra.quantity)}</td>
              </tr>
            ))}
            {!selectedExtras && (invoice.extras_total ?? 0) > 0 && (
              <tr className="border-b border-gray-300">
                <td className="p-3 text-sm">Rental Extras</td>
                <td className="p-3 text-sm text-right">{formatCurrency(invoice.extras_total ?? 0)}</td>
              </tr>
            )}
            {(invoice.delivery_fee ?? 0) > 0 && (
              <tr className="border-b border-gray-300">
                <td className="p-3 text-sm">Delivery Fee</td>
                <td className="p-3 text-sm text-right">{formatCurrency(invoice.delivery_fee ?? 0)}</td>
              </tr>
            )}
            {(invoice.insurance_premium ?? 0) > 0 && (
              <tr className="border-b border-gray-300">
                <td className="p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span style={{ color: '#C5A572' }}>🛡</span>
                    <p className="font-medium">Bonzah Insurance</p>
                  </div>
                </td>
                <td className="p-3 text-sm text-right font-medium">{formatCurrency(invoice.insurance_premium ?? 0)}</td>
              </tr>
            )}
            {invoice.tax_amount > 0 && (
              <tr className="border-b border-gray-300">
                <td className="p-3 text-sm">Tax</td>
                <td className="p-3 text-sm text-right">{formatCurrency(invoice.tax_amount)}</td>
              </tr>
            )}
            {(invoice.service_fee ?? 0) > 0 && (
              <tr className="border-b border-gray-300">
                <td className="p-3 text-sm">Service Fee</td>
                <td className="p-3 text-sm text-right">{formatCurrency(invoice.service_fee ?? 0)}</td>
              </tr>
            )}
            {(invoice.security_deposit ?? 0) > 0 && (
              <tr className="border-b border-gray-300">
                <td className="p-3 text-sm">Security Deposit</td>
                <td className="p-3 text-sm text-right">{formatCurrency(invoice.security_deposit ?? 0)}</td>
              </tr>
            )}
            <tr className="bg-gray-100">
              <td className="p-3 text-sm font-bold">Total</td>
              <td className="p-3 text-lg font-bold text-right" style={{ color: discountAmount > 0 ? '#16a34a' : accentColor }}>
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
  onSignAgreement,
  invoice,
  customer,
  vehicle,
  rental,
  isEnquiry = false,
  payableAmount,
  promoDetails,
  selectedExtras,
}: InvoiceDialogProps) => {
  const { tenant } = useTenant();
  const companyName = tenant?.app_name || tenant?.company_name || 'Invoice';
  const logoUrl = tenant?.logo_url;
  const accentColor = tenant?.accent_color || '#06b6d4';
  const printRef = useRef<HTMLDivElement>(null);
  const vehicleName = vehicle.make && vehicle.model ? `${vehicle.make} ${vehicle.model}` : vehicle.reg;
  // If there's a discount, subtotal is the discounted amount, so we need to calculate original
  const discountAmount = invoice.discount_amount || 0;
  const originalRentalFee = invoice.subtotal + discountAmount;
  const rentalFee = invoice.subtotal;
  // For enquiry tenants, display the payable amount (deposit only or $0)
  const displayTotal = isEnquiry && payableAmount !== undefined ? payableAmount : invoice.total_amount;

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
            promoDetails={promoDetails}
            selectedExtras={selectedExtras}
            companyName={companyName}
            logoUrl={logoUrl}
            accentColor={accentColor}
          />
        </div>
      </div>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
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
              {logoUrl ? (
                <img src={logoUrl} alt={companyName} className="h-12 object-contain" />
              ) : (
                <h1 className="text-3xl font-bold text-accent">{companyName}</h1>
              )}
            </div>

            {/* Invoice Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <div>
                <h3 className="font-semibold mb-2">Bill To:</h3>
                <div className="text-sm space-y-1">
                  <p className="font-medium">{customer.name}</p>
                  {customer.email && <p>{customer.email}</p>}
                  {customer.phone && <p>{customer.phone}</p>}
                </div>
              </div>
              <div className="sm:text-right">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
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
                  {/* For enquiry tenants, show rental fee as TBD */}
                  {isEnquiry ? (
                    <tr className="border-b">
                      <td className="p-3 text-sm">
                        <div>
                          <p className="font-medium">Rental Fee</p>
                          <p className="text-xs text-muted-foreground">
                            {vehicleName} ({vehicle.reg})
                          </p>
                        </div>
                      </td>
                      <td className="p-3 text-sm text-right font-medium text-muted-foreground italic">
                        To be confirmed
                      </td>
                    </tr>
                  ) : (
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
                        {discountAmount > 0 ? (
                          <span className="line-through text-muted-foreground">
                            {formatCurrency(originalRentalFee)}
                          </span>
                        ) : (
                          formatCurrency(rentalFee)
                        )}
                      </td>
                    </tr>
                  )}
                  {/* Promo Discount Line */}
                  {!isEnquiry && discountAmount > 0 && promoDetails && (
                    <tr className="border-b bg-green-50 dark:bg-green-950/30">
                      <td className="p-3 text-sm">
                        <div>
                          <p className="font-medium text-green-600 dark:text-green-400">Promo Discount</p>
                          <p className="text-xs text-green-500 dark:text-green-500">
                            Code: {promoDetails.code} ({promoDetails.type === 'percentage' ? `${promoDetails.value}%` : formatCurrency(promoDetails.value)} off)
                          </p>
                        </div>
                      </td>
                      <td className="p-3 text-sm text-right font-medium text-green-600 dark:text-green-400">
                        -{formatCurrency(discountAmount)}
                      </td>
                    </tr>
                  )}
                  {/* Discounted Subtotal */}
                  {!isEnquiry && discountAmount > 0 && (
                    <tr className="border-b">
                      <td className="p-3 text-sm font-medium">Subtotal (after discount)</td>
                      <td className="p-3 text-sm text-right font-medium">{formatCurrency(rentalFee)}</td>
                    </tr>
                  )}
                  {/* Extras */}
                  {selectedExtras && selectedExtras.map((extra, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-3 text-sm">
                        {extra.name}{extra.quantity > 1 ? ` x${extra.quantity}` : ''}
                      </td>
                      <td className="p-3 text-sm text-right">{formatCurrency(extra.price * extra.quantity)}</td>
                    </tr>
                  ))}
                  {!selectedExtras && (invoice.extras_total ?? 0) > 0 && (
                    <tr className="border-b">
                      <td className="p-3 text-sm">Rental Extras</td>
                      <td className="p-3 text-sm text-right">{formatCurrency(invoice.extras_total ?? 0)}</td>
                    </tr>
                  )}
                  {(invoice.delivery_fee ?? 0) > 0 && (
                    <tr className="border-b">
                      <td className="p-3 text-sm">Delivery Fee</td>
                      <td className="p-3 text-sm text-right">{formatCurrency(invoice.delivery_fee ?? 0)}</td>
                    </tr>
                  )}
                  {(invoice.insurance_premium ?? 0) > 0 && (
                    <tr className="border-b">
                      <td className="p-3 text-sm">
                        <div className="flex items-start gap-2">
                          <Shield className="w-4 h-4 text-[#C5A572] mt-0.5" />
                          <p className="font-medium">Bonzah Insurance</p>
                        </div>
                      </td>
                      <td className="p-3 text-sm text-right font-medium">{formatCurrency(invoice.insurance_premium ?? 0)}</td>
                    </tr>
                  )}
                  {/* Hide tax and service fee for enquiry tenants */}
                  {!isEnquiry && invoice.tax_amount > 0 && (
                    <tr className="border-b">
                      <td className="p-3 text-sm">Tax</td>
                      <td className="p-3 text-sm text-right">{formatCurrency(invoice.tax_amount)}</td>
                    </tr>
                  )}
                  {!isEnquiry && (invoice.service_fee ?? 0) > 0 && (
                    <tr className="border-b">
                      <td className="p-3 text-sm">Service Fee</td>
                      <td className="p-3 text-sm text-right">{formatCurrency(invoice.service_fee ?? 0)}</td>
                    </tr>
                  )}
                  {/* Security deposit shown for both */}
                  {(invoice.security_deposit ?? 0) > 0 && (
                    <tr className="border-b">
                      <td className="p-3 text-sm">Security Deposit</td>
                      <td className="p-3 text-sm text-right">{formatCurrency(invoice.security_deposit ?? 0)}</td>
                    </tr>
                  )}
                  <tr className="bg-muted/50">
                    <td className="p-3 text-sm font-bold">
                      {isEnquiry ? 'Total Due Now' : 'Total'}
                    </td>
                    <td className={`p-3 text-lg font-bold text-right ${!isEnquiry && discountAmount > 0 ? 'text-green-600 dark:text-green-400' : 'text-accent'}`}>
                      {formatCurrency(displayTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Enquiry booking note */}
            {isEnquiry && (
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                  ENQUIRY BOOKING
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  Rental charges will be confirmed after your booking is approved.
                </p>
              </div>
            )}

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
          <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-stretch sm:items-center gap-3 border-t pt-4">
            <Button variant="outline" onClick={handlePrint} className="w-full sm:w-auto">
              <Download className="h-4 w-4 mr-2" />
              Print / Save PDF
            </Button>
            <Button
              onClick={() => {
                onOpenChange(false);
                if (onSignAgreement) {
                  onSignAgreement();
                }
              }}
              className="gradient-accent w-full sm:w-auto"
            >
              {isEnquiry && displayTotal === 0 ? (
                <>
                  Continue to Submit Enquiry
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              ) : (
                <>
                  Continue to Sign Agreement
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
