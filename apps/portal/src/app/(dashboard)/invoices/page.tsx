"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { FileText, Eye, MoreVertical, Trash2, Mail, Search, Calendar, X, Download } from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/invoice-utils";
import { InvoiceDialog } from "@/components/shared/dialogs/invoice-dialog";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { DeleteInvoiceDialog } from "@/components/invoices/delete-invoice-dialog";
import { SendInvoiceEmailDialog } from "@/components/invoices/send-invoice-email-dialog";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";

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

interface InvoiceFilters {
  search: string;
  status: string;
  dateFrom?: Date;
  dateTo?: Date;
}

const InvoicesList = () => {
  const { tenant } = useTenant();
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);
  const [selectedInvoiceForAction, setSelectedInvoiceForAction] = useState<Invoice | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // Filter state
  const [filters, setFilters] = useState<InvoiceFilters>({
    search: "",
    status: "all",
  });
  const [localSearch, setLocalSearch] = useState("");
  const [dateFromOpen, setDateFromOpen] = useState(false);
  const [dateToOpen, setDateToOpen] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== filters.search) {
        setFilters(prev => ({ ...prev, search: localSearch }));
        setCurrentPage(1);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [localSearch]);

  // Sync local search when filters change externally
  useEffect(() => {
    setLocalSearch(filters.search);
  }, [filters.search]);

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["invoices-list", tenant?.id],
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
    enabled: !!tenant?.id,
  });

  // Filtered invoices
  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];

    let result = [...invoices];

    // Search filter
    if (filters.search.trim()) {
      const search = filters.search.toLowerCase();
      result = result.filter(invoice =>
        invoice.invoice_number?.toLowerCase().includes(search) ||
        invoice.customers?.name?.toLowerCase().includes(search) ||
        invoice.vehicles?.reg?.toLowerCase().includes(search) ||
        invoice.vehicles?.make?.toLowerCase().includes(search) ||
        invoice.vehicles?.model?.toLowerCase().includes(search)
      );
    }

    // Status filter
    if (filters.status !== "all") {
      result = result.filter(invoice => invoice.status === filters.status);
    }

    // Date range filter
    if (filters.dateFrom) {
      result = result.filter(invoice =>
        new Date(invoice.invoice_date) >= filters.dateFrom!
      );
    }

    if (filters.dateTo) {
      result = result.filter(invoice =>
        new Date(invoice.invoice_date) <= filters.dateTo!
      );
    }

    return result;
  }, [invoices, filters]);

  // Pagination
  const totalInvoices = filteredInvoices.length;
  const totalPages = Math.ceil(totalInvoices / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalInvoices);
  const paginatedInvoices = filteredInvoices.slice(startIndex, endIndex);

  const updateFilter = (key: keyof InvoiceFilters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilters({
      search: "",
      status: "all",
    });
    setLocalSearch("");
    setCurrentPage(1);
  };

  // Helper to fix timezone issues with date picker
  const normalizeDate = (date: Date | undefined) => {
    if (!date) return undefined;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  };

  const hasActiveFilters = filters.search || filters.status !== "all" || filters.dateFrom || filters.dateTo;

  const handleViewInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setShowInvoiceDialog(true);
  };

  const handleExportCSV = () => {
    if (!filteredInvoices.length) return;

    const csvContent = [
      ["Invoice #", "Customer", "Vehicle", "Invoice Date", "Due Date", "Amount", "Status"].join(","),
      ...filteredInvoices.map((invoice) =>
        [
          invoice.invoice_number,
          invoice.customers?.name || "",
          `${invoice.vehicles?.reg || ""} (${invoice.vehicles?.make || ""} ${invoice.vehicles?.model || ""})`,
          invoice.invoice_date,
          invoice.due_date || "",
          invoice.total_amount,
          invoice.status || "",
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "invoices-export.csv";
    link.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Invoices</h1>
          <p className="text-sm sm:text-base text-muted-foreground">View and manage rental invoices</p>
        </div>
        <Button
          variant="outline"
          onClick={handleExportCSV}
          disabled={!filteredInvoices.length}
          className="border-primary/20 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200"
        >
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="space-y-4">
        {/* Search and main filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 min-w-[200px] sm:min-w-[300px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search by invoice #, customer, or vehicle..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <Select
            value={filters.status}
            onValueChange={(value) => updateFilter("status", value)}
          >
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="Paid">Paid</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Overdue">Overdue</SelectItem>
              <SelectItem value="Draft">Draft</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex gap-2 items-center">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Invoice Date:</span>

            <Popover open={dateFromOpen} onOpenChange={setDateFromOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[110px] justify-start text-left font-normal",
                    !filters.dateFrom && "text-muted-foreground"
                  )}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {filters.dateFrom ? format(filters.dateFrom, "MMM dd") : "From"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={filters.dateFrom}
                  onSelect={(date) => {
                    updateFilter("dateFrom", normalizeDate(date));
                    setDateFromOpen(false);
                  }}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>

            <Popover open={dateToOpen} onOpenChange={setDateToOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[110px] justify-start text-left font-normal",
                    !filters.dateTo && "text-muted-foreground"
                  )}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {filters.dateTo ? format(filters.dateTo, "MMM dd") : "To"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={filters.dateTo}
                  onSelect={(date) => {
                    updateFilter("dateTo", normalizeDate(date));
                    setDateToOpen(false);
                  }}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {hasActiveFilters && (
            <Button variant="outline" onClick={clearFilters} className="gap-2">
              <X className="h-4 w-4" />
              Clear Filters
            </Button>
          )}
        </div>
      </div>

      {/* Invoices Table */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading invoices...</div>
      ) : !filteredInvoices || filteredInvoices.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No invoices found"
          description={hasActiveFilters ? "Try adjusting your filters" : "Invoices will appear here when rentals are created"}
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
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
                    {paginatedInvoices.map((invoice) => (
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
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewInvoice(invoice)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedInvoiceForAction(invoice);
                                  setSendEmailDialogOpen(true);
                                }}
                              >
                                <Mail className="h-4 w-4 mr-2" />
                                Send Email
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                  setSelectedInvoiceForAction(invoice);
                                  setDeleteDialogOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                    ))}
                  </TableBody>
                </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {startIndex + 1}-{endIndex} of {totalInvoices} invoices
            </p>
            <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-center sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                Page {currentPage} of {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages || totalPages <= 1}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

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

      {/* Delete Invoice Dialog */}
      <DeleteInvoiceDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        invoice={selectedInvoiceForAction}
      />

      {/* Send Invoice Email Dialog */}
      <SendInvoiceEmailDialog
        open={sendEmailDialogOpen}
        onOpenChange={setSendEmailDialogOpen}
        invoice={selectedInvoiceForAction}
      />
    </div>
  );
};

export default InvoicesList;
