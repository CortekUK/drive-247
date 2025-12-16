import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface VehicleEvent {
  id: string;
  vehicle_id: string;
  event_type: string;
  event_date: string;
  summary: string;
  reference_id?: string;
  reference_table?: string;
  created_at: string;
}

export function useVehicleEvents(vehicleId: string) {
  const { tenant } = useTenant();

  // Fetch events for a vehicle
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['vehicleEvents', tenant?.id, vehicleId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from('vehicle_events')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('vehicle_id', vehicleId)
        .order('event_date', { ascending: false });

      if (error) throw error;
      return data as VehicleEvent[];
    },
    enabled: !!tenant && !!vehicleId,
  });

  return {
    events,
    isLoading,
  };
}