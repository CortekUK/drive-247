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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { addPlateSchema, type AddPlateFormValues } from "@/client-schemas/plates/add-plate";

type PlateFormData = AddPlateFormValues;

interface AddPlateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  preSelectedVehicleId?: string;
}

export const AddPlateDialog = ({
  open,
  onOpenChange,
  onSuccess,
  preSelectedVehicleId,
}: AddPlateDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  // Fetch vehicles for selection
  const { data: vehicles } = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, reg, make, model")
        .order("reg");
      
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<PlateFormData>({
    resolver: zodResolver(addPlateSchema),
    defaultValues: {
      plate_number: "",
      vehicle_id: preSelectedVehicleId || "",
      supplier: "",
      order_date: "",
      cost: "",
      status: "ordered",
      retention_doc_reference: "",
      notes: "",
    },
  });

  // Update form when preSelectedVehicleId changes
  useEffect(() => {
    if (preSelectedVehicleId) {
      form.setValue("vehicle_id", preSelectedVehicleId);
    }
  }, [preSelectedVehicleId, form]);

  const onSubmit = async (data: PlateFormData) => {
    setIsSubmitting(true);
    try {
      const plateData: any = {
        plate_number: data.plate_number.toUpperCase(),
        vehicle_id: data.vehicle_id === "unassigned" ? null : data.vehicle_id || null,
        supplier: data.supplier || null,
        order_date: data.order_date || null,
        cost: data.cost ? parseFloat(data.cost) : 0,
        status: data.status,
        retention_doc_reference: data.retention_doc_reference || null,
        notes: data.notes || null,
      };

      const { error } = await supabase
        .from("plates")
        .insert(plateData);

      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          throw new Error("Plate number already exists");
        }
        throw error;
      }

      toast({
        title: "Success",
        description: "Plate added successfully",
      });

      form.reset({
        plate_number: "",
        vehicle_id: preSelectedVehicleId || "",
        supplier: "",
        order_date: "",
        cost: "",
        status: "ordered",
        retention_doc_reference: "",
        notes: "",
      });
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add plate",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Plate</DialogTitle>
          <DialogDescription>
            Add a new license plate to the system.
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
                        {...field}
                        placeholder="e.g., ABC123"
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                        className="uppercase"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="vehicle_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vehicle</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a vehicle (optional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="unassigned">No vehicle assigned</SelectItem>
                        {vehicles?.map((vehicle) => (
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="supplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supplier</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Enter supplier name" />
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
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
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
                        {...field} 
                        type="number" 
                        step="0.01"
                        placeholder="0.00" 
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
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ordered">Ordered</SelectItem>
                        <SelectItem value="received">Received</SelectItem>
                        <SelectItem value="fitted">Fitted</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="retention_doc_reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Retention Document Reference</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Enter retention document reference" />
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
                    <Textarea {...field} placeholder="Additional notes about this plate..." />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Adding..." : "Add Plate"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};