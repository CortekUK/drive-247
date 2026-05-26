'use client';

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { LocationAutocomplete } from "@/components/ui/location-autocomplete";
import { TimePicker } from "@/components/ui/time-picker";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { useTenant } from "@/contexts/TenantContext";
import { parseLocalDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;

// Schema covers both dates and times for the whole Rental Period card. start_date
// is always required (every rental has one). end_date is optional because PAYG
// rentals are open-ended. Times stay optional/empty-string-allowed so an operator
// can clear them if needed; the regex still applies when a value is present.
const editPickupReturnSchema = z.object({
  start_date: z.date({ required_error: "Pickup date is required" }),
  end_date: z.date().optional().nullable(),
  pickup_location: z.string().trim().min(1, "Pickup location is required"),
  pickup_time: z
    .string()
    .trim()
    .regex(timeRegex, "Pickup time is required")
    .or(z.literal("")),
  return_location: z.string().trim().min(1, "Return location is required"),
  return_time: z
    .string()
    .trim()
    .regex(timeRegex, "Return time is required")
    .or(z.literal("")),
});

type EditPickupReturnValues = z.infer<typeof editPickupReturnSchema>;

interface RentalForEdit {
  id: string;
  start_date?: string | null;
  end_date?: string | null;
  pickup_location?: string | null;
  return_location?: string | null;
  pickup_time?: string | null;
  return_time?: string | null;
  delivery_address?: string | null;
  collection_address?: string | null;
  is_pay_as_you_go?: boolean | null;
}

interface EditPickupReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: RentalForEdit | null;
}

const normalizeTime = (t?: string | null) => {
  if (!t) return "";
  const [h = "", m = ""] = t.split(":");
  if (!h || !m) return "";
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
};

// Pick a friendly label for the timezone footer. Tenant-configured timezone wins
// (so an East-coast operator running a fleet in PT sees PT, not their browser);
// fall back to the browser's resolved timezone.
function useDisplayTimezone(): string {
  const { tenant } = useTenant();
  if (tenant?.timezone) return tenant.timezone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "local time";
  }
}

export function EditPickupReturnDialog({
  open,
  onOpenChange,
  rental,
}: EditPickupReturnDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();
  const tz = useDisplayTimezone();
  const isPayg = !!rental?.is_pay_as_you_go;

  const form = useForm<EditPickupReturnValues>({
    resolver: zodResolver(editPickupReturnSchema),
    defaultValues: {
      start_date: undefined as any,
      end_date: null,
      pickup_location: "",
      pickup_time: "",
      return_location: "",
      return_time: "",
    },
  });

  useEffect(() => {
    if (open && rental) {
      form.reset({
        start_date: rental.start_date ? parseLocalDate(rental.start_date) : (undefined as any),
        end_date: rental.end_date ? parseLocalDate(rental.end_date) : null,
        pickup_location:
          rental.pickup_location || rental.delivery_address || "",
        pickup_time: normalizeTime(rental.pickup_time),
        return_location:
          rental.return_location || rental.collection_address || "",
        return_time: normalizeTime(rental.return_time),
      });
    }
  }, [open, rental, form]);

  const updateMutation = useMutation({
    mutationFn: async (values: EditPickupReturnValues) => {
      if (!rental) throw new Error("No rental selected");

      // Format Date back to YYYY-MM-DD before writing to the rentals table.
      // parseLocalDate gave us a Date at local midnight, so the calendar day is
      // exactly what the operator picked — formatting it via toISOString would
      // shift it back to UTC and re-introduce the off-by-one we just fixed.
      const ymd = (d?: Date | null) => {
        if (!d) return null;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };

      let query = supabase
        .from("rentals")
        .update({
          start_date: ymd(values.start_date)!,
          // PAYG rentals stay open-ended even if the operator briefly picked a date
          end_date: isPayg ? null : ymd(values.end_date),
          pickup_location: values.pickup_location,
          return_location: values.return_location,
          pickup_time: values.pickup_time || null,
          return_time: values.return_time || null,
          // Clear saved-location FKs since we're now using freeform addresses
          pickup_location_id: null,
          return_location_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rental.id);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;
      if (error) throw error;
    },
    onSuccess: (_data, values) => {
      toast({
        title: "Rental period updated",
        description: "Dates, locations and times have been saved.",
      });
      if (rental) {
        queryClient.invalidateQueries({ queryKey: ["rental", rental.id] });
      }
      queryClient.invalidateQueries({ queryKey: ["rentals"] });
      queryClient.invalidateQueries({ queryKey: ["enhanced-rentals"] });
      queryClient.invalidateQueries({ queryKey: ["customer-rentals"] });

      if (rental) {
        logAction({
          action: "rental_pickup_return_updated",
          entityType: "rental",
          entityId: rental.id,
          details: {
            start_date: values.start_date?.toISOString().split("T")[0] ?? null,
            end_date: isPayg ? null : (values.end_date?.toISOString().split("T")[0] ?? null),
            pickup_location: values.pickup_location,
            pickup_time: values.pickup_time || null,
            return_location: values.return_location,
            return_time: values.return_time || null,
          },
        });
      }

      onOpenChange(false);
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Failed to update.";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: EditPickupReturnValues) => {
    updateMutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Edit Rental Period
          </DialogTitle>
          <DialogDescription>
            Update the pickup and return dates, times, and locations for this rental. Times are shown in <span className="font-medium">{tz}</span>.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500">
                Pickup
              </p>

              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Date</FormLabel>
                    <Popover modal>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pickup_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time</FormLabel>
                    <FormControl>
                      <TimePicker
                        id="pickup_time"
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        placeholder="Select pickup time"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pickup_location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <LocationAutocomplete
                        id="pickup_location"
                        value={field.value}
                        onChange={(address) => field.onChange(address)}
                        placeholder="Enter pickup address"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-500">
                Return
              </p>

              {!isPayg && (
                <FormField
                  control={form.control}
                  name="end_date"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Date</FormLabel>
                      <Popover modal>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value ?? undefined}
                            onSelect={(d) => field.onChange(d ?? null)}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {isPayg && (
                <p className="text-sm text-muted-foreground italic">
                  Pay-As-You-Go rentals are open-ended — no return date.
                </p>
              )}

              <FormField
                control={form.control}
                name="return_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time</FormLabel>
                    <FormControl>
                      <TimePicker
                        id="return_time"
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        placeholder="Select return time"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="return_location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <LocationAutocomplete
                        id="return_location"
                        value={field.value}
                        onChange={(address) => field.onChange(address)}
                        placeholder="Enter return address"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default EditPickupReturnDialog;
