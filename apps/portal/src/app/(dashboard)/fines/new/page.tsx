"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, AlertTriangle, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";
import { DatePickerInput } from "@/components/shared/forms/date-picker-input";
import { CurrencyInput } from "@/components/shared/forms/currency-input";
import { EnhancedFileUpload } from "@/components/fines/enhanced-file-upload";
import { getCurrencySymbol, formatCurrency } from "@/lib/format-utils";

const fineSchema = z.object({
  type: z.string().min(1, "Fine type is required"),
  vehicle_id: z.string().min(1, "Vehicle is required"),
  customer_id: z.string().min(1, "Customer is required"),
  reference_no: z.string().optional(),
  issue_date: z.date(),
  due_date: z.date(),
  amount: z.number().min(1, "Amount must be at least 1"),
  notes: z.string().optional(),
}).refine((data) => data.due_date >= data.issue_date, {
  message: "Due date must be on or after issue date",
  path: ["due_date"],
});

type FineFormData = z.infer<typeof fineSchema>;

interface FileWithPreview extends File {
  id: string;
  preview?: string;
}

const CreateFine = () => {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();
  const [loading, setLoading] = useState(false);
  const [evidenceFiles, setEvidenceFiles] = useState<FileWithPreview[]>([]);
  const [showOtherTypeDialog, setShowOtherTypeDialog] = useState(false);
  const [otherTypeValue, setOtherTypeValue] = useState("");
  const [selectedTypeOption, setSelectedTypeOption] = useState("PCN");
  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'GBP');

  const form = useForm<FineFormData>({
    resolver: zodResolver(fineSchema),
    defaultValues: {
      type: "PCN",
      vehicle_id: "",
      customer_id: "",
      reference_no: "",
      issue_date: new Date(),
      due_date: new Date(new Date().getTime() + 28 * 24 * 60 * 60 * 1000), // 28 days from now
      amount: undefined,
      notes: "",
    },
  });

  const watchedIssueDate = form.watch("issue_date");
  const selectedCustomerId = form.watch("customer_id");

  // Clear vehicle selection when customer changes
  useEffect(() => {
    form.setValue("vehicle_id", "");
  }, [selectedCustomerId, form]);

  // Auto-update due date when issue date changes
  const handleIssueDateChange = (date: Date | undefined) => {
    if (date) {
      form.setValue("issue_date", date);
      // Auto-set due date to +28 days
      const newDueDate = new Date(date.getTime() + 28 * 24 * 60 * 60 * 1000);
      form.setValue("due_date", newDueDate);
    }
  };

  // DEV MODE: Listen for dev panel fill events (only in development)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    const handleDevFillFine = (e: CustomEvent<{
      type: string;
      vehicle_id: string;
      customer_id: string;
      reference_no: string;
      issue_date: Date;
      due_date: Date;
      amount: number;
      notes: string;
    }>) => {
      const data = e.detail;
      console.log('🔧 DEV MODE: Filling fine form with:', data);

      // Set form values
      form.setValue('type', data.type);
      setSelectedTypeOption(['PCN', 'Speeding'].includes(data.type) ? data.type : 'Other');
      form.setValue('vehicle_id', data.vehicle_id);
      form.setValue('customer_id', data.customer_id);
      form.setValue('reference_no', data.reference_no);
      form.setValue('issue_date', new Date(data.issue_date));
      form.setValue('due_date', new Date(data.due_date));
      form.setValue('amount', data.amount);
      form.setValue('notes', data.notes);

      // Trigger form validation
      form.trigger();

      toast({
        title: "Form Auto-Filled",
        description: "Fine form auto-filled by Dev Panel",
      });
    };

    window.addEventListener('dev-fill-fine-form', handleDevFillFine as EventListener);
    return () => window.removeEventListener('dev-fill-fine-form', handleDevFillFine as EventListener);
  }, [form, toast]);

  // Fetch all customers and vehicles for searchable dropdowns
  const { data: customers } = useQuery({
    queryKey: ["customers-for-fines", tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from("customers")
        .select("id, name, email, phone")
        .eq("status", "Active")
        .order("name");

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!tenant,
  });

  const { data: vehicles } = useQuery({
    queryKey: ["rented-vehicles-for-customer", tenant?.id, selectedCustomerId],
    queryFn: async () => {
      // Get unique vehicles that have been rented by this specific customer
      let query = supabase
        .from("rentals")
        .select(`
          vehicle_id,
          vehicles(
            id,
            reg,
            make,
            model,
            status
          )
        `)
        .order("created_at", { ascending: false });

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      // Filter by selected customer
      if (selectedCustomerId) {
        query = query.eq("customer_id", selectedCustomerId);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Extract unique vehicles from the rentals (filter out null vehicles)
      const uniqueVehiclesMap = new Map();
      data?.forEach((rental: any) => {
        if (rental.vehicles && !uniqueVehiclesMap.has(rental.vehicles.id)) {
          uniqueVehiclesMap.set(rental.vehicles.id, rental.vehicles);
        }
      });

      return Array.from(uniqueVehiclesMap.values());
    },
    enabled: !!tenant && !!selectedCustomerId,
  });

  const createFineMutation = useMutation({
    mutationFn: async (data: FineFormData) => {
      // Create fine record
      const { data: fine, error: fineError } = await supabase
        .from("fines")
        .insert({
          type: data.type,
          vehicle_id: data.vehicle_id,
          customer_id: data.customer_id,
          reference_no: data.reference_no || null,
          issue_date: data.issue_date.toISOString().split('T')[0],
          due_date: data.due_date.toISOString().split('T')[0],
          amount: data.amount,
          notes: data.notes || null,
          status: "Open",
          tenant_id: tenant?.id || null,
        })
        .select()
        .single();

      if (fineError) throw fineError;

      // Upload evidence files if any
      if (evidenceFiles.length > 0) {
        for (const file of evidenceFiles) {
          const fileExt = file.name.split('.').pop();
          const fileName = `${fine.id}/${Date.now()}-${file.name}`;

          const { error: uploadError } = await supabase.storage
            .from('fine-evidence')
            .upload(fileName, file);

          if (uploadError) throw uploadError;

          // Create file record
          const { data: { publicUrl } } = supabase.storage
            .from('fine-evidence')
            .getPublicUrl(fileName);

          await supabase
            .from("fine_files")
            .insert({
              fine_id: fine.id,
              file_name: file.name,
              file_url: publicUrl,
              tenant_id: tenant?.id || null,
            });
        }
      }

      return fine;
    },
    onSuccess: (fine) => {
      toast({
        title: "Fine Created",
        description: `Fine ${fine.reference_no || fine.id.slice(0, 8)} created successfully. Not charged yet.`,
      });

      // Audit log for fine creation
      logAction({
        action: "fine_created",
        entityType: "fine",
        entityId: fine.id,
        details: {
          reference_no: fine.reference_no,
          amount: fine.amount,
          type: fine.type
        }
      });

      queryClient.invalidateQueries({ queryKey: ["fines-list"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["customer-fines"] });
      queryClient.invalidateQueries({ queryKey: ["customer-fine-stats"] });
      queryClient.invalidateQueries({ queryKey: ["fines-enhanced"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
      router.push("/fines");
    },
    onError: (error) => {
      console.error("Error creating fine:", error);
      toast({
        title: "Error",
        description: "Failed to create fine. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: FineFormData) => {
    setLoading(true);
    try {
      await createFineMutation.mutateAsync(data);
    } finally {
      setLoading(false);
    }
  };

  const selectedCustomer = customers?.find(c => c.id === form.watch("customer_id"));
  const selectedVehicle = vehicles?.find(v => v.id === form.watch("vehicle_id"));

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => router.push("/fines")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Fines
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Add New Fine</h1>
          <p className="text-muted-foreground">Record a new traffic fine or penalty</p>
        </div>
      </div>

      {/* Two-column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-primary" />
                Fine Details
              </CardTitle>
              <CardDescription>
                Enter the fine information and upload any supporting evidence
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  {/* Type and Liability */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Fine Type <span className="text-red-500">*</span></FormLabel>
                          <Select
                            value={selectedTypeOption}
                            onValueChange={(value) => {
                              if (value === "Other") {
                                setShowOtherTypeDialog(true);
                              } else {
                                setSelectedTypeOption(value);
                                field.onChange(value);
                              }
                            }}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select fine type">
                                  {field.value && !["PCN", "Speeding"].includes(field.value)
                                    ? field.value
                                    : field.value === "PCN"
                                      ? "Parking Citation"
                                      : field.value === "Speeding"
                                        ? "Speeding Violation"
                                        : "Select fine type"}
                                </SelectValue>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="PCN">Parking Citation</SelectItem>
                              <SelectItem value="Speeding">Speeding Violation</SelectItem>
                              <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Customer and Vehicle */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="customer_id"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Customer <span className="text-red-500">*</span></FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select customer">
                                  {selectedCustomer ? selectedCustomer.name : "Select customer"}
                                </SelectValue>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="max-h-[300px]">
                              {customers?.map((customer) => (
                                <SelectItem key={customer.id} value={customer.id} className="py-2">
                                  <div className="flex flex-col items-start w-[250px]">
                                    <span className="font-medium truncate w-full">{customer.name}</span>
                                    <span className="text-xs text-muted-foreground truncate w-full">
                                      {customer.email || customer.phone}
                                    </span>
                                  </div>
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
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                            disabled={!selectedCustomerId}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={!selectedCustomerId ? "Select customer first" : "Select vehicle"} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {vehicles && vehicles.length > 0 ? (
                                vehicles.map((vehicle) => (
                                  <SelectItem key={vehicle.id} value={vehicle.id}>
                                    {vehicle.reg} • {vehicle.make} {vehicle.model}
                                  </SelectItem>
                                ))
                              ) : (
                                <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                                  No vehicles found for this customer
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                          {!selectedCustomerId && (
                            <p className="text-xs text-muted-foreground">Select a customer first to see their rented vehicles</p>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Reference Number */}
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

                  {/* Dates and Amount */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="issue_date"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Issue Date <span className="text-red-500">*</span></FormLabel>
                          <FormControl>
                            <DatePickerInput
                              date={field.value}
                              onSelect={handleIssueDateChange}
                              placeholder="Select issue date"
                              disabled={(date) => date > new Date()}
                            />
                          </FormControl>
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
                          <FormControl>
                            <DatePickerInput
                              date={field.value}
                              onSelect={field.onChange}
                              placeholder="Select due date"
                              disabled={(date) => date < watchedIssueDate}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Amount ({currencySymbol}) <span className="text-red-500">*</span></FormLabel>
                          <FormControl>
                            <CurrencyInput
                              value={field.value}
                              onChange={field.onChange}
                              placeholder="Enter fine amount"
                              min={1}
                              step={1}
                            />
                          </FormControl>
                          <FormDescription>
                            Charging the customer is an explicit action after creation.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Notes */}
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Additional notes about this fine..."
                            className="min-h-[100px]"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Evidence Upload */}
                  <div>
                    <FormLabel>Evidence Files</FormLabel>
                    <EnhancedFileUpload
                      files={evidenceFiles}
                      onFilesChange={setEvidenceFiles}
                      acceptedTypes={['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.doc', '.docx']}
                      maxFiles={10}
                      maxFileSize={20}
                      className="mt-2"
                    />
                  </div>

                  {/* Submit */}
                  <div className="flex items-center gap-4 pt-4">
                    <Button
                      type="submit"
                      disabled={loading || !form.formState.isValid}
                      className="bg-gradient-primary"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {loading ? "Creating..." : "Create Fine"}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push("/fines")}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Preview */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Fine Preview</CardTitle>
              <CardDescription>Review the fine details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Type</p>
                <p className="font-medium">{form.watch("type") || "Not selected"}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground">Customer</p>
                <p className="font-medium">{selectedCustomer?.name || "Not selected"}</p>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground">Vehicle</p>
                <p className="font-medium">
                  {selectedVehicle ? `${selectedVehicle.reg} • ${selectedVehicle.make} ${selectedVehicle.model}` : "Not selected"}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground">Amount</p>
                <p className="font-medium text-lg text-destructive">
                  {formatCurrency(form.watch("amount") || 0, tenant?.currency_code || 'GBP')}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground">Status After Creation</p>
                <p className="font-medium text-amber-600">Open (Not Charged)</p>
              </div>

              <div className="pt-4 border-t">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground">
                    <strong>Next Steps:</strong> After creation, you can charge the fine to the customer's account
                    from the fine detail page.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Other Type Dialog */}
      <Dialog open={showOtherTypeDialog} onOpenChange={setShowOtherTypeDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Custom Fine Type</DialogTitle>
            <DialogDescription>
              Enter a custom name for this fine type
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="e.g., Red Light Violation, Toll Evasion..."
              value={otherTypeValue}
              onChange={(e) => setOtherTypeValue(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowOtherTypeDialog(false);
                setOtherTypeValue("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (otherTypeValue.trim()) {
                  form.setValue("type", otherTypeValue.trim());
                  setSelectedTypeOption("Other");
                  setShowOtherTypeDialog(false);
                  setOtherTypeValue("");
                }
              }}
              disabled={!otherTypeValue.trim()}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CreateFine;
