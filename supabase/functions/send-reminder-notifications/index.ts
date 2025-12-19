import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

interface Reminder {
  id: string;
  rule_code: string;
  object_type: string;
  object_id: string;
  title: string;
  message: string;
  due_on: string;
  remind_on: string;
  severity: string;
  status: string;
  context: Record<string, any>;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log('RESEND_API_KEY not set, skipping email');
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'DRIVE917 <onboarding@resend.dev>',
        to,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error('Failed to send email:', error);
      return false;
    }

    console.log('Email sent successfully to:', to);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#dc2626';
    case 'warning': return '#f59e0b';
    default: return '#3b82f6';
  }
}

function getSeverityBadge(severity: string): string {
  const color = getSeverityColor(severity);
  return `<span style="display: inline-block; background: ${color}; color: white; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: uppercase;">${severity}</span>`;
}

function generateReminderEmailHTML(reminders: Reminder[], recipientName: string): string {
  const criticalReminders = reminders.filter(r => r.severity === 'critical');
  const warningReminders = reminders.filter(r => r.severity === 'warning');
  const infoReminders = reminders.filter(r => r.severity === 'info');

  const renderReminder = (reminder: Reminder) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        ${getSeverityBadge(reminder.severity)}
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #eee;">
        <strong>${reminder.title}</strong><br>
        <span style="color: #666; font-size: 13px;">${reminder.message}</span>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #eee; white-space: nowrap;">
        ${new Date(reminder.due_on).toLocaleDateString('en-GB')}
      </td>
    </tr>
  `;

  const renderSection = (title: string, items: Reminder[], color: string) => {
    if (items.length === 0) return '';
    return `
      <div style="margin: 20px 0;">
        <h3 style="color: ${color}; margin-bottom: 10px; border-bottom: 2px solid ${color}; padding-bottom: 5px;">
          ${title} (${items.length})
        </h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f8f9fa;">
              <th style="padding: 10px; text-align: left; width: 100px;">Severity</th>
              <th style="padding: 10px; text-align: left;">Details</th>
              <th style="padding: 10px; text-align: left; width: 100px;">Due Date</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(renderReminder).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Daily Reminders Digest</title>
</head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
    <div style="background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <div style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px; color: #C5A572;">DRIVE917</h1>
            <p style="margin: 10px 0 0; opacity: 0.9;">Daily Reminders Digest</p>
        </div>

        <div style="padding: 30px;">
            <p style="font-size: 16px;">Hello ${recipientName},</p>
            <p>You have <strong>${reminders.length}</strong> pending reminder${reminders.length !== 1 ? 's' : ''} that require your attention:</p>

            <div style="display: flex; gap: 15px; margin: 20px 0;">
                ${criticalReminders.length > 0 ? `
                <div style="flex: 1; background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; border-radius: 0 8px 8px 0;">
                    <div style="font-size: 24px; font-weight: bold; color: #dc2626;">${criticalReminders.length}</div>
                    <div style="font-size: 12px; color: #666; text-transform: uppercase;">Critical</div>
                </div>
                ` : ''}
                ${warningReminders.length > 0 ? `
                <div style="flex: 1; background: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 0 8px 8px 0;">
                    <div style="font-size: 24px; font-weight: bold; color: #f59e0b;">${warningReminders.length}</div>
                    <div style="font-size: 12px; color: #666; text-transform: uppercase;">Warning</div>
                </div>
                ` : ''}
                ${infoReminders.length > 0 ? `
                <div style="flex: 1; background: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; border-radius: 0 8px 8px 0;">
                    <div style="font-size: 24px; font-weight: bold; color: #3b82f6;">${infoReminders.length}</div>
                    <div style="font-size: 12px; color: #666; text-transform: uppercase;">Info</div>
                </div>
                ` : ''}
            </div>

            ${renderSection('Critical Reminders', criticalReminders, '#dc2626')}
            ${renderSection('Warning Reminders', warningReminders, '#f59e0b')}
            ${renderSection('Info Reminders', infoReminders, '#3b82f6')}

            <div style="margin-top: 30px; text-align: center;">
                <a href="https://drive917.com/reminders" style="display: inline-block; background: #C5A572; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: 600;">
                    View All Reminders
                </a>
            </div>
        </div>

        <div style="background: #f8f9fa; padding: 20px 30px; text-align: center; color: #666; font-size: 14px;">
            <p>DRIVE917 - Premium Vehicle Rentals</p>
            <p>This is an automated reminder digest. Please do not reply directly to this email.</p>
        </div>
    </div>
</body>
</html>
  `;
}

function getNotificationType(severity: string): string {
  switch (severity) {
    case 'critical': return 'reminder_critical';
    case 'warning': return 'reminder_warning';
    default: return 'reminder_info';
  }
}

function getObjectLink(reminder: Reminder): string {
  switch (reminder.object_type) {
    case 'Vehicle': return `/vehicles/${reminder.object_id}`;
    case 'Rental': return `/rentals/${reminder.object_id}`;
    case 'Customer': return `/customers/${reminder.object_id}`;
    case 'Fine': return `/fines/${reminder.object_id}`;
    default: return '/reminders';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting reminder notifications...');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const today = new Date().toISOString().split('T')[0];
    let notificationsCreated = 0;
    let emailsSent = 0;

    // Get pending reminders that need to be sent today (remind_on <= today)
    const { data: pendingReminders, error: remindersError } = await supabase
      .from('reminders')
      .select('*, tenant_id')
      .eq('status', 'pending')
      .lte('remind_on', today)
      .order('severity', { ascending: true }) // critical first
      .order('due_on', { ascending: true });

    if (remindersError) {
      throw remindersError;
    }

    if (!pendingReminders || pendingReminders.length === 0) {
      console.log('No pending reminders to process');
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending reminders',
        notificationsCreated: 0,
        emailsSent: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${pendingReminders.length} pending reminders`);

    // Get all admin users for in-app notifications
    const { data: adminUsers } = await supabase
      .from('app_users')
      .select('id, email, name')
      .in('role', ['admin', 'head_admin']);

    // Create in-app notifications for each reminder
    for (const reminder of pendingReminders) {
      for (const admin of adminUsers || []) {
        // Check if notification already exists for this reminder
        const { data: existingNotification } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', admin.id)
          .contains('metadata', { reminder_id: reminder.id })
          .single();

        if (!existingNotification) {
          const { error: notificationError } = await supabase
            .from('notifications')
            .insert({
              user_id: admin.id,
              title: reminder.title,
              message: reminder.message,
              type: getNotificationType(reminder.severity),
              link: getObjectLink(reminder),
              metadata: {
                reminder_id: reminder.id,
                rule_code: reminder.rule_code,
                object_type: reminder.object_type,
                object_id: reminder.object_id,
                severity: reminder.severity,
                due_on: reminder.due_on
              },
              tenant_id: reminder.tenant_id
            });

          if (!notificationError) {
            notificationsCreated++;
          } else {
            console.error('Error creating notification:', notificationError);
          }
        }
      }

      // Update reminder status to 'sent' and set last_sent_at
      await supabase
        .from('reminders')
        .update({
          status: 'sent',
          last_sent_at: new Date().toISOString()
        })
        .eq('id', reminder.id);

      // Log the action
      await supabase
        .from('reminder_actions')
        .insert({
          reminder_id: reminder.id,
          action: 'sent',
          note: 'Notification sent via send-reminder-notifications function',
          tenant_id: reminder.tenant_id
        });
    }

    // Send email digest to each admin
    for (const admin of adminUsers || []) {
      if (admin.email && pendingReminders.length > 0) {
        const subject = `[DRIVE917] ${pendingReminders.length} Reminder${pendingReminders.length !== 1 ? 's' : ''} - ${
          pendingReminders.filter(r => r.severity === 'critical').length > 0
            ? `${pendingReminders.filter(r => r.severity === 'critical').length} Critical`
            : 'Action Required'
        }`;

        const html = generateReminderEmailHTML(pendingReminders, admin.name || 'Admin');
        const emailSent = await sendEmail(admin.email, subject, html);

        if (emailSent) {
          emailsSent++;

          // Log email - get tenant_id from first reminder
          const emailTenantId = pendingReminders[0]?.tenant_id;
          await supabase.from('email_logs').insert({
            recipient_email: admin.email,
            recipient_name: admin.name || 'Admin',
            subject: subject,
            template: 'reminder_digest',
            status: 'sent',
            metadata: {
              reminder_count: pendingReminders.length,
              critical_count: pendingReminders.filter(r => r.severity === 'critical').length
            },
            tenant_id: emailTenantId
          });
        }
      }
    }

    console.log(`Created ${notificationsCreated} in-app notifications, sent ${emailsSent} emails`);

    return new Response(JSON.stringify({
      success: true,
      remindersProcessed: pendingReminders.length,
      notificationsCreated,
      emailsSent
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in send-reminder-notifications:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
