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

interface NotifyRequest {
  paymentId: string;
  rentalId: string;
  customerId: string;
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
  tenantId?: string;
}

// Email template for customer
const getCustomerEmailHtml = (data: NotifyRequest) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Booking Received - DRIVE 247</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
                            <h1 style="margin: 0; color: #C5A572; font-size: 28px; letter-spacing: 2px;">DRIVE 247</h1>
                            <p style="margin: 10px 0 0; color: #888; font-size: 14px;">Premium Car Rentals</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px 30px 0; text-align: center;">
                            <span style="display: inline-block; background: #fef3c7; color: #92400e; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                Booking Under Review
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                Thank you for choosing DRIVE 247! We've received your booking request and our team is reviewing it.
                            </p>
                            <p style="margin: 0 0 25px; color: #444; line-height: 1.6; font-size: 16px;">
                                You'll receive a confirmation email within <strong>24 hours</strong> once your booking is approved.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 15px; color: #1a1a1a; font-size: 16px; text-transform: uppercase; letter-spacing: 1px;">Booking Details</h3>
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Reference:</td><td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.bookingRef}</td></tr>
                                            <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td><td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleName}</td></tr>
                                            <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Pickup Date:</td><td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.pickupDate}</td></tr>
                                            <tr><td style="padding: 8px 0; color: #666; font-size: 14px;">Return Date:</td><td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.returnDate}</td></tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, #C5A572 0%, #d4b896 100%); border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px; text-align: center;">
                                        <p style="margin: 0 0 5px; color: rgba(255,255,255,0.9); font-size: 14px;">Amount Held</p>
                                        <p style="margin: 0; color: white; font-size: 32px; font-weight: bold;">$${data.amount.toLocaleString()}</p>
                                        <p style="margin: 10px 0 0; color: rgba(255,255,255,0.8); font-size: 12px;">Your card has been authorized. You will only be charged upon approval.</p>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 0; color: #666; font-size: 14px; line-height: 1.6;">
                                If you have any questions, please don't hesitate to contact us.
                            </p>
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

// Email template for admin
const getAdminEmailHtml = (data: NotifyRequest) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>New Booking Pending - DRIVE 247</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background: white; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="background: #f97316; padding: 20px; border-radius: 12px 12px 0 0;">
                            <h1 style="margin: 0; color: white; font-size: 20px;">New Booking Requires Approval</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr><td style="padding: 8px 0; color: #666; font-size: 14px;"><strong>Customer:</strong></td><td style="padding: 8px 0; color: #1a1a1a; font-size: 14px;">${data.customerName}</td></tr>
                                <tr><td style="padding: 8px 0; color: #666; font-size: 14px;"><strong>Email:</strong></td><td style="padding: 8px 0; color: #1a1a1a; font-size: 14px;">${data.customerEmail}</td></tr>
                                <tr><td style="padding: 8px 0; color: #666; font-size: 14px;"><strong>Phone:</strong></td><td style="padding: 8px 0; color: #1a1a1a; font-size: 14px;">${data.customerPhone || 'N/A'}</td></tr>
                                <tr><td style="padding: 8px 0; color: #666; font-size: 14px;"><strong>Vehicle:</strong></td><td style="padding: 8px 0; color: #1a1a1a; font-size: 14px;">${data.vehicleName} (${data.vehicleReg})</td></tr>
                                <tr><td style="padding: 8px 0; color: #666; font-size: 14px;"><strong>Dates:</strong></td><td style="padding: 8px 0; color: #1a1a1a; font-size: 14px;">${data.pickupDate} - ${data.returnDate}</td></tr>
                                <tr><td style="padding: 8px 0; color: #666; font-size: 14px;"><strong>Amount:</strong></td><td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; font-weight: bold;">$${data.amount.toLocaleString()}</td></tr>
                            </table>
                            <div style="margin-top: 25px; text-align: center;">
                                <a href="${Deno.env.get('ADMIN_PORTAL_URL') || 'https://portal.drive-247.com'}/pending-bookings" style="display: inline-block; background: #C5A572; color: white; padding: 14px 40px; border-radius: 6px; text-decoration: none; font-weight: 600;">Review Booking</a>
                            </div>
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
    console.log('To:', phoneNumber);
    console.log('Message:', message);
    return { success: true, simulated: true };
  }

  // Normalize phone number
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
    console.log('Sending pending booking notifications for:', data.bookingRef);

    const results = {
      customerEmail: null as any,
      customerSMS: null as any,
      adminEmail: null as any,
      adminSMS: null as any,
    };

    // Build customer email using template service if tenantId is provided
    let customerSubject = `Booking Received - Reference: ${data.bookingRef} | DRIVE 247`;
    let customerHtml = getCustomerEmailHtml(data);

    if (data.tenantId) {
      try {
        // Create supabase admin client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Prepare template data
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
          rental_amount: `$${data.amount.toLocaleString()}`,
        };

        // Render email from custom or default template
        const rendered = await renderEmail(supabase, data.tenantId, 'booking_pending', templateData);
        customerSubject = rendered.subject;
        customerHtml = rendered.html;
        console.log('Using custom/default email template for customer');
      } catch (templateError) {
        console.warn('Error rendering email template, using fallback:', templateError);
        // Fall back to hardcoded template
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
        `DRIVE 247: Your booking ${data.bookingRef} has been received and is under review. We'll confirm within 24 hours.`
      );
      console.log('Customer SMS result:', results.customerSMS);
    }

    // Send admin email
    const adminEmail = Deno.env.get('ADMIN_EMAIL') || 'admin@drive-247.com';
    if (adminEmail) {
      results.adminEmail = await sendEmail(
        adminEmail,
        `[ACTION REQUIRED] New Booking Pending: ${data.customerName} - ${data.vehicleName}`,
        getAdminEmailHtml(data)
      );
      console.log('Admin email result:', results.adminEmail);
    }

    // Send admin SMS
    const adminPhone = Deno.env.get('ADMIN_PHONE');
    if (adminPhone) {
      results.adminSMS = await sendSMS(
        adminPhone,
        `DRIVE 247: New booking pending from ${data.customerName} for ${data.vehicleName}. Amount: $${data.amount}. Review now.`
      );
      console.log('Admin SMS result:', results.adminSMS);
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
