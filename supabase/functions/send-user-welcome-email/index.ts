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
      email,
      name,
      temporaryPassword,
      tenant_id,
    } = await req.json()

    if (!email || !name || !temporaryPassword || !tenant_id) {
      throw new Error('Missing required fields: email, name, temporaryPassword, tenant_id')
    }

    // Initialize Supabase client to fetch tenant info
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Default tenant values
    let companyName = 'Drive247'
    let primaryColor = '#FFD700'
    let accentColor = '#FFD700'
    let logoUrl = ''
    let tenantSlug = 'portal'
    let contactEmail = 'support@drive247.com'

    // Fetch tenant details for email customization
    const { data: tenant, error: tenantError } = await supabaseClient
      .from('tenants')
      .select('company_name, primary_color, accent_color, logo_url, contact_email, slug')
      .eq('id', tenant_id)
      .single()

    if (tenant && !tenantError) {
      companyName = tenant.company_name || companyName
      primaryColor = tenant.primary_color || primaryColor
      accentColor = tenant.accent_color || accentColor
      logoUrl = tenant.logo_url || ''
      tenantSlug = tenant.slug || tenantSlug
      contactEmail = tenant.contact_email || contactEmail
    }

    // Construct portal URL
    const portalUrl = `https://${tenantSlug}.portal.drive-247.com`

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1a1a1a, #2d2d2d); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .credentials-card { background: white; border: 2px solid ${accentColor}; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .credential-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #eee; }
            .credential-row:last-child { border-bottom: none; }
            .credential-label { font-weight: 600; color: #666; }
            .credential-value { color: #333; font-family: monospace; font-size: 14px; background: #f5f5f5; padding: 4px 8px; border-radius: 4px; }
            .warning-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
            .warning-box strong { color: #856404; }
            .footer { background: #1a1a1a; color: #999; padding: 20px; text-align: center; font-size: 12px; border-radius: 0 0 10px 10px; margin-top: -10px; }
            .button { display: inline-block; background: linear-gradient(135deg, ${accentColor}, ${primaryColor}); color: #1a1a1a; padding: 14px 35px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 15px 0; }
            .button:hover { opacity: 0.9; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="max-height: 50px; margin-bottom: 15px;" />` : ''}
              <h1>Welcome to ${companyName}</h1>
              <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">Your account has been created</p>
            </div>

            <div class="content">
              <h2 style="color: #1a1a1a; margin-top: 0;">Hello ${name},</h2>
              <p>Your account for the ${companyName} portal has been created. You can now log in using the credentials below.</p>

              <div class="credentials-card">
                <h3 style="margin-top: 0; color: ${accentColor}; font-size: 16px;">Login Credentials</h3>

                <div class="credential-row">
                  <span class="credential-label">Email:</span>
                  <span class="credential-value">${email}</span>
                </div>

                <div class="credential-row">
                  <span class="credential-label">Temporary Password:</span>
                  <span class="credential-value">${temporaryPassword}</span>
                </div>
              </div>

              <div class="warning-box">
                <strong>Important:</strong> You will be required to change your password when you first log in. Please keep your credentials secure and do not share them with anyone.
              </div>

              <div style="text-align: center; margin: 25px 0;">
                <a href="${portalUrl}" class="button">Login to Portal</a>
              </div>

              <p style="color: #666; font-size: 14px;">
                If you have any questions or need assistance, please contact your administrator or reach out to us at <a href="mailto:${contactEmail}" style="color: ${accentColor};">${contactEmail}</a>.
              </p>
            </div>

            <div class="footer">
              <p style="margin: 5px 0;"><strong>${companyName}</strong></p>
              <p style="margin: 5px 0;">This is an automated message. Please do not reply directly to this email.</p>
              <p style="margin: 15px 0 5px 0;">Need help? Contact us at ${contactEmail}</p>
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
        to: [email],
        subject: `Welcome to ${companyName} - Your Account Details`,
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
      throw new Error(data.message || 'Failed to send welcome email')
    }
  } catch (error) {
    console.error('Error sending welcome email:', error)
    const message = String(error instanceof Error ? error.message : error)
    return new Response(
      JSON.stringify({ success: false, error: message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
