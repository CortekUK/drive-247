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

      if (error) {
        console.error('[EmailTemplates] Error fetching templates:', error);
        throw error;
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

      // Check if template already exists for this key
      const existing = customTemplates?.find(t => t.template_key === input.template_key);

      if (existing) {
        // Update existing template
        const { data, error } = await supabase
          .from('email_templates')
          .update({
            template_name: input.template_name,
            subject: input.subject,
            template_content: input.template_content,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .eq('tenant_id', tenant.id)
          .select()
          .single();

        if (error) {
          console.error('[EmailTemplates] Error updating template:', error);
          throw error;
        }

        return data;
      } else {
        // Create new template
        const { data, error } = await supabase
          .from('email_templates')
          .insert({
            tenant_id: tenant.id,
            template_key: input.template_key,
            template_name: input.template_name,
            subject: input.subject,
            template_content: input.template_content,
            is_active: true,
          })
          .select()
          .single();

        if (error) {
          console.error('[EmailTemplates] Error creating template:', error);
          throw error;
        }

        return data;
      }
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

      const { error } = await supabase
        .from('email_templates')
        .delete()
        .eq('template_key', templateKey)
        .eq('tenant_id', tenant.id);

      if (error) {
        console.error('[EmailTemplates] Error resetting template:', error);
        throw error;
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

      if (error) {
        console.error('[EmailTemplate] Error fetching template:', error);
        throw error;
      }

      // Get default template
      const defaultTemplate = getDefaultEmailTemplate(templateKey);

      return {
        customTemplate,
        defaultTemplate,
        isCustomized: !!customTemplate,
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
