import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/aws-config.ts";
import { sendEmail, getTenantAdminEmail } from "../_shared/resend-service.ts";
import { getTenantInfo, wrapEmailHtml } from "../_shared/email-template-service.ts";
import { formatCurrency } from "../_shared/format-utils.ts";

interface InstallmentReminder {
  installment_id: string;
  plan_id: string;
  tenant_id: string;
  rental_id: string;
  customer_id: string;
  installment_number: number;
  amount: number;
  due_date: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_reg: string;
  rental_number: string;
}

const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const getReminderEmailHtml = (
  reminder: InstallmentReminder,
  tenantInfo: { company_name: string; company_email: string; company_phone: string; currency_code: string }
): string => {
  const cc = tenantInfo.currency_code;
  return `
<h1>Payment Reminder</h1>

<p>Dear ${reminder.customer_name},</p>

<p>This is a friendly reminder that your upcoming installment payment for your vehicle rental will be charged in <strong>3 days</strong>.</p>

<hr>

<h2>Payment Details</h2>

<table>
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>${reminder.rental_number}</td>
  </tr>
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>${reminder.vehicle_make} ${reminder.vehicle_model} (${reminder.vehicle_reg})</td>
  </tr>
  <tr>
    <td><strong>Installment #:</strong></td>
    <td>${reminder.installment_number}</td>
  </tr>
  <tr>
    <td><strong>Amount:</strong></td>
    <td><strong style="color: #1a1a1a;">${formatCurrency(reminder.amount, cc)}</strong></td>
  </tr>
  <tr>
    <td><strong>Payment Date:</strong></td>
    <td>${formatDate(reminder.due_date)}</td>
  </tr>
</table>

<hr>

<h2>Important Information</h2>

<ul>
  <li>The payment will be automatically charged to your saved card on file</li>
  <li>Please ensure sufficient funds are available in your account</li>
  <li>If you need to update your payment method, please contact us before the due date</li>
</ul>

<hr>

<h2>Need Assistance?</h2>

<p>If you have any questions or concerns about your payment, please don't hesitate to contact us:</p>

<ul>
  <li><strong>Email:</strong> ${tenantInfo.company_email}</li>
  ${tenantInfo.company_phone ? `<li><strong>Phone:</strong> ${tenantInfo.company_phone}</li>` : ''}
</ul>

<p>Thank you for choosing ${tenantInfo.company_name}!</p>

<p>Kind regards,<br>
<strong>The ${tenantInfo.company_name} Team</strong></p>
`;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Fetching installments due in 3 days for reminder...');

    // Get installments due in 3 days
    const { data: reminders, error: fetchError } = await supabase
      .rpc('get_installments_for_reminder');

    if (fetchError) {
      console.error('Error fetching installments for reminder:', fetchError);
      throw fetchError;
    }

    if (!reminders || reminders.length === 0) {
      console.log('No installments due in 3 days');
      return new Response(
        JSON.stringify({ success: true, message: 'No reminders to send', count: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${reminders.length} installments due in 3 days`);

    const results: Array<{ installmentId: string; success: boolean; error?: string }> = [];

    for (const reminder of reminders as InstallmentReminder[]) {
      try {
        // Check if reminder was already sent
        const { data: existingNotification } = await supabase
          .from('installment_notifications')
          .select('id')
          .eq('installment_id', reminder.installment_id)
          .eq('notification_type', 'reminder_3_days')
          .maybeSingle();

        if (existingNotification) {
          console.log(`Reminder already sent for installment ${reminder.installment_id}`);
          results.push({ installmentId: reminder.installment_id, success: true });
          continue;
        }

        // Get tenant info for branding
        const tenantInfo = await getTenantInfo(supabase, reminder.tenant_id);

        // Generate email content
        const emailContent = getReminderEmailHtml(reminder, tenantInfo);
        const emailHtml = wrapEmailHtml(emailContent, {
          companyName: tenantInfo.company_name,
          accentColor: tenantInfo.accent_color,
          primaryColor: tenantInfo.primary_color,
          logoUrl: tenantInfo.logo_url,
          contactEmail: tenantInfo.company_email,
        });

        const subject = `Payment Reminder - ${formatCurrency(reminder.amount, tenantInfo.currency_code)} due ${formatDate(reminder.due_date)} | ${tenantInfo.company_name}`;

        // Send email to customer
        const emailResult = await sendEmail(
          reminder.customer_email,
          subject,
          emailHtml,
          supabase,
          reminder.tenant_id
        );

        if (!emailResult.success) {
          console.error(`Failed to send reminder email for installment ${reminder.installment_id}:`, emailResult.error);
          results.push({ installmentId: reminder.installment_id, success: false, error: emailResult.error });
          continue;
        }

        // Record that notification was sent
        await supabase.rpc('record_installment_notification', {
          p_installment_id: reminder.installment_id,
          p_notification_type: 'reminder_3_days',
        });

        console.log(`Reminder sent successfully for installment ${reminder.installment_id}`);
        results.push({ installmentId: reminder.installment_id, success: true });
      } catch (reminderError) {
        console.error(`Error processing reminder for installment ${reminder.installment_id}:`, reminderError);
        results.push({ installmentId: reminder.installment_id, success: false, error: reminderError.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log(`Reminder processing complete. Success: ${successCount}, Failed: ${failureCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${results.length} reminders`,
        successCount,
        failureCount,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-installment-reminders:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
