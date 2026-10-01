"use client";

/**
 * FORKED from `app/(dashboard)/invoices/page.tsx` for the Finances screen
 * (`/finances`, v2 area `finances`). The v1 page is untouched and still serves
 * `/invoices` for every tenant.
 *
 * The only structural difference: no page title and no page padding. The
 * Finances screen owns both, and this tab's header actions are portalled into
 * the Finances header line via `actionsSlot`.
 */
import { createPortal } from "react-dom";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
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
import { FileText, MoreVertical, Trash2, Mail, Search, Calendar, X, Download, Plus } from "lucide-react";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";
import { InvoiceDialog } from "@/components/shared/dialogs/invoice-dialog";
import { EmptyState } from "@/components/shared/data-display/empty-state";
import { DeleteInvoiceDialog } from "@/components/invoices/delete-invoice-dialog";
import { SendInvoiceEmailDialog } from "@/components/invoices/send-invoice-email-dialog";
import { useTenant } from "@/contexts/TenantContext";
import { useRouter } from "next/navigation";
import { useIsLean } from "@/lib/lean-context";
import { InvoicesTeachingEmptyState } from "@/components/empty-states/lean-empty-states";
import { useForcedEmptyState } from "@/hooks/use-forced-empty-state";
import { cn } from "@/lib/utils";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useV2 } from "@/lib/v2-context";
import { usePageSearch } from "@/components/shared/layout/page-search-slot";
import { InvoicePaymentsTable } from "./invoice-payments-table";
import { FinancesOverview } from "./finances-overview";
import { useFinanceIndex } from "./finance-data";
import { FINANCES_PREVIEW, usePreviewFinance } from "./finance-mock";
import { NewInvoiceDialog } from "./new-invoice-dialog";
import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2, HeaderIconButton } from "@/components/shared/header-icon-button-v2";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";

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

/** Placeholder invoices for the v2 skeleton: only their shapes are ever seen. */
const SKELETON_INVOICES = skeletonRows(8, (f) => ({
  id: f.id,
  rental_id: null,
  customer_id: null,
  vehicle_id: null,
  invoice_number: f.word(8, 11),
  invoice_type: "rental",
  invoice_date: f.date(),
  due_date: f.date(f.int(-20, 30)).slice(0, 10),
  status: "pending",
  entity_ref: f.word(5, 7),
  total_amount: f.money(80, 2400),
  customers: { name: f.text(2, 3) },
  vehicles: { reg: f.word(6, 8), make: f.word(4, 8), model: f.word(3, 7) },
})) as unknown as Invoice[];

interface InvoiceFilters {
  search: string;
  status: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export const InvoicesTab = ({
  actionsSlot,
  onEmptyChange,
}: {
  actionsSlot: HTMLElement | null;
  /** Tells Finances this tab is showing its empty state, so it can hide the tab strip. */
  onEmptyChange?: (empty: boolean) => void;
}) => {
  const { tenant, tenantSlug } = useTenant();
  const router = useRouter();
  const { canEdit } = useManagerPermissions();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sendEmailDialogOpen, setSendEmailDialogOpen] = useState(false);
  const [selectedInvoiceForAction, setSelectedInvoiceForAction] = useState<Invoice | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;
  const [activeTab, setActiveTab] = useState("invoices");
  // Record Payment lives here now that Finances has no Payments tab.
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const queryClient = useQueryClient();
  // Shared with the table (same query key), so this is one read, not two.
  // In preview the index is the mock one; the real read is switched off
  // (no tenant id → the query never runs).
  const liveIndex = useFinanceIndex(FINANCES_PREVIEW ? undefined : tenant?.id);
  // The preview store: re-renders when a preview action changes it.
  const preview = usePreviewFinance();
  const financeIndex = FINANCES_PREVIEW ? preview.index : liveIndex;

  // Filter state
  const [filters, setFilters] = useState<InvoiceFilters>({
    search: "",
    status: "all",
  });
  const [localSearch, setLocalSearch] = useState("");
  // v2 only: the Payment Requests tab's search, lifted from PaymentRequestsTab
  // so the top-bar field can drive it.
  const [requestsSearch, setRequestsSearch] = useState("");
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

