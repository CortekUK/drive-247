import { useState, useEffect } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CalendarX, Trash2, Plus } from "lucide-react";
import { format } from "date-fns";

interface BlockedDate {
  id: string;
  date: string;
  reason: string | null;
  created_at: string;
}

export default function BlockedDatesCalendar() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBlockedDates();
  }, []);

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

  const blockDate = async () => {
    if (!selectedDate) {
      toast.error("Please select a date");
      return;
    }

    try {
      const dateStr = format(selectedDate, "yyyy-MM-dd");

      // Check if date is already blocked
      const existing = blockedDates.find(bd => bd.date === dateStr);
      if (existing) {
        toast.error("This date is already blocked");
        return;
      }

      const { error } = await supabase
        .from("blocked_dates")
        .insert({
          date: dateStr,
          reason: reason.trim() || null,
        });

      if (error) throw error;

      toast.success("Date blocked successfully");
      setReason("");
      setSelectedDate(undefined);
      loadBlockedDates();
    } catch (error: any) {
      toast.error("Failed to block date: " + error.message);
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

  const isDateBlocked = (date: Date): boolean => {
    const dateStr = format(date, "yyyy-MM-dd");
    return blockedDates.some(bd => bd.date === dateStr);
  };

  if (loading) {
    return (
      <Card className="border-border/50 shadow-metal">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarX className="h-5 w-5 text-accent" />
            Blocked Dates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 shadow-metal hover:shadow-glow transition-all duration-300 bg-gradient-to-br from-card via-card to-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-gradient-metal">
          <CalendarX className="h-5 w-5 text-accent" />
          Block Dates
        </CardTitle>
        <CardDescription>
          Prevent customers from booking on specific dates
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Calendar */}
        <div className="flex justify-center">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={setSelectedDate}
            disabled={isDateBlocked}
            className="rounded-md border border-border/50"
            classNames={{
              day_disabled: "text-muted-foreground opacity-50 line-through decoration-red-500",
            }}
          />
        </div>

        {/* Block Date Form */}
        {selectedDate && (
          <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border/50">
            <div className="space-y-2">
              <Label>Selected Date</Label>
              <p className="text-sm font-medium text-foreground">
                {format(selectedDate, "MMMM dd, yyyy")}
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
              onClick={blockDate}
              className="w-full gap-2 bg-gradient-to-r from-accent/90 to-accent hover:from-accent hover:to-accent/90 shadow-[0_0_20px_rgba(244,197,66,0.3)]"
            >
              <Plus className="w-4 h-4" />
              Block This Date
            </Button>
          </div>
        )}

        {/* Blocked Dates List */}
        {blockedDates.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CalendarX className="w-4 h-4 text-accent" />
              Currently Blocked ({blockedDates.length})
            </h4>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {blockedDates.map((blocked) => (
                <div
                  key={blocked.id}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50 hover:border-accent/40 transition-all group"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {format(new Date(blocked.date + 'T00:00:00'), "MMMM dd, yyyy")}
                    </p>
                    {blocked.reason && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {blocked.reason}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => unblockDate(blocked.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {blockedDates.length === 0 && !selectedDate && (
          <p className="text-center text-sm text-muted-foreground py-6">
            No dates are currently blocked. Select a date to block it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
