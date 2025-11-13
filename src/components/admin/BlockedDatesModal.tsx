import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CalendarX, Trash2, Plus } from "lucide-react";
import { format } from "date-fns";
import { DateRange } from "react-day-picker";

interface BlockedDate {
  id: string;
  date: string;
  reason: string | null;
  created_at: string;
}

interface BlockedDatesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function BlockedDatesModal({ open, onOpenChange }: BlockedDatesModalProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      loadBlockedDates();
    }
  }, [open]);

  const loadBlockedDates = async () => {
    try {
      const { data, error } = await supabase
        .from("blocked_dates")
        .select("*")
        .order("date", { ascending: true });

      if (error) throw error;
      setBlockedDates(data || []);
    } catch (error: any) {
      toast.error("Failed to load blocked dates: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const blockDateRange = async () => {
    if (!dateRange?.from) {
      toast.error("Please select a date or date range");
      return;
    }

    try {
      const dates: string[] = [];
      const startDate = new Date(dateRange.from);
      const endDate = dateRange.to ? new Date(dateRange.to) : startDate;

      // Generate all dates in range
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = format(d, "yyyy-MM-dd");
        // Skip if already blocked
        if (!blockedDates.find(bd => bd.date === dateStr)) {
          dates.push(dateStr);
        }
      }

      if (dates.length === 0) {
        toast.error("All selected dates are already blocked");
        return;
      }

      const datesToInsert = dates.map(date => ({
        date,
        reason: reason.trim() || null,
      }));

      const { error } = await supabase
        .from("blocked_dates")
        .insert(datesToInsert);

      if (error) throw error;

      toast.success(`${dates.length} date(s) blocked successfully`);
      setReason("");
      setDateRange(undefined);
      loadBlockedDates();
    } catch (error: any) {
      toast.error("Failed to block dates: " + error.message);
    }
  };

  const unblockDate = async (id: string) => {
    try {
      const { error } = await supabase
        .from("blocked_dates")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast.success("Date unblocked successfully");
      loadBlockedDates();
    } catch (error: any) {
      toast.error("Failed to unblock date: " + error.message);
    }
  };

  const disabledDates = blockedDates.map(bd => {
    const [year, month, day] = bd.date.split('-').map(Number);
    return new Date(year, month - 1, day);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-gradient-metal">
            <CalendarX className="h-5 w-5 text-accent" />
            Manage Blocked Dates
          </DialogTitle>
          <DialogDescription>
            Block dates or date ranges to prevent customers from booking
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Calendar Section */}
          <div className="space-y-4">
            <div className="flex justify-center p-4 bg-muted/30 rounded-lg border border-border/50">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                disabled={(date) => {
                  const dateStr = format(date, "yyyy-MM-dd");
                  return blockedDates.some(bd => bd.date === dateStr);
                }}
                className="rounded-md"
                numberOfMonths={1}
                classNames={{
                  day_selected: "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                  day_range_middle: "bg-accent/50 text-accent-foreground",
                  day_disabled: "text-muted-foreground opacity-50 line-through decoration-red-500",
                }}
              />
            </div>

            {/* Block Date Form */}
            {dateRange?.from && (
              <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border/50">
                <div className="space-y-2">
                  <Label>Selected {dateRange.to ? "Range" : "Date"}</Label>
                  <p className="text-sm font-medium text-foreground">
                    {format(dateRange.from, "MMM dd, yyyy")}
                    {dateRange.to && ` - ${format(dateRange.to, "MMM dd, yyyy")}`}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reason">Reason (Optional)</Label>
                  <Input
                    id="reason"
                    placeholder="e.g., Holiday, Maintenance..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="bg-background/50"
                  />
                </div>

                <Button
                  onClick={blockDateRange}
                  className="w-full gap-2 bg-gradient-to-r from-accent/90 to-accent hover:from-accent hover:to-accent/90 shadow-[0_0_20px_rgba(244,197,66,0.3)]"
                >
                  <Plus className="w-4 h-4" />
                  Block {dateRange.to ? "Date Range" : "This Date"}
                </Button>
              </div>
            )}
          </div>

          {/* Blocked Dates List */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CalendarX className="w-4 h-4 text-accent" />
              Blocked Dates ({blockedDates.length})
            </h4>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : blockedDates.length > 0 ? (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                {blockedDates.map((blocked) => (
                  <div
                    key={blocked.id}
                    className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50 hover:border-accent/40 transition-all group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {format(new Date(blocked.date + 'T00:00:00'), "MMMM dd, yyyy")}
                      </p>
                      {blocked.reason && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {blocked.reason}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => unblockDate(blocked.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-sm text-muted-foreground py-6">
                No dates are currently blocked. Select a date or range to block it.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