  const { data: liveInvoices, isLoading: liveLoading } = useQuery({
    queryKey: ["invoices-list", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];

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
        .eq('tenant_id', tenant.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as any as Invoice[];
    },
    enabled: !!tenant?.id && !FINANCES_PREVIEW,
  });
  // Preview: the ideal-model mock (finance-mock.ts) instead of the database.
  const isLoading = useSkeletonLoading(FINANCES_PREVIEW ? false : liveLoading);
  // While the invoices load, the tab renders these placeholder invoices through
  // its real hero row and table, and <AutoSkeleton> turns that into the skeleton.
  const invoices = isLoading
    ? SKELETON_INVOICES
    : FINANCES_PREVIEW
      ? (preview.invoices as unknown as typeof liveInvoices)
      : liveInvoices;

  // `invoices`, the raw query result — not `filteredInvoices`, which a search
  // or a status chip can empty for an operator with a full book. Lean canary
  // only; everyone else keeps the existing EmptyState.
  //
  // `devForceEmpty` is the /dev preview switch (lib/dev-overrides.ts): inert
  // outside development, and INSIDE the slug gate so it reaches nobody else.
  const devForceEmpty = useForcedEmptyState("invoices");
  const isLean = useIsLean();
  // Never while loading: the placeholder rows must not report "empty" upward.
  const teachEmptyInvoices = !FINANCES_PREVIEW && !isLoading && isLean && (!invoices?.length || devForceEmpty);
  useEffect(() => {
    onEmptyChange?.(teachEmptyInvoices);
  }, [teachEmptyInvoices, onEmptyChange]);

