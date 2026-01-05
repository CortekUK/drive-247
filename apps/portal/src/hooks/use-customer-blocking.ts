import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "./use-toast";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";

export interface BlockedIdentity {
  id: string;
  identity_type: 'license' | 'id_card' | 'passport' | 'email' | 'other';
  identity_number: string;
  reason: string;
  blocked_by: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BlockCustomerRequest {
  customerId: string;
  reason: string;
}

export interface AddBlockedIdentityRequest {
  identityType: 'license' | 'id_card' | 'passport' | 'email' | 'other';
  identityNumber: string;
  reason: string;
  notes?: string;
}

// Hook to get all blocked identities
export function useBlockedIdentities() {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['blocked-identities', tenant?.id],
    queryFn: async () => {
      let query = supabase
        .from('blocked_identities')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching blocked identities:', error);
        throw error;
      }

      return data as BlockedIdentity[];
    },
  });
}

// Hook to check if an identity is blocked
export function useCheckBlockedIdentity(identityNumber: string | null) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ['blocked-identity-check', identityNumber, tenant?.id],
    queryFn: async () => {
      if (!identityNumber) return null;

      let query = supabase
        .from('blocked_identities')
        .select('*')
        .eq('identity_number', identityNumber)
        .eq('is_active', true);

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { data, error } = await query.single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking blocked identity:', error);
        throw error;
      }

      return data as BlockedIdentity | null;
    },
    enabled: !!identityNumber,
  });
}

// Hook for customer blocking actions
export function useCustomerBlockingActions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { appUser } = useAuth();
  const { tenant } = useTenant();

  // Block a customer
  const blockCustomer = useMutation({
    mutationFn: async ({ customerId, reason }: BlockCustomerRequest) => {
      const { data, error } = await supabase.rpc('block_customer', {
        p_customer_id: customerId,
        p_reason: reason,
        p_blocked_by: appUser?.id || null
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-list'] });
      queryClient.invalidateQueries({ queryKey: ['blocked-identities'] });
      toast({
        title: "Customer Blocked",
        description: "The customer has been blocked and their identifiers added to the blocklist.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to block customer",
        variant: "destructive",
      });
    },
  });

  // Unblock a customer
  const unblockCustomer = useMutation({
    mutationFn: async (customerId: string) => {
      const { data, error } = await supabase.rpc('unblock_customer', {
        p_customer_id: customerId
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-list'] });
      queryClient.invalidateQueries({ queryKey: ['blocked-identities'] });
      toast({
        title: "Customer Unblocked",
        description: "The customer has been unblocked.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to unblock customer",
        variant: "destructive",
      });
    },
  });

  // Add identity to blocklist directly
  const addBlockedIdentity = useMutation({
    mutationFn: async ({ identityType, identityNumber, reason, notes }: AddBlockedIdentityRequest) => {
      const { data, error } = await supabase
        .from('blocked_identities')
        .insert({
          identity_type: identityType,
          identity_number: identityNumber,
          reason,
          notes,
          blocked_by: appUser?.id || null,
          tenant_id: tenant?.id
        })
        .select()
        .single();

      if (error) throw error;

      // If blocking by email, check and update global blacklist
      if (identityType === 'email') {
        await supabase.rpc('check_and_update_global_blacklist', {
          p_email: identityNumber
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-identities'] });
      queryClient.invalidateQueries({ queryKey: ['global-blacklist'] });
      toast({
        title: "Identity Blocked",
        description: "The identity has been added to the blocklist.",
      });
    },
    onError: (error: any) => {
      if (error.code === '23505') {
        toast({
          title: "Already Blocked",
          description: "This identity is already in the blocklist.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to add to blocklist",
          variant: "destructive",
        });
      }
    },
  });

  // Remove identity from blocklist (deactivate)
  const removeBlockedIdentity = useMutation({
    mutationFn: async (identityId: string) => {
      // First get the identity to check if it's an email type
      const { data: identity } = await supabase
        .from('blocked_identities')
        .select('identity_type, identity_number')
        .eq('id', identityId)
        .single();

      let query = supabase
        .from('blocked_identities')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', identityId);

      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }

      const { error } = await query;

      if (error) throw error;

      // If it was an email type, update global blacklist
      if (identity?.identity_type === 'email' && identity?.identity_number) {
        await supabase.rpc('check_and_update_global_blacklist', {
          p_email: identity.identity_number
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-identities'] });
      queryClient.invalidateQueries({ queryKey: ['global-blacklist'] });
      toast({
        title: "Identity Unblocked",
        description: "The identity has been removed from the blocklist.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove from blocklist",
        variant: "destructive",
      });
    },
  });

  return {
    blockCustomer,
    unblockCustomer,
    addBlockedIdentity,
    removeBlockedIdentity,
    isLoading: blockCustomer.isPending || unblockCustomer.isPending ||
               addBlockedIdentity.isPending || removeBlockedIdentity.isPending
  };
}

// Utility function to check identity blocking (for use in forms/validation)
// Checks license, id_card, passport, and email types
export async function checkIdentityBlocked(identityNumber: string, tenantId?: string): Promise<{
  isBlocked: boolean;
  reason?: string;
  type?: string;
}> {
  if (!identityNumber || identityNumber.trim() === '') {
    return { isBlocked: false };
  }

  let query = supabase
    .from('blocked_identities')
    .select('identity_type, reason')
    .eq('identity_number', identityNumber.trim())
    .eq('is_active', true)
    .in('identity_type', ['license', 'id_card', 'passport', 'email']);

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data, error } = await query.single();

  if (data && !error) {
    return {
      isBlocked: true,
      reason: data.reason,
      type: data.identity_type
    };
  }

  return { isBlocked: false };
}
