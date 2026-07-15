/**
 * Low e-sign credit alerting.
 *
 * When a tenant's live credit wallet runs low, every attempt to auto-generate a
 * rental agreement (original OR extension) is blocked by the `deduct_credits`
 * check and parked in `rental_agreements` as `document_status='credit_failed'`.
 * The customer never gets the contract and — before this — the tenant was not
 * alerted loudly. This raises a reminder (warning when low, critical when the
 * next agreement WILL fail) reusing the same `reminders` / `reminder_config`
 * infrastructure as the Bonzah low-balance monitor.
 *
 * Threshold is configurable per tenant via `reminder_config`
 * (config_key = 'esign_low_credit', config_value = { threshold, enabled }).
 * Default threshold = enough for 2 agreements (2 x esign cost from credit_costs).
 *
 * The helper is best-effort: it never throws, so it can be awaited inline in the
 * esign route without risking the agreement flow.
 */

const RULE_CODE = 'ESIGN_LOW_CREDIT';
const CONFIG_KEY = 'esign_low_credit';
const DEFAULT_ESIGN_COST = 7;

interface EsignCreditAlertOpts {
  /** Wallet balance AFTER the attempted deduction, or the current balance when the deduction failed. */
  balance: number;
  /** True when the deduction failed for insufficient credits (the next agreement already failed). */
  insufficient?: boolean;
  /** Test mode never spends real credits — skip alerting entirely. */
  isTestMode?: boolean;
}

// Typed loosely on purpose: this is called with a service-role client created in
// the API route, and the route files already lean on `any` for Supabase results.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function raiseEsignCreditAlert(
  supabase: any,
  tenantId: string | null | undefined,
  opts: EsignCreditAlertOpts,
): Promise<void> {
  try {
    if (!tenantId) return;
    if (opts.isTestMode) return; // test mode doesn't consume live credits

    // Cost of a single e-sign agreement (default 7 credits).
    const { data: costRow } = await supabase
      .from('credit_costs')
      .select('cost_credits')
      .eq('category', 'esign')
      .eq('is_active', true)
      .maybeSingle();
    const esignCost = Number(costRow?.cost_credits ?? DEFAULT_ESIGN_COST) || DEFAULT_ESIGN_COST;

    // Per-tenant configurable threshold (default: enough for 2 agreements).
    const { data: cfgRow } = await supabase
      .from('reminder_config')
      .select('config_value')
      .eq('config_key', CONFIG_KEY)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const cfg = (cfgRow?.config_value ?? null) as { threshold?: number; enabled?: boolean } | null;
    if (cfg && cfg.enabled === false) return;
    const threshold = typeof cfg?.threshold === 'number' ? cfg.threshold : esignCost * 2;

    const balance = Number(opts.balance);
    // Critical the moment the balance can't cover the next agreement.
    const willFail = !!opts.insufficient || balance < esignCost;

    const nowIso = new Date().toISOString();

    // Healthy balance — resolve any open alert and stop.
    if (!willFail && balance >= threshold) {
      await supabase
        .from('reminders')
        .update({ status: 'done', updated_at: nowIso })
        .eq('rule_code', RULE_CODE)
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'sent']);
      return;
    }

    const severity = willFail ? 'critical' : 'warning';
    const title = willFail
      ? 'E-sign credits depleted — agreements will fail'
      : 'Low e-sign credits';
    const message = willFail
      ? `Your e-sign credit balance (${balance}) is below the ${esignCost} credits required to send a rental agreement. The next agreement (original or extension) will fail until you top up.`
      : `Your e-sign credit balance (${balance}) is running low. Each agreement costs ${esignCost} credits. Top up to avoid failed agreements.`;
    const today = nowIso.split('T')[0];
    const context = { balance, esign_cost: esignCost, threshold };

    // Dedupe: reuse an existing unresolved reminder instead of spamming new rows.
    const { data: existing } = await supabase
      .from('reminders')
      .select('id, severity')
      .eq('rule_code', RULE_CODE)
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'sent'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Only touch it when escalating warning -> critical, so we don't re-alert
      // on every deduction while a warning is already outstanding.
      if (severity === 'critical' && existing.severity !== 'critical') {
        await supabase
          .from('reminders')
          .update({ severity, title, message, context, last_sent_at: nowIso, updated_at: nowIso })
          .eq('id', existing.id);
      }
      return;
    }

    await supabase.from('reminders').insert({
      rule_code: RULE_CODE,
      object_type: 'Integration',
      object_id: tenantId,
      title,
      message,
      due_on: today,
      remind_on: today,
      severity,
      status: 'pending',
      context,
      tenant_id: tenantId,
    });
  } catch (e) {
    console.warn('raiseEsignCreditAlert failed:', e);
  }
}
