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
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  vehicleName: string;
  vehicleReg: string;
  lockboxCode: string;
  lockboxInstructions?: string;
  deliveryAddress: string;
  bookingRef: string;
  tenantId?: string;
}

const getEmailHtml = (data: NotifyRequest) => {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Lockbox Code - DRIVE 247</title>
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
                            <span style="display: inline-block; background: #ecfdf5; color: #10b981; padding: 8px 20px; border-radius: 20px; font-weight: 600; font-size: 14px;">
                                LOCKBOX CODE
                            </span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a; font-size: 22px;">Hello ${data.customerName},</h2>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                Your vehicle is ready for collection! Please use the lockbox code below to retrieve the keys at the delivery address.
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 25px; text-align: center;">
                                        <p style="margin: 0 0 5px; color: #C5A572; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Your Lockbox Code</p>
                                        <p style="margin: 0; color: white; font-size: 42px; font-weight: 700; letter-spacing: 8px;">${data.lockboxCode}</p>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Booking Reference:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.bookingRef}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Vehicle:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.vehicleName} (${data.vehicleReg})</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Delivery Address:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.deliveryAddress}</td>
                                            </tr>
                                            ${data.lockboxInstructions ? `
                                            <tr>
                                                <td style="padding: 8px 0; color: #666; font-size: 14px;">Instructions:</td>
                                                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600; font-size: 14px; text-align: right;">${data.lockboxInstructions}</td>
                                            </tr>
                                            ` : ''}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #0369a1; font-size: 14px;">How To Use The Lockbox</h3>
                                        <ul style="margin: 0; padding-left: 20px; color: #0369a1; font-size: 14px; line-height: 1.8;">
                                            <li>Go to the delivery address shown above</li>
                                            <li>Locate the lockbox near the vehicle</li>
                                            <li>Enter the code <strong>${data.lockboxCode}</strong> to open the lockbox</li>
                                            <li>Retrieve the vehicle keys from inside</li>
                                            <li>Close the lockbox after retrieving the keys</li>
                                        </ul>
                                    </td>
                                </tr>
                            </table>
                            <table role="presentation" style="width: 100%; border-collapse: collapse; background: #fef2f2; border-left: 4px solid #dc2626; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <h3 style="margin: 0 0 10px; color: #991b1b; font-size: 14px;">Important</h3>
                                        <p style="margin: 0; color: #991b1b; font-size: 14px; line-height: 1.6;">
                                            Please do not share this lockbox code with anyone. This code is for your use only.
                                            If you have any issues accessing the lockbox, please contact us immediately.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 0 0 20px; color: #444; line-height: 1.6; font-size: 16px;">
                                Thank you for choosing DRIVE 247. We hope you have a wonderful experience!
                            </p>
                            <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="text-align: center; padding: 20px 0;">
                                        <a href="mailto:support@drive-247.com" style="display: inline-block; background: #C5A572; color: white; padding: 14px 35px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px;">Contact Support</a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background: #f8f9fa; padding: 25px 30px; border-radius: 0 0 12px 12px; text-align: center;">
                            <p style="margin: 0 0 10px; color: #666; font-size: 14px;">
                                Questions? Email us at <a href="mailto:support@drive-247.com" style="color: #C5A572; text-decoration: none;">support@drive-247.com</a>
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
    console.log('Sending lockbox code notification for:', data.bookingRef);

    const results = {
      customerEmail: null as any,
      customerSMS: null as any,
    };

    // Variable replacement helper
    const replaceVars = (template: string) => {
      return template
        .replace(/\{\{customer_name\}\}/g, data.customerName)
        .replace(/\{\{vehicle_name\}\}/g, data.vehicleName)
        .replace(/\{\{vehicle_reg\}\}/g, data.vehicleReg)
        .replace(/\{\{lockbox_code\}\}/g, data.lockboxCode)
        .replace(/\{\{lockbox_instructions\}\}/g, data.lockboxInstructions || '')
        .replace(/\{\{delivery_address\}\}/g, data.deliveryAddress)
        .replace(/\{\{booking_ref\}\}/g, data.bookingRef);
    };

    // Build customer email using lockbox_templates or fallback
    let customerSubject = `Your Lockbox Code - ${data.vehicleName} | DRIVE 247`;
    let customerHtml = getEmailHtml(data);
    let smsMessage = `DRIVE 247: Your lockbox code is ${data.lockboxCode}. Vehicle: ${data.vehicleName} (${data.vehicleReg}). Address: ${data.deliveryAddress}. Do not share this code.`;

    if (data.tenantId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Check lockbox_templates table for custom templates
        const { data: templates } = await supabase
          .from('lockbox_templates')
          .select('channel, subject, body, is_active')
          .eq('tenant_id', data.tenantId)
          .eq('is_active', true);

        const emailTemplate = templates?.find(t => t.channel === 'email');
        const smsTemplate = templates?.find(t => t.channel === 'sms');

        if (emailTemplate) {
          // Use custom lockbox email template
          customerSubject = replaceVars(emailTemplate.subject || customerSubject);
          const bodyText = replaceVars(emailTemplate.body);
          // Wrap plain text in simple HTML
          customerHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            ${bodyText.split('\n').map(line => line.trim() ? `<p style="margin: 0 0 10px; color: #333; line-height: 1.6;">${line}</p>` : '<br/>').join('\n')}
          </div>`;
          console.log('Using custom lockbox email template');
        } else {
          // Fallback to email template service
          try {
            const templateData: EmailTemplateData = {
              customer_name: data.customerName,
              customer_email: data.customerEmail,
              customer_phone: data.customerPhone || '',
              vehicle_make: data.vehicleName.split(' ')[0] || '',
              vehicle_model: data.vehicleName.split(' ').slice(1).join(' ') || '',
              vehicle_reg: data.vehicleReg,
              rental_number: data.bookingRef,
            };
            const rendered = await renderEmail(supabase, data.tenantId, 'lockbox_code', templateData);
            customerSubject = rendered.subject;
            customerHtml = rendered.html;
            console.log('Using email template service for customer');
          } catch (templateError) {
            console.warn('No email template found, using default HTML:', templateError);
          }
        }

        if (smsTemplate) {
          smsMessage = replaceVars(smsTemplate.body);
          console.log('Using custom lockbox SMS template');
        }
      } catch (templateError) {
        console.warn('Error loading lockbox templates, using fallback:', templateError);
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
        smsMessage
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
    console.error('Error sending lockbox code notification:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
