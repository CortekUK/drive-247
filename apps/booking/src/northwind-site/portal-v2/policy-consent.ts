'use client';

/**
 * Records that the signed-in customer accepted the rental company's current
 * privacy policy and terms of service — the sign-in screens say "By
 * continuing, you agree to …" (auth-v2/policy-consent-line.tsx). Once per
 * browser session and tenant; the function itself keeps one row per version,
 * so the date on file is when that version was first accepted. A failure is
 * logged and otherwise ignored: it must never stand between a customer and
 * their portal. Settings → Consent reads the rows.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { supabase } from '@nw/integrations/supabase/client';

const KEY = 'pv2-policy-consent';

export function useRecordPolicyConsent() {
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const queryClient = useQueryClient();
  const tenantId = tenant?.id ?? null;
  const versions = `${tenant?.privacy_policy_version ?? ''}|${tenant?.terms_version ?? ''}`;

  useEffect(() => {
    if (!tenantId || !customerId) return;
    const marker = `${tenantId}:${customerId}:${versions}`;
    try {
      if (sessionStorage.getItem(KEY) === marker) return;
    } catch {
      /* storage blocked: record anyway, the function is idempotent */
    }
    void supabase
      .rpc('record_customer_policy_consent', {
        p_tenant_id: tenantId,
        p_source: 'login',
        p_user_agent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
      })
      .then(({ error }) => {
        if (error) {
          console.warn('[policy-consent] not recorded', error.message);
          return;
        }
        try {
          sessionStorage.setItem(KEY, marker);
        } catch {
          /* ignore */
        }
        void queryClient.invalidateQueries({ queryKey: ['customer-consents'] });
      });
  }, [tenantId, customerId, versions, queryClient]);
}
