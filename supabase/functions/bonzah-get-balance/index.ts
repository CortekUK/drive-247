import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  getTenantBonzahCredentials,
  getBonzahTokenForCredentials,
  getBonzahApiUrl,
} from '../_shared/bonzah-client.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import {
  sendEmail,
  getTenantBranding,
  getTenantAdminEmail,
  wrapWithBrandedTemplate,
} from '../_shared/resend-service.ts'

interface GetBalanceRequest {
  tenant_id: string
}

async function checkLowBalanceThreshold(
  supabase: any,
  tenantId: string,
  balance: number
) {
  try {
    // Fetch alert config from reminder_config
    const { data: configRow } = await supabase
      .from('reminder_config')
      .select('config_value')
      .eq('config_key', 'bonzah_low_balance')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!configRow) return
    const config = configRow.config_value as { threshold: number; enabled: boolean }
    if (!config?.enabled || !config?.threshold) return

    const threshold = config.threshold
    const today = new Date().toISOString().split('T')[0]

    if (balance < threshold) {
      const severity = balance <= threshold * 0.5 ? 'critical' : 'warning'
      const formattedBalance = `$${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      const formattedThreshold = `$${threshold.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

      // Check for existing active reminder
      const { data: existingReminder } = await supabase
        .from('reminders')
        .select('id, severity, context')
        .eq('rule_code', 'BONZAH_LOW_BALANCE')
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'sent'])
        .maybeSingle()

      if (existingReminder) {
        // Update the existing reminder with current balance and severity
        await supabase
          .from('reminders')
          .update({
            title: 'Bonzah Balance Low',
            message: `Your Bonzah balance (${formattedBalance}) is below your alert threshold of ${formattedThreshold}. Top up to continue issuing insurance policies.`,
            severity,
            context: { balance, threshold },
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingReminder.id)

        // If already alerted (context has alerted flag), skip notifications
        if (existingReminder.context?.alerted) {
          console.log('[Bonzah Balance] Already alerted for this low balance period, skipping notifications')
          return
        }
      } else {
        // Create new reminder
        const { error: reminderError } = await supabase
          .from('reminders')
          .insert({
            rule_code: 'BONZAH_LOW_BALANCE',
            object_type: 'Integration',
            object_id: tenantId,
            title: 'Bonzah Balance Low',
            message: `Your Bonzah balance (${formattedBalance}) is below your alert threshold of ${formattedThreshold}. Top up to continue issuing insurance policies.`,
            due_on: today,
            remind_on: today,
            severity,
            status: 'pending',
            context: { balance, threshold, alerted: true },
            tenant_id: tenantId,
          })

        if (reminderError) {
          console.error('[Bonzah Balance] Failed to create reminder:', reminderError)
          return
        }
      }

      // Mark as alerted so we don't re-send on subsequent polls
      if (existingReminder) {
        await supabase
          .from('reminders')
          .update({ context: { balance, threshold, alerted: true } })
          .eq('id', existingReminder.id)
      }

      console.log(`[Bonzah Balance] Low balance detected (${severity}) for tenant ${tenantId}`)

      // Create in-app notifications for admin/head_admin users
      const { data: adminUsers } = await supabase
        .from('app_users')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('role', ['admin', 'head_admin'])

      if (adminUsers?.length) {
        const notifications = adminUsers.map((admin: { id: string }) => ({
          user_id: admin.id,
          title: 'Bonzah Balance Low',
          message: `Your Bonzah balance (${formattedBalance}) is below ${formattedThreshold}. Top up soon.`,
          type: severity === 'critical' ? 'reminder_critical' : 'reminder_warning',
          link: '/settings?tab=integrations',
          metadata: { rule_code: 'BONZAH_LOW_BALANCE', balance, threshold },
          tenant_id: tenantId,
        }))

        const { error: notifError } = await supabase
          .from('notifications')
          .insert(notifications)

        if (notifError) {
          console.error('[Bonzah Balance] Failed to create notifications:', notifError)
        }
      }

      // Send email to tenant admin
      const adminEmail = await getTenantAdminEmail(tenantId, supabase)
      if (adminEmail) {
        const branding = await getTenantBranding(tenantId, supabase)
        const emailContent = `
          <tr>
            <td style="padding: 30px;">
              <p style="font-size: 16px; margin: 0 0 15px;">Hello,</p>
              <p style="margin: 0 0 20px; color: #444;">Your Bonzah balance is running low:</p>
              <table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <tr>
                  <td style="background: ${severity === 'critical' ? '#fef2f2' : '#fffbeb'}; border-left: 4px solid ${severity === 'critical' ? '#dc2626' : '#f59e0b'}; padding: 20px; border-radius: 0 8px 8px 0;">
                    <div style="font-size: 28px; font-weight: bold; color: ${severity === 'critical' ? '#dc2626' : '#f59e0b'};">${formattedBalance}</div>
                    <div style="font-size: 13px; color: #666; margin-top: 4px;">Current balance (threshold: ${formattedThreshold})</div>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px; color: #444;">Please top up your Bonzah account to continue issuing insurance policies to your customers.</p>
              <div style="text-align: center;">
                <a href="https://${branding.slug}.portal.drive-247.com/settings?tab=integrations" style="display: inline-block; background: ${branding.accentColor}; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: 600;">
                  View Settings
                </a>
              </div>
            </td>
          </tr>`

        const subject = `[${branding.companyName}] Bonzah Balance Low — ${formattedBalance}`
        const html = wrapWithBrandedTemplate(emailContent, branding)
        await sendEmail(adminEmail, subject, html, supabase, tenantId)
        console.log(`[Bonzah Balance] Sent low balance email to ${adminEmail}`)
      }
    } else {
      // Balance is above threshold — reset the reminder back to monitoring state
      const formattedThreshold = `$${threshold.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

      const { data: activeReminders } = await supabase
        .from('reminders')
        .select('id, context')
        .eq('rule_code', 'BONZAH_LOW_BALANCE')
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'sent'])

      if (activeReminders?.length) {
        await supabase
          .from('reminders')
          .update({
            title: `Bonzah Low Balance Alert — Below ${formattedThreshold}`,
            message: `Monitoring your Bonzah balance. You will be notified when it drops below ${formattedThreshold}.`,
            severity: 'info',
            context: { threshold, alerted: false },
            updated_at: new Date().toISOString(),
          })
          .eq('rule_code', 'BONZAH_LOW_BALANCE')
          .eq('tenant_id', tenantId)
          .in('status', ['pending', 'sent'])

        console.log(`[Bonzah Balance] Balance recovered, reset reminder to monitoring for tenant ${tenantId}`)
      }
    }
  } catch (err) {
    // Don't fail the balance request if threshold check errors
    console.error('[Bonzah Balance] Threshold check error:', err)
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body: GetBalanceRequest = await req.json()

    if (!body.tenant_id) {
      return errorResponse('Missing tenant_id')
    }

    const credentials = await getTenantBonzahCredentials(supabase, body.tenant_id)
    const apiUrl = getBonzahApiUrl(credentials.mode)
    const token = await getBonzahTokenForCredentials(credentials.username, credentials.password, apiUrl)

    const resp = await fetch(`${apiUrl}/Bonzah/cdBalance`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'in-auth-token': token,
      },
    })

    const data = await resp.json()

    if (data.status !== 0) {
      console.error('[Bonzah Balance] API error:', data.txt)
      return errorResponse(data.txt || 'Failed to fetch balance', 400)
    }

    const balance = data.data?.amount ?? data.data?.balance ?? '0'

    // Check threshold and create reminder/notifications if needed
    const balanceNum = Number(balance)
    if (!isNaN(balanceNum)) {
      await checkLowBalanceThreshold(supabase, body.tenant_id, balanceNum)
    }

    return jsonResponse({ balance })
  } catch (error) {
    console.error('[Bonzah Balance] Error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch balance',
      500
    )
  }
})
