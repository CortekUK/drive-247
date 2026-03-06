import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import { getTenantTwilioCredentials, sendTenantSMS, normalizePhoneNumber } from '../_shared/twilio-sms-client.ts';
import {
  sendEmail,
  getTenantAdminEmail,
  getTenantBranding,
  TenantBranding,
  wrapWithBrandedTemplate
} from "../_shared/resend-service.ts";

interface RentalInfo {
  bookingRef: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  vehicleName: string;
  vehicleReg: string;
  returnDate: string;
  returnTime?: string;
  returnLocation?: string;
  status: "due_today" | "overdue";
  daysOverdue?: number;
}

interface NotifyRequest {
  rentals: RentalInfo[];
  tenantId?: string;
}

const getAdminEmailContent = (rentals: RentalInfo[], branding: TenantBranding) => {
  const dueToday = rentals.filter(r => r.status === "due_today");
  const overdue = rentals.filter(r => r.status === "overdue");

  const renderRentalRow = (rental: RentalInfo) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${rental.bookingRef}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${rental.customerName}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${rental.vehicleName}<br><span style="color: #666; font-size: 12px;">${rental.vehicleReg}</span></td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${rental.returnDate}${rental.returnTime ? `<br><span style="color: #666; font-size: 12px;">${rental.returnTime}</span>` : ''}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${rental.status === "overdue" ? `<span style="color: #dc2626; font-weight: 600;">${rental.daysOverdue} day(s) overdue</span>` : '<span style="color: #f59e0b;">Due today</span>'}</td>
    </tr>
  `;

  return `
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 20px; color: #1a1a1a;">Daily Returns Summary</h2>
                            <p style="margin: 0 0 25px; color: #444;">Here's your daily summary of vehicle returns that need attention.</p>

                            ${overdue.length > 0 ? `
                            <div style="margin-bottom: 30px;">
                                <h3 style="margin: 0 0 15px; color: #dc2626; display: flex; align-items: center;">
                                    <span style="display: inline-block; background: #fef2f2; color: #dc2626; padding: 4px 12px; border-radius: 12px; font-size: 12px; margin-right: 10px;">${overdue.length}</span>
                                    OVERDUE RETURNS
                                </h3>
                                <table style="width: 100%; border-collapse: collapse; background: #fef2f2; border-radius: 8px;">
                                    <thead>
                                        <tr style="background: #fee2e2;">
                                            <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">REF</th>
                                            <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">CUSTOMER</th>
                                            <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">VEHICLE</th>
                                            <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">DUE DATE</th>
                                            <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b;">STATUS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${overdue.map(renderRentalRow).join('')}
                                    </tbody>
                                </table>
                            </div>
                            ` : ''}

                            ${dueToday.length > 0 ? `
                            <div style="margin-bottom: 30px;">
                                <h3 style="margin: 0 0 15px; color: #f59e0b; display: flex; align-items: center;">
                                    <span style="display: inline-block; background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 12px; font-size: 12px; margin-right: 10px;">${dueToday.length}</span>
                                    DUE TODAY
                                </h3>
                                <table style="width: 100%; border-collapse: collapse; background: #fef3c7; border-radius: 8px;">
                                    <thead>
                                        <tr style="background: #fde68a;">
                                            <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">REF</th>
                                            <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">CUSTOMER</th>
                                            <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">VEHICLE</th>
                                            <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">RETURN TIME</th>
                                            <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e;">STATUS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${dueToday.map(renderRentalRow).join('')}
                                    </tbody>
                                </table>
                            </div>
                            ` : ''}

                            ${rentals.length === 0 ? `
                            <div style="text-align: center; padding: 40px; background: #ecfdf5; border-radius: 8px;">
                                <p style="margin: 0; color: #10b981; font-size: 18px;">All caught up! No returns due today.</p>
                            </div>
                            ` : `
                            <div style="text-align: center; margin-top: 25px;">
                                <a href="https://${branding.slug}.portal.drive-247.com/rentals" style="display: inline-block; background: ${branding.accentColor}; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: 600;">View All Rentals</a>
                            </div>
                            `}
                        </td>
                    </tr>`;
};

// sendEmail is now imported from resend-service.ts

async function sendSMS(phoneNumber: string, message: string, supabaseClient?: any, tenantId?: string) {
  if (!phoneNumber) {
    console.log('[SMS] No phone number provided, skipping');
    return { success: true, skipped: true };
  }
  if (!supabaseClient || !tenantId) {
    console.log('[SMS] No supabase client or tenantId, skipping SMS');
    return { success: true, skipped: true };
  }
  try {
    const creds = await getTenantTwilioCredentials(supabaseClient, tenantId);
    if (!creds.isConfigured) {
      console.log(`[SMS] Twilio not configured for tenant ${tenantId}, skipping`);
      return { success: true, skipped: true };
    }
    const normalized = normalizePhoneNumber(phoneNumber);
    return await sendTenantSMS(creds, normalized, message);
  } catch (err: any) {
    console.error('[SMS] Error sending via Twilio:', err.message);
    return { success: false, error: err.message };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: NotifyRequest = await req.json();
    console.log('Sending return due notification for', data.rentals.length, 'rentals');

    // Create supabase client for all email operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get tenant branding
    const branding = data.tenantId
      ? await getTenantBranding(data.tenantId, supabase)
      : { companyName: 'Drive 247', logoUrl: null, primaryColor: '#1a1a1a', accentColor: '#C5A572', contactEmail: 'support@drive-247.com', contactPhone: null, slug: 'drive247' };

    const results = {
      adminEmail: null as any,
      adminSMS: null as any,
    };

    const overdue = data.rentals.filter(r => r.status === "overdue");
    const dueToday = data.rentals.filter(r => r.status === "due_today");

    // Get tenant-specific admin email, fall back to env variable
    let adminEmail: string | null = null;
    if (data.tenantId) {
      adminEmail = await getTenantAdminEmail(data.tenantId, supabase);
      console.log('Using tenant admin email:', adminEmail);
    }
    if (!adminEmail) {
      adminEmail = Deno.env.get('ADMIN_EMAIL') || null;
      console.log('Falling back to env ADMIN_EMAIL:', adminEmail);
    }

    // Build subject line
    let subject = "Daily Returns Summary";
    if (overdue.length > 0) {
      subject = `URGENT: ${overdue.length} Overdue Return${overdue.length > 1 ? 's' : ''}`;
    } else if (dueToday.length > 0) {
      subject = `${dueToday.length} Return${dueToday.length > 1 ? 's' : ''} Due Today`;
    }

    // Build branded admin email HTML
    const adminEmailContent = getAdminEmailContent(data.rentals, branding);
    const adminEmailHtml = wrapWithBrandedTemplate(adminEmailContent, branding);

    // Send admin email
    if (adminEmail) {
      results.adminEmail = await sendEmail(
        adminEmail,
        subject,
        adminEmailHtml,
        supabase,
        data.tenantId
      );
      console.log('Admin email result:', results.adminEmail);
    }

    // Send admin SMS if there are overdue rentals (using env variable for now)
    const adminPhone = Deno.env.get('ADMIN_PHONE');
    if (adminPhone && overdue.length > 0) {
      results.adminSMS = await sendSMS(
        adminPhone,
        `${branding.companyName} URGENT: ${overdue.length} rental(s) overdue. Check admin portal for details.`,
        supabase,
        data.tenantId
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
