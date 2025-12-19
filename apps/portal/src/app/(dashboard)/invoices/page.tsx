"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Eye } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/invoice-utils";
import { InvoiceDialog } from "@/components/shared/dialogs/invoice-dialog";
import { EmptyState } from "@/components/shared/data-display/empty-state";

interface Invoice {
  id: string;
  rental_id: string;
  customer_id: string;
  vehicle_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  subtotal: number;
  rental_fee?: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  notes: string;
  created_at: string;
  customers: {
    name: string;
    email?: string;
    phone?: string;
  };
  vehicles: {
    reg: string;
    make: string;
    model: string;
  };
  rentals: {
    start_date: string;
    end_date: string;
    monthly_amount: number;
  };
}

const InvoicesList = () => {
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  console.log("selectedInvoice", selectedInvoice);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["invoices-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices" as any)
        .select(`
          *,
          customers:customer_id (name, email, phone),
          vehicles:vehicle_id (reg, make, model),
          rentals:rental_id (
            start_date,
            end_date,
            monthly_amount
          )
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as any as Invoice[];
    },
  });

  const handleViewInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setShowInvoiceDialog(true);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Invoices</h1>
          <p className="text-muted-foreground">View and manage rental invoices</p>
        </div>
      </div>

      {/* Invoices Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            All Invoices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading invoices...</div>
          ) : !invoices || invoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No invoices found"
              description="Invoices will appear here when rentals are created"
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Invoice Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-left">Amount</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                      <TableCell>{invoice.customers?.name || "—"}</TableCell>
                      <TableCell>
                        {invoice.vehicles?.reg || "—"}
                        <span className="text-xs text-muted-foreground block">
                          {invoice.vehicles?.make} {invoice.vehicles?.model}
                        </span>
                      </TableCell>
                      <TableCell>{format(new Date(invoice.invoice_date), "PP")}</TableCell>
                      <TableCell>
                        {invoice.due_date ? format(new Date(invoice.due_date), "PP") : "—"}
                      </TableCell>
                      <TableCell className="text-left font-medium">
                        {formatCurrency(invoice.total_amount)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewInvoice(invoice)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoice Dialog */}
      {selectedInvoice && (
        <InvoiceDialog
          open={showInvoiceDialog}
          onOpenChange={setShowInvoiceDialog}
          invoice={{
            invoice_number: selectedInvoice.invoice_number,
            invoice_date: selectedInvoice.invoice_date,
            due_date: selectedInvoice.due_date,
            subtotal: selectedInvoice.subtotal,
            tax_amount: selectedInvoice.tax_amount,
            total_amount: selectedInvoice.total_amount,
            notes: selectedInvoice.notes,
          }}
          customer={{
            name: selectedInvoice.customers?.name || "",
            email: selectedInvoice.customers?.email,
            phone: selectedInvoice.customers?.phone,
          }}
          vehicle={{
            reg: selectedInvoice.vehicles?.reg || "",
            make: selectedInvoice.vehicles?.make || "",
            model: selectedInvoice.vehicles?.model || "",
          }}
          rental={{
            start_date: selectedInvoice.rentals?.start_date || "",
            end_date: selectedInvoice.rentals?.end_date || "",
            monthly_amount: selectedInvoice.rentals?.monthly_amount || 0,
          }}
        />
      )}
    </div>
  );
};

export default InvoicesList;
