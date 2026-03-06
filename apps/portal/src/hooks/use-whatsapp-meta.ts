'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

interface WhatsAppConfig {
  appId: string;
  configId: string;
}

interface WhatsAppStatus {
  isConfigured: boolean;
  phoneNumber: string | null;
  wabaId: string | null;
}

async function invokeManageWhatsApp(action: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('manage-whatsapp-meta', {
    body: { action, ...params },
  });
  if (error) {
    if ('context' in error && (error as any).context?.body) {
      try {
        const body = await (error as any).context.body.getReader().read();
        const text = new TextDecoder().decode(body.value);
        const parsed = JSON.parse(text);
        if (parsed?.error) throw new Error(parsed.error);
      } catch (parseErr: any) {
        if (parseErr?.message && parseErr.message !== error.message) throw parseErr;
      }
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function useWhatsAppMeta() {
  const queryClient = useQueryClient();
  const { tenant, refetchTenant } = useTenant();

  const invoke = (action: string, params: Record<string, any> = {}) =>
    invokeManageWhatsApp(action, { tenantId: tenant?.id, ...params });

  // Fetch platform config (appId, configId) for FB SDK init
  const configQuery = useQuery({
    queryKey: ['whatsapp-meta-config'],
    queryFn: async () => {
      const data = await invoke('get-config');
      return data as WhatsAppConfig;
    },
    enabled: !!tenant?.id,
    staleTime: Infinity, // Platform config doesn't change
  });

  // Fetch tenant's WhatsApp connection status
  const statusQuery = useQuery({
    queryKey: ['whatsapp-meta-status', tenant?.id],
    queryFn: async () => {
      const data = await invoke('get-status');
      return data as WhatsAppStatus;
    },
    enabled: !!tenant?.id,
    staleTime: 0,
  });

  const invalidateStatus = () => {
    queryClient.invalidateQueries({ queryKey: ['whatsapp-meta-status'] });
    refetchTenant();
  };

  const completeSignup = useMutation({
    mutationFn: (params: { code: string; wabaId: string; phoneNumberId: string }) =>
      invoke('complete-signup', params),
    onSuccess: (data: any) => {
      invalidateStatus();
      toast({
        title: 'WhatsApp Connected',
        description: `Connected with number ${data.phoneNumber || ''}. WhatsApp messaging is now active!`,
      });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const sendTest = useMutation({
    mutationFn: (to: string) => invoke('send-test', { to }),
    onSuccess: () => {
      toast({ title: 'Test Message Sent', description: 'Check your WhatsApp for the test message.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const disconnect = useMutation({
    mutationFn: () => invoke('disconnect'),
    onSuccess: () => {
      invalidateStatus();
      toast({ title: 'Disconnected', description: 'WhatsApp has been disconnected.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return {
    config: configQuery.data ?? null,
    status: statusQuery.data ?? null,
    isLoading: statusQuery.isLoading || configQuery.isLoading,
    completeSignup,
    sendTest,
    disconnect,
  };
}
