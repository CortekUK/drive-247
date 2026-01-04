import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";

export interface ServiceRecord {
  id: string;
  vehicle_id: string;
  service_date: string;
  service_type?: string;
  mileage?: number;
  description?: string;
  cost: number;
  created_at: string;
}

export interface ServiceFormData {
  service_date: string;
  service_type?: string;
  mileage?: number;
  description?: string;
  cost: number;
}

export function useVehicleServices(vehicleId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();

  // Fetch service records for a vehicle
  const { data: serviceRecords = [], isLoading } = useQuery({
    queryKey: ['serviceRecords', tenant?.id, vehicleId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from('service_records')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('vehicle_id', vehicleId)
        .order('service_date', { ascending: false });

      if (error) throw error;
      return data as ServiceRecord[];
    },
    enabled: !!tenant && !!vehicleId,
  });

  // Add service record mutation
  const addServiceMutation = useMutation({
    mutationFn: async (formData: ServiceFormData) => {
      if (!tenant?.id) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from('service_records')
        .insert({
          vehicle_id: vehicleId,
          service_date: formData.service_date,
          service_type: formData.service_type,
          mileage: formData.mileage,
          description: formData.description,
          cost: formData.cost,
          tenant_id: tenant.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceRecords', tenant?.id, vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['plEntries', vehicleId] });
      toast({
        title: "Service Record Added",
        description: "Service record has been added successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add service record",
        variant: "destructive",
      });
    },
  });

  // Edit service record mutation
  const editServiceMutation = useMutation({
    mutationFn: async ({ id, ...formData }: ServiceFormData & { id: string }) => {
      let query = supabase
        .from('service_records')
        .update({
          service_date: formData.service_date,
          service_type: formData.service_type,
          mileage: formData.mileage,
          description: formData.description,
          cost: formData.cost,
        })
        .eq('id', id);

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { data, error } = await query.select().single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceRecords', tenant?.id, vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['plEntries', vehicleId] });
      toast({
        title: "Service Record Updated",
        description: "Service record has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update service record",
        variant: "destructive",
      });
    },
  });

  // Delete service record mutation
  const deleteServiceMutation = useMutation({
    mutationFn: async (id: string) => {
      let query = supabase
        .from('service_records')
        .delete()
        .eq('id', id);

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serviceRecords', tenant?.id, vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['plEntries', vehicleId] });
      toast({
        title: "Service Record Deleted",
        description: "Service record has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete service record",
        variant: "destructive",
      });
    },
  });

  return {
    serviceRecords,
    isLoading,
    addService: addServiceMutation.mutate,
    editService: editServiceMutation.mutate,
    deleteService: deleteServiceMutation.mutate,
    isAdding: addServiceMutation.isPending,
    isEditing: editServiceMutation.isPending,
    isDeleting: deleteServiceMutation.isPending,
  };
}