import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

interface PaymentVerificationRequest {
  paymentId: string;
  customerId: string;
  customerName: string;
  amount: number;
  vehicleReg?: string;
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

function generateVerificationEmailHTML(data: PaymentVerificationRequest): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Payment Verification Required</title>
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
        .pending-badge {
            background: #f97316;
            color: white;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
        }
        .content {
            padding: 25px 30px;
        }
        .alert-box {
            background: #fff7ed;
            border-left: 4px solid #f97316;
            padding: 15px 20px;
            margin: 15px 0;
            border-radius: 0 8px 8px 0;
        }
        .alert-box p {
            margin: 0;
            color: #9a3412;
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
            background: linear-gradient(135deg, #f97316 0%, #fb923c 100%);
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
        .cta-button {
            display: inline-block;
            background: #C5A572;
            color: white;
            padding: 12px 30px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            margin: 20px 0;
        }
        .cta-button:hover {
            background: #b8956a;
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
                <span class="pending-badge">ACTION REQUIRED</span>
                Payment Verification
            </h1>
        </div>

        <div class="content">
            <div class="alert-box">
                <p><strong>A new payment requires your approval.</strong> Please review and approve or reject this payment to proceed with the rental.</p>
            </div>

            <div class="info-grid">
                <div class="info-item">
                    <div class="label">Customer</div>
                    <div class="value">${data.customerName}</div>
                </div>
                ${data.vehicleReg ? `
                <div class="info-item">
                    <div class="label">Vehicle</div>
                    <div class="value">${data.vehicleReg}</div>
                </div>
                ` : `
                <div class="info-item">
                    <div class="label">Payment ID</div>
                    <div class="value">${data.paymentId.substring(0, 8)}...</div>
                </div>
                `}
            </div>

            <div class="amount-box">
                <div class="label">Payment Amount</div>
                <div class="value">$${data.amount.toFixed(2)}</div>
            </div>

            <p style="text-align: center;">
                <a href="${Deno.env.get('APP_URL') || 'https://app.drive917.com'}/payments?status=pending" class="cta-button">
                    Review Payment
                </a>
            </p>

            <p style="color: #666; font-size: 14px; text-align: center;">
                Log in to the dashboard to approve or reject this payment.
            </p>
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

    const data: PaymentVerificationRequest = await req.json();
    console.log('Sending payment verification email for payment:', data.paymentId);

    // Get admin email from settings
    const { data: adminEmailSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'admin_email')
      .single();

    const adminEmail = adminEmailSetting?.value?.replace(/"/g, '') || 'admin@drive917.com';

    // Send verification email to admin
    const subject = `Payment Verification Required - $${data.amount.toFixed(2)} from ${data.customerName}`;
    const html = generateVerificationEmailHTML(data);

    let emailResult;
    try {
      emailResult = await sendEmail(adminEmail, subject, html);
      console.log('Verification email sent to admin:', emailResult);

      // Log the email
      await supabase.from('email_logs').insert({
        recipient_email: adminEmail,
        recipient_name: 'Admin',
        subject: subject,
        template: 'payment_verification',
        status: 'sent',
        metadata: {
          payment_id: data.paymentId,
          customer_id: data.customerId,
          customer_name: data.customerName,
          amount: data.amount
        }
      });
    } catch (emailError) {
      console.error('Error sending verification email:', emailError);
      await supabase.from('email_logs').insert({
        recipient_email: adminEmail,
        recipient_name: 'Admin',
        subject: subject,
        template: 'payment_verification',
        status: 'failed',
        error_message: emailError.message,
        metadata: {
          payment_id: data.paymentId,
          customer_id: data.customerId,
          customer_name: data.customerName,
          amount: data.amount
        }
      });
    }

    console.log('Payment verification notification completed');

    return new Response(JSON.stringify({
      success: true,
      email: emailResult
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in send-payment-verification-email:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
