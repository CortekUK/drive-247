import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Car } from "lucide-react";
import { enhancedAssignPlateSchema, type EnhancedAssignPlateFormValues } from "@/client-schemas/plates/enhanced-assign-plate";

type AssignFormData = EnhancedAssignPlateFormValues;

interface Plate {
  id: string;
  plate_number: string;
  status: string;
  vehicle_id?: string;
}

interface Vehicle {
  id: string;
  reg: string;
  make: string;
  model: string;
  status: string;
}

interface VehicleWithPlate extends Vehicle {
  current_plate?: {
    id: string;
    plate_number: string;
  };
}

interface EnhancedAssignPlateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plate: Plate | null;
  onSuccess: () => void;
}

export const EnhancedAssignPlateDialog = ({
  open,
  onOpenChange,
  plate,
  onSuccess,
}: EnhancedAssignPlateDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictMode, setConflictMode] = useState<'replace' | null>(null);
  const [conflictVehicle, setConflictVehicle] = useState<VehicleWithPlate | null>(null);
  const { toast } = useToast();

  const form = useForm<AssignFormData>({
    resolver: zodResolver(enhancedAssignPlateSchema),
    defaultValues: {
      vehicle_id: plate?.vehicle_id || "",
      assignment_note: "",
    },
  });

  // Get vehicles with current plate assignments
  const { data: vehicles, isLoading: vehiclesLoading } = useQuery({
    queryKey: ["vehicles-with-plates"],
    queryFn: async () => {
      const { data: vehiclesData, error: vehiclesError } = await supabase
        .from("vehicles")
        .select("*")
        .eq("status", "Available")
        .order("reg");
      
      if (vehiclesError) throw vehiclesError;

      // Get current plate assignments
      const { data: platesData, error: platesError } = await supabase
        .from("plates")
        .select("id, plate_number, vehicle_id")
        .not("vehicle_id", "is", null)
        .in("status", ["assigned", "fitted"]);
      
      if (platesError) throw platesError;

      // Combine data
      const vehiclesWithPlates = vehiclesData.map(vehicle => ({
        ...vehicle,
        current_plate: platesData.find(p => p.vehicle_id === vehicle.id)
      }));

      return vehiclesWithPlates as VehicleWithPlate[];
    },
    enabled: open,
  });

  const handleVehicleSelect = (vehicleId: string) => {
    const selectedVehicle = vehicles?.find(v => v.id === vehicleId);
    
    if (selectedVehicle?.current_plate && selectedVehicle.current_plate.id !== plate?.id) {
      setConflictVehicle(selectedVehicle);
      setConflictMode('replace');
    } else {
      setConflictMode(null);
      setConflictVehicle(null);
    }
    
    form.setValue('vehicle_id', vehicleId);
  };

  const onSubmit = async (data: AssignFormData) => {
    if (!plate) return;
    
    setIsSubmitting(true);
    try {
      // If replacing existing plate, unassign it first
      if (conflictMode === 'replace' && conflictVehicle?.current_plate) {
        const { error: unassignError } = await supabase
          .from("plates")
          .update({ 
            vehicle_id: null, 
            status: 'received',
            updated_at: new Date().toISOString()
          })
          .eq("id", conflictVehicle.current_plate.id);

        if (unassignError) throw unassignError;

        // Log unassignment event
        await supabase.from("vehicle_events").insert({
          vehicle_id: data.vehicle_id,
          event_type: "expense_added",
          summary: `Plate ${conflictVehicle.current_plate.plate_number} unassigned (replaced by ${plate.plate_number})`,
          reference_id: conflictVehicle.current_plate.id,
          reference_table: "plates"
        });
      }

      // Assign new plate
      const { error } = await supabase
        .from("plates")
        .update({ 
          vehicle_id: data.vehicle_id, 
          status: 'assigned',
          updated_at: new Date().toISOString()
        })
        .eq("id", plate.id);

      if (error) throw error;

      // Log assignment event
      await supabase.from("vehicle_events").insert({
        vehicle_id: data.vehicle_id,
        event_type: "expense_added",
        summary: `Plate ${plate.plate_number} assigned${data.assignment_note ? ` - ${data.assignment_note}` : ''}`,
        reference_id: plate.id,
        reference_table: "plates"
      });

      const vehicle = vehicles?.find(v => v.id === data.vehicle_id);
      toast({
        title: "Success",
        description: `Plate ${plate.plate_number} assigned to ${vehicle?.reg || 'vehicle'}`,
      });

      form.reset();
      setConflictMode(null);
      setConflictVehicle(null);
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
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            Assign Plate to Vehicle
          </DialogTitle>
          <DialogDescription>
            Assign plate "{plate.plate_number}" to a vehicle. This will update the plate status to "Assigned".
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
                  <Select onValueChange={handleVehicleSelect} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a vehicle" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {vehiclesLoading ? (
                        <SelectItem value="loading" disabled>Loading vehicles...</SelectItem>
                      ) : vehicles?.map((vehicle) => (
                        <SelectItem key={vehicle.id} value={vehicle.id}>
                          <div className="flex items-center justify-between w-full">
                            <span>{vehicle.reg} - {vehicle.make} {vehicle.model}</span>
                            {vehicle.current_plate && (
                              <Badge variant="outline" className="ml-2">
                                {vehicle.current_plate.plate_number}
                              </Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Conflict Warning */}
            {conflictMode === 'replace' && conflictVehicle && (
              <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="font-semibold text-amber-800">Plate Replacement Required</h4>
                    <p className="text-sm text-amber-700 mt-1">
                      Vehicle {conflictVehicle.reg} already has plate {conflictVehicle.current_plate?.plate_number} assigned.
                      Proceeding will unassign the current plate and assign {plate.plate_number}.
                    </p>
                    <div className="mt-2 text-xs text-amber-600">
                      ✓ Current plate will be set to "Received" status
                      <br />
                      ✓ New plate will be set to "Assigned" status
                      <br />
                      ✓ Both changes will be logged in vehicle history
                    </div>
                  </div>
                </div>
              </div>
            )}

            <FormField
              control={form.control}
              name="assignment_note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assignment Note (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add a note about this assignment..."
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
              <Button 
                type="submit" 
                disabled={isSubmitting}
                variant={conflictMode === 'replace' ? 'destructive' : 'default'}
              >
                {isSubmitting ? "Assigning..." : 
                 conflictMode === 'replace' ? "Replace & Assign" : "Assign Plate"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};