import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "./use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";

export interface ReminderRule {
  id: string;
  rule_type: string;
  category: string;
  lead_days: number;
  severity: 'info' | 'warning' | 'critical';
  is_enabled: boolean;
  rule_code: string;
  description?: string;
  is_recurring: boolean;
  interval_type: string;
  created_at: string;
  updated_at: string;
}

export interface ReminderRuleUpdate {
  id: string;
  lead_days?: number;
  severity?: 'info' | 'warning' | 'critical';
  is_enabled?: boolean;
  description?: string;
}

export function useReminderRules() {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['reminder-rules', tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from('reminder_rules')
        .select('*');

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      query = query
        .order('category', { ascending: true })
        .order('rule_type', { ascending: true })
        .order('lead_days', { ascending: false });

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching reminder rules:', error);
        throw new Error('Failed to fetch reminder rules');
      }

      return data as ReminderRule[];
    },
  });
}

export function useReminderRulesByCategory() {
  const { data: rules, ...rest } = useReminderRules();
  
  const groupedRules = rules?.reduce((acc, rule) => {
    if (!acc[rule.category]) {
      acc[rule.category] = {};
    }
    if (!acc[rule.category][rule.rule_type]) {
      acc[rule.category][rule.rule_type] = [];
    }
    acc[rule.category][rule.rule_type].push(rule);
    return acc;
  }, {} as Record<string, Record<string, ReminderRule[]>>);

  return {
    data: groupedRules,
    ...rest
  };
}

export function useReminderRuleActions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();

  const updateRule = useMutation({
    mutationFn: async (updates: ReminderRuleUpdate) => {
      const { id, ...updateData } = updates;

      let query = supabase
        .from('reminder_rules')
        .update(updateData)
        .eq('id', id);

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { data, error } = await query.select();

      if (error) {
        console.error('Failed to update reminder rule:', error);
        throw new Error(`Failed to update reminder rule: ${error.message}`);
      }

      return data[0];
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['reminder-rules'] });
      toast({
        title: "Success",
        description: "Reminder rule updated successfully",
      });
      logAction({
        action: "reminder_rule_updated",
        entityType: "reminder_rule",
        entityId: data.id,
        details: { rule_type: data.rule_type, is_enabled: data.is_enabled, severity: data.severity },
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const bulkUpdate = useMutation({
    mutationFn: async (updates: ReminderRuleUpdate[]) => {
      const results = [];
      
      for (const update of updates) {
        const { id, ...updateData } = update;
        let query = supabase
          .from('reminder_rules')
          .update(updateData)
          .eq('id', id);

        if (tenant?.id) {
          query = query.eq('tenant_id', tenant.id);
        }

        const { data, error } = await query.select();

        if (error) {
          console.error('Failed to update reminder rule:', error);
          throw new Error(`Failed to update reminder rule: ${error.message}`);
        }

        results.push(data[0]);
      }

      return results;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['reminder-rules'] });
      toast({
        title: "Success",
        description: "Reminder rules updated successfully",
      });
      logAction({
        action: "reminder_rules_bulk_updated",
        entityType: "reminder_rule",
        entityId: data[0]?.id || "bulk",
        details: { count: data.length },
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetToDefaults = useMutation({
    mutationFn: async () => {
      // Reset all rules to their default values
      const defaultRules = [
        // MOT reminders
        { rule_type: 'MOT', lead_days: 30, severity: 'info', is_enabled: true },
        { rule_type: 'MOT', lead_days: 14, severity: 'warning', is_enabled: true },
        { rule_type: 'MOT', lead_days: 7, severity: 'warning', is_enabled: true },
        { rule_type: 'MOT', lead_days: 0, severity: 'critical', is_enabled: true },
        
        // TAX reminders
        { rule_type: 'TAX', lead_days: 30, severity: 'info', is_enabled: true },
        { rule_type: 'TAX', lead_days: 14, severity: 'warning', is_enabled: true },
        { rule_type: 'TAX', lead_days: 7, severity: 'warning', is_enabled: true },
        { rule_type: 'TAX', lead_days: 0, severity: 'critical', is_enabled: true },
        
        // Insurance reminders
        { rule_type: 'Insurance', lead_days: 30, severity: 'info', is_enabled: true },
        { rule_type: 'Insurance', lead_days: 14, severity: 'warning', is_enabled: true },
        { rule_type: 'Insurance', lead_days: 7, severity: 'warning', is_enabled: true },
        { rule_type: 'Insurance', lead_days: 0, severity: 'critical', is_enabled: true },
        
        // Fine reminders
        { rule_type: 'Fine', lead_days: 14, severity: 'warning', is_enabled: true },
        { rule_type: 'Fine', lead_days: 7, severity: 'warning', is_enabled: true },
        { rule_type: 'Fine', lead_days: 0, severity: 'critical', is_enabled: true },
        
        // Document reminders
        { rule_type: 'Document', lead_days: 30, severity: 'info', is_enabled: true },
        { rule_type: 'Document', lead_days: 14, severity: 'warning', is_enabled: true },
        { rule_type: 'Document', lead_days: 7, severity: 'warning', is_enabled: true },
        { rule_type: 'Document', lead_days: 0, severity: 'critical', is_enabled: true },
        
        // Rental reminders
        { rule_type: 'Rental', lead_days: 1, severity: 'warning', is_enabled: true },
        { rule_type: 'Rental', lead_days: 7, severity: 'warning', is_enabled: true },
        { rule_type: 'Rental', lead_days: 14, severity: 'critical', is_enabled: true },
        
        // Immobiliser reminders
        { rule_type: 'Immobiliser', lead_days: 0, severity: 'critical', is_enabled: true },
        { rule_type: 'Immobiliser', lead_days: 7, severity: 'warning', is_enabled: true },
        { rule_type: 'Immobiliser', lead_days: 14, severity: 'warning', is_enabled: true },
        { rule_type: 'Immobiliser', lead_days: 30, severity: 'info', is_enabled: true },
      ];

      const results = [];
      for (const defaultRule of defaultRules) {
        let query = supabase
          .from('reminder_rules')
          .update({
            lead_days: defaultRule.lead_days,
            severity: defaultRule.severity,
            is_enabled: defaultRule.is_enabled
          })
          .eq('rule_type', defaultRule.rule_type)
          .eq('lead_days', defaultRule.lead_days);

        if (tenant?.id) {
          query = query.eq('tenant_id', tenant.id);
        }

        const { data, error } = await query.select();

        if (error) {
          console.error('Failed to reset reminder rule:', error);
          throw new Error(`Failed to reset reminder rules: ${error.message}`);
        }

        if (data.length > 0) {
          results.push(...data);
        }
      }

      return results;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['reminder-rules'] });
      toast({
        title: "Success",
        description: "All reminder rules reset to defaults",
      });
      logAction({
        action: "reminder_rules_reset",
        entityType: "reminder_rule",
        entityId: tenant?.id || "all",
        details: { count: data.length },
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    updateRule,
    bulkUpdate,
    resetToDefaults,
    isLoading: updateRule.isPending || bulkUpdate.isPending || resetToDefaults.isPending
  };
}