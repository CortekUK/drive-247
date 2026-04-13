'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export interface ForwardingUser {
  id: string;
  name: string | null;
  role: string;
  forwardingNumber: string | null;
}

export interface VoiceStatus {
  isEnabled: boolean;
  hasTwimlApp: boolean;
  twimlAppSid: string | null;
  hasApiKey: boolean;
  webhookConfigured: boolean;
  callForwardingEnabled: boolean;
  voicemailEnabled: boolean;
  voicemailGreetingUrl: string | null;
  forwardingNumber: string | null;
  forwardingUsers: ForwardingUser[];
}

async function invokeManageVoice(action: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('manage-twilio-voice', {
    body: { action, ...params },
  });
  if (error) {
    // Extract detailed error from response body if available
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

export function useTwilioVoice() {
  const queryClient = useQueryClient();
  const { tenant, refetchTenant } = useTenant();

  const invoke = (action: string, params: Record<string, any> = {}) =>
    invokeManageVoice(action, { tenantId: tenant?.id, ...params });

  const invalidateStatus = () => {
    queryClient.invalidateQueries({ queryKey: ['twilio-voice-status'] });
    refetchTenant();
  };

  const statusQuery = useQuery({
    queryKey: ['twilio-voice-status', tenant?.id],
    queryFn: async () => {
      const data = await invoke('get-status');
      return {
        isEnabled: data.voiceEnabled ?? false,
        hasTwimlApp: !!data.twimlAppSid,
        twimlAppSid: data.twimlAppSid ?? null,
        hasApiKey: data.apiKeyConfigured ?? false,
        webhookConfigured: data.webhookConfigured ?? false,
        callForwardingEnabled: data.callForwardingEnabled ?? false,
        voicemailEnabled: data.voicemailEnabled ?? false,
        voicemailGreetingUrl: data.voicemailGreetingUrl ?? null,
        forwardingNumber: data.forwardingNumber ?? null,
        forwardingUsers: data.forwardingUsers ?? [],
      } as VoiceStatus;
    },
    enabled: !!tenant?.id,
    staleTime: 0,
  });

  const setup = useMutation({
    mutationFn: () => invoke('setup'),
    onSuccess: () => {
      invalidateStatus();
      toast({
        title: 'Voice Calling Enabled',
        description: 'Browser-based calling is now set up and ready to use.',
      });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const disable = useMutation({
    mutationFn: () => invoke('disable'),
    onSuccess: () => {
      invalidateStatus();
      toast({
        title: 'Voice Calling Disabled',
        description: 'Browser-based calling has been disabled.',
      });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const getToken = useMutation({
    mutationFn: () => invoke('get-token'),
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const updateForwarding = useMutation({
    mutationFn: (params: {
      callForwardingEnabled?: boolean;
      voicemailEnabled?: boolean;
      voicemailGreetingUrl?: string | null;
      forwardingNumber?: string | null;
    }) => invoke('update-forwarding', params),
    onSuccess: (_data, variables) => {
      invalidateStatus();
      if (typeof variables.callForwardingEnabled === 'boolean') {
        toast({
          title: variables.callForwardingEnabled ? 'Call Forwarding Enabled' : 'Call Forwarding Disabled',
          description: variables.callForwardingEnabled
            ? 'Inbound calls will now ring on team members\' phones too.'
            : 'Inbound calls will only ring in the browser.',
        });
      }
      if (typeof variables.voicemailEnabled === 'boolean') {
        toast({
          title: variables.voicemailEnabled ? 'Voicemail Enabled' : 'Voicemail Disabled',
          description: variables.voicemailEnabled
            ? 'Callers can leave a voicemail when no one answers.'
            : 'Voicemail has been turned off.',
        });
      }
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const setForwardingNumber = useMutation({
    mutationFn: (params: { userId: string; forwardingNumber: string | null }) =>
      invoke('set-forwarding-number', params),
    onSuccess: () => {
      invalidateStatus();
      toast({
        title: 'Forwarding Number Updated',
        description: 'The phone number has been saved.',
      });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return {
    status: statusQuery.data ?? null,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    setup,
    disable,
    getToken,
    updateForwarding,
    setForwardingNumber,
    invalidateStatus,
  };
}
