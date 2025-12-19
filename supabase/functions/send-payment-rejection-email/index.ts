import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

interface PaymentRejectionRequest {
  paymentId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amount: number;
  reason: string;
  vehicleReg?: string;
  tenantId?: string;
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

function generateRejectionEmailHTML(data: PaymentRejectionRequest): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Payment Update</title>
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
        .alert-box {
            background: #fef2f2;
            border-left: 4px solid #ef4444;
            padding: 20px;
            margin: 20px 0;
            border-radius: 0 8px 8px 0;
        }
        .alert-box h3 {
            margin: 0 0 10px;
            color: #dc2626;
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
        .reason-box {
            background: #fff7ed;
            border: 1px solid #fed7aa;
            padding: 15px 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .reason-box .label {
            font-size: 12px;
            color: #9a3412;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }
        .reason-box .value {
            color: #7c2d12;
            font-weight: 500;
        }
        .next-steps {
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .next-steps h4 {
            margin: 0 0 10px;
            color: #166534;
        }
        .next-steps ul {
            margin: 0;
            padding-left: 20px;
        }
        .next-steps li {
            margin: 5px 0;
            color: #15803d;
        }
        .footer {
            background: #f8f9fa;
            padding: 20px 30px;
            text-align: center;
            color: #666;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>DRIVE917</h1>
            <p>Payment Update</p>
        </div>

        <div class="content">
            <p class="greeting">Dear ${data.customerName},</p>

            <div class="alert-box">
                <h3>Payment Could Not Be Processed</h3>
                <p>We regret to inform you that your recent payment could not be approved at this time.</p>
            </div>

            <div class="details-card">
                <h3>Payment Details</h3>
                <div class="detail-row">
                    <span class="detail-label">Amount</span>
                    <span class="detail-value">$${data.amount.toFixed(2)}</span>
                </div>
                ${data.vehicleReg ? `
                <div class="detail-row">
                    <span class="detail-label">Vehicle</span>
                    <span class="detail-value">${data.vehicleReg}</span>
                </div>
                ` : ''}
            </div>

            <div class="reason-box">
                <div class="label">Reason</div>
                <div class="value">${data.reason}</div>
            </div>

            <div class="next-steps">
                <h4>What happens next?</h4>
                <ul>
                    <li>Your payment has been declined and will not be charged</li>
                    <li>The associated rental booking has been cancelled</li>
                    <li>Please contact us if you have any questions</li>
                </ul>
            </div>

            <p>If you believe this was made in error or have any questions, please don't hesitate to contact us.</p>

            <p>Thank you for your understanding.</p>
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const data: PaymentRejectionRequest = await req.json();
    console.log('Sending payment rejection email for payment:', data.paymentId);

    // Get tenant_id from payment if not provided
    let tenantId = data.tenantId;
    if (!tenantId && data.paymentId) {
      const { data: payment } = await supabase
        .from('payments')
        .select('tenant_id')
        .eq('id', data.paymentId)
        .single();
      tenantId = payment?.tenant_id;
    }

    // Send rejection email to customer
    const subject = `Payment Update - Action Required`;
    const html = generateRejectionEmailHTML(data);

    let emailResult;
    try {
      emailResult = await sendEmail(data.customerEmail, subject, html);
      console.log('Rejection email sent:', emailResult);

      // Log the email
      await supabase.from('email_logs').insert({
        recipient_email: data.customerEmail,
        recipient_name: data.customerName,
        subject: subject,
        template: 'payment_rejection',
        status: 'sent',
        metadata: {
          payment_id: data.paymentId,
          customer_id: data.customerId,
          reason: data.reason
        },
        tenant_id: tenantId
      });
    } catch (emailError) {
      console.error('Error sending rejection email:', emailError);
      await supabase.from('email_logs').insert({
        recipient_email: data.customerEmail,
        recipient_name: data.customerName,
        subject: subject,
        template: 'payment_rejection',
        status: 'failed',
        error_message: emailError.message,
        metadata: {
          payment_id: data.paymentId,
          customer_id: data.customerId,
          reason: data.reason
        },
        tenant_id: tenantId
      });
    }

    console.log('Payment rejection notification completed');

    return new Response(JSON.stringify({
      success: true,
      email: emailResult
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in send-payment-rejection-email:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
