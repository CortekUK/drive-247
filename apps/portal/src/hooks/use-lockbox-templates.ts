import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';

export interface LockboxTemplate {
  id: string;
  tenant_id: string;
  channel: 'email' | 'sms' | 'whatsapp';
  subject: string | null;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const DEFAULT_EMAIL_TEMPLATE = {
  subject: 'Your Vehicle Keys - Lockbox Code',
  body: `Hi {{customer_name}},

Your vehicle ({{vehicle_name}} - {{vehicle_reg}}) has been delivered to {{delivery_address}}.

Your lockbox code is: {{lockbox_code}}

{{lockbox_instructions}}

Booking Reference: {{booking_ref}}

If you have any questions, please don't hesitate to contact us.`,
};

const DEFAULT_SMS_TEMPLATE = {
  body: `Your vehicle {{vehicle_reg}} has been delivered. Lockbox code: {{lockbox_code}}. Ref: {{booking_ref}}`,
};

export function useLockboxTemplates() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const { data: templates, isLoading } = useQuery({
    queryKey: ['lockbox-templates', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];

      const { data, error } = await supabase
        .from('lockbox_templates')
        .select('*')
        .eq('tenant_id', tenant.id);

      if (error) throw error;
      return (data || []) as LockboxTemplate[];
    },
    enabled: !!tenant?.id,
  });

  const getTemplate = (channel: 'email' | 'sms' | 'whatsapp') => {
    return templates?.find(t => t.channel === channel) || null;
  };

  const getEmailTemplate = () => {
    const saved = getTemplate('email');
    if (saved) return { subject: saved.subject || '', body: saved.body };
    return DEFAULT_EMAIL_TEMPLATE;
  };

  const getSmsTemplate = () => {
    const saved = getTemplate('sms');
    if (saved) return { body: saved.body };
    return DEFAULT_SMS_TEMPLATE;
  };

  const saveTemplate = useMutation({
    mutationFn: async ({ channel, subject, body }: { channel: string; subject?: string; body: string }) => {
      if (!tenant?.id) throw new Error('No tenant');

      const existing = getTemplate(channel as 'email' | 'sms' | 'whatsapp');

      if (existing) {
        const { error } = await supabase
          .from('lockbox_templates')
          .update({ subject: subject || null, body })
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('lockbox_templates')
          .insert({
            tenant_id: tenant.id,
            channel,
            subject: subject || null,
            body,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lockbox-templates', tenant?.id] });
    },
  });

  return {
    templates,
    isLoading,
    getTemplate,
    getEmailTemplate,
    getSmsTemplate,
    saveTemplate,
  };
}
