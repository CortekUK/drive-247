'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

interface TwilioStatus {
  hasSubaccount: boolean;
  subaccountSid: string | null;
  hasPhoneNumber: boolean;
  phoneNumber: string | null;
  isConfigured: boolean;
}

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
  capabilities: { sms: boolean; voice: boolean; mms: boolean };
}

async function invokeManageTwilio(action: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('manage-twilio-subaccount', {
    body: { action, ...params },
  });
  if (error) {
    // supabase.functions.invoke wraps non-2xx into a generic error.
    // The actual error message is in the response body (JSON { error: "..." }).
    // Try to extract it from the error context.
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

  const createSubaccount = useMutation({
    mutationFn: () => invoke('create-subaccount'),
    onSuccess: () => {
      invalidateStatus();
      toast({ title: 'Subaccount Created', description: 'Your Twilio subaccount has been created. Now add a phone number.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const searchNumbers = useMutation({
    mutationFn: (params: { countryCode: string; contains?: string; areaCode?: string }) =>
      invoke('search-numbers', params),
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const purchaseNumber = useMutation({
    mutationFn: (phoneNumber: string) =>
      invoke('purchase-number', { phoneNumber }),
    onSuccess: () => {
      invalidateStatus();
      toast({ title: 'Number Purchased', description: 'Phone number has been added to your account. SMS is now active!' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const assignOwnNumber = useMutation({
    mutationFn: (phoneNumber: string) =>
      invoke('assign-own-number', { phoneNumber }),
    onSuccess: () => {
      invalidateStatus();
      toast({ title: 'Number Assigned', description: 'Your phone number has been configured. SMS is now active!' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const sendTestSms = useMutation({
    mutationFn: (to: string) =>
      invoke('send-test-sms', { to }),
    onSuccess: () => {
      toast({ title: 'Test SMS Sent', description: 'Check your phone for the test message.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const disconnect = useMutation({
    mutationFn: () => invoke('disconnect'),
    onSuccess: () => {
      invalidateStatus();
      toast({ title: 'Disconnected', description: 'Twilio SMS has been disconnected. SMS notifications are now disabled.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return {
    status: statusQuery.data ?? null,
    isLoading: statusQuery.isLoading,
    createSubaccount,
    searchNumbers,
    purchaseNumber,
    assignOwnNumber,
    sendTestSms,
    disconnect,
  };
}
