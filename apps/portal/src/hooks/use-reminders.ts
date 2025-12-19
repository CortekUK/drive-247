import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "./use-toast";
import { useTenant } from "@/contexts/TenantContext";

export interface Reminder {
  id: string;
  rule_code: string;
  object_type: 'Vehicle' | 'Rental' | 'Customer' | 'Fine' | 'Document';
  object_id: string;
  title: string;
  message: string;
  due_on: string;
  remind_on: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'pending' | 'sent' | 'snoozed' | 'done' | 'dismissed' | 'expired';
  snooze_until?: string;
  last_sent_at?: string;
  context: any;
  created_at: string;
  updated_at: string;
}

export interface ReminderFilters {
  status?: string[];
  severity?: string[];
  object_type?: string[];
  rule_code?: string[];
  date_from?: string;
  date_to?: string;
}

export function useReminders(filters?: ReminderFilters) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['reminders', tenant?.id, filters],
    queryFn: async () => {
      let query = supabase
        .from('reminders')
        .select('*');

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      query = query
        .order('due_on', { ascending: true })
        .order('remind_on', { ascending: true });

      // If no status filter is applied, default to showing active reminders
      if (filters?.status && filters.status.length > 0) {
        query = query.in('status', filters.status);
      } else {
        // Default to showing active reminders (pending, sent, snoozed)
        query = query.in('status', ['pending', 'sent', 'snoozed']);
      }

      if (filters?.severity && filters.severity.length > 0) {
        query = query.in('severity', filters.severity);
      }

      if (filters?.object_type && filters.object_type.length > 0) {
        query = query.in('object_type', filters.object_type);
      }

      if (filters?.rule_code && filters.rule_code.length > 0) {
        query = query.in('rule_code', filters.rule_code);
      }

      if (filters?.date_from) {
        query = query.gte('due_on', filters.date_from);
      }

      if (filters?.date_to) {
        query = query.lte('due_on', filters.date_to);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching reminders:', error);
        throw new Error('Failed to fetch reminders');
      }

      // Sort by severity priority: critical (1), warning (2), info (3)
      const sortedData = (data as Reminder[]).sort((a, b) => {
        const severityOrder = { critical: 1, warning: 2, info: 3 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      });

      return sortedData;
    },
  });
}

export function useRemindersByObject(objectType: string, objectId: string) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['reminders', 'object', tenant?.id, objectType, objectId],
    queryFn: async () => {
      let query = supabase
        .from('reminders')
        .select('*')
        .eq('object_type', objectType)
        .eq('object_id', objectId)
        .in('status', ['pending', 'sent', 'snoozed']);

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { data, error } = await query.order('due_on', { ascending: true });

      if (error) {
        console.error('Error fetching object reminders:', error);
        throw new Error('Failed to fetch reminders');
      }

      // Sort by severity priority: critical (1), warning (2), info (3)
      const sortedData = (data as Reminder[]).sort((a, b) => {
        const severityOrder = { critical: 1, warning: 2, info: 3 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      });

      return sortedData;
    },
  });
}

