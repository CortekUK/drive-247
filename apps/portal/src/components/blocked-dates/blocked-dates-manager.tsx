import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, Plus, Trash2, Ban, Calendar as CalendarIconLucide, Globe } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useBlockedDates } from "@/hooks/use-blocked-dates";
import { EmptyState } from "@/components/shared/data-display/empty-state";

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

  const { blockedDates, isLoading, addBlockedDate, deleteBlockedDate, isAdding, isDeleting } =
    useBlockedDates(vehicle_id);

  // Helper function to check if a date is already blocked
  const isDateBlocked = (date: Date): boolean => {
    const dateStr = format(date, 'yyyy-MM-dd');

    return blockedDates.some((blockedRange) => {
      const start = blockedRange.start_date;
      const end = blockedRange.end_date;

      return dateStr >= start && dateStr <= end;
    });
  };

  const handleAddBlockedDate = () => {
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
        },
      }
    );
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div />
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Block Dates
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Block Date Range</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
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

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddBlockedDate} disabled={!startDate || !endDate || isAdding}>
                  {isAdding ? "Blocking..." : "Block Dates"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading blocked dates...</div>
        ) : blockedDates.length === 0 ? (
          <EmptyState
            icon={CalendarIconLucide}
            title="No blocked dates"
            description="Block date ranges to prevent rentals on specific days"
          />
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
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
                    <TableRow key={blockedDate.id}>
                      <TableCell className="font-medium">
                        {format(new Date(blockedDate.start_date), "PPP")}
                      </TableCell>
                      <TableCell className="font-medium">
                        {format(new Date(blockedDate.end_date), "PPP")}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {blockedDate.reason || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {isGeneralBlock ? (
                          <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                            <Globe className="h-3 w-3" />
                            General
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="flex items-center gap-1 w-fit">
                            {blockedDate.vehicles
                              ? `${blockedDate.vehicles.make} ${blockedDate.vehicles.model} (${blockedDate.vehicles.reg})`
                              : "This Vehicle"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(blockedDate.id, blockedDate.start_date, blockedDate.end_date)}
                          disabled={isDeleting}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

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
    </Card>
  );
};
