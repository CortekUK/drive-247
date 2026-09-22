'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuthStore } from '@/stores/auth-store';
import { isMissingTableError } from '@/lib/agreements-v2/status';

/**
 * Agreements v2 — the signed-in staff member's own signature ("Your signature"
 * in the editor's side panel).
 *
 * One row per staff member in `agreement_operator_signatures_v2`, keyed by
 * `app_users.id` (ops/agreements_v2.sql, NOT YET APPLIED). The value is a PNG
 * or JPEG data URL, drawn or uploaded, capped at 500 kB.
 *
 * DEGRADES, NEVER BREAKS. Until the SQL is applied the table does not exist.
 * Reading it then answers `signature: null`, and `save()` resolves
 * `{ persisted: false }` without throwing, so "Save and use" still puts the
 * signature into the document and simply keeps nothing for next time. Any
 * OTHER failure is a real one and does throw.
 *
 * The table is not in the generated types until it is applied, hence the
 * untyped client. Every read and write also filters by `tenant_id`.
 */

export const OPERATOR_SIGNATURE_MAX_BYTES = 500 * 1024;

const DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Is this a PNG or JPEG data URL no larger than the cap? */
export function isValidOperatorSignature(dataUrl: string): boolean {
  if (typeof dataUrl !== 'string') return false;
  if (dataUrl.length > OPERATOR_SIGNATURE_MAX_BYTES) return false;
  return DATA_URL.test(dataUrl);
}

export const operatorSignatureV2QueryKey = (tenantId: string | undefined, appUserId: string | undefined) =>
  ['operator-signature-v2', tenantId, appUserId] as const;

export function useOperatorSignatureV2() {
  const { tenant } = useTenant();
  const appUser = useAuthStore((s) => s.appUser);
  const queryClient = useQueryClient();
  const tenantId = tenant?.id;
  const appUserId = appUser?.id;
  const key = operatorSignatureV2QueryKey(tenantId, appUserId);

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabaseUntyped
        .from('agreement_operator_signatures_v2')
        .select('image_data')
        .eq('app_user_id', appUserId)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (error) {
        if (isMissingTableError(error)) return null;
        throw error;
      }
      const image = (data as { image_data?: string | null } | null)?.image_data ?? null;
      return image && isValidOperatorSignature(image) ? image : null;
    },
    enabled: !!tenantId && !!appUserId,
    retry: false,
  });

  const save = useCallback(
    async (dataUrl: string): Promise<{ persisted: boolean }> => {
      if (!isValidOperatorSignature(dataUrl)) {
        throw new Error('The signature must be a PNG or JPEG image no larger than 500 kB.');
      }
      if (!tenantId || !appUserId) return { persisted: false };

      const { error } = await supabaseUntyped
        .from('agreement_operator_signatures_v2')
        .upsert(
          {
            app_user_id: appUserId,
            tenant_id: tenantId,
            image_data: dataUrl,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'app_user_id' },
        );
      if (error) {
        if (isMissingTableError(error)) return { persisted: false };
        throw error;
      }
      queryClient.setQueryData(operatorSignatureV2QueryKey(tenantId, appUserId), dataUrl);
      return { persisted: true };
    },
    [tenantId, appUserId, queryClient],
  );

  return {
    signature: query.data ?? null,
    isLoading: query.isLoading,
    save,
  };
}
