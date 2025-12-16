import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReminderDigestItem {
  id: string;
  rule_code: string;
  object_type: string;
  title: string;
  message: string;
  due_on: string;
  remind_on: string;
  severity: 'info' | 'warning' | 'critical';
  context: any;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting reminder digest generation...');
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if email digest is enabled
    const { data: emailConfig } = await supabase
      .from('reminder_config')
      .select('config_value')
      .eq('config_key', 'reminders.email_digest.enabled')
      .single();

    if (!emailConfig || emailConfig.config_value !== true) {
      console.log('Email digest is disabled');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Email digest disabled',
        sent: false 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const today = new Date().toISOString().split('T')[0];

    // Get reminders due today or snoozed until today
    const { data: dueReminders, error: reminderError } = await supabase
      .from('reminders')
      .select('*')
      .or(`and(status.eq.pending,remind_on.lte.${today}),and(status.eq.snoozed,snooze_until.lte.${today})`)
      .order('severity', { ascending: false })
      .order('due_on', { ascending: true });

    if (reminderError) {
      console.error('Error fetching reminders:', reminderError);
      throw new Error('Failed to fetch reminders');
    }

    if (!dueReminders || dueReminders.length === 0) {
      console.log('No reminders due today');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No reminders due',
        sent: false 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group reminders by severity
    const critical = dueReminders.filter(r => r.severity === 'critical');
    const warning = dueReminders.filter(r => r.severity === 'warning');
    const info = dueReminders.filter(r => r.severity === 'info');

    // Generate email content
    const subject = `Fleet Reminders Digest - ${dueReminders.length} items due (${critical.length} critical)`;
    
    const htmlBody = generateEmailHTML({
      critical,
      warning,
      info,
      totalCount: dueReminders.length,
      date: today
    });

    const textBody = generateEmailText({
      critical,
      warning,
      info,
      totalCount: dueReminders.length,
      date: today
    });

    // Get recipient email addresses
    const { data: recipientsConfig } = await supabase
      .from('reminder_config')
      .select('config_value')
      .eq('config_key', 'reminders.email_digest.recipients')
      .single();

    const recipients = recipientsConfig?.config_value || 'admin@company.com';
    
    // TODO: Send email using Resend or similar service
    // For now, just log the email content and save to reminder_emails table
    
    console.log('Email Subject:', subject);
    console.log('Recipients:', recipients);
    console.log('Email Body (first 200 chars):', textBody.substring(0, 200) + '...');

    // Save email record
    const { error: emailError } = await supabase
      .from('reminder_emails')
      .insert({
        to_address: recipients,
        subject: subject,
        body_text: textBody,
        body_html: htmlBody,
        meta: {
          reminder_count: dueReminders.length,
          critical_count: critical.length,
          warning_count: warning.length,
          info_count: info.length
        }
      });

    if (emailError) {
      console.error('Error saving email record:', emailError);
    }

    // Update last_sent_at for all processed reminders
    const reminderIds = dueReminders.map(r => r.id);
    const { error: updateError } = await supabase
      .from('reminders')
      .update({ 
        last_sent_at: new Date().toISOString(),
        status: 'sent'
      })
      .in('id', reminderIds);

    if (updateError) {
      console.error('Error updating reminders:', updateError);
    }

    // Log sent actions
    for (const reminder of dueReminders) {
      await supabase
        .from('reminder_actions')
        .insert({
          reminder_id: reminder.id,
          action: 'sent',
          note: 'Included in daily digest email'
        });
    }

    console.log(`Digest complete. Processed ${dueReminders.length} reminders.`);

    return new Response(JSON.stringify({ 
      success: true, 
      sent: true,
      count: dueReminders.length,
      critical: critical.length,
      warning: warning.length,
      info: info.length,
      recipients: recipients
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in reminder digest:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function generateEmailHTML(data: {
  critical: ReminderDigestItem[];
  warning: ReminderDigestItem[];
  info: ReminderDigestItem[];
  totalCount: number;
  date: string;
}): string {
  const { critical, warning, info, totalCount, date } = data;
  
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Fleet Reminders Digest</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .header { background: #f4f4f4; padding: 20px; border-radius: 5px; }
        .section { margin: 20px 0; }
        .critical { border-left: 4px solid #ef4444; padding-left: 10px; }
        .warning { border-left: 4px solid #f59e0b; padding-left: 10px; }
        .info { border-left: 4px solid #3b82f6; padding-left: 10px; }
        .reminder-item { margin: 10px 0; padding: 10px; background: #f9f9f9; border-radius: 3px; }
        .title { font-weight: bold; }
        .message { color: #666; font-size: 0.9em; }
        .meta { color: #888; font-size: 0.8em; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Fleet Reminders Digest</h1>
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Total Items:</strong> ${totalCount} (${critical.length} critical, ${warning.length} warning, ${info.length} info)</p>
    </div>

    ${critical.length > 0 ? `
    <div class="section critical">
        <h2>🚨 Critical Reminders (${critical.length})</h2>
        ${critical.map(r => `
        <div class="reminder-item">
            <div class="title">${r.title}</div>
            <div class="message">${r.message}</div>
            <div class="meta">Due: ${r.due_on} | Type: ${r.object_type}</div>
        </div>
        `).join('')}
    </div>
    ` : ''}

    ${warning.length > 0 ? `
    <div class="section warning">
        <h2>⚠️ Warning Reminders (${warning.length})</h2>
        ${warning.map(r => `
        <div class="reminder-item">
            <div class="title">${r.title}</div>
            <div class="message">${r.message}</div>
            <div class="meta">Due: ${r.due_on} | Type: ${r.object_type}</div>
        </div>
        `).join('')}
    </div>
    ` : ''}

    ${info.length > 0 ? `
    <div class="section info">
        <h2>ℹ️ Information Reminders (${info.length})</h2>
        ${info.map(r => `
        <div class="reminder-item">
            <div class="title">${r.title}</div>
            <div class="message">${r.message}</div>
            <div class="meta">Due: ${r.due_on} | Type: ${r.object_type}</div>
        </div>
        `).join('')}
    </div>
    ` : ''}

    <div class="section">
        <p><small>This is an automated message from your Fleet Management System.</small></p>
    </div>
</body>
</html>
  `;
}

function generateEmailText(data: {
  critical: ReminderDigestItem[];
  warning: ReminderDigestItem[];
  info: ReminderDigestItem[];
  totalCount: number;
  date: string;
}): string {
  const { critical, warning, info, totalCount, date } = data;
  
  let text = `Fleet Reminders Digest - ${date}\n`;
  text += `Total Items: ${totalCount} (${critical.length} critical, ${warning.length} warning, ${info.length} info)\n\n`;

  if (critical.length > 0) {
    text += `CRITICAL REMINDERS (${critical.length}):\n`;
    text += '=' + '='.repeat(30) + '\n';
    for (const reminder of critical) {
      text += `• ${reminder.title}\n`;
      text += `  ${reminder.message}\n`;
      text += `  Due: ${reminder.due_on} | Type: ${reminder.object_type}\n\n`;
    }
  }

  if (warning.length > 0) {
    text += `WARNING REMINDERS (${warning.length}):\n`;
    text += '=' + '='.repeat(30) + '\n';
    for (const reminder of warning) {
      text += `• ${reminder.title}\n`;
      text += `  ${reminder.message}\n`;
      text += `  Due: ${reminder.due_on} | Type: ${reminder.object_type}\n\n`;
    }
  }

  if (info.length > 0) {
    text += `INFO REMINDERS (${info.length}):\n`;
    text += '=' + '='.repeat(30) + '\n';
    for (const reminder of info) {
      text += `• ${reminder.title}\n`;
      text += `  ${reminder.message}\n`;
      text += `  Due: ${reminder.due_on} | Type: ${reminder.object_type}\n\n`;
    }
  }

  text += '\n---\nThis is an automated message from your Fleet Management System.';
  
  return text;
}