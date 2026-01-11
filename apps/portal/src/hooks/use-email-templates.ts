import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';
import { getDefaultEmailTemplate } from '@/lib/default-email-templates';
import { EMAIL_TEMPLATE_TYPES } from '@/lib/email-template-variables';

export interface EmailTemplate {
  id: string;
  tenant_id: string;
  template_key: string;
  template_name: string;
  subject: string;
  template_content: string;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SaveEmailTemplateInput {
  template_key: string;
  template_name: string;
  subject: string;
  template_content: string;
}

/**
 * Hook to manage email templates for the current tenant
 */
export const useEmailTemplates = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // Fetch all custom templates for the tenant
  const {
    data: customTemplates,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['email-templates', tenant?.id],
    queryFn: async (): Promise<EmailTemplate[]> => {
      if (!tenant?.id) {
        return [];
      }

      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('template_key', { ascending: true });

      // Don't throw on RLS/permission errors - just return empty array
      // This handles the case where the table has no custom templates
      if (error) {
        console.warn('[EmailTemplates] Could not fetch templates (may be empty):', error.message || error);
        return [];
      }

      return data || [];
    },
    enabled: !!tenant?.id,
  });

  // Get template by key (custom or default)
  const getTemplate = (templateKey: string): {
    template: EmailTemplate | null;
    isCustom: boolean;
    defaultTemplate: ReturnType<typeof getDefaultEmailTemplate>;
  } => {
    const customTemplate = customTemplates?.find(t => t.template_key === templateKey) || null;
    const defaultTemplate = getDefaultEmailTemplate(templateKey);

    return {
      template: customTemplate,
      isCustom: !!customTemplate,
      defaultTemplate,
    };
  };

  // Check if a template type has been customized
  const isCustomized = (templateKey: string): boolean => {
    return customTemplates?.some(t => t.template_key === templateKey) || false;
  };

  // Save template mutation (create or update)
  const saveTemplateMutation = useMutation({
    mutationFn: async (input: SaveEmailTemplateInput): Promise<EmailTemplate> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      // Use Edge Function to bypass RLS
      const { data, error } = await supabase.functions.invoke('manage-email-template', {
        body: {
          action: 'create',
          tenantId: tenant.id,
          templateKey: input.template_key,
          templateName: input.template_name,
          subject: input.subject,
          templateContent: input.template_content,
        },
      });

      if (error) {
        console.error('[EmailTemplates] Error calling manage-email-template:', error);
        throw new Error(error.message || 'Failed to save template');
      }

      if (!data?.success) {
        console.error('[EmailTemplates] Function returned error:', data?.error);
        throw new Error(data?.error || 'Failed to save template');
      }

      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates', tenant?.id] });
      toast({
        title: 'Template Saved',
        description: 'Your email template has been saved successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save template',
        variant: 'destructive',
      });
    },
  });

  // Reset template to default (delete custom template)
  const resetTemplateMutation = useMutation({
    mutationFn: async (templateKey: string): Promise<void> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      // Use Edge Function to bypass RLS
      const { data, error } = await supabase.functions.invoke('manage-email-template', {
        body: {
          action: 'delete',
          tenantId: tenant.id,
          templateKey: templateKey,
        },
      });

      if (error) {
        console.error('[EmailTemplates] Error calling manage-email-template:', error);
        throw new Error(error.message || 'Failed to reset template');
      }

      if (!data?.success) {
        console.error('[EmailTemplates] Function returned error:', data?.error);
        throw new Error(data?.error || 'Failed to reset template');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates', tenant?.id] });
      toast({
        title: 'Template Reset',
        description: 'The email template has been reset to default.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to reset template',
        variant: 'destructive',
      });
    },
  });

  // Get all template types with their customization status
  const getAllTemplateTypes = () => {
    return EMAIL_TEMPLATE_TYPES.map(type => ({
      ...type,
      isCustomized: isCustomized(type.key),
      customTemplate: customTemplates?.find(t => t.template_key === type.key) || null,
    }));
  };

  return {
    customTemplates: customTemplates || [],
    isLoading,
    error,
    refetch,
    getTemplate,
    isCustomized,
    getAllTemplateTypes,
    saveTemplate: saveTemplateMutation.mutate,
    saveTemplateAsync: saveTemplateMutation.mutateAsync,
    isSaving: saveTemplateMutation.isPending,
    resetTemplate: resetTemplateMutation.mutate,
    resetTemplateAsync: resetTemplateMutation.mutateAsync,
    isResetting: resetTemplateMutation.isPending,
  };
};

/**
 * Hook to fetch a single email template by key
 */
export const useEmailTemplate = (templateKey: string) => {
  const { tenant } = useTenant();

  const { data, isLoading, error } = useQuery({
    queryKey: ['email-template', tenant?.id, templateKey],
    queryFn: async () => {
      if (!tenant?.id || !templateKey) {
        return null;
      }

      // Try to fetch custom template
      const { data: customTemplate, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('template_key', templateKey)
        .maybeSingle();

      // Don't throw on errors - just return default template
      if (error) {
        console.warn('[EmailTemplate] Could not fetch template (using default):', error.message || error);
      }

      // Get default template
      const defaultTemplate = getDefaultEmailTemplate(templateKey);

      return {
        customTemplate: error ? null : customTemplate,
        defaultTemplate,
        isCustomized: !error && !!customTemplate,
      };
    },
    enabled: !!tenant?.id && !!templateKey,
  });

  return {
    customTemplate: data?.customTemplate || null,
    defaultTemplate: data?.defaultTemplate || null,
    isCustomized: data?.isCustomized || false,
    isLoading,
    error,
  };
};
