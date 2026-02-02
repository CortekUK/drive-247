import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/aws-config.ts";
import { sendEmail } from "../_shared/resend-service.ts";
import { getTenantInfo, wrapEmailHtml } from "../_shared/email-template-service.ts";

interface ReceiptRequest {
  installmentId: string;
  paymentId?: string;
  customerEmail: string;
  customerName: string;
  amount: number;
  installmentNumber: number;
  tenantId: string;
  rentalNumber?: string;
  vehicleName?: string;
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

const getReceiptEmailHtml = (
  data: ReceiptRequest,
  tenantInfo: { company_name: string; company_email: string; company_phone: string },
  planDetails?: { total_paid: number; total_installable_amount: number; paid_installments: number; number_of_installments: number }
): string => {
  const progressPercent = planDetails
    ? Math.round((planDetails.paid_installments / planDetails.number_of_installments) * 100)
    : null;

  return `
<h1>Payment Received</h1>

<p>Dear ${data.customerName},</p>

<p>Thank you! We have successfully received your installment payment.</p>

<hr>

<h2>Payment Receipt</h2>

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
    <td><strong>Amount Paid:</strong></td>
    <td><strong style="color: #16a34a;">${formatCurrency(data.amount)}</strong></td>
  </tr>
  <tr>
    <td><strong>Payment Date:</strong></td>
    <td>${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
  </tr>
</table>

${planDetails ? `
<hr>

<h2>Payment Progress</h2>

<table>
  <tr>
    <td><strong>Installments Paid:</strong></td>
    <td>${planDetails.paid_installments} of ${planDetails.number_of_installments}</td>
  </tr>
  <tr>
    <td><strong>Total Paid:</strong></td>
    <td>${formatCurrency(planDetails.total_paid)}</td>
  </tr>
  <tr>
    <td><strong>Remaining:</strong></td>
    <td>${formatCurrency(planDetails.total_installable_amount - planDetails.total_paid)}</td>
  </tr>
</table>

<p style="margin-top: 16px;">
  <strong>Progress: ${progressPercent}%</strong>
</p>
<div style="background-color: #e5e7eb; border-radius: 4px; height: 8px; margin-top: 8px;">
  <div style="background-color: #16a34a; border-radius: 4px; height: 8px; width: ${progressPercent}%;"></div>
</div>
` : ''}

<hr>

<h2>Questions?</h2>

<p>If you have any questions about your payment or rental, please contact us:</p>

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
    const data: ReceiptRequest = await req.json();
    console.log('Sending installment receipt for:', data.installmentId);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get tenant info for branding
    const tenantInfo = await getTenantInfo(supabase, data.tenantId);

    // Get additional details if not provided
    let rentalNumber = data.rentalNumber;
    let vehicleName = data.vehicleName;
    let planDetails: { total_paid: number; total_installable_amount: number; paid_installments: number; number_of_installments: number } | undefined;

    if (!rentalNumber || !vehicleName) {
      // Get installment plan details
      const { data: installment } = await supabase
        .from('scheduled_installments')
        .select(`
          installment_plans!inner(
            rental_id,
            total_paid,
            total_installable_amount,
            paid_installments,
            number_of_installments,
            rentals!inner(
              rental_number,
              vehicles!inner(make, model, reg)
            )
          )
        `)
        .eq('id', data.installmentId)
        .single();

      if (installment?.installment_plans) {
        const plan = installment.installment_plans as any;
        planDetails = {
          total_paid: plan.total_paid,
          total_installable_amount: plan.total_installable_amount,
          paid_installments: plan.paid_installments,
          number_of_installments: plan.number_of_installments,
        };
        if (plan.rentals) {
          rentalNumber = plan.rentals.rental_number;
          if (plan.rentals.vehicles) {
            vehicleName = `${plan.rentals.vehicles.make} ${plan.rentals.vehicles.model} (${plan.rentals.vehicles.reg})`;
          }
        }
      }
    }

    // Generate email content
    const emailContent = getReceiptEmailHtml(
      { ...data, rentalNumber, vehicleName },
      tenantInfo,
      planDetails
    );
    const emailHtml = wrapEmailHtml(emailContent, {
      companyName: tenantInfo.company_name,
      accentColor: tenantInfo.accent_color,
      primaryColor: tenantInfo.primary_color,
      logoUrl: tenantInfo.logo_url,
      contactEmail: tenantInfo.company_email,
    });

    const subject = `Payment Received - ${formatCurrency(data.amount)} | ${tenantInfo.company_name}`;

    // Send email to customer
    const emailResult = await sendEmail(
      data.customerEmail,
      subject,
      emailHtml,
      supabase,
      data.tenantId
    );

    if (!emailResult.success) {
      console.error('Failed to send receipt email:', emailResult.error);
      throw new Error(emailResult.error);
    }

    // Record notification
    try {
      await supabase.rpc('record_installment_notification', {
        p_installment_id: data.installmentId,
        p_notification_type: 'payment_success',
      });
    } catch (recordError) {
      console.warn('Failed to record notification:', recordError);
    }

    console.log('Receipt sent successfully for installment:', data.installmentId);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-installment-receipt:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
