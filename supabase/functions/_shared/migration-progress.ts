// Shared: operator migration progress — admin notification + completion reward.
//
// Two operator tasks drive the migration prompt:
//   1. "stripe"  → connected their own Stripe account via OAuth
//   2. "payment" → payment details captured on the new billing account
//
// Whenever either task completes we (a) email the platform admin so Ghulam sees
// progress live, and (b) if BOTH are now complete, grant 100 live credits
// exactly once (guarded by tenants.migration_reward_granted_at).
//
// Every call is best-effort: a failure here must NEVER break the OAuth callback
// or the subscription webhook that invoked it.

import { sendEmail } from "./resend-service.ts";

/** Where migration progress notifications go. */
const ADMIN_NOTIFY_EMAIL = "ilyasghulam35@gmail.com";
const REWARD_CREDITS = 100;

export type MigrationTask = "stripe" | "payment";

interface TenantProgressRow {
  id: string;
  company_name: string | null;
  slug: string | null;
  stripe_mode: string | null;
  payment_model: string | null;
  subscription_account: string | null;
  own_stripe_account_id: string | null;
  own_stripe_test_account_id: string | null;
  migration_reward_granted_at: string | null;
}

const PROGRESS_COLUMNS =
  "id, company_name, slug, stripe_mode, payment_model, subscription_account, own_stripe_account_id, own_stripe_test_account_id, migration_reward_granted_at";

/**
 * Task 1 complete = the operator's LIVE Stripe account is connected.
 *
 * The migration prompt always runs OAuth in live mode (connecting the account
 * they actually get paid into), regardless of the tenant's current stripe_mode
 * — so completion is keyed off the live account only. A test connection made
 * via the admin's explicit test link is for rehearsal and does not complete
 * the operator's task or trigger the reward.
 */
export function isStripeConnected(t: Partial<TenantProgressRow>): boolean {
  return !!t.own_stripe_account_id;
}

/** Task 2 complete = billing has moved to the new account. */
export function isPaymentCaptured(t: Partial<TenantProgressRow>): boolean {
  return t.subscription_account === "uae";
}

function progressEmailHtml(
  tenant: TenantProgressRow,
  task: MigrationTask,
  bothDone: boolean,
  rewardGranted: boolean
): string {
  const taskLabel =
    task === "stripe" ? "Connected their Stripe account" : "Confirmed payment details";
  const stripeDone = isStripeConnected(tenant);
  const paymentDone = isPaymentCaptured(tenant);
  const tick = (b: boolean) => (b ? "✅" : "⬜️");
  return `
    <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a2e;line-height:1.6">
      <h2 style="margin:0 0 4px;color:#6366f1;font-size:20px">
        ${bothDone ? "🎉 Migration complete" : "Migration progress"}
      </h2>
      <p style="margin:0 0 16px;color:#64748b">
        <strong>${tenant.company_name ?? "Unknown tenant"}</strong> (${tenant.slug ?? "-"})
      </p>
      <p style="margin:0 0 12px"><strong>${taskLabel}</strong></p>
      <table style="border-collapse:collapse;margin:0 0 16px">
        <tr><td style="padding:4px 10px 4px 0">${tick(stripeDone)}</td><td>Stripe account connected</td></tr>
        <tr><td style="padding:4px 10px 4px 0">${tick(paymentDone)}</td><td>Payment details confirmed</td></tr>
      </table>
      ${
        bothDone
          ? `<p style="margin:0 0 12px;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
               Both steps are done. ${
                 rewardGranted
                   ? `<strong>${REWARD_CREDITS} credits granted.</strong>`
                   : `<strong>Reward NOT granted</strong> — check logs.`
               }
             </p>`
          : `<p style="margin:0 0 12px;color:#64748b">Waiting on the remaining step.</p>`
      }
      <p style="margin:0;color:#94a3b8;font-size:13px">
        Mode: ${tenant.stripe_mode ?? "-"} · payment_model: ${tenant.payment_model ?? "-"} · tenant: ${tenant.id}
      </p>
    </div>`;
}

/**
 * Record that an operator finished a migration task: notify the admin and, when
 * both tasks are complete, grant the completion credits exactly once.
 * Never throws — callers are payment-critical paths.
 */
export async function onMigrationTaskComplete(
  supabase: any,
  tenantId: string,
  task: MigrationTask
): Promise<void> {
  try {
    const { data: tenant, error } = await supabase
      .from("tenants")
      .select(PROGRESS_COLUMNS)
      .eq("id", tenantId)
      .single();
    if (error || !tenant) {
      console.error(`[migration-progress] tenant ${tenantId} not found:`, error?.message);
      return;
    }

    const t = tenant as TenantProgressRow;
    const bothDone = isStripeConnected(t) && isPaymentCaptured(t);
    let rewardGranted = false;

    // Grant the completion reward exactly once. The conditional UPDATE below is
    // the idempotency guard: only the first caller to flip NULL→now() proceeds,
    // so concurrent OAuth + webhook completions can't double-grant.
    if (bothDone && !t.migration_reward_granted_at) {
      const nowIso = new Date().toISOString();
      const { data: claimed, error: claimErr } = await supabase
        .from("tenants")
        .update({ migration_reward_granted_at: nowIso })
        .eq("id", tenantId)
        .is("migration_reward_granted_at", null)
        .select("id");

      if (!claimErr && claimed && claimed.length > 0) {
        const { error: creditErr } = await supabase.rpc("add_credits", {
          p_tenant_id: tenantId,
          p_amount: REWARD_CREDITS,
          p_type: "gift",
          p_description: "Thank you for completing your payment setup — 100 free credits",
          p_is_test_mode: false, // live balance
        });
        if (creditErr) {
          // Roll the claim back so a retry can grant it rather than silently owing them.
          await supabase
            .from("tenants")
            .update({ migration_reward_granted_at: null })
            .eq("id", tenantId);
          console.error(`[migration-progress] credit grant FAILED for ${tenantId}:`, creditErr.message);
        } else {
          rewardGranted = true;
          console.log(`[migration-progress] granted ${REWARD_CREDITS} live credits to ${tenantId}`);
        }
      }
    }

    const subject = bothDone
      ? `🎉 ${t.company_name ?? "Tenant"} completed migration`
      : `Migration progress — ${t.company_name ?? "Tenant"}: ${
          task === "stripe" ? "Stripe connected" : "payment details confirmed"
        }`;

    await sendEmail(
      ADMIN_NOTIFY_EMAIL,
      subject,
      progressEmailHtml(t, task, bothDone, rewardGranted || !!t.migration_reward_granted_at)
    );
  } catch (err) {
    console.error("[migration-progress] non-fatal error:", (err as Error)?.message ?? err);
  }
}
