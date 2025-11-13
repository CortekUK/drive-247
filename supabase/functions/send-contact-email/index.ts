import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const {
      name,
      email,
      phone,
      subject,
      message,
      adminEmail
    } = await req.json()

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1a1a1a, #2d2d2d); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { margin: 0; font-size: 28px; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .message-card { background: white; border: 2px solid #FFD700; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .detail-row { padding: 10px 0; border-bottom: 1px solid #eee; }
            .detail-label { font-weight: 600; color: #666; display: inline-block; width: 100px; }
            .detail-value { color: #333; }
            .message-box { background: #f5f5f5; padding: 15px; border-left: 4px solid #FFD700; margin: 15px 0; border-radius: 4px; }
            .footer { background: #1a1a1a; color: #999; padding: 20px; text-align: center; font-size: 12px; margin-top: 20px; border-radius: 10px; }
            .icon { color: #FFD700; margin-right: 8px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🛡️ Contact Form Submission</h1>
              <p style="margin: 10px 0 0 0; font-size: 16px;">New Message Received</p>
            </div>

            <div class="content">
              <div class="message-card">
                <h2 style="margin-top: 0; color: #FFD700;">📬 Contact Details</h2>

                <div class="detail-row">
                  <span class="detail-label">Name:</span>
                  <span class="detail-value">${name}</span>
                </div>

                <div class="detail-row">
                  <span class="detail-label">Email:</span>
                  <span class="detail-value"><a href="mailto:${email}" style="color: #FFD700;">${email}</a></span>
                </div>

                <div class="detail-row">
                  <span class="detail-label">Phone:</span>
                  <span class="detail-value"><a href="tel:${phone}" style="color: #FFD700;">${phone}</a></span>
                </div>

                <div class="detail-row" style="border-bottom: none;">
                  <span class="detail-label">Subject:</span>
                  <span class="detail-value"><strong>${subject}</strong></span>
                </div>
              </div>

              <div class="message-box">
                <h3 style="margin-top: 0; color: #333;">💬 Message:</h3>
                <p style="margin: 0; white-space: pre-wrap;">${message}</p>
              </div>

              <div style="background: #fff3cd; border-left: 4px solid #FFD700; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <strong>⏰ Received:</strong> ${new Date().toLocaleString('en-GB', {
                  dateStyle: 'full',
                  timeStyle: 'short',
                  timeZone: 'Europe/London'
                })}
              </div>

              <div style="text-align: center; margin-top: 30px;">
                <a href="mailto:${email}" style="display: inline-block; background: linear-gradient(135deg, #FFD700, #FFC700); color: #1a1a1a; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 10px;">
                  Reply to ${name.split(' ')[0]}
                </a>
              </div>
            </div>

            <div class="footer">
              <p style="margin: 5px 0;"><strong>Drive 917</strong></p>
              <p style="margin: 5px 0;">Luxury Chauffeur & Close Protection Services</p>
              <p style="margin: 15px 0 5px 0;">This email was sent from your contact form</p>
            </div>
          </div>
        </body>
      </html>
    `

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [adminEmail],
        subject: `New Contact Form Submission: ${subject}`,
        html: emailHtml,
        text: `Contact Form Submission

Contact Details:
Name: ${name}
Email: ${email}
Phone: ${phone}
Subject: ${subject}

Message:
${message}

Received: ${new Date().toLocaleString('en-GB', {
          dateStyle: 'full',
          timeStyle: 'short',
          timeZone: 'Europe/London'
        })}

---
Reply to this customer at: ${email}

Drive 917
Luxury Chauffeur & Close Protection Services
`,
        reply_to: email, // Set reply-to as customer's email
      }),
    })

    const data = await res.json()

    if (res.ok) {
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    } else {
      throw new Error(data.message || 'Failed to send email')
    }
  } catch (error) {
    console.error('Error sending contact email:', error)
    const message = String(error instanceof Error ? error.message : error)
    return new Response(
      JSON.stringify({ error: message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
