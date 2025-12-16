import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CalendarIcon, Upload, X, FileText } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { enhancedAddPlateSchema, type EnhancedAddPlateFormValues } from "@/client-schemas/plates/enhanced-add-plate";

type PlateFormData = EnhancedAddPlateFormValues;

interface Plate {
  id: string;
  plate_number: string;
  vehicle_id?: string;
  supplier?: string;
  order_date?: string;
  cost?: number;
  status: string;
  retention_doc_reference?: string;
  notes?: string;
  document_url?: string;
  document_name?: string;
}

interface EnhancedAddPlateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  preSelectedVehicleId?: string;
  editPlate?: Plate | null;
}

export const EnhancedAddPlateDialog = ({
  open,
  onOpenChange,
  onSuccess,
  preSelectedVehicleId,
  editPlate,
}: EnhancedAddPlateDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [existingDocumentUrl, setExistingDocumentUrl] = useState(editPlate?.document_url || null);
  const [existingDocumentName, setExistingDocumentName] = useState(editPlate?.document_name || null);
  const { toast } = useToast();

  const isEditing = !!editPlate;

  const form = useForm<PlateFormData>({
    resolver: zodResolver(enhancedAddPlateSchema),
    defaultValues: {
      plate_number: "",
      vehicle_id: "none",
      supplier: "",
      order_date: undefined,
      cost: "0" as any,
      status: 'ordered',
      retention_doc_reference: "",
      notes: "",
    },
  });

  // Reset form when dialog opens with plate data
  useEffect(() => {
    if (open) {
      if (editPlate) {
        // Editing mode - populate with plate data
        form.reset({
          plate_number: editPlate.plate_number,
          vehicle_id: editPlate.vehicle_id || "none",
          supplier: editPlate.supplier || "",
          order_date: editPlate.order_date ? new Date(editPlate.order_date) : undefined,
          cost: (editPlate.cost?.toString() || "0") as any,
          status: (editPlate.status as any) || 'ordered',
          retention_doc_reference: editPlate.retention_doc_reference || "",
          notes: editPlate.notes || "",
        });
        setExistingDocumentUrl(editPlate.document_url || null);
        setExistingDocumentName(editPlate.document_name || null);
      } else {
        // Adding mode - reset to defaults
        form.reset({
          plate_number: "",
          vehicle_id: preSelectedVehicleId || "none",
          supplier: "",
          order_date: undefined,
          cost: "0" as any,
          status: preSelectedVehicleId ? 'assigned' : 'ordered',
          retention_doc_reference: "",
          notes: "",
        });
        setExistingDocumentUrl(null);
        setExistingDocumentName(null);
      }
      setUploadedFile(null);
    }
  }, [open, editPlate, preSelectedVehicleId, form]);

  // Get available vehicles
  const { data: vehicles } = useQuery({
    queryKey: ["vehicles-for-plates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg, make, model, status")
        .in("status", ["Available", "Rented"])
        .order("reg");
      
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Watch status to enforce business rules
  const watchedStatus = form.watch("status");

  // Validate plate number uniqueness
  const checkPlateUniqueness = async (plateNumber: string): Promise<string | true> => {
    if (!plateNumber || plateNumber === editPlate?.plate_number) return true;
    
    let query = supabase
      .from("plates")
      .select("id")
      .eq("plate_number", plateNumber.toUpperCase().replace(/\s+/g, ''));
    
    // Only apply neq filter when editing an existing plate
    if (editPlate?.id) {
      query = query.neq("id", editPlate.id);
    }
    
    const { data, error } = await query;
    
    if (error) return "Error checking plate number";
    return data.length === 0 ? true : "This plate number already exists";
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Basic validation
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        toast({
          title: "File too large",
          description: "Please select a file smaller than 10MB",
          variant: "destructive",
        });
        return;
      }

      setUploadedFile(file);
      setExistingDocumentUrl(null); // Clear existing if uploading new
      setExistingDocumentName(null);
    }
  };

  const removeFile = () => {
    setUploadedFile(null);
    // Reset file input
    const fileInput = document.getElementById('document-upload') as HTMLInputElement;
    if (fileInput) fileInput.value = '';
  };

  const removeExistingDocument = () => {
    setExistingDocumentUrl(null);
    setExistingDocumentName(null);
  };

  const onSubmit = async (data: PlateFormData) => {
    setIsSubmitting(true);
    
    try {
      // Check uniqueness if not editing or if plate number changed
      if (!isEditing || data.plate_number !== editPlate?.plate_number) {
        const uniqueCheck = await checkPlateUniqueness(data.plate_number);
        if (uniqueCheck !== true) {
          form.setError("plate_number", { message: uniqueCheck });
          setIsSubmitting(false);
          return;
        }
      }

      // Business rule validations
      if (data.status === 'assigned' && (!data.vehicle_id || data.vehicle_id === 'none')) {
        form.setError("vehicle_id", { message: "Vehicle is required when status is Assigned" });
        setIsSubmitting(false);
        return;
      }

      if (data.order_date && data.order_date > new Date() && ['received', 'assigned'].includes(data.status)) {
        form.setError("order_date", { message: "Order date cannot be in the future for Received/Assigned plates" });
        setIsSubmitting(false);
        return;
      }

      let documentUrl = existingDocumentUrl;
      let documentName = existingDocumentName;

      // Upload document if new file selected
      if (uploadedFile) {
        const fileExt = uploadedFile.name.split('.').pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const filePath = `plates/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, uploadedFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('documents')
          .getPublicUrl(filePath);

        documentUrl = publicUrl;
        documentName = uploadedFile.name; // Save original filename
      }

      // Prepare plate data
      const plateData = {
        plate_number: data.plate_number,
        vehicle_id: data.vehicle_id === 'none' ? null : data.vehicle_id || null,
        supplier: data.supplier || null,
        order_date: data.order_date?.toISOString().split('T')[0] || null,
        cost: data.cost,
        status: data.status,
        retention_doc_reference: data.retention_doc_reference || null,
        notes: data.notes || null,
        document_url: documentUrl,
        document_name: documentName,
        updated_at: new Date().toISOString(),
      };

      if (isEditing) {
        // Update existing plate
        const { error } = await supabase
          .from("plates")
          .update(plateData)
          .eq("id", editPlate.id);

        if (error) throw error;

        // Log update event
        if (data.vehicle_id && data.vehicle_id !== 'none') {
          await supabase.from("vehicle_events").insert({
            vehicle_id: data.vehicle_id,
            event_type: "expense_added",
            summary: `Plate ${data.plate_number} updated`,
            reference_id: editPlate.id,
            reference_table: "plates"
          });
        }

        toast({
          title: "Success",
          description: "Plate updated successfully",
        });
      } else {
        // Create new plate
        const { data: newPlate, error } = await supabase
          .from("plates")
          .insert(plateData)
          .select()
          .single();

        if (error) throw error;

        // Log creation event
        if (data.vehicle_id && data.vehicle_id !== 'none') {
          await supabase.from("vehicle_events").insert({
            vehicle_id: data.vehicle_id,
            event_type: "expense_added",
            summary: `Plate ${data.plate_number} created`,
            reference_id: newPlate.id,
            reference_table: "plates"
          });
        }

        toast({
          title: "Success",
          description: "Plate added successfully",
        });
      }

      form.reset();
      setUploadedFile(null);
      setExistingDocumentUrl(null);
      setExistingDocumentName(null);
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error("Error saving plate:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to save plate",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Plate" : "Add New Plate"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update plate information and assignment." : "Register a new license plate in the system."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="plate_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plate Number <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g. VS12 ABC" 
                        className="font-mono"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status <span className="text-red-500">*</span></FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ordered">Ordered</SelectItem>
                        <SelectItem value="received">Received</SelectItem>
                        <SelectItem value="assigned">Assigned</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="vehicle_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Vehicle {watchedStatus === 'assigned' && <span className="text-destructive">*</span>}
                  </FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select vehicle (optional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">No Vehicle</SelectItem>
                      {vehicles?.map((vehicle) => (
                        <SelectItem key={vehicle.id} value={vehicle.id}>
                          {vehicle.reg} - {vehicle.make} {vehicle.model}
                          <Badge variant="outline" className="ml-2">
                            {vehicle.status}
                          </Badge>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="supplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supplier</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. DMV Direct" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="order_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Order Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className="w-full pl-3 text-left font-normal"
                          >
                            {field.value ? (
                              format(field.value, "MM/dd/yyyy")
                            ) : (
                              <span className="text-muted-foreground">Pick a date</span>
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
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cost ($)</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        step="0.01" 
                        min="0" 
                        placeholder="0.00" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="retention_doc_reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Retention Document Reference</FormLabel>
                    <FormControl>
                      <Input placeholder="Document reference number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Document Upload */}
            <div className="space-y-2">
              <FormLabel>Document</FormLabel>
              
              {/* Existing document */}
              {existingDocumentUrl && !uploadedFile && (
                <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span className="text-sm">
                      {existingDocumentName || existingDocumentUrl.split('/').pop() || 'Existing document'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(existingDocumentUrl, '_blank')}
                    >
                      View
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={removeExistingDocument}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* New file upload */}
              {uploadedFile ? (
                <div className="flex items-center justify-between p-3 border rounded-lg bg-green-50">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-green-600" />
                    <span className="text-sm">{uploadedFile.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {(uploadedFile.size / 1024 / 1024).toFixed(1)} MB
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={removeFile}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6">
                  <div className="text-center">
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <div className="text-sm text-muted-foreground mb-2">
                      Upload plate document (optional)
                    </div>
                    <input
                      id="document-upload"
                      type="file"
                      className="hidden"
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                      onChange={handleFileUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById('document-upload')?.click()}
                    >
                      Choose File
                    </Button>
                    <div className="text-xs text-muted-foreground mt-1">
                      PDF, Images, or Documents (max 10MB)
                    </div>
                  </div>
                </div>
              )}
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Additional notes about this plate..."
                      rows={3}
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (isEditing ? "Updating..." : "Adding...") : (isEditing ? "Update Plate" : "Add Plate")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