  // v2 (northwind) swaps only the populated table for the rentals list's table,
  // with no pager. Loading, teaching and "no results" states stay shared.
  const v2Chrome = useV2("chrome");

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
        parseLocalDate(invoice.invoice_date) >= filters.dateFrom!
      );
    }

    if (filters.dateTo) {
      result = result.filter(invoice =>
        parseLocalDate(invoice.invoice_date) <= filters.dateTo!
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

  /* v2: the search lives in the top bar (page-search-slot.tsx) and follows the
     open tab; the Payment Requests tab's filter is lifted up here for it. */
  usePageSearch(
    // The teaching empty state (lean, no invoices yet) has no search to offer.
    !v2Chrome || (teachEmptyInvoices && activeTab === "invoices")
      ? null
      : activeTab === "requests"
        ? {
            placeholder: "Search by customer or type…",
            value: requestsSearch,
            onChange: setRequestsSearch,
            scopeLabel: "Payment requests",
          }
        : {
            placeholder: "Search by invoice #, customer, or vehicle…",
            value: localSearch,
            onChange: setLocalSearch,
            scopeLabel: "Invoices",
            resultCount: isLoading || filters.search !== localSearch ? undefined : filteredInvoices.length,
          },
  );

  const hasActiveFilters = filters.search || filters.status !== "all" || filters.dateFrom || filters.dateTo;

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
    <div className="space-y-6">
      {/* Header actions — rendered on the Finances header line. */}
      {actionsSlot && createPortal(
        <>
          {activeTab === "invoices" && !teachEmptyInvoices && (
            v2Chrome ? (
              <HeaderIconButton label="Export CSV" onClick={handleExportCSV} disabled={isLoading || !filteredInvoices.length}>
                <Download className="h-4 w-4" />
              </HeaderIconButton>
            ) : (
            <Button
              variant="outline"
              size="icon"
              onClick={handleExportCSV}
              disabled={!filteredInvoices.length}
              className="shrink-0"
            >
              <Download className="h-4 w-4" />
            </Button>
            )
          )}
          <AddPaymentDialog
            open={showAddPayment}
            onOpenChange={(open) => {
              setShowAddPayment(open);
              // The invoice rows' payments are read under their own key.
              if (!open) queryClient.invalidateQueries({ queryKey: ["finances-invoice-payments", tenant?.id] });
            }}
          />
          {/* New invoice (preview): Finances creates BILLS; payments are taken
              on a line's "+ Add payment". Outside the preview, Record Payment
              stays until the flow is real. */}
          {FINANCES_PREVIEW && canEdit('invoices') && (
            <>
              <NewInvoiceDialog
                open={showNewInvoice}
                onOpenChange={setShowNewInvoice}
                currencyCode={tenant?.currency_code || 'USD'}
              />
              <Button onClick={() => setShowNewInvoice(true)} className={`bg-gradient-primary flex-1 sm:flex-none ${HEADER_PRIMARY_V2}`}>
                <Plus className="h-4 w-4 mr-2" />
                New invoice
              </Button>
            </>
          )}
          {!FINANCES_PREVIEW && canEdit('payments') && (
            <Button onClick={() => setShowAddPayment(true)} className={`bg-gradient-primary flex-1 sm:flex-none ${HEADER_PRIMARY_V2}`}>
              <Plus className="h-4 w-4 mr-2" />
              Record Payment
            </Button>
          )}
        </>,
        actionsSlot,
      )}

      {/* Finances shows the invoice list alone: no Invoices / Payment Requests
          strip and no filter row. Payment Requests is still on /invoices. */}
      <AutoSkeleton loading={isLoading} className="space-y-4">
      {/* The hero row — one graph and the Auto-charge card, as on Customers
          and Vehicles. Over exactly the invoices the table lists. */}
      {!teachEmptyInvoices && filteredInvoices.length > 0 && (
        <FinancesOverview
          invoices={filteredInvoices}
          index={financeIndex}
          currencyCode={tenant?.currency_code || 'USD'}
        />
      )}

      {/* Invoices Table */}
      {!filteredInvoices || filteredInvoices.length === 0 || teachEmptyInvoices ? (
        teachEmptyInvoices ? (
          <InvoicesTeachingEmptyState onCreateRental={() => router.push("/rentals/new")} />
        ) : (
        <EmptyState
          icon={FileText}
          title="No invoices found"
          description={hasActiveFilters ? "Try adjusting your filters" : "Invoices will appear here when rentals are created"}
        />
        )
      ) : (
        v2Chrome ? (
          // v2: the rentals list's table (components/shared/list-table-v2). No
          // pager, rows arrive as it scrolls. Rows open nothing, as in v1; the
          // actions menu is the same menu with the same handlers.
          <InvoicePaymentsTable
            invoices={filteredInvoices}
            resetKey={`${tenant?.id ?? ""}|${filters.search}|${filters.status}|${filters.dateFrom?.toISOString() ?? ""}|${filters.dateTo?.toISOString() ?? ""}`}
            currencyCode={tenant?.currency_code || 'USD'}
            canEdit={canEdit}
            onSendEmail={(invoice) => {
              setSelectedInvoiceForAction(invoice);
              setSendEmailDialogOpen(true);
            }}
            onDelete={(invoice) => {
              setSelectedInvoiceForAction(invoice);
              setDeleteDialogOpen(true);
            }}
          />
        ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[calc(100vh-340px)] min-h-[300px] overflow-auto relative">
              <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
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
                      <TableCell>{format(parseLocalDate(invoice.invoice_date), "PP")}</TableCell>
                      <TableCell>
                        {invoice.due_date ? format(parseLocalDate(invoice.due_date), "PP") : "—"}
                      </TableCell>
                      <TableCell className="text-left font-medium">
                        {formatCurrency(invoice.total_amount, tenant?.currency_code || 'USD')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canEdit('invoices') && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setSelectedInvoiceForAction(invoice);
                                    setSendEmailDialogOpen(true);
                                  }}
                                >
                                  <Mail className="h-4 w-4 mr-2" />
                                  Send Email
                                </DropdownMenuItem>
                              )}
                              {canEdit('invoices') && (
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
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
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
        )
      )}
      </AutoSkeleton>

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

