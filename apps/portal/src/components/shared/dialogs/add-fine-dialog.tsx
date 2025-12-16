import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon, Upload, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

const fineFormSchema = z.object({
  type: z.enum(["PCN", "Speeding", "Other"]),
  vehicle_id: z.string().min(1, "Vehicle is required"),
  customer_id: z.string().min(1, "Customer is required"),
  reference_no: z.string().optional(),
  issue_date: z.date({
    required_error: "Issue date is required",
  }),
  due_date: z.date({
    required_error: "Due date is required",
  }),
  amount: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Amount must be a positive number",
  }),
  liability: z.enum(["Customer", "Company"]).default("Individual"),
  notes: z.string().optional(),
});

type FineFormValues = z.infer<typeof fineFormSchema>;

interface AddFineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle_id?: string;
  customer_id?: string;
}

export const AddFineDialog = ({ open, onOpenChange, vehicle_id, customer_id }: AddFineDialogProps) => {
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const queryClient = useQueryClient();

  const form = useForm<FineFormValues>({
    resolver: zodResolver(fineFormSchema),
    defaultValues: {
      type: "PCN",
      liability: "Customer",
      vehicle_id: vehicle_id || "",
      customer_id: customer_id || "",
    },
  });

  // Reset form with pre-selected values when dialog opens or props change
  useEffect(() => {
    if (open) {
      form.reset({
        type: "Parking",
        liability: "Individual",
        vehicle_id: vehicle_id || "",
        customer_id: customer_id || "",
      });
    }
  }, [open, vehicle_id, customer_id, form]);

  // Fetch pre-selected vehicle if provided
  const { data: preSelectedVehicle } = useQuery({
    queryKey: ["vehicle-info", vehicle_id],
    queryFn: async () => {
      if (!vehicle_id) return null;
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg, make, model")
        .eq("id", vehicle_id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!vehicle_id,
  });

  // Fetch pre-selected customer if provided
  const { data: preSelectedCustomer } = useQuery({
    queryKey: ["customer-info", customer_id],
    queryFn: async () => {
      if (!customer_id) return null;
      const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .eq("id", customer_id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!customer_id,
  });

  // Fetch all customers for generic usage
  const { data: allCustomers } = useQuery({
    queryKey: ["all-customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .order("name");

      if (error) throw error;
      return data;
    },
    
  });

  // Fetch all vehicles for generic usage
  const { data: allVehicles } = useQuery({
    queryKey: ["all-vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg, make, model")
        .order("reg");

      if (error) throw error;
      return data;
    },
  });

  // Fetch active rentals for customer-vehicle sync
  const { data: activeRentals } = useQuery({
    queryKey: ["active-rentals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select(`
          id,
          customer_id,
          vehicle_id,
          customers!inner(id, name),
          vehicles!inner(id, reg, make, model)
        `)
        .eq("status", "Active")
        .order("customers(name)");

      if (error) throw error;

      return data.map(rental => ({
        rental_id: rental.id,
        customer_id: rental.customer_id,
        customer_name: (rental.customers as any).name,
        vehicle_id: rental.vehicle_id,
        vehicle_reg: (rental.vehicles as any).reg,
        vehicle_make: (rental.vehicles as any).make,
        vehicle_model: (rental.vehicles as any).model,
      }));
    },
  });

  const selectedCustomerId = form.watch("customer_id");
  const selectedVehicleId = form.watch("vehicle_id");

  // Get unique customers based on context
  const customers = (() => {
    // If customer is pre-selected, only show that customer
    if (customer_id && preSelectedCustomer) {
      return [{ id: preSelectedCustomer.id, name: preSelectedCustomer.name }];
    }

    // For generic usage (no props), show all customers
    if (allCustomers) {
      return allCustomers;
    }

    return [];
  })();

  // Get vehicles based on context
  const availableVehicles = (() => {
    // If vehicle is pre-selected, only show that vehicle
    if (vehicle_id && preSelectedVehicle) {
      return [{
        vehicle_id: preSelectedVehicle.id,
        vehicle_reg: preSelectedVehicle.reg,
        vehicle_make: preSelectedVehicle.make || '',
        vehicle_model: preSelectedVehicle.model || '',
        customer_name: '',
      }];
    }

    // For generic usage, show all vehicles with renter info if applicable
    if (allVehicles) {
      return allVehicles.map(v => ({
        vehicle_id: v.id,
        vehicle_reg: v.reg,
        vehicle_make: v.make || '',
        vehicle_model: v.model || '',
        customer_name: activeRentals?.find(r => r.vehicle_id === v.id)?.customer_name || '',
      }));
    }

    return [];
  })();

  // Handle customer selection - auto-select vehicle if only one option
  const handleCustomerChange = (customerId: string) => {
    form.setValue("customer_id", customerId);

    // Don't change vehicle if it's pre-selected (from Vehicle Detail page)
    if (vehicle_id) {
      return;
    }

    const customerVehicles = activeRentals?.filter(rental => rental.customer_id === customerId);

    if (customerVehicles?.length === 1) {
      form.setValue("vehicle_id", customerVehicles[0].vehicle_id);
    } else {
      form.setValue("vehicle_id", "");
    }
  };

  // Handle vehicle selection - auto-select customer
  const handleVehicleChange = (vehicleId: string) => {
    form.setValue("vehicle_id", vehicleId);
    const rental = activeRentals?.find(rental => rental.vehicle_id === vehicleId);
    
    if (rental) {
      form.setValue("customer_id", rental.customer_id);
    }
  };

  const createFineMutation = useMutation({
    mutationFn: async (values: FineFormValues) => {
      // Create fine record - the trigger will handle ledger entries automatically
      const { data: fine, error } = await supabase
        .from("fines")
        .insert({
          type: values.type,
          vehicle_id: values.vehicle_id,
          customer_id: values.customer_id,
          reference_no: values.reference_no || null,
          issue_date: format(values.issue_date, "yyyy-MM-dd"),
          due_date: format(values.due_date, "yyyy-MM-dd"),
          amount: Number(values.amount),
          liability: values.liability,
          notes: values.notes || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Upload files if any
      if (uploadedFiles.length > 0) {
        const filePromises = uploadedFiles.map(async (file) => {
          const fileExt = file.name.split('.').pop();
          const fileName = `${fine.id}/${Date.now()}.${fileExt}`;
          
          const { error: uploadError } = await supabase.storage
            .from("fine-evidence")
            .upload(fileName, file);

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from("fine-evidence")
            .getPublicUrl(fileName);

          await supabase
            .from("fine_files")
            .insert({
              fine_id: fine.id,
              file_url: publicUrl,
              file_name: file.name,
            });
        });

        await Promise.all(filePromises);
      }

      return fine;
    },
    onSuccess: () => {
      toast.success("Fine created successfully");
      queryClient.invalidateQueries({ queryKey: ["fines"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle-fines"] });
      queryClient.invalidateQueries({ queryKey: ["customer-fines"] });
      queryClient.invalidateQueries({ queryKey: ["customer-fine-stats"] });
      queryClient.invalidateQueries({ queryKey: ["fines-enhanced"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
      onOpenChange(false);
      form.reset();
      setUploadedFiles([]);
    },
    onError: (error) => {
      console.error("Error creating fine:", error);
      toast.error("Failed to create fine");
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setUploadedFiles((prev) => [...prev, ...files]);
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const onSubmit = (values: FineFormValues) => {
    createFineMutation.mutate(values);
  };

  // Reset form when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      form.reset();
      setUploadedFiles([]);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Fine</DialogTitle>
          <DialogDescription>
            Add a new parking or speeding fine to the system
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select fine type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="PCN">Parking Citation</SelectItem>
                        <SelectItem value="Speeding">Speeding</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="liability"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Liability</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select liability" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Customer">Individual</SelectItem>
                        <SelectItem value="Company">Company</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="customer_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer <span className="text-red-500">*</span></FormLabel>
                  <Select onValueChange={handleCustomerChange} value={field.value} disabled={!!customer_id}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select customer" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {customers?.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="vehicle_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vehicle <span className="text-red-500">*</span></FormLabel>
                  <Select onValueChange={handleVehicleChange} value={field.value} disabled={!!vehicle_id}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select vehicle" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableVehicles?.map((vehicle) => (
                        <SelectItem key={vehicle.vehicle_id} value={vehicle.vehicle_id}>
                          {vehicle.vehicle_reg} - {vehicle.vehicle_make} {vehicle.vehicle_model}
                          {vehicle.customer_name && ` (${vehicle.customer_name})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reference_no"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference Number</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., CITE-123456" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="issue_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Issue Date <span className="text-red-500">*</span></FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => date > new Date()}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="due_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Due Date <span className="text-red-500">*</span></FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
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
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="Enter amount"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional notes about this fine..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div>
              <FormLabel>Evidence Files</FormLabel>
              <div className="mt-2">
                <Input
                  type="file"
                  multiple
                  accept="image/*,.pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="evidence-upload"
                />
                <label
                  htmlFor="evidence-upload"
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 cursor-pointer"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Files
                </label>
              </div>
              {uploadedFiles.length > 0 && (
                <div className="mt-2 space-y-2">
                  {uploadedFiles.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 bg-muted rounded-md"
                    >
                      <span className="text-sm">{file.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createFineMutation.isPending}>
                {createFineMutation.isPending ? "Creating..." : "Create Fine"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
