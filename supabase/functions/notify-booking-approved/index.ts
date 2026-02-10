import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
  vehicleName: string;
  vehicleReg: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  pickupDate: string;
  returnDate: string;
  amount: number;
  bookingRef: string;
  pickupLocation?: string;
  tenantId?: string;
}

const getApprovalEmailHtml = (data: NotifyRequest, currencyCode: string = 'USD') => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Booking Confirmed - DRIVE 247</title>
</head>
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
                            <span style="display: inline-block; background: #dcfce7; color: #166534; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                ✓ BOOKING CONFIRMED
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Great news, ${data.customerName}!</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                Your booking has been approved and confirmed! Your vehicle is reserved and waiting for you.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 15px; color: #1a1a1a; font-size: 16px;">Your Rental Details</h3>
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Confirmation #:</td><td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.bookingRef}</td></tr>
                                            <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td><td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleName}</td></tr>
                                            <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Pickup:</td><td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.pickupDate}</td></tr>
                                            <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Return:</td><td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.returnDate}</td></tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, #166534 0%, #22c55e 100%); border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px; text-align: center;">
                                        <p style="margin: 0 0 5px; color: rgba(255,255,255,0.9); font-size: 14px;">Total Charged</p>
                                        <p style="margin: 0; color: white; font-size: 32px; font-weight: bold;">${formatCurrency(data.amount, currencyCode)}</p>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; border: 2px solid #C5A572; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 15px; color: #C5A572; font-size: 16px;">Pickup Instructions</h3>
                                        <p style="margin: 0 0 10px; color: #444; font-size: 14px; line-height: 1.6;">
                                            <strong>Location:</strong> ${data.pickupLocation || 'To be confirmed'}
                                        </p>
                                        <p style="margin: 0; color: #444; font-size: 14px; line-height: 1.6;">
                                            Please bring a valid driver's license and the credit card used for booking.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #eff6ff; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #1e40af; font-size: 14px;">Rental Agreement</h3>
                                        <p style="margin: 0; color: #1e40af; font-size: 14px; line-height: 1.6;">
                                            You'll receive a separate email from DocuSign with your rental agreement. Please sign it before pickup.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background: #f8f9fa; padding: 25px 30px; border-radius: 0 0 12px 12px; text-align: center;">
                            <p style="margin: 0 0 10px; color: #666; font-size: 14px;">
                                Need help? Contact us at <a href="mailto:support@drive-247.com" style="color: #C5A572; text-decoration: none;">support@drive-247.com</a>
                            </p>
                            <p style="margin: 0; color: #999; font-size: 12px;">&copy; 2024 DRIVE 247. All rights reserved.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`;

// sendEmail is now imported from resend-service.ts

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

  const response = await signedAWSRequest({
    service: 'sns',
    method: 'POST',
    body,
  });

  const responseText = await response.text();
  if (!response.ok) {
    console.error('SNS Error:', responseText);
    return { success: false, error: parseXMLValue(responseText, 'Message') };
  }

  return { success: true, messageId: parseXMLValue(responseText, 'MessageId') };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: NotifyRequest = await req.json();
    console.log('Sending booking approved notifications for:', data.bookingRef);

    const results = {
      customerEmail: null as any,
      customerSMS: null as any,
    };

    // Fetch tenant currency code
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let currencyCode = 'USD';
    if (data.tenantId) {
      try {
        const { data: tenantData, error: tenantError } = await supabase
          .from('tenants')
          .select('currency_code')
          .eq('id', data.tenantId)
          .single();

        if (tenantError) {
          console.warn('Error fetching tenant currency:', tenantError);
        } else if (tenantData?.currency_code) {
          currencyCode = tenantData.currency_code;
        }
      } catch (error) {
        console.warn('Error fetching tenant currency:', error);
      }
    }

    // Build customer email using template service if tenantId is provided
    let customerSubject = `Booking Confirmed! Reference: ${data.bookingRef} | DRIVE 247`;
    let customerHtml = getApprovalEmailHtml(data, currencyCode);

    if (data.tenantId) {
      try {

        const templateData: EmailTemplateData = {
          customer_name: data.customerName,
          customer_email: data.customerEmail,
          customer_phone: data.customerPhone || '',
          vehicle_make: data.vehicleMake || data.vehicleName.split(' ')[0] || '',
          vehicle_model: data.vehicleModel || data.vehicleName.split(' ').slice(1).join(' ') || '',
          vehicle_reg: data.vehicleReg,
          vehicle_year: data.vehicleYear || '',
          rental_number: data.bookingRef,
          rental_start_date: data.pickupDate,
          rental_end_date: data.returnDate,
          rental_amount: formatCurrency(data.amount, currencyCode),
        };

        const rendered = await renderEmail(supabase, data.tenantId, 'booking_approved', templateData);
        customerSubject = rendered.subject;
        customerHtml = rendered.html;
        console.log('Using custom/default email template for customer');
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
        `DRIVE 247: Great news! Your booking ${data.bookingRef} is confirmed. ${data.vehicleName} is ready for pickup on ${data.pickupDate}. See you soon!`
      );
      console.log('Customer SMS result:', results.customerSMS);
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error sending notifications:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
