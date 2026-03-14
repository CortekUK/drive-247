"use client";

import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "@/integrations/supabase/client";
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
import { AlertTriangle, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";
import { DatePickerInput } from "@/components/shared/forms/date-picker-input";
import { CurrencyInput } from "@/components/shared/forms/currency-input";
import { EnhancedFileUpload } from "@/components/fines/enhanced-file-upload";
import { getCurrencySymbol } from "@/lib/format-utils";

const fineSchema = z.object({
  type: z.string().min(1, "Fine type is required"),
  rental_id: z.string().min(1, "Rental is required"),
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

interface AddFineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedCustomerId?: string;
}

export const AddFineDialog = ({ open, onOpenChange, preselectedCustomerId }: AddFineDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();
  const [loading, setLoading] = useState(false);
  const [evidenceFiles, setEvidenceFiles] = useState<FileWithPreview[]>([]);
  const [showOtherTypeDialog, setShowOtherTypeDialog] = useState(false);
  const [otherTypeValue, setOtherTypeValue] = useState("");
  const [selectedTypeOption, setSelectedTypeOption] = useState("PCN");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'GBP');

  const form = useForm<FineFormData>({
    resolver: zodResolver(fineSchema),
    defaultValues: {
      type: "PCN",
      rental_id: "",
      vehicle_id: "",
      customer_id: "",
      reference_no: "",
      issue_date: new Date(),
      due_date: new Date(new Date().getTime() + 28 * 24 * 60 * 60 * 1000),
      amount: undefined,
      notes: "",
    },
  });

  const watchedIssueDate = form.watch("issue_date");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      form.reset({
        type: "PCN",
        rental_id: "",
        vehicle_id: "",
        customer_id: preselectedCustomerId || "",
        reference_no: "",
        issue_date: new Date(),
        due_date: new Date(new Date().getTime() + 28 * 24 * 60 * 60 * 1000),
        amount: undefined,
        notes: "",
      });
      setEvidenceFiles([]);
      setSelectedTypeOption("PCN");
      setOtherTypeValue("");
      setSelectedCustomerId(preselectedCustomerId || "");
    }
  }, [open, form, preselectedCustomerId]);

  // Auto-update due date when issue date changes
  const handleIssueDateChange = (date: Date | undefined) => {
    if (date) {
      form.setValue("issue_date", date);
      const newDueDate = new Date(date.getTime() + 28 * 24 * 60 * 60 * 1000);
      form.setValue("due_date", newDueDate);
    }
  };

  const { data: customers } = useQuery({
    queryKey: ["customers-for-fines", tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];

      const { data, error } = await supabase
        .from("customers")
        .select("id, name, email, phone, status")
        .eq("tenant_id", tenant.id)
        .order("name");

      if (error) throw error;
      return data || [];
    },
    enabled: !!tenant?.id && open,
  });

  const { data: customerRentals } = useQuery({
    queryKey: ["customer-rentals-for-fines", tenant?.id, selectedCustomerId],
    queryFn: async () => {
      if (!tenant?.id || !selectedCustomerId) return [];

      // First fetch rentals
      const { data: rentals, error: rentalsError } = await supabase
        .from("rentals")
        .select("id, rental_number, start_date, end_date, status, vehicle_id")
        .eq("tenant_id", tenant.id)
        .eq("customer_id", selectedCustomerId)
        .order("created_at", { ascending: false });

      if (rentalsError) throw rentalsError;

      if (!rentals || rentals.length === 0) return [];

      // Then fetch vehicles for those rentals
      const vehicleIds = [...new Set(rentals.map(r => r.vehicle_id).filter(Boolean))];
      const { data: vehicles } = await supabase
        .from("vehicles")
        .select("id, reg, make, model")
        .in("id", vehicleIds);

      const vehicleMap = new Map((vehicles || []).map(v => [v.id, v]));

      return rentals.map(rental => ({
        ...rental,
        vehicles: vehicleMap.get(rental.vehicle_id) || null,
      }));
    },
    enabled: !!tenant?.id && !!selectedCustomerId && open,
  });

  const createFineMutation = useMutation({
    mutationFn: async (data: FineFormData) => {
      const { data: fine, error: fineError } = await supabase
        .from("fines")
        .insert({
          type: data.type,
          vehicle_id: data.vehicle_id,
          customer_id: data.customer_id,
          rental_id: data.rental_id || null,
          reference_no: data.reference_no || null,
          issue_date: `${data.issue_date.getFullYear()}-${String(data.issue_date.getMonth() + 1).padStart(2, '0')}-${String(data.issue_date.getDate()).padStart(2, '0')}`,
          due_date: `${data.due_date.getFullYear()}-${String(data.due_date.getMonth() + 1).padStart(2, '0')}-${String(data.due_date.getDate()).padStart(2, '0')}`,
          amount: data.amount,
          notes: data.notes || null,
          status: "Open",
          tenant_id: tenant?.id || null,
        })
        .select()
        .single();

      if (fineError) throw fineError;

      // Create ledger entry so fine amount is included in customer balance
      const issueDate = `${data.issue_date.getFullYear()}-${String(data.issue_date.getMonth() + 1).padStart(2, '0')}-${String(data.issue_date.getDate()).padStart(2, '0')}`;
      const dueDate = `${data.due_date.getFullYear()}-${String(data.due_date.getMonth() + 1).padStart(2, '0')}-${String(data.due_date.getDate()).padStart(2, '0')}`;

      await supabase
        .from("ledger_entries")
        .insert({
          customer_id: data.customer_id,
          vehicle_id: data.vehicle_id,
          rental_id: data.rental_id || null,
          entry_date: issueDate,
          due_date: dueDate,
          type: "Charge",
          category: "Fine",
          amount: data.amount,
          remaining_amount: data.amount,
          reference: `FINE-${fine.id}`,
          tenant_id: tenant?.id || null,
        });

      if (evidenceFiles.length > 0) {
        for (const file of evidenceFiles) {
          const fileName = `${fine.id}/${Date.now()}-${file.name}`;

          const { error: uploadError } = await supabase.storage
            .from('fine-evidence')
            .upload(fileName, file);

          if (uploadError) throw uploadError;

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
      queryClient.invalidateQueries({ queryKey: ["customer-balance"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance-status"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
      onOpenChange(false);
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-primary" />
              Add New Fine
            </DialogTitle>
            <DialogDescription>
              Record a new traffic fine or penalty
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {/* Fine Type */}
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

              {/* Customer */}
              <FormField
                control={form.control}
                name="customer_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer <span className="text-red-500">*</span></FormLabel>
                    <Select onValueChange={(val) => {
                          field.onChange(val);
                          setSelectedCustomerId(val);
                          form.setValue("rental_id", "");
                          form.setValue("vehicle_id", "");
                          form.setValue("reference_no", "");
                        }} value={field.value} disabled={!!preselectedCustomerId}>
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
                            <div className="flex flex-col items-start w-[200px]">
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

              {/* Rental */}
              <FormField
                control={form.control}
                name="rental_id"
                render={({ field }) => {
                  const selectedRental = customerRentals?.find((r: any) => r.id === field.value);
                  return (
                    <FormItem>
                      <FormLabel>Rental <span className="text-red-500">*</span></FormLabel>
                      <Select
                        onValueChange={(rentalId) => {
                          field.onChange(rentalId);
                          const rental = customerRentals?.find((r: any) => r.id === rentalId);
                          if (rental) {
                            form.setValue("vehicle_id", rental.vehicle_id);
                            form.setValue("reference_no", rental.vehicles?.reg || "");
                          }
                        }}
                        value={field.value}
                        disabled={!selectedCustomerId}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={!selectedCustomerId ? "Select customer first" : "Select rental"}>
                              {selectedRental
                                ? `${(selectedRental as any).rental_number || selectedRental.id.slice(0, 8)} — ${new Date((selectedRental as any).start_date).toLocaleDateString()} to ${new Date((selectedRental as any).end_date).toLocaleDateString()}`
                                : (!selectedCustomerId ? "Select customer first" : "Select rental")}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-[300px]">
                          {customerRentals && customerRentals.length > 0 ? (
                            customerRentals.map((rental: any) => (
                              <SelectItem key={rental.id} value={rental.id} className="py-2">
                                <span className="truncate">
                                  {rental.rental_number || rental.id.slice(0, 8)} — {new Date(rental.start_date).toLocaleDateString()} to {new Date(rental.end_date).toLocaleDateString()}
                                </span>
                              </SelectItem>
                            ))
                          ) : (
                            <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                              No rentals found for this customer
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      {!selectedCustomerId && (
                        <p className="text-xs text-muted-foreground">Select a customer first to see their rentals</p>
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

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

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              </div>

              {/* Amount */}
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
                        currencySymbol={currencySymbol}
                      />
                    </FormControl>
                    <FormDescription>
                      Charging the customer is an explicit action after creation.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                        className="min-h-[80px]"
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

              {/* Footer */}
              <DialogFooter className="pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !form.formState.isValid}
                  className="bg-gradient-primary"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {loading ? "Creating..." : "Create Fine"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

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
    </>
  );
};

export default AddFineDialog;
