import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/aws-config.ts";
import { sendEmail, getTenantAdminEmail } from "../_shared/resend-service.ts";
import { getTenantInfo, wrapEmailHtml } from "../_shared/email-template-service.ts";

interface FailedRequest {
  installmentId: string;
  customerEmail: string;
  customerName: string;
  amount: number;
  installmentNumber: number;
  failureReason?: string;
  tenantId: string;
  rentalNumber?: string;
  vehicleName?: string;
  dueDate?: string;
  failureCount?: number;
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

const getFailedEmailHtml = (
  data: FailedRequest,
  tenantInfo: { company_name: string; company_email: string; company_phone: string }
): string => {
  return `
<h1>Payment Issue - Action Required</h1>

<p>Dear ${data.customerName},</p>

<p>We were unable to process your scheduled installment payment. Don't worry - we'll automatically retry the payment, but please ensure your payment method has sufficient funds.</p>

<hr>

<h2>Payment Details</h2>

<table>
  ${data.rentalNumber ? `
  <tr>
    <td><strong>Rental Reference:</strong></td>
    <td>${data.rentalNumber}</td>
  </tr>
  ` : ''}
  ${data.vehicleName ? `
  <tr>
    <td><strong>Vehicle:</strong></td>
    <td>${data.vehicleName}</td>
  </tr>
  ` : ''}
  <tr>
    <td><strong>Installment #:</strong></td>
    <td>${data.installmentNumber}</td>
  </tr>
  <tr>
    <td><strong>Amount Due:</strong></td>
    <td><strong style="color: #dc2626;">${formatCurrency(data.amount)}</strong></td>
  </tr>
  ${data.dueDate ? `
  <tr>
    <td><strong>Due Date:</strong></td>
    <td>${new Date(data.dueDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
  </tr>
  ` : ''}
</table>

${data.failureReason ? `
<hr>

<h2>Reason</h2>

<p style="color: #dc2626;">${data.failureReason}</p>
` : ''}

<hr>

<h2>What You Can Do</h2>

<ol>
  <li><strong>Check Your Card Details</strong> - Ensure your card number, expiry date, and CVV are correct</li>
  <li><strong>Verify Available Funds</strong> - Make sure sufficient funds are available in your account</li>
  <li><strong>Contact Your Bank</strong> - Your bank may have blocked the transaction for security reasons</li>
  <li><strong>Update Payment Method</strong> - Contact us if you need to use a different card</li>
</ol>

<p><strong>Note:</strong> We will automatically retry the payment. If the issue persists after multiple attempts, our team will reach out to assist you.</p>

<hr>

<h2>Need Help?</h2>

<p>If you're experiencing difficulties or need to update your payment method, please contact us:</p>

<ul>
  <li><strong>Email:</strong> ${tenantInfo.company_email}</li>
  ${tenantInfo.company_phone ? `<li><strong>Phone:</strong> ${tenantInfo.company_phone}</li>` : ''}
</ul>

<p>Please resolve this issue promptly to avoid any impact on your rental service.</p>

<p>Kind regards,<br>
<strong>The ${tenantInfo.company_name} Team</strong></p>
`;
};

const getAdminFailedEmailHtml = (
  data: FailedRequest,
  tenantInfo: { company_name: string }
): string => {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Installment Payment Failed</title></head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f5f5f5;">
    <table style="width: 100%; max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
        <tr>
            <td style="background: #1a1a1a; padding: 20px; text-align: center;">
                <h1 style="margin: 0; color: #C5A572; font-size: 24px;">${tenantInfo.company_name.toUpperCase()} ADMIN</h1>
            </td>
        </tr>
        <tr>
            <td style="padding: 30px;">
                <div style="text-align: center; margin-bottom: 25px;">
                    <span style="display: inline-block; background: #fef2f2; color: #dc2626; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                        INSTALLMENT PAYMENT FAILED
                    </span>
                </div>
                <h2 style="margin: 0 0 20px; color: #dc2626;">Installment Payment Failed</h2>
                <p style="margin: 0 0 20px; color: #444;">A customer's installment payment failed to process. They have been notified.</p>
                <table style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px;">
                    ${data.rentalNumber ? `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Rental Reference:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${data.rentalNumber}</td></tr>` : ''}
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Customer:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.customerName}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Email:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.customerEmail}</td></tr>
                    ${data.vehicleName ? `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Vehicle:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.vehicleName}</td></tr>` : ''}
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Installment #:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${data.installmentNumber}</td></tr>
                    <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Amount:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #dc2626; font-weight: 600;">${formatCurrency(data.amount)}</td></tr>
                    ${data.failureCount ? `<tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #666;">Failure Count:</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #dc2626;">${data.failureCount}</td></tr>` : ''}
                    ${data.failureReason ? `<tr><td style="padding: 12px; color: #666;">Failure Reason:</td><td style="padding: 12px; color: #dc2626;">${data.failureReason}</td></tr>` : ''}
                </table>
                <p style="margin: 20px 0 0; color: #666; font-size: 14px;">The customer has been notified. The system will automatically retry the payment. If this persists, manual intervention may be required.</p>
            </td>
        </tr>
    </table>
</body>
</html>
`;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: FailedRequest = await req.json();
    console.log('Sending installment failed notification for:', data.installmentId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get tenant info for branding
    const tenantInfo = await getTenantInfo(supabase, data.tenantId);

    // Get additional details if not provided
    let rentalNumber = data.rentalNumber;
    let vehicleName = data.vehicleName;
    let dueDate = data.dueDate;
    let failureCount = data.failureCount;

    if (!rentalNumber || !vehicleName || !dueDate) {
      // Get installment details
      const { data: installment } = await supabase
        .from('scheduled_installments')
        .select(`
          due_date,
          failure_count,
          installment_plans!inner(
            rental_id,
            rentals!inner(
              rental_number,
              vehicles!inner(make, model, reg)
            )
          )
        `)
        .eq('id', data.installmentId)
        .single();

      if (installment) {
        dueDate = installment.due_date;
        failureCount = installment.failure_count;
        const plan = installment.installment_plans as any;
        if (plan?.rentals) {
          rentalNumber = plan.rentals.rental_number;
          if (plan.rentals.vehicles) {
            vehicleName = `${plan.rentals.vehicles.make} ${plan.rentals.vehicles.model} (${plan.rentals.vehicles.reg})`;
          }
        }
      }
    }

    const results = {
      customerEmail: null as any,
      adminEmail: null as any,
    };

    // Generate customer email content
    const emailContent = getFailedEmailHtml(
      { ...data, rentalNumber, vehicleName, dueDate, failureCount },
      tenantInfo
    );
    const emailHtml = wrapEmailHtml(emailContent, {
      companyName: tenantInfo.company_name,
      accentColor: tenantInfo.accent_color,
      primaryColor: tenantInfo.primary_color,
      logoUrl: tenantInfo.logo_url,
      contactEmail: tenantInfo.company_email,
    });

    const subject = `Payment Issue - Action Required | ${tenantInfo.company_name}`;

    // Send email to customer
    results.customerEmail = await sendEmail(
      data.customerEmail,
      subject,
      emailHtml,
      supabase,
      data.tenantId
    );
    console.log('Customer email result:', results.customerEmail);

    // Get tenant-specific admin email
    let adminEmail = await getTenantAdminEmail(data.tenantId, supabase);
    if (!adminEmail) {
      adminEmail = Deno.env.get('ADMIN_EMAIL') || null;
    }

    // Send admin email
    if (adminEmail) {
      results.adminEmail = await sendEmail(
        adminEmail,
        `Installment Payment Failed - ${data.customerName} - ${formatCurrency(data.amount)}`,
        getAdminFailedEmailHtml({ ...data, rentalNumber, vehicleName, dueDate, failureCount }, tenantInfo),
        supabase,
        data.tenantId
      );
      console.log('Admin email result:', results.adminEmail);
    }

    // Record notification
    try {
      await supabase.rpc('record_installment_notification', {
        p_installment_id: data.installmentId,
        p_notification_type: 'payment_failed',
      });
    } catch (recordError) {
      console.warn('Failed to record notification:', recordError);
    }

    console.log('Failed notification sent for installment:', data.installmentId);

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-installment-failed:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
