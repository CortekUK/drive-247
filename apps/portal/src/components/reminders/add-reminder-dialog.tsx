"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon, Clock } from "lucide-react";
import { useCreateReminder } from "@/hooks/use-reminders";

import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 12 }, (_, i) => {
  const h = i + 1;
  return { value: String(h), label: String(h).padStart(2, "0") };
});

const MINUTES = ["00", "15", "30", "45"].map((m) => ({
  value: m,
  label: m,
}));

const reminderFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title must be 200 characters or less"),
  description: z.string().optional(),
  date: z.date({ required_error: "Date is required" }),
  hour: z.string().default("9"),
  minute: z.string().default("00"),
  period: z.enum(["AM", "PM"]).default("AM"),
  severity: z.enum(["critical", "warning", "info"], {
    required_error: "Severity is required",
  }),
  object_type: z.enum(["Vehicle", "Rental", "Customer", "Fine", "Integration", "Document"], {
    required_error: "Type is required",
  }),
});

type ReminderFormValues = z.infer<typeof reminderFormSchema>;

interface AddReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill the title field */
  defaultTitle?: string;
  /** Pre-fill the object type */
  defaultObjectType?: "Vehicle" | "Rental" | "Customer" | "Fine" | "Integration" | "Document";
}

export function AddReminderDialog({ open, onOpenChange, defaultTitle, defaultObjectType }: AddReminderDialogProps) {
  const createReminder = useCreateReminder();

  const form = useForm<ReminderFormValues>({
    resolver: zodResolver(reminderFormSchema),
    defaultValues: {
      title: defaultTitle || "",
      description: "",
      hour: "9",
      minute: "00",
      period: "AM",
      severity: "info",
      object_type: defaultObjectType || "Rental",
    },
  });

  // Update defaults when props change (e.g. opening from different rows)
  useEffect(() => {
    if (open) {
      if (defaultTitle) form.setValue("title", defaultTitle);
      if (defaultObjectType) form.setValue("object_type", defaultObjectType);
    }
  }, [open, defaultTitle, defaultObjectType]);

  const onSubmit = (values: ReminderFormValues) => {
    let hour24 = parseInt(values.hour);
    if (values.period === "PM" && hour24 !== 12) hour24 += 12;
    if (values.period === "AM" && hour24 === 12) hour24 = 0;
    const dateTime = new Date(values.date);
    dateTime.setHours(hour24, parseInt(values.minute), 0, 0);
    const isoDate = dateTime.toISOString();

    createReminder.mutate(
      {
        title: values.title,
        message: values.description || undefined,
        due_on: isoDate,
        remind_on: isoDate,
        severity: values.severity,
        object_type: values.object_type,
      },
      {
        onSuccess: () => {
          form.reset();
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>New Reminder</DialogTitle>
          <DialogDescription>
            Create a new reminder with a title, date, severity and type.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. MOT due for TX25 AAH" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional details about this reminder..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Date <span className="text-red-500">*</span></FormLabel>
                    <Popover modal={true}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? format(field.value, "PPP") : "Pick a date"}
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

              <div className="flex flex-col gap-2">
                <FormLabel>Time</FormLabel>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <FormField
                    control={form.control}
                    name="hour"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger className="w-[68px] h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HOURS.map((h) => (
                            <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <span className="text-muted-foreground font-medium">:</span>
                  <FormField
                    control={form.control}
                    name="minute"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger className="w-[68px] h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MINUTES.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="period"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger className="w-[72px] h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AM">AM</SelectItem>
                          <SelectItem value="PM">PM</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="severity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Severity <span className="text-red-500">*</span></FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select severity" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="critical">Critical</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="info">Info</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="object_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type <span className="text-red-500">*</span></FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Vehicle">Vehicle</SelectItem>
                        <SelectItem value="Rental">Rental</SelectItem>
                        <SelectItem value="Customer">Customer</SelectItem>
                        <SelectItem value="Fine">Fine</SelectItem>
                        <SelectItem value="Integration">Integration</SelectItem>
                        <SelectItem value="Document">Document</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createReminder.isPending}>
                {createReminder.isPending ? "Saving..." : "Save Reminder"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
