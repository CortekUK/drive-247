import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

/**
 * Per-tenant configuration for the low e-sign credit alert.
 *
 * Mirrors the Bonzah low-balance alert-config pattern (use-bonzah-alert-config):
 * the threshold + enabled flag live in `reminder_config`
 * (config_key = 'esign_low_credit'). The alert itself is raised reactively by the
 * esign API route (see apps/<app>/src/lib/esign-credit-alert.ts) after each credit
 * deduction — this hook only reads/writes the tunable config.
 *
 * `threshold` is expressed in credits. When unset, the route defaults to
 * 2 x the e-sign cost (enough for two agreements).
 */
export interface EsignCreditAlertConfig {
  threshold: number;
  enabled: boolean;
}

const CONFIG_KEY = 'esign_low_credit';

export function useEsignCreditAlertConfig() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ['esign-credit-alert-config', tenant?.id],
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
      return data.config_value as unknown as EsignCreditAlertConfig;
    },
    enabled: !!tenant?.id,
  });

  const updateConfig = useMutation({
    mutationFn: async (newConfig: EsignCreditAlertConfig) => {
      if (!tenant?.id) throw new Error('No tenant');

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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['esign-credit-alert-config', tenant?.id] });
    },
  });

  return {
    config,
    isLoading,
    updateConfig,
  };
}
