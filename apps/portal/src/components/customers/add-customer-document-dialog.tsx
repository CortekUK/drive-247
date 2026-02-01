import React, { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CalendarIcon, Upload, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { addCustomerDocumentSchema, type AddCustomerDocumentFormValues } from "@/client-schemas/customers/add-customer-document";

type DocumentFormData = AddCustomerDocumentFormValues;

interface AddCustomerDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  documentId?: string; // For editing existing documents
}

export default function AddCustomerDocumentDialog({
  open,
  onOpenChange,
  customerId,
  documentId,
}: AddCustomerDocumentDialogProps) {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const form = useForm<DocumentFormData>({
    resolver: zodResolver(addCustomerDocumentSchema),
    defaultValues: {
      document_name: "",
      vehicle_id: "none",
      insurance_provider: "",
      policy_number: "",
      notes: "",
    },
  });

  // Fetch customer's vehicles for selection
  const { data: vehicles } = useQuery({
    queryKey: ["customer-vehicles", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select(`
          vehicles!rentals_vehicle_id_fkey(id, reg, make, model)
        `)
        .eq("customer_id", customerId)
        .eq("status", "Active");

      if (error) throw error;
      return data?.map(r => r.vehicles).filter(Boolean) || [];
    },
    enabled: !!customerId,
  });

  // Fetch existing document data if editing
  const { data: existingDocument } = useQuery({
    queryKey: ["customer-document", documentId],
    queryFn: async () => {
      if (!documentId) return null;
      const { data, error } = await supabase
        .from("customer_documents")
        .select("*")
        .eq("id", documentId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!documentId && open,
  });

  // Reset form when dialog opens/closes or document data loads
  React.useEffect(() => {
    if (open && existingDocument) {
      form.reset({
        document_type: existingDocument.document_type as any,
        document_name: existingDocument.document_name,
        vehicle_id: existingDocument.vehicle_id || "none",
        insurance_provider: existingDocument.insurance_provider || "",
        policy_number: existingDocument.policy_number || "",
        start_date: existingDocument.start_date ? new Date(existingDocument.start_date) : undefined,
        end_date: existingDocument.end_date ? new Date(existingDocument.end_date) : undefined,
        notes: existingDocument.notes || "",
      });
    } else if (open && !documentId) {
      form.reset({
        document_name: "",
        vehicle_id: "none",
        insurance_provider: "",
        policy_number: "",
        notes: "",
      });
      setSelectedFile(null);
    }
  }, [open, existingDocument, documentId, form]);

  const uploadFile = async (file: File, customerId: string): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = `${customerId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('customer-documents')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;
    return `customer-documents/${filePath}`;
  };

  const mutation = useMutation({
    mutationFn: async (data: DocumentFormData) => {
      let fileUrl = existingDocument?.file_url;
      let fileName = existingDocument?.file_name;
      let fileSize = existingDocument?.file_size;
      let mimeType = existingDocument?.mime_type;

      // Upload new file if selected
      if (selectedFile) {
        // Delete old file if replacing
        if (existingDocument?.file_url) {
          const oldFilePath = existingDocument.file_url.replace('customer-documents/', '');
          await supabase.storage
            .from('customer-documents')
            .remove([oldFilePath]);
        }

        fileUrl = await uploadFile(selectedFile, customerId);
        fileName = selectedFile.name;
        fileSize = selectedFile.size;
        mimeType = selectedFile.type;
      }

      const documentData = {
        customer_id: customerId,
        vehicle_id: data.vehicle_id === "none" ? null : data.vehicle_id || null,
        document_type: data.document_type,
        document_name: data.document_name,
        file_url: fileUrl,
        file_name: fileName,
        file_size: fileSize,
        mime_type: mimeType,
        insurance_provider: data.insurance_provider || null,
        policy_number: data.policy_number || null,
        start_date: data.start_date?.toISOString().split('T')[0] || null,
        end_date: data.end_date?.toISOString().split('T')[0] || null,
        status: data.end_date ? (data.end_date > new Date() ? 'Active' : 'Expired') : null,
        notes: data.notes || null,
      };

      if (documentId) {
        let updateQuery = supabase
          .from("customer_documents")
          .update(documentData)
          .eq("id", documentId);

        if (tenant?.id) {
          updateQuery = updateQuery.eq("tenant_id", tenant.id);
        }

        const { error } = await updateQuery;
        if (error) throw error;
        return { isUpdate: true, documentId, documentData };
      } else {
        const { data: newDoc, error } = await supabase
          .from("customer_documents")
          .insert({
            ...documentData,
            tenant_id: tenant?.id || null,
          })
          .select("id")
          .single();
        if (error) throw error;
        return { isUpdate: false, documentId: newDoc?.id, documentData };
      }
    },
    onSuccess: (result) => {
      // Audit log for document upload/update
      if (result?.documentId) {
        logAction({
          action: result.isUpdate ? "document_updated" : "document_uploaded",
          entityType: "document",
          entityId: result.documentId,
          details: {
            document_type: result.documentData.document_type,
            document_name: result.documentData.document_name,
            customer_id: customerId
          }
        });
      }

      // Invalidate all customer-documents queries to ensure refresh
      queryClient.invalidateQueries({ queryKey: ["customer-documents"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
      toast.success(documentId ? "Document updated successfully" : "Document added successfully");
      form.reset();
      setSelectedFile(null);
      onOpenChange(false);
    },
    onError: (error) => {
      console.error("Error saving document:", error);
      toast.error("Failed to save document");
    },
  });

  const onSubmit = (data: DocumentFormData) => {
    mutation.mutate(data);
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const watchDocumentType = form.watch("document_type");
  const showInsuranceFields = watchDocumentType === "Insurance Certificate";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{documentId ? "Edit Document" : "Add Document"}</DialogTitle>
          <DialogDescription>
            {documentId ? "Update the document details." : "Add a new document for this customer."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="document_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Document Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select document type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Insurance Certificate">Insurance Certificate</SelectItem>
                      <SelectItem value="Driver's License">Driver's License</SelectItem>
                      <SelectItem value="Social Security">Social Security</SelectItem>
                      <SelectItem value="Address Proof">Address Proof</SelectItem>
                      <SelectItem value="ID Card/Passport">ID Card/Passport</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="document_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Document Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter document name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {vehicles && vehicles.length > 0 && (
              <FormField
                control={form.control}
                name="vehicle_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vehicle (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select vehicle (optional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No vehicle</SelectItem>
                        {vehicles.map(vehicle => (
                          <SelectItem key={vehicle.id} value={vehicle.id}>
                            {vehicle.reg} - {vehicle.make} {vehicle.model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* File Upload Section */}
            <div className="space-y-2">
              <FormLabel>Upload File {!documentId && "(Optional)"}</FormLabel>
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                  dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25",
                  "hover:border-primary/50 hover:bg-primary/5"
                )}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-upload')?.click()}
              >
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  onChange={handleFileSelect}
                  accept="image/*,.pdf,.doc,.docx,.txt"
                />
                
                {selectedFile ? (
                  <div className="flex items-center justify-center space-x-2">
                    <span className="text-sm font-medium">{selectedFile.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : existingDocument?.file_name ? (
                  <div className="text-sm">
                    <p className="font-medium">Current file: {existingDocument.file_name}</p>
                    <p className="text-muted-foreground">Click or drag to replace</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                    <div className="text-sm">
                      <p className="font-medium">Click to upload or drag and drop</p>
                      <p className="text-muted-foreground">Images, PDFs, documents up to 20MB</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {showInsuranceFields && (
              <>
                <FormField
                  control={form.control}
                  name="insurance_provider"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Insurance Provider</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter insurance provider" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="policy_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Policy Number</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter policy number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>
                      {showInsuranceFields ? "Policy Start Date" : "Start Date"}
                    </FormLabel>
                    <Popover modal={true}>
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
                          disabled={(date) =>
                            date > new Date() || date < new Date("1900-01-01")
                          }
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
                name="end_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>
                      {showInsuranceFields ? "Policy End Date" : "End Date (Expiry)"}
                    </FormLabel>
                    <Popover modal={true}>
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
                          disabled={(date) => date < new Date("1900-01-01")}
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
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter any additional notes"
                      className="min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending 
                  ? (documentId ? "Updating..." : "Adding...") 
                  : (documentId ? "Update Document" : "Add Document")
                }
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}