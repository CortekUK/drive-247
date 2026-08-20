import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";

export interface DisposalData {
  disposal_date: string;
  sale_proceeds: number;
  disposal_buyer?: string;
  disposal_notes?: string;
}

export function useVehicleDisposal(vehicleId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();

  const disposeMutation = useMutation({
    mutationFn: async (disposalData: DisposalData) => {
      const { data, error } = await supabase.rpc('dispose_vehicle', {
        p_vehicle_id: vehicleId,
        p_disposal_date: disposalData.disposal_date,
        p_sale_proceeds: disposalData.sale_proceeds,
        p_buyer: disposalData.disposal_buyer || null,
        p_notes: disposalData.disposal_notes || null,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicleEvents', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['pnlEntries'] });
      
      const gainLoss = data?.gain_loss || 0;
      const currencyCode = tenant?.currency_code || 'USD';
      const message = gainLoss > 0
        ? `Vehicle disposed with gain of ${formatCurrency(gainLoss, currencyCode)}`
        : gainLoss < 0
        ? `Vehicle disposed with loss of ${formatCurrency(Math.abs(gainLoss), currencyCode)}`
        : 'Vehicle disposed at break-even';
      
      toast({
        title: "Vehicle Disposed",
        description: message,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to dispose vehicle",
        variant: "destructive",
      });
      console.error('Disposal error:', error);
    },
  });

  const undoDisposalMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('undo_vehicle_disposal', {
        p_vehicle_id: vehicleId,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      // The list page keys on ["vehicles-list", tenant?.id]; the bare
      // ['vehicles'] above never matches it, so the list would stay stale.
      queryClient.invalidateQueries({ queryKey: ['vehicles-list'] });
      queryClient.invalidateQueries({ queryKey: ['vehicleEvents', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['pnlEntries'] });

      // The RPC un-disposes the vehicle even when it cannot put back the
      // maintenance jobs / blocked dates / reminders that disposal removed
      // (e.g. a newly-added block now overlaps one being restored). Saying
      // "Disposal Undone" in that case would be a lie, and the operator would
      // never know to retry — the journal is deliberately kept so a second
      // Undo replays it once the conflict is cleared.
      if (data?.restore_failed) {
        toast({
          title: "Vehicle restored — but not its maintenance records",
          description:
            "The vehicle is Available again, but its maintenance jobs, blocked dates or reminders could not be put back. Clear any conflicting blocked dates and press Undo Disposal again.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Disposal Undone",
        description: "Vehicle has been returned to available status",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to undo disposal",
        variant: "destructive",
      });
      console.error('Undo disposal error:', error);
    },
  });

  const calculateBookCostMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('calculate_vehicle_book_cost', {
        p_vehicle_id: vehicleId,
      });

      if (error) throw error;
      return data;
    },
  });

  return {
    disposeVehicle: disposeMutation.mutateAsync,
    undoDisposal: undoDisposalMutation.mutateAsync,
    calculateBookCost: calculateBookCostMutation.mutateAsync,
    isDisposing: disposeMutation.isPending,
    isUndoing: undoDisposalMutation.isPending,
    isCalculatingBookCost: calculateBookCostMutation.isPending,
  };
}