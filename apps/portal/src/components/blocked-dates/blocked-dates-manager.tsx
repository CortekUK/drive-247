import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarIcon, Plus, Trash2, Ban, Calendar as CalendarIconLucide, Globe, AlertTriangle, Info } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/date-utils";
import { useBlockedDates } from "@/hooks/use-blocked-dates";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import {
  SectionCard,
  TableTile,
  bentoTable,
  StatusPill,
  EmptyState as BentoEmptyState,
  Modal,
  Shimmer,
} from "@/components/bento";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useAuditLogOnOpen } from "@/hooks/use-audit-log-on-open";

interface BlockedDatesManagerProps {
  vehicle_id?: string;
}

export const BlockedDatesManager = ({ vehicle_id }: BlockedDatesManagerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [reason, setReason] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: string; startDate: string; endDate: string } | null>(null);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictingRentals, setConflictingRentals] = useState<Array<{ id: string; customer_name: string; vehicle_reg: string; start_date: string; end_date: string }>>([]);
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);

  const { canEdit } = useManagerPermissions();
  const { tenant } = useTenant();

  const { blockedDates, isLoading, addBlockedDate, deleteBlockedDate, isAdding, isDeleting } =
    useBlockedDates(vehicle_id);

  useAuditLogOnOpen({
    open: deleteDialogOpen,
    action: "blocked_date_delete_warning_shown",
    entityType: "blocked_date",
    entityId: itemToDelete?.id,
  });

  // Helper function to check if a date is already blocked
  const isDateBlocked = (date: Date): boolean => {
    const dateStr = format(date, 'yyyy-MM-dd');

    return blockedDates.some((blockedRange) => {
      const start = blockedRange.start_date;
      const end = blockedRange.end_date;

      return dateStr >= start && dateStr <= end;
    });
  };

  const proceedWithBlock = () => {
    if (!startDate || !endDate) return;

    addBlockedDate(
      {
        start_date: startDate,
        end_date: endDate,
        reason: reason || undefined,
        vehicle_id: vehicle_id,
      },
      {
        onSuccess: () => {
          setIsOpen(false);
          setStartDate(undefined);
          setEndDate(undefined);
          setReason("");
          setConflictDialogOpen(false);
          setConflictingRentals([]);
          setOverlapWarning(null);
        },
      }
    );
  };

  const handleAddBlockedDate = async () => {
    if (!startDate || !endDate || !tenant?.id) return;

    setIsCheckingConflicts(true);
    setOverlapWarning(null);

    try {
      const startStr = format(startDate, 'yyyy-MM-dd');
      const endStr = format(endDate, 'yyyy-MM-dd');

      // Check for overlapping existing global blocks (Fix 5)
      if (!vehicle_id) {
        const existingOverlap = blockedDates.find(b => {
          if (b.vehicle_id) return false; // only check global blocks
          return startStr <= b.end_date && endStr >= b.start_date;
        });
        if (existingOverlap) {
          setOverlapWarning(
            `Note: This overlaps with an existing block (${format(new Date(existingOverlap.start_date), 'MMM dd, yyyy')} – ${format(new Date(existingOverlap.end_date), 'MMM dd, yyyy')}).`
          );
        }
      }

      // Check for conflicting active/confirmed rentals (Fix 2)
      let query = supabaseUntyped
        .from('rentals')
        .select('id, start_date, end_date, customers(name), vehicles(reg)')
        .eq('tenant_id', tenant.id)
        .in('status', ['Active', 'Confirmed'])
        .lte('start_date', endStr)
        .gte('end_date', startStr);

      if (vehicle_id) {
        query = query.eq('vehicle_id', vehicle_id);
      }

      const { data: conflicts, error } = await query;

      if (error) {
        console.error('[BlockedDates] Conflict check failed:', error);
        proceedWithBlock();
      } else if (conflicts && conflicts.length > 0) {
        setConflictingRentals(
          conflicts.map((r: any) => ({
            id: r.id,
            customer_name: r.customers?.name || 'Unknown',
            vehicle_reg: r.vehicles?.reg || 'Unknown',
            start_date: r.start_date,
            end_date: r.end_date,
          }))
        );
        // Close the create dialog first so the conflict alert isn't blocked behind it
        setIsOpen(false);
        setConflictDialogOpen(true);
      } else {
        proceedWithBlock();
      }
    } catch (err) {
      console.error('[BlockedDates] Conflict check error:', err);
      // If check fails, proceed anyway
      proceedWithBlock();
    } finally {
      setIsCheckingConflicts(false);
    }
  };

  const handleDeleteClick = (id: string, startDate: string, endDate: string) => {
    setItemToDelete({ id, startDate, endDate });
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (itemToDelete) {
      deleteBlockedDate(itemToDelete.id);
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  return (
    <SectionCard
      icon={<Ban className="h-4 w-4" />}
      title="Blocked Dates"
      description="Prevent bookings on specific dates"
      action={
        canEdit('availability') ? (
          <Button size="sm" className="flex items-center gap-2 shrink-0" onClick={() => setIsOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Block Dates</span>
            <span className="sm:hidden">Block</span>
          </Button>
        ) : undefined
      }
    >
        <Modal open={isOpen} onOpenChange={setIsOpen} title="Block Date Range">
            <div className="space-y-4">
              {/* Start Date Selection */}
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Popover modal={true}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !startDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, "PPP") : "Pick start date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                      disabled={(date) => {
                        const today = new Date(new Date().setHours(0, 0, 0, 0));
                        if (date < today) return true;
                        if (isDateBlocked(date)) return true;
                        return false;
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* End Date Selection */}
              <div className="space-y-2">
                <Label>End Date</Label>
                <Popover modal={true}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !endDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, "PPP") : "Pick end date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                      disabled={(date) => {
                        const today = new Date(new Date().setHours(0, 0, 0, 0));
                        if (date < today) return true;
                        if (startDate && date < startDate) return true;
                        if (isDateBlocked(date)) return true;
                        return false;
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Reason */}
              <div className="space-y-2">
                <Label>Reason (Optional)</Label>
                <Textarea
                  placeholder="e.g., Maintenance scheduled, Holiday closure, etc."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="resize-none"
                  rows={3}
                />
              </div>

              {overlapWarning && (
                <Alert className="[border-color:var(--bento-info)] [background:var(--bento-info-weak)]">
                  <Info className="h-4 w-4 text-[color:var(--bento-info)]" />
                  <AlertDescription className="text-sm text-[color:var(--bento-info)]">
                    {overlapWarning}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setIsOpen(false); setOverlapWarning(null); }}>
                  Cancel
                </Button>
                <Button onClick={handleAddBlockedDate} disabled={!startDate || !endDate || isAdding || isCheckingConflicts}>
                  {isCheckingConflicts ? "Checking..." : isAdding ? "Blocking..." : "Block Dates"}
                </Button>
              </div>
            </div>
        </Modal>

        {isLoading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Shimmer key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : blockedDates.length === 0 ? (
          <BentoEmptyState
            icon={<CalendarIconLucide className="h-5 w-5" />}
            title="No blocked dates"
            description="Block date ranges to prevent rentals on specific days"
          />
        ) : (
          <TableTile>
            <Table>
              <TableHeader className={bentoTable.header}>
                <TableRow>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blockedDates.map((blockedDate) => {
                  const isGeneralBlock = !blockedDate.vehicle_id;

                  return (
                    <TableRow key={blockedDate.id} className="border-border">
                      <TableCell className="font-medium font-mono tabular-nums">
                        {format(new Date(blockedDate.start_date), "PPP")}
                      </TableCell>
                      <TableCell className="font-medium font-mono tabular-nums">
                        {format(new Date(blockedDate.end_date), "PPP")}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {blockedDate.reason || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {isGeneralBlock ? (
                          <StatusPill tone="primary" className="w-fit">
                            <Globe className="h-3 w-3" />
                            Global
                          </StatusPill>
                        ) : (
                          <StatusPill tone="neutral" className="w-fit">
                            {blockedDate.vehicles
                              ? `${blockedDate.vehicles.make} ${blockedDate.vehicles.model} (${blockedDate.vehicles.reg})`
                              : "This Vehicle"}
                          </StatusPill>
                        )}
                      </TableCell>
                      <TableCell>
                        {canEdit('availability') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteClick(blockedDate.id, blockedDate.start_date, blockedDate.end_date)}
                            disabled={isDeleting}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableTile>
        )}

      {/* Conflict Warning Dialog */}
      <AlertDialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-[color:var(--bento-warn-accent)]" />
              Conflicting Rentals Found
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-3">
                  The following active/confirmed rentals overlap with the dates you are blocking:
                </p>
                <div className="space-y-2 max-h-[200px] overflow-auto">
                  {conflictingRentals.map((rental) => (
                    <div key={rental.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <span className="font-medium">{rental.customer_name}</span>
                      <span className="text-muted-foreground">{rental.vehicle_reg}</span>
                      <span className="text-muted-foreground">
                        {format(parseLocalDate(rental.start_date), 'MMM dd')} – {format(parseLocalDate(rental.end_date), 'MMM dd, yyyy')}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[color:var(--bento-warn-accent)] text-sm">
                  Blocking these dates will not cancel existing rentals but will prevent new bookings.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={proceedWithBlock} className="[background:var(--bento-warn-accent)] text-white hover:opacity-90">
              Block Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              {itemToDelete && (
                <>
                  This will unblock the date range from{" "}
                  <strong>{format(new Date(itemToDelete.startDate), "PPP")}</strong> to{" "}
                  <strong>{format(new Date(itemToDelete.endDate), "PPP")}</strong>.
                  This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
};
