import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { notifyOperatorsInApp } from "../_shared/notify-inapp.ts";
import {
  sendEmail,
  getTenantBranding,
  getTenantNotificationRecipient,
  isOperatorEmailEnabled,
  wrapWithBrandedTemplate,
  TenantBranding,
} from "../_shared/resend-service.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface InsurancePolicy {
  id: string;
  customer_id: string;
  vehicle_id: string | null;
  policy_number: string;
  provider: string | null;
  expiry_date: string;
  status: string;
  tenant_id: string;
  customers: {
    name: string;
    email: string | null;
    phone: string | null;
    whatsapp_opt_in: boolean;
  };
  vehicles: {
    reg: string;
    make: string;
    model: string;
  } | null;
}

interface InsDigestItem {
  policyNumber: string;
  customerName: string;
  vehicleReg: string | null;
  offset?: number;
}

// Builds the operator-facing HTML digest of this run's insurance events.
function buildInsuranceDigestHtml(
  digest: { expiring: InsDigestItem[]; expired: InsDigestItem[] },
  branding: TenantBranding,
): string {
  const row = (cols: string[]) =>
    `<tr>${cols.map((c) => `<td style="padding:12px;border-bottom:1px solid #e5e7eb;">${c}</td>`).join('')}</tr>`;
  const expiredRows = digest.expired
    .map((i) => row([i.policyNumber, i.customerName, i.vehicleReg ?? '—', '<span style="color:#dc2626;font-weight:600;">Expired</span>']))
    .join('');
  const expiringRows = [...digest.expiring]
    .sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))
    .map((i) => row([i.policyNumber, i.customerName, i.vehicleReg ?? '—', i.offset === 0 ? '<span style="color:#d97706;font-weight:600;">Today</span>' : `In ${i.offset} days`]))
    .join('');
  return `
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a;">Insurance Policy Alerts</h2>
                            <p style="margin: 0 0 25px; color: #444;">The following customer insurance policies need attention.</p>
                            ${digest.expired.length ? `
                            <h3 style="margin: 0 0 12px; color: #dc2626;">Expired (${digest.expired.length})</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
                                <thead><tr style="background: #fef2f2;"><th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">POLICY</th><th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">CUSTOMER</th><th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">VEHICLE</th><th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">STATUS</th></tr></thead>
                                <tbody>${expiredRows}</tbody>
                            </table>` : ''}
                            ${digest.expiring.length ? `
                            <h3 style="margin: 0 0 12px; color: #d97706;">Expiring soon (${digest.expiring.length})</h3>
                            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
                                <thead><tr style="background: #fffbeb;"><th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">POLICY</th><th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">CUSTOMER</th><th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">VEHICLE</th><th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">EXPIRES</th></tr></thead>
                                <tbody>${expiringRows}</tbody>
                            </table>` : ''}
                            <div style="text-align: center; margin-top: 10px;">
                                <a href="https://${branding.slug}.portal.drive-247.com/insurances" style="display: inline-block; background: ${branding.accentColor}; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: 600;">View Insurance</a>
                            </div>
                        </td>
                    </tr>`;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('🔄 Starting insurance reminders generation...');

    // Get all active insurance policies (including tenant_id)
    const { data: policies, error: policiesError } = await supabaseClient
      .from('insurance_policies')
      .select(`
        *, tenant_id,
        customers!inner(name, email, phone, whatsapp_opt_in),
        vehicles(reg, make, model)
      `)
      .eq('status', 'Active')
      .order('expiry_date', { ascending: true });

    if (policiesError) {
      console.error('❌ Error fetching policies:', policiesError);
      throw policiesError;
    }

    console.log(`📋 Found ${policies.length} active insurance policies`);

    const today = new Date();
    const currentMonth = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    let monthlyChecksCreated = 0;
    let expiryRemindersCreated = 0;

    // Per-tenant digest of insurance events created this run. Sent as ONE gated
    // operator email per tenant at the end (see below) to avoid bombarding
    // operators with per-policy mail.
    const emailDigest = new Map<string, { expiring: InsDigestItem[]; expired: InsDigestItem[] }>();
    const pushDigest = (tenantId: string, bucket: 'expiring' | 'expired', item: InsDigestItem) => {
      const d = emailDigest.get(tenantId) ?? { expiring: [], expired: [] };
      d[bucket].push(item);
      emailDigest.set(tenantId, d);
    };

    for (const policy of policies as InsurancePolicy[]) {
      const expiryDate = new Date(policy.expiry_date);
      const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Generate monthly verification reminder
      const monthlyCheckKey = `insurance_check:${policy.id}:${currentMonth}`;
      const monthlyCheckMessage = `Monthly insurance verification for ${policy.policy_number} (${policy.customers.name})${policy.vehicles ? ` - Vehicle: ${policy.vehicles.reg}` : ''}`;

      const { error: monthlyCheckError } = await supabaseClient
        .from('reminder_events')
        .insert({
          unique_key: monthlyCheckKey,
          customer_id: policy.customer_id,
          vehicle_id: policy.vehicle_id,
          rental_id: null, // Insurance reminders don't have rental_id
          charge_id: null, // Insurance reminders don't have charge_id
          reminder_type: 'insurance_check',
          message_preview: monthlyCheckMessage,
          status: 'Delivered',
          delivered_at: new Date().toISOString(),
          delivered_to: 'in_app',
          tenant_id: policy.tenant_id
        })
        .select()
        .single();

      if (monthlyCheckError && monthlyCheckError.code !== '23505') { // Ignore duplicate key errors
        console.error('❌ Error creating monthly check reminder:', monthlyCheckError);
      } else if (!monthlyCheckError) {
        monthlyChecksCreated++;
        console.log(`✅ Created monthly check reminder for policy ${policy.policy_number}`);
      }

      // Generate expiry reminders at 30, 14, 7, and 0 days before expiry
      const expiryOffsets = [30, 14, 7, 0];
      
      for (const offset of expiryOffsets) {
        if (daysUntilExpiry === offset) {
          const expiryReminderKey = `insurance_expiry:${policy.id}:${offset}d`;
          let expiryMessage = '';

          if (offset === 0) {
            expiryMessage = `🚨 URGENT: Insurance policy ${policy.policy_number} expires TODAY! (${policy.customers.name})${policy.vehicles ? ` - Vehicle: ${policy.vehicles.reg}` : ''}`;
          } else {
            expiryMessage = `⚠️ Insurance policy ${policy.policy_number} expires in ${offset} days (${policy.customers.name})${policy.vehicles ? ` - Vehicle: ${policy.vehicles.reg}` : ''}`;
          }

          const { error: expiryReminderError } = await supabaseClient
            .from('reminder_events')
            .insert({
              unique_key: expiryReminderKey,
              customer_id: policy.customer_id,
              vehicle_id: policy.vehicle_id,
              rental_id: null,
              charge_id: null,
              reminder_type: 'insurance_expiry',
              message_preview: expiryMessage,
              status: 'Delivered',
              delivered_at: new Date().toISOString(),
              delivered_to: 'in_app',
              tenant_id: policy.tenant_id
            })
            .select()
            .single();

          if (expiryReminderError && expiryReminderError.code !== '23505') {
            console.error('❌ Error creating expiry reminder:', expiryReminderError);
          } else if (!expiryReminderError) {
            expiryRemindersCreated++;
            console.log(`✅ Created ${offset}-day expiry reminder for policy ${policy.policy_number}`);

            // Always-on operator bell for insurance expiry. Tied to the
            // newly-created reminder_event (the 23505 duplicate path is skipped),
            // so it fires exactly once per milestone and never spams repeat cron
            // runs. This is the portal bell the reminder_events ledger never fed.
            await notifyOperatorsInApp({
              tenantId: policy.tenant_id,
              type: "insurance_reminder",
              title: offset === 0
                ? "Insurance policy expires today"
                : `Insurance policy expires in ${offset} days`,
              message: `Policy ${policy.policy_number} for ${policy.customers.name}${policy.vehicles ? ` (${policy.vehicles.reg})` : ''}${offset === 0 ? ' expires today.' : ` expires in ${offset} days.`}`,
              link: "/insurances",
              metadata: {
                policy_id: policy.id,
                policy_number: policy.policy_number,
                customer_id: policy.customer_id,
                customer_name: policy.customers.name,
                vehicle_reg: policy.vehicles?.reg ?? null,
                days_until_expiry: offset,
              },
              dedupeKey: `insurance_expiry:${policy.id}:${offset}d`,
            });

            pushDigest(policy.tenant_id, 'expiring', {
              policyNumber: policy.policy_number,
              customerName: policy.customers.name,
              vehicleReg: policy.vehicles?.reg ?? null,
              offset,
            });
          }
        }
      }

      // Mark policies as expired if past due date
      if (daysUntilExpiry < 0 && policy.status === 'Active') {
        const { error: updateError } = await supabaseClient
          .from('insurance_policies')
          .update({ status: 'Expired' })
          .eq('id', policy.id);

        if (updateError) {
          console.error('❌ Error updating policy status to expired:', updateError);
        } else {
          console.log(`📅 Marked policy ${policy.policy_number} as expired`);

          // Always-on operator bell for a policy that has just lapsed. Fires
          // once: the source query only pulls 'Active' policies, so once flipped
          // to 'Expired' this branch won't be reached again for the same policy.
          await notifyOperatorsInApp({
            tenantId: policy.tenant_id,
            type: "insurance_reminder",
            title: "Insurance policy expired",
            message: `Policy ${policy.policy_number} for ${policy.customers.name}${policy.vehicles ? ` (${policy.vehicles.reg})` : ''} has expired.`,
            link: "/insurances",
            metadata: {
              policy_id: policy.id,
              policy_number: policy.policy_number,
              customer_id: policy.customer_id,
              customer_name: policy.customers.name,
              vehicle_reg: policy.vehicles?.reg ?? null,
            },
            dedupeKey: `insurance_expired:${policy.id}`,
          });

          pushDigest(policy.tenant_id, 'expired', {
            policyNumber: policy.policy_number,
            customerName: policy.customers.name,
            vehicleReg: policy.vehicles?.reg ?? null,
          });
        }
      }
    }

    // Send one gated operator email per tenant summarising this run's insurance
    // events. Each send is isolated in try/catch so an email failure never
    // breaks the reminder generation above. Off by default — only tenants with
    // the 'insurance' email preference enabled (and the master switch on)
    // receive it; routed to the tenant's configured notification recipient.
    let digestEmailsSent = 0;
    for (const [tenantId, digest] of emailDigest) {
      if (digest.expiring.length === 0 && digest.expired.length === 0) continue;
      try {
        if (!(await isOperatorEmailEnabled(supabaseClient, tenantId, 'insurance'))) continue;
        const recipient = await getTenantNotificationRecipient(supabaseClient, tenantId);
        if (!recipient) {
          console.log(`No notification recipient for tenant ${tenantId}; skipping insurance digest`);
          continue;
        }
        const branding = await getTenantBranding(tenantId, supabaseClient);
        const html = wrapWithBrandedTemplate(buildInsuranceDigestHtml(digest, branding), branding);
        const total = digest.expiring.length + digest.expired.length;
        const subject = digest.expired.length > 0
          ? `Insurance alert: ${digest.expired.length} expired, ${digest.expiring.length} expiring`
          : `Insurance reminder: ${total} polic${total === 1 ? 'y' : 'ies'} expiring`;
        await sendEmail(recipient, subject, html, supabaseClient, tenantId);
        digestEmailsSent++;
        console.log(`✉️ Insurance digest sent to ${recipient} for tenant ${tenantId}`);
      } catch (digestErr) {
        console.error(`Failed to send insurance digest for tenant ${tenantId}:`, digestErr);
      }
    }

    const summary = {
      success: true,
      processed_policies: policies.length,
      monthly_checks_created: monthlyChecksCreated,
      expiry_reminders_created: expiryRemindersCreated,
      digest_emails_sent: digestEmailsSent,
      timestamp: new Date().toISOString()
    };

    console.log('✅ Insurance reminders generation completed:', summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in generate-insurance-reminders:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});