import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const {
      adminEmail,
      customerName,
      customerEmail,
      customerPhone,
      enquiryDetails,
      supportEmail
    } = await req.json()

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #8b0000, #dc143c); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { margin: 0; font-size: 28px; }
            .shield-icon { font-size: 48px; margin-bottom: 10px; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .enquiry-card { background: white; border: 2px solid #dc143c; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .detail-row { padding: 12px 0; border-bottom: 1px solid #eee; }
            .detail-label { font-weight: 600; color: #666; display: block; margin-bottom: 5px; }
            .detail-value { color: #333; display: block; }
            .footer { background: #1a1a1a; color: #999; padding: 20px; text-align: center; font-size: 12px; }
            .priority-badge { background: #dc143c; color: white; padding: 8px 16px; border-radius: 4px; display: inline-block; font-weight: bold; margin: 15px 0; }
            .info-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
            .customer-box { background: #e8f5e9; border-left: 4px solid #4caf50; padding: 15px; margin: 20px 0; }
            .risk-high { color: #dc143c; font-weight: bold; font-size: 18px; }
            .risk-medium { color: #ff9800; font-weight: bold; font-size: 18px; }
            .risk-low { color: #4caf50; font-weight: bold; font-size: 18px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="shield-icon">🛡️</div>
              <h1>Close Protection Enquiry</h1>
              <p style="margin: 10px 0 0 0; font-size: 16px;">New Security Request</p>
            </div>

            <div class="content">
              <div class="priority-badge">⚠️ HIGH PRIORITY ENQUIRY</div>

              <h2 style="color: #1a1a1a; margin-top: 20px;">New Close Protection Request</h2>
              <p>A client has submitted a confidential close protection enquiry. Please review and respond within 24 hours.</p>

              <div class="customer-box">
                <h3 style="margin-top: 0; color: #2e7d32;">👤 Customer Information</h3>
                <div class="detail-row">
                  <span class="detail-label">Name:</span>
                  <span class="detail-value">${customerName}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Email:</span>
                  <span class="detail-value"><a href="mailto:${customerEmail}">${customerEmail}</a></span>
                </div>
                <div class="detail-row" style="border-bottom: none;">
                  <span class="detail-label">Phone:</span>
                  <span class="detail-value"><a href="tel:${customerPhone}">${customerPhone}</a></span>
                </div>
              </div>

              <div class="enquiry-card">
                <h3 style="margin-top: 0; color: #dc143c;">🛡️ Service Requirements</h3>

                <div class="detail-row">
                  <span class="detail-label">Service Type:</span>
                  <span class="detail-value">${enquiryDetails.serviceType}</span>
                </div>

                <div class="detail-row">
                  <span class="detail-label">Date:</span>
                  <span class="detail-value">${enquiryDetails.date}</span>
                </div>

                ${enquiryDetails.startTime && enquiryDetails.startTime !== 'TBD' ? `
                  <div class="detail-row">
                    <span class="detail-label">Start Time:</span>
                    <span class="detail-value">${enquiryDetails.startTime}</span>
                  </div>
                ` : ''}

                ${enquiryDetails.durationHours && enquiryDetails.durationHours !== 'TBD' ? `
                  <div class="detail-row">
                    <span class="detail-label">Duration:</span>
                    <span class="detail-value">${enquiryDetails.durationHours} hours</span>
                  </div>
                ` : ''}

                <div class="detail-row">
                  <span class="detail-label">Primary Location:</span>
                  <span class="detail-value">${enquiryDetails.primaryLocation}</span>
                </div>

                ${enquiryDetails.secondaryLocation && enquiryDetails.secondaryLocation.trim() !== '' ? `
                  <div class="detail-row">
                    <span class="detail-label">Secondary Location:</span>
                    <span class="detail-value">${enquiryDetails.secondaryLocation}</span>
                  </div>
                ` : ''}

                ${enquiryDetails.agentsRequired && enquiryDetails.agentsRequired !== 'TBD' ? `
                  <div class="detail-row">
                    <span class="detail-label">Agents Required:</span>
                    <span class="detail-value">${enquiryDetails.agentsRequired}</span>
                  </div>
                ` : ''}

                <div class="detail-row" style="border-bottom: none;">
                  <span class="detail-label">Risk Level:</span>
                  <span class="detail-value">
                    <span class="risk-${enquiryDetails.riskLevel.toLowerCase()}">${enquiryDetails.riskLevel.toUpperCase()}</span>
                  </span>
                </div>
              </div>

              ${enquiryDetails.notes ? `
                <div class="info-box">
                  <strong>📝 Additional Notes:</strong><br/><br/>
                  ${enquiryDetails.notes.replace(/\n/g, '<br/>')}
                </div>
              ` : ''}

              <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                <strong>⏰ Action Required:</strong><br/>
                1. Review security requirements and assess risk level<br/>
                2. Prepare custom quote based on service requirements<br/>
                3. Contact customer at <a href="tel:${customerPhone}">${customerPhone}</a> or <a href="mailto:${customerEmail}">${customerEmail}</a><br/>
                4. Respond within 24 hours
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <p style="color: #dc143c; font-weight: bold; font-size: 16px;">
                  ⚠️ CONFIDENTIAL - Handle with discretion
                </p>
              </div>
            </div>

            <div class="footer">
              <p style="margin: 5px 0;"><strong>Drive 917</strong></p>
              <p style="margin: 5px 0;">Close Protection & Executive Security Services</p>
              <p style="margin: 10px 0 5px 0;">
                📧 <a href="mailto:${supportEmail}" style="color: #C5A572; text-decoration: none;">${supportEmail}</a>
              </p>
              <p style="margin: 5px 0;">
                📞 <a href="tel:+441234567890" style="color: #C5A572; text-decoration: none;">+44 1234 567 890</a>
              </p>
              <p style="margin: 5px 0;">
                📍 <a href="https://maps.google.com/?q=London,UK" style="color: #C5A572; text-decoration: none;" target="_blank">London, United Kingdom</a>
              </p>
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
        subject: `Close Protection Enquiry - ${enquiryDetails.riskLevel} Risk Level - ${enquiryDetails.date}`,
        html: emailHtml,
        text: `Close Protection Enquiry

Customer Information:
Name: ${customerName}
Email: ${customerEmail}
Phone: ${customerPhone}

Service Requirements:
Service Type: ${enquiryDetails.serviceType}
Date: ${enquiryDetails.date}
${enquiryDetails.startTime && enquiryDetails.startTime !== 'TBD' ? `Start Time: ${enquiryDetails.startTime}` : ''}
${enquiryDetails.durationHours && enquiryDetails.durationHours !== 'TBD' ? `Duration: ${enquiryDetails.durationHours} hours` : ''}
Primary Location: ${enquiryDetails.primaryLocation}
${enquiryDetails.secondaryLocation && enquiryDetails.secondaryLocation.trim() !== '' ? `Secondary Location: ${enquiryDetails.secondaryLocation}` : ''}
${enquiryDetails.agentsRequired && enquiryDetails.agentsRequired !== 'TBD' ? `Agents Required: ${enquiryDetails.agentsRequired}` : ''}
Risk Level: ${enquiryDetails.riskLevel.toUpperCase()}

${enquiryDetails.notes ? `Additional Notes:\n${enquiryDetails.notes}` : ''}

Action Required:
1. Review security requirements and assess risk level
2. Prepare custom quote based on service requirements
3. Contact customer at ${customerPhone} or ${customerEmail}
4. Respond within 24 hours

CONFIDENTIAL - Handle with discretion

---
Drive 917
Close Protection & Executive Security Services
Email: ${supportEmail}
Phone: +44 1234 567 890
`,
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
    console.error('Error sending CP enquiry email:', error)
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
