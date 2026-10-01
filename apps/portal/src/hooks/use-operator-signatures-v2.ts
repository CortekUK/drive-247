'use client';

/**
 * Agreements v2 — the signed-in staff member's saved signatures: several each,
 * one primary (Template Studio → "Manage signatures").
 *
 * Table: `operator_signatures_v2` (ops/operator_signatures_v2.sql). RLS limits
 * every read and write to the caller's own rows; the queries still filter by
 * `app_user_id` AND `tenant_id`, as V2_PLAN §5 asks of every query.
 *
 * The first signature saved becomes the primary. Making another primary clears
 * the old one first (a partial unique index allows one primary per person per
 * tenant). Deleting the primary hands it to the newest remaining one.
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuthStore } from '@/stores/auth-store';
import { isMissingTableError } from '@/lib/agreements-v2/status';
import { isValidOperatorSignature } from '@/hooks/use-operator-signature-v2';

export const OPERATOR_SIGNATURES_TABLE_V2 = 'operator_signatures_v2';

export interface OperatorSignatureV2 {
  id: string;
  label: string | null;
  source: 'drawn' | 'uploaded';
  imageData: string;
  isPrimary: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  label: string | null;
  source: string;
  image_data: string;
  is_primary: boolean;
  created_at: string;
}

const SELECT = 'id, label, source, image_data, is_primary, created_at';

export const operatorSignaturesV2QueryKey = (tenantId: string | undefined, appUserId: string | undefined) =>
  ['operator-signatures-v2', tenantId, appUserId] as const;

const toSignature = (r: Row): OperatorSignatureV2 => ({
  id: r.id,
  label: r.label,
  source: r.source === 'uploaded' ? 'uploaded' : 'drawn',
  imageData: r.image_data,
  isPrimary: r.is_primary === true,
  createdAt: r.created_at,
});

/** Primary first, then newest first. */
const order = (list: OperatorSignatureV2[]) =>
  [...list].sort((a, b) => (a.isPrimary !== b.isPrimary ? (a.isPrimary ? -1 : 1) : b.createdAt.localeCompare(a.createdAt)));

export function useOperatorSignaturesV2() {
  const { tenant } = useTenant();
  const appUser = useAuthStore((s) => s.appUser);
  const queryClient = useQueryClient();
  const tenantId = tenant?.id;
  const appUserId = appUser?.id;
  const key = operatorSignaturesV2QueryKey(tenantId, appUserId);

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<OperatorSignatureV2[]> => {
      const { data, error } = await supabaseUntyped
        .from(OPERATOR_SIGNATURES_TABLE_V2)
        .select(SELECT)
        .eq('app_user_id', appUserId)
        .eq('tenant_id', tenantId);
      if (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
      return order(((data ?? []) as Row[]).filter((r) => isValidOperatorSignature(r.image_data)).map(toSignature));
    },
    enabled: !!tenantId && !!appUserId,
    retry: false,
  });

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['operator-signatures-v2', tenantId, appUserId] }),
      queryClient.invalidateQueries({ queryKey: ['operator-signature-v2', tenantId, appUserId] }),
    ]);
  }, [queryClient, tenantId, appUserId]);

  const owner = useCallback(() => {
    if (!tenantId || !appUserId) throw new Error('Sign in again to manage your signatures.');
    return { tenantId, appUserId };
  }, [tenantId, appUserId]);

  const clearPrimary = useCallback(
    async (ids: { tenantId: string; appUserId: string }, except?: string) => {
      let q = supabaseUntyped
        .from(OPERATOR_SIGNATURES_TABLE_V2)
        .update({ is_primary: false })
        .eq('app_user_id', ids.appUserId)
        .eq('tenant_id', ids.tenantId)
        .eq('is_primary', true);
      if (except) q = q.neq('id', except);
      const { error } = await q;
      if (error) throw error;
    },
    [],
  );

  /** Save a new signature. The first one, or `makePrimary`, becomes the primary. */
  const add = useCallback(
    async (input: { imageData: string; source: 'drawn' | 'uploaded'; label?: string; makePrimary?: boolean }) => {
      const ids = owner();
      if (!isValidOperatorSignature(input.imageData)) {
        throw new Error('The signature must be a PNG or JPEG image no larger than 500 kB.');
      }
      const primary = input.makePrimary || (query.data ?? []).length === 0;
      if (primary) await clearPrimary(ids);
      const { data, error } = await supabaseUntyped
        .from(OPERATOR_SIGNATURES_TABLE_V2)
        .insert({
          app_user_id: ids.appUserId,
          tenant_id: ids.tenantId,
          label: input.label?.trim().slice(0, 60) || null,
          source: input.source,
          image_data: input.imageData,
          is_primary: primary,
        })
        .select(SELECT)
        .single();
      if (error) throw error;
      await refresh();
      return toSignature(data as Row);
    },
    [owner, clearPrimary, refresh, query.data],
  );

  const setPrimary = useCallback(
    async (id: string) => {
      const ids = owner();
      await clearPrimary(ids, id);
      const { error } = await supabaseUntyped
        .from(OPERATOR_SIGNATURES_TABLE_V2)
        .update({ is_primary: true })
        .eq('id', id)
        .eq('app_user_id', ids.appUserId)
        .eq('tenant_id', ids.tenantId);
      if (error) throw error;
      await refresh();
    },
    [owner, clearPrimary, refresh],
  );

  const rename = useCallback(
    async (id: string, label: string) => {
      const ids = owner();
      const { error } = await supabaseUntyped
        .from(OPERATOR_SIGNATURES_TABLE_V2)
        .update({ label: label.trim().slice(0, 60) || null })
        .eq('id', id)
        .eq('app_user_id', ids.appUserId)
        .eq('tenant_id', ids.tenantId);
      if (error) throw error;
      await refresh();
    },
    [owner, refresh],
  );

  /** Delete one. If it was the primary, the newest remaining one takes over. */
  const remove = useCallback(
    async (id: string) => {
      const ids = owner();
      const wasPrimary = (query.data ?? []).find((s) => s.id === id)?.isPrimary === true;
      const { error } = await supabaseUntyped
        .from(OPERATOR_SIGNATURES_TABLE_V2)
        .delete()
        .eq('id', id)
        .eq('app_user_id', ids.appUserId)
        .eq('tenant_id', ids.tenantId);
      if (error) throw error;
      if (wasPrimary) {
        const next = (query.data ?? []).filter((s) => s.id !== id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (next) {
          await supabaseUntyped
            .from(OPERATOR_SIGNATURES_TABLE_V2)
            .update({ is_primary: true })
            .eq('id', next.id)
            .eq('app_user_id', ids.appUserId)
            .eq('tenant_id', ids.tenantId);
        }
      }
      await refresh();
    },
    [owner, refresh, query.data],
  );

  const signatures = query.data ?? [];
  return {
    signatures,
    primary: signatures.find((s) => s.isPrimary) ?? signatures[0] ?? null,
    isLoading: query.isLoading,
    error: query.error,
    add,
    setPrimary,
    rename,
    remove,
  };
}
