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
      customerEmail,
      customerName,
      bookingDetails,
      supportEmail
    } = await req.json()

    // This is for admin notifications - customerEmail is the admin's email
    const hasPrice = bookingDetails.totalPrice && bookingDetails.totalPrice !== '' && bookingDetails.totalPrice !== 'TBD'
    const isCloseProtection = bookingDetails.vehicleName?.includes('🛡️') || bookingDetails.vehicleName?.includes('Close Protection')

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
            .booking-card { background: white; border: 2px solid #FFD700; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .customer-card { background: white; border: 2px solid #4caf50; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
            .detail-label { font-weight: 600; color: #666; }
            .detail-value { color: #333; }
            .total { font-size: 24px; font-weight: bold; color: #FFD700; text-align: right; margin-top: 15px; padding-top: 15px; border-top: 2px solid #FFD700; }
            .footer { background: #1a1a1a; color: #999; padding: 20px; text-align: center; font-size: 12px; }
            .alert-box { background: #fff3cd; border-left: 4px solid #FFD700; padding: 15px; margin: 20px 0; }
            .priority-box { background: #fee; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; color: #721c24; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🛡️ Drive 917</h1>
              <p style="margin: 10px 0 0 0; font-size: 16px;">Admin Notification - New Booking</p>
            </div>

            <div class="content">
              <h2 style="color: #1a1a1a; margin-top: 0;">${isCloseProtection ? '🛡️ Close Protection Booking Received' : 'New Booking Received'}</h2>
              <p>A new booking has been confirmed. Please review the details and ${isCloseProtection ? 'assign security team' : 'assign chauffeur'}.</p>

              <div class="customer-card">
                <h3 style="margin-top: 0; color: #4caf50;">👤 Customer Information</h3>
                <div class="detail-row">
                  <span class="detail-label">Name:</span>
                  <span class="detail-value">${customerName}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Email:</span>
                  <span class="detail-value">${bookingDetails.customerEmail || 'Not provided'}</span>
                </div>
                <div class="detail-row" style="border-bottom: none;">
                  <span class="detail-label">Phone:</span>
                  <span class="detail-value">${bookingDetails.customerPhone || 'Not provided'}</span>
                </div>
              </div>

              <div class="booking-card">
                <h3 style="margin-top: 0; color: #FFD700;">📋 Service Details</h3>

                <div class="detail-row">
                  <span class="detail-label">Pickup Location:</span>
                  <span class="detail-value">${bookingDetails.pickupLocation}</span>
                </div>

                <div class="detail-row">
                  <span class="detail-label">Drop-off Location:</span>
                  <span class="detail-value">${bookingDetails.dropoffLocation}</span>
                </div>

                <div class="detail-row">
                  <span class="detail-label">Date & Time:</span>
                  <span class="detail-value">${bookingDetails.pickupDate} at ${bookingDetails.pickupTime}</span>
                </div>

                <div class="detail-row">
                  <span class="detail-label">Vehicle:</span>
                  <span class="detail-value">${bookingDetails.vehicleName}</span>
                </div>

                <div class="detail-row" style="border-bottom: none;">
                  <span class="detail-label">Passengers:</span>
                  <span class="detail-value">${bookingDetails.passengers || 'N/A'}</span>
                </div>

                ${hasPrice ? `
                  <div class="total">
                    Total: $${bookingDetails.totalPrice}
                  </div>
                ` : ''}
              </div>

              ${bookingDetails.additionalRequirements ? `
                <div class="${isCloseProtection ? 'priority-box' : 'alert-box'}">
                  <strong>Additional Information:</strong><br/><br/>
                  ${bookingDetails.additionalRequirements}
                </div>
              ` : ''}

              ${isCloseProtection ? `
                <div class="priority-box">
                  <strong>⚠️ ACTION REQUIRED:</strong><br/>
                  This is a close protection booking. Please assign appropriate security personnel and contact the client within 24 hours.
                </div>
              ` : ''}
            </div>

            <div class="footer">
              <p style="margin: 5px 0;"><strong>Drive 917</strong></p>
              <p style="margin: 5px 0;">Luxury Chauffeur & Close Protection Services</p>
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

    const subject = isCloseProtection
      ? `New Close Protection Booking - ${bookingDetails.pickupDate} - ${customerName}`
      : `New Booking Confirmation - ${bookingDetails.pickupDate} - ${customerName}`

    const plainText = `${isCloseProtection ? 'CLOSE PROTECTION BOOKING RECEIVED' : 'NEW BOOKING RECEIVED'}

Customer Information:
Name: ${customerName}
Email: ${bookingDetails.customerEmail || 'Not provided'}
Phone: ${bookingDetails.customerPhone || 'Not provided'}

Service Details:
Pickup Location: ${bookingDetails.pickupLocation}
Drop-off Location: ${bookingDetails.dropoffLocation}
Date & Time: ${bookingDetails.pickupDate} at ${bookingDetails.pickupTime}
Vehicle: ${bookingDetails.vehicleName}
Passengers: ${bookingDetails.passengers || 'N/A'}
${hasPrice ? `Total: $${bookingDetails.totalPrice}` : ''}

${bookingDetails.additionalRequirements ? `Additional Information:\n${bookingDetails.additionalRequirements}` : ''}

${isCloseProtection ? `ACTION REQUIRED:\nThis is a close protection booking. Please assign appropriate security personnel and contact the client within 24 hours.` : ''}

---
Drive 917
Luxury Chauffeur & Close Protection Services
Email: ${supportEmail}
Phone: +44 1234 567 890
`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [customerEmail], // This is admin email
        subject: subject,
        html: emailHtml,
        text: plainText,
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
    console.error('Error sending email:', error)
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
