import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';

export interface AgreementTemplate {
  id: string;
  tenant_id: string;
  template_name: string;
  template_content: string;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateTemplateInput {
  template_name: string;
  template_content: string;
  is_active?: boolean;
}

export interface UpdateTemplateInput {
  id: string;
  template_name?: string;
  template_content?: string;
  is_active?: boolean;
}

/**
 * Hook to manage agreement templates for the current tenant
 */
export const useAgreementTemplates = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  // Fetch all templates for the tenant
  const {
    data: templates,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['agreement-templates', tenant?.id],
    queryFn: async (): Promise<AgreementTemplate[]> => {
      if (!tenant?.id) {
        console.log('[AgreementTemplates] No tenant ID, returning empty array');
        return [];
      }

      console.log(`[AgreementTemplates] Fetching templates for tenant: ${tenant.id}`);

      const { data, error } = await supabase
        .from('agreement_templates')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[AgreementTemplates] Error fetching templates:', error);
        throw error;
      }

      return data || [];
    },
    enabled: !!tenant?.id,
  });

  // Create template mutation
  const createTemplateMutation = useMutation({
    mutationFn: async (input: CreateTemplateInput): Promise<AgreementTemplate> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      // If setting as active, first deactivate all other templates
      if (input.is_active) {
        await supabase
          .from('agreement_templates')
          .update({ is_active: false })
          .eq('tenant_id', tenant.id);
      }

      const { data, error } = await supabase
        .from('agreement_templates')
        .insert({
          tenant_id: tenant.id,
          template_name: input.template_name,
          template_content: input.template_content,
          is_active: input.is_active ?? true,
        })
        .select()
        .single();

      if (error) {
        console.error('[AgreementTemplates] Error creating template:', error);
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreement-templates', tenant?.id] });
      toast({
        title: 'Template Created',
        description: 'Your agreement template has been created successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create template',
        variant: 'destructive',
      });
    },
  });

  // Update template mutation
  const updateTemplateMutation = useMutation({
    mutationFn: async (input: UpdateTemplateInput): Promise<AgreementTemplate> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      // If setting as active, first deactivate all other templates
      if (input.is_active) {
        await supabase
          .from('agreement_templates')
          .update({ is_active: false })
          .eq('tenant_id', tenant.id)
          .neq('id', input.id);
      }

      const updateData: Partial<AgreementTemplate> = {
        updated_at: new Date().toISOString(),
      };

      if (input.template_name !== undefined) {
        updateData.template_name = input.template_name;
      }
      if (input.template_content !== undefined) {
        updateData.template_content = input.template_content;
      }
      if (input.is_active !== undefined) {
        updateData.is_active = input.is_active;
      }

      const { data, error } = await supabase
        .from('agreement_templates')
        .update(updateData)
        .eq('id', input.id)
        .eq('tenant_id', tenant.id)
        .select()
        .single();

      if (error) {
        console.error('[AgreementTemplates] Error updating template:', error);
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreement-templates', tenant?.id] });
      toast({
        title: 'Template Updated',
        description: 'Your agreement template has been updated successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update template',
        variant: 'destructive',
      });
    },
  });

  // Delete template mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: async (templateId: string): Promise<void> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      const { error } = await supabase
        .from('agreement_templates')
        .delete()
        .eq('id', templateId)
        .eq('tenant_id', tenant.id);

      if (error) {
        console.error('[AgreementTemplates] Error deleting template:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreement-templates', tenant?.id] });
      toast({
        title: 'Template Deleted',
        description: 'The agreement template has been deleted.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete template',
        variant: 'destructive',
      });
    },
  });

  // Set template as active mutation
  const setActiveTemplateMutation = useMutation({
    mutationFn: async (templateId: string): Promise<void> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      // Deactivate all templates first
      await supabase
        .from('agreement_templates')
        .update({ is_active: false })
        .eq('tenant_id', tenant.id);

      // Activate the selected template
      const { error } = await supabase
        .from('agreement_templates')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', templateId)
        .eq('tenant_id', tenant.id);

      if (error) {
        console.error('[AgreementTemplates] Error setting active template:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreement-templates', tenant?.id] });
      toast({
        title: 'Active Template Updated',
        description: 'The selected template is now active and will be used for new agreements.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to set active template',
        variant: 'destructive',
      });
    },
  });

  // Get active template
  const activeTemplate = templates?.find((t) => t.is_active) || null;

  return {
    templates: templates || [],
    activeTemplate,
    isLoading,
    error,
    refetch,
    createTemplate: createTemplateMutation.mutate,
    createTemplateAsync: createTemplateMutation.mutateAsync,
    isCreating: createTemplateMutation.isPending,
    updateTemplate: updateTemplateMutation.mutate,
    updateTemplateAsync: updateTemplateMutation.mutateAsync,
    isUpdating: updateTemplateMutation.isPending,
    deleteTemplate: deleteTemplateMutation.mutate,
    deleteTemplateAsync: deleteTemplateMutation.mutateAsync,
    isDeleting: deleteTemplateMutation.isPending,
    setActiveTemplate: setActiveTemplateMutation.mutate,
    setActiveTemplateAsync: setActiveTemplateMutation.mutateAsync,
    isSettingActive: setActiveTemplateMutation.isPending,
  };
};

/**
 * Hook to fetch only the active template for the current tenant
 */
export const useActiveAgreementTemplate = () => {
  const { tenant } = useTenant();

  const { data: activeTemplate, isLoading, error } = useQuery({
    queryKey: ['active-agreement-template', tenant?.id],
    queryFn: async (): Promise<AgreementTemplate | null> => {
      if (!tenant?.id) {
        return null;
      }

      const { data, error } = await supabase
        .from('agreement_templates')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .single();

      if (error) {
        // No active template found is not an error
        if (error.code === 'PGRST116') {
          return null;
        }
        console.error('[AgreementTemplates] Error fetching active template:', error);
        throw error;
      }

      return data;
    },
    enabled: !!tenant?.id,
  });

  return {
    activeTemplate,
    isLoading,
    error,
    hasTemplate: !!activeTemplate,
  };
};
