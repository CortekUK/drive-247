import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";

type ExpenseCategory = 'Repair' | 'Service' | 'Tyres' | 'Valet' | 'Accessory' | 'Other';

export interface VehicleExpense {
  id: string;
  vehicle_id: string;
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  notes?: string;
  reference?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ExpenseFormData {
  expense_date: string;
  category: ExpenseCategory;
  amount: number;
  notes?: string;
  reference?: string;
}

export function useVehicleExpenses(vehicleId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();

  // Fetch expenses for a vehicle
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['vehicleExpenses', tenant?.id, vehicleId],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from('vehicle_expenses')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('vehicle_id', vehicleId)
        .order('expense_date', { ascending: false });

      if (error) throw error;
      return data as VehicleExpense[];
    },
    enabled: !!tenant && !!vehicleId,
  });

  // Add expense mutation
  const addExpenseMutation = useMutation({
    mutationFn: async (formData: ExpenseFormData) => {
      if (!tenant?.id) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from('vehicle_expenses')
        .insert({
          vehicle_id: vehicleId,
          expense_date: formData.expense_date,
          category: formData.category as any,
          amount: formData.amount,
          notes: formData.notes,
          reference: formData.reference,
          tenant_id: tenant.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleExpenses', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['plEntries', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['plSummary'] });
      queryClient.invalidateQueries({ queryKey: ['vehiclePLData'] });
      queryClient.invalidateQueries({ queryKey: ['monthlyPLData'] });
      toast({
        title: "Expense Added",
        description: "Vehicle expense has been added successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add expense",
        variant: "destructive",
      });
    },
  });

  // Delete expense mutation
  const deleteExpenseMutation = useMutation({
    mutationFn: async (id: string) => {
      let query = supabase
        .from('vehicle_expenses')
        .delete()
        .eq('id', id);

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleExpenses', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['plEntries', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['plSummary'] });
      queryClient.invalidateQueries({ queryKey: ['vehiclePLData'] });
      queryClient.invalidateQueries({ queryKey: ['monthlyPLData'] });
      toast({
        title: "Expense Deleted",
        description: "Vehicle expense has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete expense",
        variant: "destructive",
      });
    },
  });

  return {
    expenses,
    isLoading,
    addExpense: addExpenseMutation.mutate,
    deleteExpense: deleteExpenseMutation.mutate,
    isAdding: addExpenseMutation.isPending,
    isDeleting: deleteExpenseMutation.isPending,
  };
}