"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, ArrowUpRight, Search, CalendarIcon, X } from "lucide-react";
import { format, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
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
    rental_number: string;
    start_date: string;
    end_date: string;
    monthly_amount: number;
  };
}

const InvoicesList = () => {
  const router = useRouter();
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

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
            rental_number,
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

  // Filter invoices based on search and date
  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];

    return invoices.filter((invoice) => {
      // Search filter
      if (search.trim()) {
        const searchLower = search.toLowerCase();
        const matchesSearch =
          invoice.invoice_number?.toLowerCase().includes(searchLower) ||
          invoice.customers?.name?.toLowerCase().includes(searchLower) ||
          invoice.rentals?.rental_number?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Date filter
      const invoiceDate = new Date(invoice.invoice_date);
      if (dateFrom && isBefore(invoiceDate, startOfDay(dateFrom))) return false;
      if (dateTo && isAfter(invoiceDate, endOfDay(dateTo))) return false;

      return true;
    });
  }, [invoices, search, dateFrom, dateTo]);

  const clearFilters = () => {
    setSearch("");
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const hasActiveFilters = search || dateFrom || dateTo;

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

      {/* Search Filter */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[250px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search by invoice #, customer, or rental..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "justify-start text-left font-normal",
                !dateFrom && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "From"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateFrom}
              onSelect={setDateFrom}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "justify-start text-left font-normal",
                !dateTo && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateTo ? format(dateTo, "dd/MM/yyyy") : "To"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateTo}
              onSelect={setDateTo}
              initialFocus
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>

        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1">
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
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
          ) : !filteredInvoices || filteredInvoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No invoices found"
              description={search ? "No invoices match your search" : "Invoices will appear here when rentals are created"}
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Rental</TableHead>
                    <TableHead>Invoice Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-left">Amount</TableHead>
                    <TableHead className="text-right">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                      <TableCell className="max-w-[150px]">
                        <button
                          onClick={() => router.push(`/customers/${invoice.customer_id}`)}
                          className="text-foreground hover:underline hover:opacity-80 font-medium truncate block max-w-full text-left"
                          title={invoice.customers?.name}
                        >
                          {(invoice.customers?.name?.length || 0) > 20
                            ? invoice.customers?.name?.slice(0, 20) + "..."
                            : invoice.customers?.name || "—"}
                        </button>
                      </TableCell>
                      <TableCell>
                        {invoice.rentals?.rental_number ? (
                          <button
                            onClick={() => router.push(`/rentals/${invoice.rental_id}`)}
                            className="text-foreground hover:underline hover:opacity-80"
                          >
                            {invoice.rentals.rental_number}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{format(new Date(invoice.invoice_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>
                        {invoice.due_date ? format(new Date(invoice.due_date), "dd/MM/yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-left font-medium">
                        {formatCurrency(invoice.total_amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewInvoice(invoice)}
                        >
                          <ArrowUpRight className="h-4 w-4" />
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
