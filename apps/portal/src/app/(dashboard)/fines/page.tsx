"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertTriangle, Plus, Eye, MoreVertical, DollarSign, Ban, ArrowUpDown, BarChart3, Undo2 } from "lucide-react";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { RefundDialog } from "@/components/shared/dialogs/refund-dialog";
import { FineStatusBadge } from "@/components/shared/status/fine-status-badge";
import { FineKPIs } from "@/components/fines/fine-kpis";
import { FineFilters, FineFilterState } from "@/components/fines/fine-filters";
import { BulkActionBar } from "@/components/fines/bulk-action-bar";
import { useFinesData, EnhancedFine } from "@/hooks/use-fines-data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import AddFineDialog from "@/components/fines/add-fine-dialog";

const FinesList = () => {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { logAction } = useAuditLog();
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const [showAddFineDialog, setShowAddFineDialog] = useState(false);
  const [paymentFine, setPaymentFine] = useState<EnhancedFine | null>(null);
  const [refundFine, setRefundFine] = useState<EnhancedFine | null>(null);

  // State for filtering, sorting, and selection
  const [filters, setFilters] = useState<FineFilterState>({
    status: [],
    vehicleSearch: '',
    customerSearch: '',
    search: '',
  });

  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  const [selectedFines, setSelectedFines] = useState<string[]>([]);

  // Fetch fines data with current filters
  const { data: finesData, isLoading, error } = useFinesData({
    filters,
    sortBy,
    sortOrder,
  });

  // All fines with pagination
  const allFines = finesData?.fines || [];
  const totalFines = allFines.length;
  const totalPages = Math.ceil(totalFines / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalFines);
  const filteredFines = allFines.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  const handleFiltersChange = (newFilters: FineFilterState) => {
    setFilters(newFilters);
    setCurrentPage(1);
  };

  // Get selected fine objects for bulk actions
  const selectedFineObjects = filteredFines.filter(fine => selectedFines.includes(fine.id));

  const waiveFineAction = useMutation({
    mutationFn: async (fineId: string) => {
      // Client-side: delete ledger entry for Open fines before calling edge function
      // (the deployed edge function only handles Charged fines' ledger cleanup)
      await supabase
        .from('ledger_entries')
        .delete()
        .eq('reference', `FINE-${fineId}`)
        .eq('type', 'Charge');

      const { data, error } = await supabase.functions.invoke('apply-fine', {
        body: { fineId, action: 'waive' }
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to waive fine');
      return { ...data, fineId };
    },
    onSuccess: (data) => {
      toast({ title: "Fine waived successfully" });
      queryClient.invalidateQueries({ queryKey: ["fines-enhanced"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance-status"] });
      queryClient.invalidateQueries({ queryKey: ["customer-fine-stats"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });

      // Audit log
      logAction({
        action: "fine_waived",
        entityType: "fine",
        entityId: data.fineId,
        details: { amount: data.amount }
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to waive fine",
        variant: "destructive",
      });
    },
  });

  // Ensure fine's ledger entry has rental_id before opening payment dialog
  const openPaymentDialog = async (fine: EnhancedFine) => {
    if (fine.rental_id) {
      // Ensure the ledger entry has the rental_id (may be missing for older fines)
      await supabase
        .from('ledger_entries')
        .update({ rental_id: fine.rental_id })
        .eq('reference', `FINE-${fine.id}`)
        .eq('type', 'Charge')
        .is('rental_id', null);
    }
    setPaymentFine(fine);
  };

  // After a payment is recorded, sync the fine status based on ledger entry remaining_amount
  const syncFineStatusAfterPayment = async (fine: EnhancedFine) => {
    try {
      // Check the ledger entry for this fine
      const { data: ledgerEntry } = await supabase
        .from('ledger_entries')
        .select('remaining_amount, amount')
        .eq('reference', `FINE-${fine.id}`)
        .eq('type', 'Charge')
        .maybeSingle();

      let newStatus: string | null = null;

      if (ledgerEntry) {
        if (ledgerEntry.remaining_amount <= 0) {
          newStatus = 'Paid';
        } else if (ledgerEntry.remaining_amount < ledgerEntry.amount) {
          newStatus = 'Charged';
        }
      } else {
        // No ledger entry found — fine was created before ledger integration
        // Mark as Paid since a payment was just successfully recorded for it
        newStatus = 'Paid';
      }

      if (newStatus && newStatus !== fine.status) {
        const updateData: any = { status: newStatus };
        const now = new Date().toISOString();
        if (newStatus === 'Paid') {
          updateData.charged_at = now;
          updateData.resolved_at = now;
        } else if (newStatus === 'Charged') {
          updateData.charged_at = now;
        }

        await supabase
          .from('fines')
          .update(updateData)
          .eq('id', fine.id);
      }

      // Always invalidate queries after payment success
      queryClient.invalidateQueries({ queryKey: ["fines-enhanced"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance-status"] });
      queryClient.invalidateQueries({ queryKey: ["customer-fine-stats"] });
      queryClient.invalidateQueries({ queryKey: ["rental-fines"] });
      queryClient.invalidateQueries({ queryKey: ["rental-totals"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
    } catch (err) {
      console.error('Error syncing fine status after payment:', err);
    }
  };

  // Handle sorting
  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  // Handle row selection
  const handleSelectFine = (fineId: string, checked: boolean) => {
    setSelectedFines(prev =>
      checked
        ? [...prev, fineId]
        : prev.filter(id => id !== fineId)
    );
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedFines(checked ? filteredFines.map(f => f.id) : []);
  };

  // Render individual fine row
  const renderFineRow = (fine: EnhancedFine) => {
    const canCharge = fine.status === 'Open';
    const canWaive = fine.status === 'Open';
    const canRefund = fine.status === 'Paid' || fine.status === 'Partially Refunded';

    return (
      <TableRow
        key={fine.id}
        className={cn(
          "hover:bg-muted/50",
          fine.isOverdue && "border-l-4 border-l-destructive",
          selectedFines.includes(fine.id) && "bg-primary/5"
        )}
      >
        <TableCell className="w-12">
          {canEdit('fines') && (
            <Checkbox
              checked={selectedFines.includes(fine.id)}
              onCheckedChange={(checked) => handleSelectFine(fine.id, checked as boolean)}
            />
          )}
        </TableCell>

        <TableCell className="font-medium">
          {fine.reference_no || fine.id.slice(0, 8)}
        </TableCell>

        <TableCell>
          {fine.rentals?.rental_number || ''}
        </TableCell>

        <TableCell>
          {fine.vehicles.reg} • {fine.vehicles.make} {fine.vehicles.model}
        </TableCell>

        <TableCell>
          {fine.customers?.name || '-'}
        </TableCell>

        <TableCell>
          {new Date(fine.issue_date + 'T00:00:00').toLocaleDateString()}
        </TableCell>

        <TableCell className={cn(fine.isOverdue && "text-destructive font-medium")}>
          {new Date(fine.due_date + 'T00:00:00').toLocaleDateString()}
          {fine.isOverdue && (
            <Badge variant="destructive" className="ml-2 text-xs">
              {Math.abs(fine.daysUntilDue)} days overdue
            </Badge>
          )}
        </TableCell>

        <TableCell>
          <FineStatusBadge
            status={fine.status}
            dueDate={fine.due_date}
            remainingAmount={fine.amount}
          />
        </TableCell>

        <TableCell className="text-left font-medium">
          {formatCurrency(Number(fine.amount), tenant?.currency_code || 'GBP')}
        </TableCell>

        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/fines/${fine.id}`)}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </TableCell>

        <TableCell className="text-right">
          {(canCharge || canWaive || canRefund) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit('fines') && canCharge && (
                  <DropdownMenuItem
                    onClick={() => openPaymentDialog(fine)}
                  >
                    <DollarSign className="h-4 w-4 mr-2" />
                    Record Payment
                  </DropdownMenuItem>
                )}
                {canEdit('fines') && canWaive && (
                  <DropdownMenuItem
                    onClick={() => waiveFineAction.mutate(fine.id)}
                    disabled={waiveFineAction.isPending}
                  >
                    <Ban className="h-4 w-4 mr-2" />
                    Waive Fine
                  </DropdownMenuItem>
                )}
                {canEdit('fines') && canRefund && (
                  <DropdownMenuItem
                    onClick={() => setRefundFine(fine)}
                  >
                    <Undo2 className="h-4 w-4 mr-2" />
                    {fine.status === 'Partially Refunded' ? 'Refund More' : 'Refund'}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </TableCell>
      </TableRow>
    );
  };

  // Render fines table
  const renderFinesTable = (fines: EnhancedFine[]) => (
    <div className="max-h-[calc(100vh-380px)] min-h-[300px] overflow-auto relative">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-12">
              {canEdit('fines') && (
                <Checkbox
                  checked={selectedFines.length === fines.length && fines.length > 0}
                  onCheckedChange={handleSelectAll}
                />
              )}
            </TableHead>
            <TableHead>Reference</TableHead>
            <TableHead>Rental #</TableHead>
            <TableHead>Vehicle</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Issue Date</TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => handleSort('due_date')}
            >
              <div className="flex items-center gap-1">
                Due Date
                <ArrowUpDown className="h-4 w-4" />
              </div>
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead
              className="text-left cursor-pointer hover:bg-muted/50"
              onClick={() => handleSort('amount')}
            >
              <div className="flex items-center gap-1">
                Amount
                <ArrowUpDown className="h-4 w-4" />
              </div>
            </TableHead>
            <TableHead className="w-12">View</TableHead>
            <TableHead className="text-right w-12">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fines.length > 0 ? (
            fines.map(renderFineRow)
          ) : (
            <TableRow>
              <TableCell colSpan={11} className="text-center py-8">
                <div className="flex flex-col items-center space-y-2">
                  <AlertTriangle className="h-12 w-12 text-muted-foreground" />
                  <p className="text-lg font-medium">No fines found</p>
                  <p className="text-muted-foreground">
                    {filters.status.length > 0 || filters.vehicleSearch || filters.customerSearch || filters.search
                      ? "Try adjusting your filters"
                      : "Get started by adding your first fine"
                    }
                  </p>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Failed to load fines</h2>
          <p className="text-muted-foreground">Please try refreshing the page</p>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Fines Management</h1>
          <p className="text-muted-foreground">
            Track and manage traffic fines
          </p>
        </div>
        <div className="flex items-center gap-2">
          {allFines.length > 0 && (
            <Link href="/fines/analytics">
              <Button variant="outline" size="icon" className="border-primary/20 hover:border-primary/40 hover:bg-primary/5">
                <BarChart3 className="h-4 w-4" />
              </Button>
            </Link>
          )}
          {canEdit('fines') && (
            <Button
              onClick={() => setShowAddFineDialog(true)}
              className="bg-gradient-primary"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Fine
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <FineKPIs />

      {/* Filters */}
      <FineFilters onFiltersChange={handleFiltersChange} />

      {/* Bulk Action Bar */}
      {canEdit('fines') && selectedFines.length > 0 && (
        <BulkActionBar
          selectedFines={selectedFineObjects}
          onClearSelection={() => setSelectedFines([])}
        />
      )}

      {/* Fines Table */}
      {isLoading ? (
        <div className="text-center py-8">Loading fines...</div>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              {renderFinesTable(filteredFines)}
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalFines > 0 && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Showing {startIndex + 1}-{endIndex} of {totalFines} fines
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
          )}
        </>
      )}
    </div>

    <AddFineDialog open={showAddFineDialog} onOpenChange={setShowAddFineDialog} />

    {paymentFine && (
      <AddPaymentDialog
        open={!!paymentFine}
        onOpenChange={(open) => {
          if (!open) setPaymentFine(null);
        }}
        customer_id={paymentFine.customer_id || undefined}
        vehicle_id={paymentFine.vehicle_id}
        rental_id={paymentFine.rental_id || undefined}
        defaultAmount={Number(paymentFine.amount)}
        targetCategories={["Fine"]}
        onPaymentSuccess={() => {
          const fineToSync = paymentFine;
          if (fineToSync) syncFineStatusAfterPayment(fineToSync);
        }}
      />
    )}

    {refundFine && (
      <RefundDialog
        open={!!refundFine}
        onOpenChange={(open) => {
          if (!open) setRefundFine(null);
        }}
        rentalId={refundFine.rental_id || refundFine.id}
        category="Fine"
        totalAmount={Number(refundFine.amount)}
        paidAmount={Number(refundFine.amount)}
        onSuccess={async (refundedAmount: number) => {
          const fine = refundFine;
          if (!fine) return;
          // Query total Fine refunds from ledger for this fine
          const { data: fineRefunds } = await supabase
            .from('ledger_entries')
            .select('amount')
            .eq('type', 'Refund')
            .eq('category', 'Fine')
            .eq('reference', `Refund: ${fine.reference_no || fine.id}`);
          // Also check by rental_id if available
          let totalRefundedFromLedger = Math.abs(fineRefunds?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0);
          if (fine.rental_id) {
            const { data: rentalFineRefunds } = await supabase
              .from('ledger_entries')
              .select('amount')
              .eq('rental_id', fine.rental_id)
              .eq('type', 'Refund')
              .eq('category', 'Fine');
            totalRefundedFromLedger = Math.abs(rentalFineRefunds?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0);
          }
          const fineAmount = Number(fine.amount);
          const newStatus = totalRefundedFromLedger >= fineAmount ? 'Refunded' : 'Partially Refunded';
          const updateData: any = { status: newStatus };
          if (newStatus === 'Refunded') {
            updateData.resolved_at = new Date().toISOString();
          }
          await supabase.from('fines').update(updateData).eq('id', fine.id);
          queryClient.invalidateQueries({ queryKey: ["fines-enhanced"] });
          queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
          queryClient.invalidateQueries({ queryKey: ["customer-balance"] });
          queryClient.invalidateQueries({ queryKey: ["customer-balance-status"] });
          queryClient.invalidateQueries({ queryKey: ["customer-fine-stats"] });
          queryClient.invalidateQueries({ queryKey: ["rental-fines"] });
          queryClient.invalidateQueries({ queryKey: ["rental-totals"] });
          setRefundFine(null);
        }}
      />
    )}
  </>
  );
};

export default FinesList;
