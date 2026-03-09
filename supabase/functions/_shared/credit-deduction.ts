import { getServiceCost } from './credit-config.ts';

export async function deductOrFail(
  supabase: any,
  {
    tenantId,
    category,
    trigger,
    description,
    referenceId,
    referenceType,
    isTestMode,
  }: {
    tenantId: string;
    category: string;
    trigger?: string;
    description?: string;
    referenceId?: string;
    referenceType?: string;
    isTestMode: boolean;
  }
) {
  const service = getServiceCost(category, trigger);
  if (!service) return { ok: false, error: `Unknown service: ${category}/${trigger}` };

  const { data, error } = await supabase.rpc('deduct_credits', {
    p_tenant_id: tenantId,
    p_category: category,
    p_description: description || service.name,
    p_reference_id: referenceId || null,
    p_reference_type: referenceType || null,
    p_is_test_mode: isTestMode,
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.success) return { ok: false, error: 'insufficient_credits', ...data };

  // Trigger auto-refill if needed (non-blocking)
  if (data.auto_refill_needed) {
    try {
      await supabase.functions.invoke('manage-credit-wallet', {
        body: { action: 'auto_refill', tenantId },
      });
    } catch (e) {
      console.warn('Auto-refill trigger failed:', e);
    }
  }

  return { ok: true, ...data };
}
