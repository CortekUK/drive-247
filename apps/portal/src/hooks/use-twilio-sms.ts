'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

// Shape returned by the `get-status` action on manage-twilio-subaccount.
// Under BYO, the edge function returns legacy field aliases (hasSubaccount, hasPhoneNumber)
// for backwards compatibility with other UI that reads twilioStatus.
export interface TwilioStatus {
  isConnected: boolean;
  isConfigured: boolean;
  accountSidMasked: string | null;
  phoneNumber: string | null;
  connectedAt: string | null;
  capabilities: { sms: boolean; voice: boolean; mms: boolean } | null;
  // Legacy aliases kept for other components that still read these
  hasSubaccount: boolean;
  hasPhoneNumber: boolean;
}

export interface TwilioConnectInput {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

async function invokeManageTwilio(action: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('manage-twilio-connection', {
    body: { action, ...params },
  });
  if (error) {
    // supabase.functions.invoke wraps non-2xx into a generic error.
    // The actual error message is in the response body (JSON { error: "..." }).
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

export function useTwilioSms() {
  const queryClient = useQueryClient();
  const { tenant, refetchTenant } = useTenant();

  // Always pass tenantId so super admins (who have no tenant_id in app_users) work correctly
  const invoke = (action: string, params: Record<string, any> = {}) =>
    invokeManageTwilio(action, { tenantId: tenant?.id, ...params });

  const statusQuery = useQuery({
    queryKey: ['twilio-sms-status', tenant?.id],
    queryFn: async () => {
      const data = await invoke('get-status');
      return data as TwilioStatus;
    },
    enabled: !!tenant?.id,
    staleTime: 0,
  });

  const invalidateStatus = () => {
    queryClient.invalidateQueries({ queryKey: ['twilio-sms-status'] });
    refetchTenant();
  };

  /**
   * Connect a tenant's own Twilio account (BYO).
   * Validates credentials, verifies the phone number exists, auto-configures
   * inbound/status webhooks, and saves everything to the DB.
   */
  const connect = useMutation({
    mutationFn: (input: TwilioConnectInput) => invoke('connect', input),
    onSuccess: (data: any) => {
      invalidateStatus();
      toast({
        title: 'Twilio Connected',
        description: `${data?.friendlyName || 'Your account'} is now sending SMS from ${data?.phoneNumber}.`,
      });
    },
    onError: (err: any) => {
      toast({ title: 'Connection Failed', description: err.message, variant: 'destructive' });
    },
  });

  /** Send a test SMS using the currently-connected credentials. */
  const sendTestSms = useMutation({
    mutationFn: ({ to, message }: { to: string; message?: string }) =>
      invoke('test', { to, message }),
    onSuccess: (data: any) => {
      if (data?.success) {
        toast({ title: 'Test SMS Sent', description: 'Check your phone for the test message.' });
      } else {
        toast({
          title: 'Test Failed',
          description: data?.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  /** Forget the tenant's Twilio credentials. Does not touch their Twilio account. */
  const disconnect = useMutation({
    mutationFn: () => invoke('disconnect'),
    onSuccess: () => {
      invalidateStatus();
      toast({
        title: 'Disconnected',
        description: 'Your Twilio credentials have been removed. SMS is now disabled.',
      });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return {
    status: statusQuery.data ?? null,
    isLoading: statusQuery.isLoading,
    connect,
    sendTestSms,
    disconnect,
  };
}
