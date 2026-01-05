import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { toast } from '@/hooks/use-toast';
import { DEFAULT_AGREEMENT_TEMPLATE } from '@/lib/default-agreement-template';

export type TemplateType = 'default' | 'custom';

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

// Template names for identification
export const DEFAULT_TEMPLATE_NAME = 'Default Template';
export const CUSTOM_TEMPLATE_NAME = 'Custom Template';

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

/**
 * Hook specifically for managing the two-template system (Default vs Custom)
 */
export const useTemplateSelection = () => {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const {
    data: templates,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['agreement-templates-selection', tenant?.id],
    queryFn: async (): Promise<{ defaultTemplate: AgreementTemplate | null; customTemplate: AgreementTemplate | null }> => {
      if (!tenant?.id) {
        return { defaultTemplate: null, customTemplate: null };
      }

      const { data, error } = await supabase
        .from('agreement_templates')
        .select('*')
        .eq('tenant_id', tenant.id)
        .in('template_name', [DEFAULT_TEMPLATE_NAME, CUSTOM_TEMPLATE_NAME]);

      if (error) {
        console.error('[TemplateSelection] Error fetching templates:', error);
        throw error;
      }

      const defaultTemplate = data?.find((t) => t.template_name === DEFAULT_TEMPLATE_NAME) || null;
      const customTemplate = data?.find((t) => t.template_name === CUSTOM_TEMPLATE_NAME) || null;

      return { defaultTemplate, customTemplate };
    },
    enabled: !!tenant?.id,
  });

  // Initialize default template if it doesn't exist
  const initializeDefaultMutation = useMutation({
    mutationFn: async (): Promise<AgreementTemplate> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      const { data, error } = await supabase
        .from('agreement_templates')
        .insert({
          tenant_id: tenant.id,
          template_name: DEFAULT_TEMPLATE_NAME,
          template_content: DEFAULT_AGREEMENT_TEMPLATE,
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreement-templates-selection', tenant?.id] });
    },
  });

  // Initialize custom template if it doesn't exist
  const initializeCustomMutation = useMutation({
    mutationFn: async (): Promise<AgreementTemplate> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      const { data, error } = await supabase
        .from('agreement_templates')
        .insert({
          tenant_id: tenant.id,
          template_name: CUSTOM_TEMPLATE_NAME,
          template_content: '', // Start blank
          is_active: false,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreement-templates-selection', tenant?.id] });
    },
  });

  // Set active template by type
  const setActiveByTypeMutation = useMutation({
    mutationFn: async (type: TemplateType): Promise<void> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      const targetName = type === 'default' ? DEFAULT_TEMPLATE_NAME : CUSTOM_TEMPLATE_NAME;

      // Deactivate all templates first
      await supabase
        .from('agreement_templates')
        .update({ is_active: false })
        .eq('tenant_id', tenant.id);

      // Activate the selected template
      const { error } = await supabase
        .from('agreement_templates')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenant.id)
        .eq('template_name', targetName);

      if (error) {
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreement-templates-selection', tenant?.id] });
      toast({
        title: 'Template Updated',
        description: 'Active template has been changed successfully.',
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

  // Update or create template content
  const updateContentMutation = useMutation({
    mutationFn: async ({ type, content }: { type: TemplateType; content: string }): Promise<void> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      const targetName = type === 'default' ? DEFAULT_TEMPLATE_NAME : CUSTOM_TEMPLATE_NAME;
      const isDefaultType = type === 'default';

      // Check if template exists
      const { data: existing } = await supabase
        .from('agreement_templates')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('template_name', targetName)
        .single();

      if (existing) {
        // Update existing template
        const { error } = await supabase
          .from('agreement_templates')
          .update({
            template_content: content,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        if (error) {
          throw error;
        }
      } else {
        // If setting as active, deactivate all other templates first
        if (isDefaultType) {
          await supabase
            .from('agreement_templates')
            .update({ is_active: false })
            .eq('tenant_id', tenant.id);
        }

        // Create new template
        const { error } = await supabase
          .from('agreement_templates')
          .insert({
            tenant_id: tenant.id,
            template_name: targetName,
            template_content: content,
            is_active: isDefaultType, // Default template is active by default
          });

        if (error) {
          throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreement-templates-selection', tenant?.id] });
      toast({
        title: 'Template Saved',
        description: 'Template content has been saved successfully.',
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

  // Clear custom template content
  const clearCustomMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      const { error } = await supabase
        .from('agreement_templates')
        .update({
          template_content: '',
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('tenant_id', tenant.id)
        .eq('template_name', CUSTOM_TEMPLATE_NAME);

      if (error) {
        throw error;
      }

      // Make sure default template is active if custom was active
      if (customTemplate?.is_active) {
        await supabase
          .from('agreement_templates')
          .update({ is_active: true })
          .eq('tenant_id', tenant.id)
          .eq('template_name', DEFAULT_TEMPLATE_NAME);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreement-templates-selection', tenant?.id] });
      toast({
        title: 'Template Cleared',
        description: 'Custom template has been cleared.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to clear template',
        variant: 'destructive',
      });
    },
  });

  // Reset default template to original content (or create if doesn't exist)
  const resetDefaultMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!tenant?.id) {
        throw new Error('No tenant ID available');
      }

      // Check if template exists
      const { data: existing } = await supabase
        .from('agreement_templates')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('template_name', DEFAULT_TEMPLATE_NAME)
        .single();

      if (existing) {
        // Update existing template
        const { error } = await supabase
          .from('agreement_templates')
          .update({
            template_content: DEFAULT_AGREEMENT_TEMPLATE,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        if (error) {
          throw error;
        }
      } else {
        // Deactivate all other templates first
        await supabase
          .from('agreement_templates')
          .update({ is_active: false })
          .eq('tenant_id', tenant.id);

        // Create new template with default content
        const { error } = await supabase
          .from('agreement_templates')
          .insert({
            tenant_id: tenant.id,
            template_name: DEFAULT_TEMPLATE_NAME,
            template_content: DEFAULT_AGREEMENT_TEMPLATE,
            is_active: true,
          });

        if (error) {
          throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreement-templates-selection', tenant?.id] });
      toast({
        title: 'Template Reset',
        description: 'Default template has been reset to original content.',
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

  const defaultTemplate = templates?.defaultTemplate || null;
  const customTemplate = templates?.customTemplate || null;
  const activeType: TemplateType | null = defaultTemplate?.is_active
    ? 'default'
    : customTemplate?.is_active
      ? 'custom'
      : null;

  return {
    defaultTemplate,
    customTemplate,
    activeType,
    isLoading,
    error,
    refetch,
    initializeDefault: initializeDefaultMutation.mutateAsync,
    isInitializingDefault: initializeDefaultMutation.isPending,
    initializeCustom: initializeCustomMutation.mutateAsync,
    isInitializingCustom: initializeCustomMutation.isPending,
    setActiveByType: setActiveByTypeMutation.mutate,
    setActiveByTypeAsync: setActiveByTypeMutation.mutateAsync,
    isSettingActive: setActiveByTypeMutation.isPending,
    updateContent: updateContentMutation.mutate,
    updateContentAsync: updateContentMutation.mutateAsync,
    isUpdating: updateContentMutation.isPending,
    resetDefault: resetDefaultMutation.mutate,
    resetDefaultAsync: resetDefaultMutation.mutateAsync,
    isResetting: resetDefaultMutation.isPending,
    clearCustom: clearCustomMutation.mutate,
    clearCustomAsync: clearCustomMutation.mutateAsync,
    isClearing: clearCustomMutation.isPending,
  };
};
