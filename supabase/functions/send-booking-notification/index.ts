import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

interface BookingNotificationRequest {
  rentalId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  vehicleReg: string;
  vehicleMake: string;
  vehicleModel: string;
  startDate: string;
  endDate: string;
  monthlyAmount: number;
  totalAmount: number;
}

async function sendEmail(to: string, subject: string, html: string, from: string = 'DRIVE917 <notifications@drive917.com>') {
  if (!RESEND_API_KEY) {
    console.log('RESEND_API_KEY not set, logging email instead');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('HTML (first 500 chars):', html.substring(0, 500));
    return { success: true, simulated: true };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to send email: ${error}`);
  }

  return await res.json();
}

function generateCustomerEmailHTML(data: BookingNotificationRequest): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Booking Confirmation</title>
    <style>
        body {
            font-family: 'Segoe UI', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 28px;
            color: #C5A572;
        }
        .header p {
            margin: 10px 0 0;
            opacity: 0.9;
        }
        .content {
            padding: 30px;
        }
        .greeting {
            font-size: 18px;
            margin-bottom: 20px;
        }
        .details-card {
            background: #f8f9fa;
            border-left: 4px solid #C5A572;
            padding: 20px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }
        .details-card h3 {
            margin: 0 0 15px;
            color: #1a1a1a;
        }
        .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }
        .detail-row:last-child {
            border-bottom: none;
        }
        .detail-label {
            color: #666;
        }
        .detail-value {
            font-weight: 600;
            color: #1a1a1a;
        }
        .amount-highlight {
            background: #C5A572;
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            text-align: center;
            margin: 20px 0;
        }
        .amount-highlight .label {
            font-size: 14px;
            opacity: 0.9;
        }
        .amount-highlight .value {
            font-size: 32px;
            font-weight: bold;
        }
        .footer {
            background: #f8f9fa;
            padding: 20px 30px;
            text-align: center;
            color: #666;
            font-size: 14px;
        }
        .status-badge {
            display: inline-block;
            background: #22c55e;
            color: white;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>DRIVE917</h1>
            <p>Booking Confirmation</p>
        </div>

        <div class="content">
            <p class="greeting">Dear ${data.customerName},</p>

            <p>Great news! Your vehicle rental booking has been <span class="status-badge">Confirmed</span></p>

            <div class="details-card">
                <h3>Booking Details</h3>
                <div class="detail-row">
                    <span class="detail-label">Vehicle</span>
                    <span class="detail-value">${data.vehicleMake} ${data.vehicleModel}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Registration</span>
                    <span class="detail-value">${data.vehicleReg}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Start Date</span>
                    <span class="detail-value">${new Date(data.startDate).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">End Date</span>
                    <span class="detail-value">${new Date(data.endDate).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
            </div>

            <div class="amount-highlight">
                <div class="label">Monthly Rental Amount</div>
                <div class="value">$${data.monthlyAmount.toLocaleString()}</div>
            </div>

            <p>You will receive the rental agreement via DocuSign shortly. Please review and sign the document to complete your booking.</p>

            <p>If you have any questions, please don't hesitate to contact us.</p>

            <p>Thank you for choosing DRIVE917!</p>
        </div>

        <div class="footer">
            <p>DRIVE917 - Premium Vehicle Rentals</p>
            <p>This is an automated message. Please do not reply directly to this email.</p>
        </div>
    </div>
</body>
</html>
  `;
}

function generateAdminEmailHTML(data: BookingNotificationRequest): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>New Booking Alert</title>
    <style>
        body {
            font-family: 'Segoe UI', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
            color: white;
            padding: 20px 30px;
        }
        .header h1 {
            margin: 0;
            font-size: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .new-badge {
            background: #22c55e;
            color: white;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
        }
        .content {
            padding: 25px 30px;
        }
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin: 20px 0;
        }
        .info-item {
            background: #f8f9fa;
            padding: 12px 15px;
            border-radius: 6px;
        }
        .info-item .label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .info-item .value {
            font-size: 16px;
            font-weight: 600;
            color: #1a1a1a;
            margin-top: 4px;
        }
        .amount-box {
            background: linear-gradient(135deg, #C5A572 0%, #d4b589 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            margin: 20px 0;
        }
        .amount-box .label {
            font-size: 14px;
            opacity: 0.9;
        }
        .amount-box .value {
            font-size: 28px;
            font-weight: bold;
        }
        .footer {
            background: #f8f9fa;
            padding: 15px 30px;
            text-align: center;
            color: #666;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>
                <span class="new-badge">NEW</span>
                Booking Received
            </h1>
        </div>

        <div class="content">
            <p>A new rental booking has been created:</p>

            <div class="info-grid">
                <div class="info-item">
                    <div class="label">Customer</div>
                    <div class="value">${data.customerName}</div>
                </div>
                <div class="info-item">
                    <div class="label">Email</div>
                    <div class="value">${data.customerEmail}</div>
                </div>
                <div class="info-item">
                    <div class="label">Vehicle</div>
                    <div class="value">${data.vehicleReg}</div>
                </div>
                <div class="info-item">
                    <div class="label">Model</div>
                    <div class="value">${data.vehicleMake} ${data.vehicleModel}</div>
                </div>
                <div class="info-item">
                    <div class="label">Start Date</div>
                    <div class="value">${new Date(data.startDate).toLocaleDateString('en-GB')}</div>
                </div>
                <div class="info-item">
                    <div class="label">End Date</div>
                    <div class="value">${new Date(data.endDate).toLocaleDateString('en-GB')}</div>
                </div>
            </div>

            <div class="amount-box">
                <div class="label">Monthly Amount</div>
                <div class="value">$${data.monthlyAmount.toLocaleString()}</div>
            </div>
        </div>

        <div class="footer">
            <p>DRIVE917 Admin Notification</p>
        </div>
    </div>
</body>
</html>
  `;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const data: BookingNotificationRequest = await req.json();
    console.log('Sending booking notifications for rental:', data.rentalId);

    // Get admin email from settings
    const { data: adminEmailSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'admin_email')
      .single();

    const adminEmail = adminEmailSetting?.value?.replace(/"/g, '') || 'admin@drive917.com';

    // Send customer confirmation email
    const customerSubject = `Booking Confirmed - ${data.vehicleMake} ${data.vehicleModel} (${data.vehicleReg})`;
    const customerHtml = generateCustomerEmailHTML(data);

    let customerEmailResult;
    try {
      customerEmailResult = await sendEmail(data.customerEmail, customerSubject, customerHtml);
      console.log('Customer email sent:', customerEmailResult);

      // Log the email
      await supabase.from('email_logs').insert({
        recipient_email: data.customerEmail,
        recipient_name: data.customerName,
        subject: customerSubject,
        template: 'booking_confirmation',
        status: 'sent',
        metadata: { rental_id: data.rentalId, type: 'customer' }
      });
    } catch (emailError) {
      console.error('Error sending customer email:', emailError);
      await supabase.from('email_logs').insert({
        recipient_email: data.customerEmail,
        recipient_name: data.customerName,
        subject: customerSubject,
        template: 'booking_confirmation',
        status: 'failed',
        error_message: emailError.message,
        metadata: { rental_id: data.rentalId, type: 'customer' }
      });
    }

    // Send admin notification email
    const adminSubject = `New Booking: ${data.customerName} - ${data.vehicleReg}`;
    const adminHtml = generateAdminEmailHTML(data);

    let adminEmailResult;
    try {
      adminEmailResult = await sendEmail(adminEmail, adminSubject, adminHtml);
      console.log('Admin email sent:', adminEmailResult);

      await supabase.from('email_logs').insert({
        recipient_email: adminEmail,
        recipient_name: 'Admin',
        subject: adminSubject,
        template: 'booking_admin_notification',
        status: 'sent',
        metadata: { rental_id: data.rentalId, type: 'admin' }
      });
    } catch (emailError) {
      console.error('Error sending admin email:', emailError);
      await supabase.from('email_logs').insert({
        recipient_email: adminEmail,
        recipient_name: 'Admin',
        subject: adminSubject,
        template: 'booking_admin_notification',
        status: 'failed',
        error_message: emailError.message,
        metadata: { rental_id: data.rentalId, type: 'admin' }
      });
    }

    // Note: In-app notifications are created by the frontend (src/lib/notifications.ts)
    // This edge function only handles email sending to avoid duplicates

    console.log('Booking email notifications completed');

    return new Response(JSON.stringify({
      success: true,
      customerEmail: customerEmailResult,
      adminEmail: adminEmailResult
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in send-booking-notification:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
