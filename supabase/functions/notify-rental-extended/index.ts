import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  corsHeaders,
  signedAWSRequest,
  parseXMLValue,
  isAWSConfigured
} from "../_shared/aws-config.ts";
import { sendEmail } from "../_shared/resend-service.ts";
import { renderEmail, EmailTemplateData } from "../_shared/email-template-service.ts";
import { formatCurrency } from "../_shared/format-utils.ts";

interface NotifyRequest {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleReg: string;
  bookingRef: string;
  previousEndDate: string;
  newEndDate: string;
  extensionDays: number;
  extensionAmount: number;
  paymentUrl?: string;
  tenantId: string;
}

const getFallbackHtml = (data: NotifyRequest, currencyCode: string = 'GBP') => {
  const paymentSection = data.paymentUrl
    ? `<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
        <tr>
          <td style="text-align: center; padding: 20px 0;">
            <a href="${data.paymentUrl}" style="display: inline-block; background: #C5A572; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">Pay Extension Fee</a>
          </td>
        </tr>
      </table>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Rental Extended</title></head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #C5A572; font-size: 28px; letter-spacing: 2px;">DRIVE 247</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px 30px 0; text-align: center;">
              <span style="display: inline-block; background: #dbeafe; color: #2563eb; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">RENTAL EXTENDED</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
              <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">Your rental has been extended. Here are the updated details:</p>
              <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                <tr><td style="padding: 12px 20px; color: #666; font-size: 14px;">Vehicle:</td><td style="padding: 12px 20px; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleMake} ${data.vehicleModel} (${data.vehicleReg})</td></tr>
                <tr><td style="padding: 12px 20px; color: #666; font-size: 14px;">Previous End Date:</td><td style="padding: 12px 20px; color: #f59e0b; font-weight: 600; font-size: 14px; text-align: right;">${data.previousEndDate}</td></tr>
                <tr><td style="padding: 12px 20px; color: #666; font-size: 14px;">New End Date:</td><td style="padding: 12px 20px; color: #10b981; font-weight: 600; font-size: 14px; text-align: right;">${data.newEndDate}</td></tr>
                <tr><td style="padding: 12px 20px; color: #666; font-size: 14px;">Extension:</td><td style="padding: 12px 20px; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">+${data.extensionDays} days</td></tr>
                <tr><td style="padding: 12px 20px; color: #666; font-size: 14px;">Extension Cost:</td><td style="padding: 12px 20px; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${formatCurrency(data.extensionAmount, currencyCode)}</td></tr>
              </table>
              ${paymentSection}
              <p style="margin: 0; color: #444; line-height: 1.6; font-size: 16px;">If you have any questions, please contact support.</p>
            </td>
          </tr>
          <tr>
            <td style="background: #f8f9fa; padding: 25px 30px; border-radius: 0 0 12px 12px; text-align: center;">
              <p style="margin: 0; color: #999; font-size: 12px;">&copy; 2024 DRIVE 247. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

async function sendSMS(phoneNumber: string, message: string) {
  if (!isAWSConfigured() || !phoneNumber) {
    console.log('AWS not configured or no phone, simulating SMS send');
    return { success: true, simulated: true };
  }

  let phone = phoneNumber.replace(/[^+\d]/g, '');
  if (!phone.startsWith('+')) {
    phone = '+1' + phone;
  }

  const params: Record<string, string> = {
    'Action': 'Publish',
    'Version': '2010-03-31',
    'PhoneNumber': phone,
    'Message': message,
    'MessageAttributes.entry.1.Name': 'AWS.SNS.SMS.SMSType',
    'MessageAttributes.entry.1.Value.DataType': 'String',
    'MessageAttributes.entry.1.Value.StringValue': 'Transactional',
  };

  const body = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  const response = await signedAWSRequest({ service: 'sns', method: 'POST', body });
  const responseText = await response.text();
  if (!response.ok) {
    console.error('SNS Error:', responseText);
    return { success: false, error: parseXMLValue(responseText, 'Message') };
  }
  return { success: true, messageId: parseXMLValue(responseText, 'MessageId') };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: NotifyRequest = await req.json();
    console.log('Sending rental extended notification for:', data.bookingRef);

    const results = {
      customerEmail: null as any,
      customerSMS: null as any,
    };

    let customerSubject = `Your Rental Has Been Extended | DRIVE 247`;
    let currencyCode = 'GBP';
    let customerHtml = getFallbackHtml(data, currencyCode);

    if (data.tenantId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Fetch tenant currency
        const { data: tenant } = await supabase
          .from('tenants')
          .select('currency_code')
          .eq('id', data.tenantId)
          .single();
        if (tenant?.currency_code) {
          currencyCode = tenant.currency_code;
        }

        // Re-generate fallback HTML with correct currency
        customerHtml = getFallbackHtml(data, currencyCode);

        const templateData: EmailTemplateData = {
          customer_name: data.customerName,
          customer_email: data.customerEmail,
          customer_phone: data.customerPhone || '',
          vehicle_make: data.vehicleMake,
          vehicle_model: data.vehicleModel,
          vehicle_reg: data.vehicleReg,
          rental_number: data.bookingRef,
          previous_end_date: data.previousEndDate,
          new_end_date: data.newEndDate,
          extension_days: String(data.extensionDays),
          extension_amount: formatCurrency(data.extensionAmount, currencyCode),
          payment_url: data.paymentUrl || '',
        };

        const rendered = await renderEmail(supabase, data.tenantId, 'rental_extended', templateData);
        customerSubject = rendered.subject;
        customerHtml = rendered.html;
        console.log('Using custom/default email template for rental extension');
      } catch (templateError) {
        console.warn('Error rendering email template, using fallback:', templateError);
      }
    }

    // Send customer email
    results.customerEmail = await sendEmail(
      data.customerEmail,
      customerSubject,
      customerHtml
    );
    console.log('Customer email result:', results.customerEmail);

    // Send customer SMS
    if (data.customerPhone) {
      results.customerSMS = await sendSMS(
        data.customerPhone,
        `Your rental has been extended by ${data.extensionDays} day(s). New end date: ${data.newEndDate}. Extension fee: ${formatCurrency(data.extensionAmount, currencyCode)}.${data.paymentUrl ? ' Pay here: ' + data.paymentUrl : ''}`
      );
      console.log('Customer SMS result:', results.customerSMS);
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error sending notifications:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
