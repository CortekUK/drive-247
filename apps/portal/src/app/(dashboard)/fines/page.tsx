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
import { AlertTriangle, Plus, Eye, MoreVertical, DollarSign, Ban, ArrowUpDown, BarChart3 } from "lucide-react";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
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
import { MoreHorizontal } from "lucide-react";
import { Button as ButtonV2 } from "@/components/ui-v2/button";
import { Checkbox as CheckboxV2 } from "@/components/ui-v2/checkbox";
import {
  DropdownMenu as DropdownMenuV2,
  DropdownMenuContent as DropdownMenuContentV2,
  DropdownMenuItem as DropdownMenuItemV2,
  DropdownMenuTrigger as DropdownMenuTriggerV2,
} from "@/components/ui-v2/dropdown-menu";
import { parseLocalDate } from "@/lib/date-utils";
import {
  LIST_CLASSES,
  LIST_ROW_ACTION,
  LIST_TONES,
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
  type ListTone,
} from "@/components/shared/list-table-v2";
import { useV2 } from "@/lib/v2-context";
import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2, HeaderIconButton } from "@/components/shared/header-icon-button-v2";

// v2 only: the Status column's hue, by meaning, keyed on the lower-cased label.
// Open waits on the operator (charge or waive); Charged, Partially Paid and the
// appeal states are underway; Overdue and Appeal Rejected need attention; the
// closed outcomes recede. Anything unknown falls back to muted at the call site.
const FINE_STATUS_TONE_V2: Record<string, ListTone> = {
  paid: 'success',
  open: 'warning',
  charged: 'info',
  'partially paid': 'info',
  appealed: 'info',
  'appeal submitted': 'info',
  overdue: 'danger',
  'appeal rejected': 'danger',
  waived: 'muted',
  'appeal successful': 'muted',
  refunded: 'muted',
  'partially refunded': 'muted',
};

// v2 only: the label `FineStatusBadge` prints, computed the same way (its
// `getDisplayText`, fed the same props the v1 row passes), so both paths name a
// fine alike. The badge itself is shared with the fine and customer detail
// pages and stays untouched.
const fineStatusLabelV2 = (fine: EnhancedFine): string => {
  if (fine.status === 'Open') {
    const isOverdue = parseLocalDate(fine.due_date) < new Date() && fine.amount > 0;
    return isOverdue ? 'Overdue' : 'Open';
  }
  return fine.status || 'Open';
};

