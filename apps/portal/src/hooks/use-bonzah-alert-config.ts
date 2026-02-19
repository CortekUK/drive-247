import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface BonzahAlertConfig {
  threshold: number;
  enabled: boolean;
}

const CONFIG_KEY = 'bonzah_low_balance';
const RULE_CODE = 'BONZAH_LOW_BALANCE';

export function useBonzahAlertConfig() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ['bonzah-alert-config', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      const { data, error } = await supabase
        .from('reminder_config')
        .select('config_value')
        .eq('config_key', CONFIG_KEY)
        .eq('tenant_id', tenant.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return data.config_value as unknown as BonzahAlertConfig;
    },
    enabled: !!tenant?.id,
  });

  const updateConfig = useMutation({
    mutationFn: async (newConfig: BonzahAlertConfig) => {
      if (!tenant?.id) throw new Error('No tenant');

      // Upsert config
      const { data: existing } = await supabase
        .from('reminder_config')
        .select('id')
        .eq('config_key', CONFIG_KEY)
        .eq('tenant_id', tenant.id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('reminder_config')
          .update({ config_value: newConfig as any, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('reminder_config')
          .insert({
            config_key: CONFIG_KEY,
            config_value: newConfig as any,
            tenant_id: tenant.id,
          });
        if (error) throw error;
      }

      // Sync reminder in reminders table
      const today = new Date().toISOString().split('T')[0];
      const formattedThreshold = `$${newConfig.threshold.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

      if (newConfig.enabled) {
        // Check for existing reminder
        const { data: existingReminder } = await supabase
          .from('reminders')
          .select('id')
          .eq('rule_code', RULE_CODE)
          .eq('tenant_id', tenant.id)
          .in('status', ['pending', 'sent'])
          .maybeSingle();

        if (!existingReminder) {
          await supabase.from('reminders').insert({
            rule_code: RULE_CODE,
            object_type: 'Integration',
            object_id: tenant.id,
            title: `Bonzah Low Balance Alert — Below ${formattedThreshold}`,
            message: `Monitoring your Bonzah balance. You will be notified when it drops below ${formattedThreshold}.`,
            due_on: today,
            remind_on: today,
            severity: 'info',
            status: 'pending',
            context: { threshold: newConfig.threshold },
            tenant_id: tenant.id,
          });
        } else {
          // Update existing reminder with new threshold
          await supabase
            .from('reminders')
            .update({
              title: `Bonzah Low Balance Alert — Below ${formattedThreshold}`,
              message: `Monitoring your Bonzah balance. You will be notified when it drops below ${formattedThreshold}.`,
              context: { threshold: newConfig.threshold },
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingReminder.id);
        }
      } else {
        // Disabled — resolve any active reminders
        await supabase
          .from('reminders')
          .update({ status: 'done', updated_at: new Date().toISOString() })
          .eq('rule_code', RULE_CODE)
          .eq('tenant_id', tenant.id)
          .in('status', ['pending', 'sent']);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bonzah-alert-config', tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
  });

  return {
    config,
    isLoading,
    updateConfig,
  };
}
