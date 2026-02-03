import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tenant-slug',
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
      supportEmail,
      tenantSlug
    } = await req.json()

    // Get tenant slug from header or body
    const slug = tenantSlug || req.headers.get('x-tenant-slug')

    // Initialize Supabase client to fetch tenant info
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Default tenant values
    let companyName = 'Drive 247'
    let primaryColor = '#FFD700'
    let accentColor = '#FFD700'
    let logoUrl = ''
    let tenantSupportEmail = supportEmail || 'support@drive247.com'

    // Fetch tenant details for email customization
    if (slug) {
      const { data: tenant, error: tenantError } = await supabaseClient
        .from('tenants')
        .select('company_name, primary_color, accent_color, logo_url, contact_email')
        .eq('slug', slug)
        .eq('status', 'active')
        .single()

      if (tenant && !tenantError) {
        companyName = tenant.company_name || companyName
        primaryColor = tenant.primary_color || primaryColor
        accentColor = tenant.accent_color || accentColor
        logoUrl = tenant.logo_url || ''
        tenantSupportEmail = tenant.contact_email || tenantSupportEmail
      }
    }

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
            .booking-card { background: white; border: 2px solid ${accentColor}; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
            .detail-label { font-weight: 600; color: #666; }
            .detail-value { color: #333; }
            .total { font-size: 24px; font-weight: bold; color: ${accentColor}; text-align: right; margin-top: 15px; padding-top: 15px; border-top: 2px solid ${accentColor}; }
            .footer { background: #1a1a1a; color: #999; padding: 20px; text-align: center; font-size: 12px; }
            .checkmark { color: #10b981; margin-right: 8px; }
            .button { display: inline-block; background: linear-gradient(135deg, ${accentColor}, ${primaryColor}); color: #1a1a1a; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="max-height: 50px; margin-bottom: 10px;" />` : ''}
              <h1>🛡️ ${companyName}</h1>
              <p style="margin: 10px 0 0 0; font-size: 16px;">Booking Confirmation</p>
            </div>

            <div class="content">
              <h2 style="color: #1a1a1a; margin-top: 0;">Thank You, ${customerName}!</h2>
              <p>Your vehicle rental booking has been confirmed. We're excited to provide you with an exceptional experience.</p>

              <div class="booking-card">
                <h3 style="margin-top: 0; color: ${accentColor};">Booking Details</h3>

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

                <div class="total">
                  Total: $${bookingDetails.totalPrice}
                </div>
              </div>

              <h3 style="color: #1a1a1a;">What's Next?</h3>
              <p style="margin: 10px 0;"><span class="checkmark">✓</span> Our team will contact you within 24 hours to confirm all details</p>
              <p style="margin: 10px 0;"><span class="checkmark">✓</span> You will receive your vehicle details before your pickup date</p>
              <p style="margin: 10px 0;"><span class="checkmark">✓</span> Payment confirmation will be sent separately</p>

              <div style="text-align: center; margin: 30px 0;">
                <a href="mailto:${tenantSupportEmail}" class="button">Contact Support</a>
              </div>

              ${bookingDetails.additionalRequirements ? `
                <div style="background: #fff3cd; border-left: 4px solid ${accentColor}; padding: 15px; margin: 20px 0;">
                  <strong>Special Requests:</strong><br/>
                  ${bookingDetails.additionalRequirements}
                </div>
              ` : ''}
            </div>

            <div class="footer">
              <p style="margin: 5px 0;"><strong>${companyName}</strong></p>
              <p style="margin: 5px 0;">Premium Vehicle Rentals</p>
              <p style="margin: 15px 0 5px 0;">Need help? Contact us at ${tenantSupportEmail}</p>
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
        to: [customerEmail],
        subject: `Booking Confirmed - ${bookingDetails.pickupDate} | ${companyName}`,
        html: emailHtml,
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