// v2 only: the rentals list's date format ("14 Sep", with the year only when it
// is not this year). `parseLocalDate`, because these are date-only strings.
const FINE_DATE_V2 = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const FINE_DATE_WITH_YEAR_V2 = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const formatFineDateV2 = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const d = parseLocalDate(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.getFullYear() === new Date().getFullYear() ? FINE_DATE_V2.format(d) : FINE_DATE_WITH_YEAR_V2.format(d);
};

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

  // v2 chrome (canary tenants only; fails closed to v1). On v2 there is no
  // pager: the table grows as it scrolls, like the rentals list.
  const v2Chrome = useV2("chrome");

  // Fetch fines data with current filters
  const { data: finesData, isLoading, error } = useFinesData({
    filters,
    sortBy,
    sortOrder,
    // v2: page 1 of up to 1,000 rows (PostgREST's per-request maximum), grown
    // on screen by `useProgressiveRows`. Same hook, so the "fines-enhanced" key
    // prefix every invalidation uses still matches. v1 passes nothing extra, so
    // its defaults (25 rows) and its query key stay exactly as they were.
    ...(v2Chrome ? { page: 1, pageSize: 1000 } : {}),
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

  /**
   * v2 (northwind) has no pager: the table grows 25 rows at a time as it is
   * scrolled, like the rentals list. On v2 the hook above fetched up to 1,000
   * rows, so this is a bigger slice of `allFines` and no new query. The fill
   * resets only when the result set changes: tenant, any filter, or the sort.
   * Nothing here moves on a background refetch (a waive or a payment).
   * Dates go in as epoch millis: an unparseable URL date is an Invalid Date,
   * whose `toISOString()` would throw during render.
   */
  const fineRows = useProgressiveRows(
    allFines,
    `${tenant?.id}|${filters.search ?? ''}|${filters.vehicleSearch}|${filters.customerSearch}|${filters.status.join(',')}|${filters.issueDateFrom?.getTime()}|${filters.issueDateTo?.getTime()}|${filters.dueDateFrom?.getTime()}|${filters.dueDateTo?.getTime()}|${filters.quickFilter}|${sortBy}|${sortOrder}`,
  );

  // v2: the bulk bar acts on the selected rows that are on screen, as v1's acts
  // on the selected rows of the page on screen.
  const selectedFineObjectsV2 = fineRows.visible.filter(fine => selectedFines.includes(fine.id));

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
          {new Date(fine.issue_date + 'T00:00:00').toLocaleDateString('en-US')}
        </TableCell>

        <TableCell className={cn(fine.isOverdue && "text-destructive font-medium")}>
          {new Date(fine.due_date + 'T00:00:00').toLocaleDateString('en-US')}
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
          {formatCurrency(Number(fine.amount), tenant?.currency_code || 'USD')}
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
          {(canCharge || canWaive) && (
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

  // v2: the rentals list's table (components/shared/list-table-v2). No pager:
  // rows arrive as the table scrolls. No View column: the row opens the fine at
  // the same /fines/:id the v1 eye button pushes. The actions menu is the ui-v2
  // menu, with the v1 menu's items, permission gates and handlers.
  const renderFinesTableV2 = () => {
    const allShownSelected =
      fineRows.visible.length > 0 && fineRows.visible.every((fine) => selectedFines.includes(fine.id));
    const serverCount = finesData?.serverCount ?? 0;

    return (
      <>
        <ListTable rows={fineRows} minWidth="min-w-[880px]">
          <ListTableHeader>
            <ListHead className="w-[4%]">
              {canEdit('fines') && (
                // `mx-auto`: the checkbox is a block-level flex box, which a
                // centred cell's text-align does not move.
                <CheckboxV2
                  className="mx-auto"
                  checked={allShownSelected}
                  onCheckedChange={(checked) =>
                    setSelectedFines(checked === true ? fineRows.visible.map((fine) => fine.id) : [])
                  }
                  aria-label="Select all shown fines"
                />
              )}
            </ListHead>
            {/* Widths, measured in Manrope on a 944px card. Rental #, Issue
                date, Due date, Status and Amount hold their longest values in
                full: "R-" plus 6 characters (uppercase too), "May 30, 2025" /
                "30 Sept 2025", "1352 days overdue", "Appeal Successful",
                "$12,345.67". Reference, Vehicle and Customer are the columns
                that truncate, each with its full value in a title. */}
            <ListHead className="w-[10%]">Reference</ListHead>
            <ListHead className="w-[11%]">Rental #</ListHead>
            <ListHead className="w-[9%]">Vehicle</ListHead>
            <ListHead className="w-[9%]">Customer</ListHead>
            <ListHead className="w-[12.5%]">Issue date</ListHead>
            {/* No sorting on v2: fines stay newest added first (the page's
                `created_at` desc default, which nothing on v2 can change). */}
            <ListHead className="w-[13.5%]">Due date</ListHead>
            <ListHead className="w-[16%]">Status</ListHead>
            <ListHead className="w-[11%]">Amount</ListHead>
            <ListHead className="w-[4%] text-right">
              <span className="sr-only">Actions</span>
            </ListHead>
          </ListTableHeader>
          <ListBody>
            {fineRows.visible.map((fine) => {
              const canCharge = fine.status === 'Open';
              const canWaive = fine.status === 'Open';
              const reference = fine.reference_no || fine.id.slice(0, 8);
              const statusLabel = fineStatusLabelV2(fine);
              const issueDate = formatFineDateV2(fine.issue_date);
              const dueDate = formatFineDateV2(fine.due_date);
              const reg = fine.vehicles?.reg;
              // v1 prints "reg • make model". Here make and model follow the
              // plate on the same line, quieter, as the invoices list does.
              const makeModel = [fine.vehicles?.make, fine.vehicles?.model].filter(Boolean).join(' ');
              const daysOverdue = Math.abs(fine.daysUntilDue);
              const overdueText = `${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'} overdue`;

              return (
                <ListRow
                  key={fine.id}
                  data-state={selectedFines.includes(fine.id) ? 'selected' : undefined}
                  // The rentals list's flag treatment: a faint tint and a 2px
                  // rail, in place of v1's 4px destructive border.
                  className={cn(fine.isOverdue && 'bg-red-500/5 border-l-2 border-l-red-500')}
                  onOpen={() => router.push(`/fines/${fine.id}`)}
                >
                  <ListCell onClick={(e) => e.stopPropagation()}>
                    {canEdit('fines') && (
                      <CheckboxV2
                        className="mx-auto"
                        checked={selectedFines.includes(fine.id)}
                        onCheckedChange={(checked) => handleSelectFine(fine.id, checked as boolean)}
                        aria-label={`Select fine ${reference}`}
                      />
                    )}
                  </ListCell>
                  {/* A real link to the same record, so it stays reachable by
                      keyboard now the eye button is gone. */}
                  <ListCell onClick={(e) => e.stopPropagation()}>
                    <Link
                      href={`/fines/${fine.id}`}
                      className={`block truncate ${LIST_CLASSES.identifier} hover:underline`}
                      title={reference}
                    >
                      {reference}
                    </Link>
                  </ListCell>
                  <ListCell>
                    {fine.rentals?.rental_number ? (
                      <span
                        className={`block truncate tabular-nums ${LIST_CLASSES.text}`}
                        title={fine.rentals.rental_number}
                      >
                        {fine.rentals.rental_number}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </ListCell>
                  <ListCell>
                    {reg || makeModel ? (
                      <span className="block truncate" title={[reg, makeModel].filter(Boolean).join(' · ')}>
                        {reg ? (
                          <span className={`tabular-nums ${LIST_CLASSES.text}`}>{reg}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {makeModel && <span className="ml-1.5 text-muted-foreground">{makeModel}</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </ListCell>
                  <ListCell>
                    {fine.customers?.name ? (
                      <span className={`block truncate ${LIST_CLASSES.text}`} title={fine.customers.name}>
                        {fine.customers.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </ListCell>
                  <ListCell className="tabular-nums">
                    {issueDate ? (
                      <span className={`block truncate ${LIST_CLASSES.text}`} title={issueDate}>
                        {issueDate}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </ListCell>
                  {/* Overdue: the date stays whole on the first line, in the
                      danger hue, and v1's "N days overdue" badge becomes the
                      rentals list's flag line under it. A chip beside the date
                      squeezed a past-year date down to "Nov …". */}
                  <ListCell
                    className="tabular-nums"
                    title={fine.isOverdue ? `${dueDate ?? ''} · ${overdueText}` : undefined}
                  >
                    {dueDate ? (
                      // Centred like every v2 cell. `max-w-full` keeps the
                      // date truncating: a centred flex item is only as wide as
                      // its text, so without it a long date would spill out.
                      <div className="flex flex-col items-center gap-0.5">
                        <span
                          className={cn(
                            'block max-w-full truncate',
                            fine.isOverdue ? `font-medium ${LIST_TONES.danger}` : LIST_CLASSES.text,
                          )}
                        >
                          {dueDate}
                        </span>
                        {fine.isOverdue && (
                          <span className="flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                            {overdueText}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </ListCell>
                  <ListCell>
                    <span className="block truncate" title={statusLabel}>
                      <ListStatusText tone={FINE_STATUS_TONE_V2[statusLabel.toLowerCase()] ?? 'muted'}>
                        {statusLabel}
                      </ListStatusText>
                    </span>
                  </ListCell>
                  <ListCell className="tabular-nums">
                    <span className={`block truncate ${LIST_CLASSES.text}`}>
                      {formatCurrency(Number(fine.amount), tenant?.currency_code || 'USD')}
                    </span>
                  </ListCell>
                  {/* The menu must not open the record: clicks on the trigger
                      and on its items (portalled, but still React children of
                      this cell) stop here. */}
                  <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                    {(canCharge || canWaive) && (
                      // The ui-v2 menu, as on the other v2 lists: `w-auto`
                      // lets a label keep one line in the trigger-wide content,
                      // and its items already space the icon.
                      <DropdownMenuV2>
                        <DropdownMenuTriggerV2 asChild>
                          <ButtonV2
                            variant="ghost"
                            size="icon-sm"
                            // `flex ml-auto`: an inline button sits on the text
                            // baseline, so with the kit's -my-1.5 alone an Open
                            // row still measured 48px against 45px for the rest.
                            // As a block it adds no height, right-aligned.
                            className={cn(LIST_ROW_ACTION, 'flex ml-auto')}
                            aria-label={`Actions for fine ${reference}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </ButtonV2>
                        </DropdownMenuTriggerV2>
                        <DropdownMenuContentV2 align="end" className="w-auto">
                          {canEdit('fines') && canCharge && (
                            <DropdownMenuItemV2
                              onClick={() => openPaymentDialog(fine)}
                            >
                              <DollarSign className="h-4 w-4" />
                              Record Payment
                            </DropdownMenuItemV2>
                          )}
                          {canEdit('fines') && canWaive && (
                            <DropdownMenuItemV2
                              onClick={() => waiveFineAction.mutate(fine.id)}
                              disabled={waiveFineAction.isPending}
                            >
                              <Ban className="h-4 w-4" />
                              Waive Fine
                            </DropdownMenuItemV2>
                          )}
                        </DropdownMenuContentV2>
                      </DropdownMenuV2>
                    )}
                  </ListCell>
                </ListRow>
              );
            })}
          </ListBody>
        </ListTable>
        {/* `serverTotal` only when the 1,000-row fetch was actually capped. The
            count is taken before the client-side search, so passing it
            unconditionally would call a complete, searched list truncated. */}
        <ListFooter
          rows={fineRows}
          one="fine"
          many="fines"
          serverTotal={serverCount > 1000 ? serverCount : undefined}
        />
      </>
    );
  };

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
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold">Fines Management</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Track and manage traffic fines
          </p>
        </div>
        {/* v2: every control here is 32px and the cluster sits on the subtitle
            line (HEADER_ACTIONS_V2 / HEADER_PRIMARY_V2, team lead Sep 16 2026).
            v1 keeps "flex items-center gap-2" and its outline icon Button byte
            for byte. */}
        <div className={`flex items-center gap-2${v2Chrome ? ` ${HEADER_ACTIONS_V2}` : ""}`}>
          {allFines.length > 0 && (
            v2Chrome ? (
              <HeaderIconButton label="Fine analytics" href="/fines/analytics">
                <BarChart3 className="h-4 w-4" />
              </HeaderIconButton>
            ) : (
            <Link href="/fines/analytics" className="shrink-0">
              <Button variant="outline" size="icon" className="border-primary/20 hover:border-primary/40 hover:bg-primary/5">
                <BarChart3 className="h-4 w-4" />
              </Button>
            </Link>
            )
          )}
          {canEdit('fines') && (
            <Button
              onClick={() => setShowAddFineDialog(true)}
              className={`bg-gradient-primary flex-1 sm:flex-none${v2Chrome ? ` ${HEADER_PRIMARY_V2}` : ""}`}
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
        v2Chrome ? (
          <BulkActionBar
            selectedFines={selectedFineObjectsV2}
            onClearSelection={() => setSelectedFines([])}
          />
        ) : (
        <BulkActionBar
          selectedFines={selectedFineObjects}
          onClearSelection={() => setSelectedFines([])}
        />
        )
      )}

      {/* Fines Table */}
      {isLoading ? (
        <div className="text-center py-8">Loading fines...</div>
      ) : (
        v2Chrome && allFines.length > 0 ? (
          renderFinesTableV2()
        ) : v2Chrome && allFines.length === 0 ? (
          // v2, nothing to list: the v1 empty row's message on its own, with
          // no table header or View column around it, as the other v2 lists
          // show theirs.
          <div className="text-center py-12">
            <AlertTriangle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No fines found</h3>
            <p className="text-muted-foreground">
              {filters.status.length > 0 || filters.vehicleSearch || filters.customerSearch || filters.search
                ? "Try adjusting your filters"
                : "Get started by adding your first fine"
              }
            </p>
          </div>
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
        )
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

  </>
  );
};

export default FinesList;