export function useReminderStats() {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['reminder-stats', tenant?.id],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];

      // Get counts for different reminder states
      let pendingQuery = supabase
        .from('reminders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lte('remind_on', today);

      if (tenant?.id) {
        pendingQuery = pendingQuery.eq('tenant_id', tenant.id);
      }

      const { count: pendingCount, error: pendingError } = await pendingQuery;

      let snoozedQuery = supabase
        .from('reminders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'snoozed');

      if (tenant?.id) {
        snoozedQuery = snoozedQuery.eq('tenant_id', tenant.id);
      }

      const { count: snoozedTotalCount, error: snoozedError } = await snoozedQuery;

      let criticalQuery = supabase
        .from('reminders')
        .select('*', { count: 'exact', head: true })
        .eq('severity', 'critical')
        .in('status', ['pending', 'sent'])
        .lte('remind_on', today);

      if (tenant?.id) {
        criticalQuery = criticalQuery.eq('tenant_id', tenant.id);
      }

      const { count: criticalCount, error: criticalError } = await criticalQuery;

      let totalQuery = supabase
        .from('reminders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'sent', 'snoozed']);

      if (tenant?.id) {
        totalQuery = totalQuery.eq('tenant_id', tenant.id);
      }

      const { count: totalActiveCount, error: totalError } = await totalQuery;

      if (pendingError || snoozedError || criticalError || totalError) {
        console.error('Error fetching reminder stats:', { pendingError, snoozedError, criticalError, totalError });
        throw new Error('Failed to fetch reminder stats');
      }

      const pendingDue = pendingCount || 0;
      const snoozedTotal = snoozedTotalCount || 0;
      const due = pendingDue; // Only pending reminders are "due"

      return {
        total: totalActiveCount || 0,
        due: due,
        critical: criticalCount || 0,
        pending: pendingDue,
        snoozed: snoozedTotal
      };
    },
    staleTime: 30 * 1000, // Cache for 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}

export function useReminderActions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { tenant } = useTenant();

  const updateReminderStatus = useMutation({
    mutationFn: async ({ 
      id, 
      status, 
      snoozeUntil, 
      note 
    }: { 
      id: string; 
      status: string; 
      snoozeUntil?: string; 
      note?: string;
    }) => {
      console.log('Updating reminder:', { id, status, snoozeUntil, note });
      
      const updateData: any = { status };
      if (snoozeUntil) {
        updateData.snooze_until = snoozeUntil;
      }

      let updateQuery = supabase
        .from('reminders')
        .update(updateData)
        .eq('id', id);

      if (tenant?.id) {
        updateQuery = updateQuery.eq('tenant_id', tenant.id);
      }

      const { data, error } = await updateQuery.select();

      if (error) {
        console.error('Failed to update reminder:', error);
        throw new Error(`Failed to update reminder: ${error.message}`);
      }

      console.log('Reminder updated successfully:', data);

      // Log the action - with better error handling
      try {
        const { data: actionData, error: actionError } = await supabase
          .from('reminder_actions')
          .insert({
            reminder_id: id,
            action: status,
            note: note || `Reminder marked as ${status}`,
            tenant_id: tenant?.id || null,
          })
          .select();

        if (actionError) {
          console.error('Failed to log reminder action:', actionError);
          // Don't throw here - the main action succeeded
        } else {
          console.log('Action logged successfully:', actionData);
        }
      } catch (actionErr) {
        console.error('Error logging action:', actionErr);
        // Continue - main action succeeded
      }

      return { id, status };
    },
    onSuccess: (data) => {
      console.log('Mutation successful, invalidating queries');
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
      queryClient.invalidateQueries({ queryKey: ['reminder-stats'] });
      toast({
        title: "Success",
        description: "Reminder updated successfully",
      });
    },
    onError: (error) => {
      console.error('Mutation failed:', error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const markDone = (id: string, note?: string) => {
    return updateReminderStatus.mutate({ id, status: 'done', note });
  };

  const dismiss = (id: string, note?: string) => {
    return updateReminderStatus.mutate({ id, status: 'dismissed', note });
  };

  const snooze = (id: string, days: number, note?: string) => {
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + days);
    const snoozeUntilStr = snoozeUntil.toISOString().split('T')[0];
    
    return updateReminderStatus.mutate({ 
      id, 
      status: 'snoozed', 
      snoozeUntil: snoozeUntilStr,
      note: note || `Snoozed for ${days} days`
    });
  };

  const bulkUpdate = useMutation({
    mutationFn: async ({ 
      ids, 
      action,
      snoozeUntil,
      note 
    }: { 
      ids: string[]; 
      action: string;
      snoozeUntil?: string;
      note?: string;
    }) => {
      console.log('Bulk updating reminders:', { ids, action, snoozeUntil, note });
      
      const updateData: any = { status: action };
      if (snoozeUntil) {
        updateData.snooze_until = snoozeUntil;
      }

      let bulkUpdateQuery = supabase
        .from('reminders')
        .update(updateData)
        .in('id', ids);

      if (tenant?.id) {
        bulkUpdateQuery = bulkUpdateQuery.eq('tenant_id', tenant.id);
      }

      const { data, error } = await bulkUpdateQuery.select();

      if (error) {
        console.error('Failed to bulk update reminders:', error);
        throw new Error(`Failed to update reminders: ${error.message}`);
      }

      console.log('Bulk update successful:', data);

      // Log actions for each reminder - with better error handling
      try {
        const actions = ids.map(id => ({
          reminder_id: id,
          action: action,
          note: note || `Bulk ${action} operation`,
          tenant_id: tenant?.id || null,
        }));

        const { data: actionData, error: actionError } = await supabase
          .from('reminder_actions')
          .insert(actions)
          .select();

        if (actionError) {
          console.error('Failed to log bulk actions:', actionError);
          // Don't throw - main operation succeeded
        } else {
          console.log('Bulk actions logged successfully:', actionData);
        }
      } catch (actionErr) {
        console.error('Error logging bulk actions:', actionErr);
        // Continue - main operation succeeded
      }

      return { ids, action };
    },
    onSuccess: (data) => {
      console.log('Bulk mutation successful, invalidating queries');
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
      queryClient.invalidateQueries({ queryKey: ['reminder-stats'] });
      toast({
        title: "Success",
        description: `Updated ${data.ids.length} reminders`,
      });
    },
    onError: (error) => {
      console.error('Bulk mutation failed:', error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    markDone,
    dismiss,
    snooze,
    bulkUpdate,
    isLoading: updateReminderStatus.isPending || bulkUpdate.isPending
  };
}

export function useReminderGeneration() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      // First generate reminders
      const { data, error } = await supabase.functions.invoke('reminders-generate');

      if (error) {
        throw error;
      }

      // Then send notifications for pending reminders
      try {
        const { data: notifData, error: notifError } = await supabase.functions.invoke('send-reminder-notifications');
        if (notifError) {
          console.log('Notification sending failed:', notifError.message);
        } else {
          console.log('Reminder notifications sent:', notifData);
        }
      } catch (notifErr) {
        console.log('Error sending reminder notifications:', notifErr);
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
      queryClient.invalidateQueries({ queryKey: ['reminder-stats'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast({
        title: "Success",
        description: `Generated ${data.generated} new reminders, expired ${data.expired} old ones`,
      });
    },
    onError: (error) => {
      toast({
        title: "Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}