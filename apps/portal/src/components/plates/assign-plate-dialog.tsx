import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
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
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { assignPlateSchema, type AssignPlateFormValues } from "@/client-schemas/plates/assign-plate";

type AssignFormData = AssignPlateFormValues;

interface Plate {
  id: string;
  plate_number: string;
  retention_doc_reference: string;
  assigned_vehicle_id: string;
  notes: string;
}

interface Vehicle {
  id: string;
  reg: string;
  make: string;
  model: string;
  status: string;
}

interface AssignPlateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plate: Plate | null;
  onSuccess: () => void;
}

export const AssignPlateDialog = ({
  open,
  onOpenChange,
  plate,
  onSuccess,
}: AssignPlateDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { tenant } = useTenant();

  const form = useForm<AssignFormData>({
    resolver: zodResolver(assignPlateSchema),
    defaultValues: {
      vehicle_id: "",
    },
  });

  // Get available vehicles (not currently assigned to other plates)
  const { data: vehicles } = useQuery({
    queryKey: ["available-vehicles", tenant?.id],
    queryFn: async () => {
      let vehiclesQuery = supabase
        .from("vehicles")
        .select("*")
        .order("reg");

      if (tenant?.id) {
        vehiclesQuery = vehiclesQuery.eq("tenant_id", tenant.id);
      }

      const { data, error } = await vehiclesQuery;

      if (error) throw error;

      // Get currently assigned vehicles
      let platesQuery = supabase
        .from("plates")
        .select("assigned_vehicle_id")
        .not("assigned_vehicle_id", "is", null);

      if (tenant?.id) {
        platesQuery = platesQuery.eq("tenant_id", tenant.id);
      }

      const { data: assignedPlates } = await platesQuery;

      const assignedVehicleIds = assignedPlates?.map(p => p.assigned_vehicle_id) || [];

      // Filter out assigned vehicles (except the current plate's vehicle if it has one)
      return (data as Vehicle[]).filter(vehicle =>
        !assignedVehicleIds.includes(vehicle.id) || vehicle.id === plate?.assigned_vehicle_id
      );
    },
    enabled: open,
  });

  const onSubmit = async (data: AssignFormData) => {
    if (!plate) return;
    
    setIsSubmitting(true);
    try {
      let query = supabase
        .from("plates")
        .update({ assigned_vehicle_id: data.vehicle_id })
        .eq("id", plate.id);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;

      toast({
        title: "Success",
        description: "Plate assigned successfully",
      });

      form.reset();
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to assign plate",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!plate) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Assign Plate to Vehicle</DialogTitle>
          <DialogDescription>
            Assign plate "{plate.plate_number}" to a vehicle.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="vehicle_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Vehicle</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a vehicle" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {vehicles?.map((vehicle) => (
                        <SelectItem key={vehicle.id} value={vehicle.id}>
                          {vehicle.reg} - {vehicle.make} {vehicle.model} ({vehicle.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Assigning..." : "Assign Plate"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};