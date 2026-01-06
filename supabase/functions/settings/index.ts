import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrgSettings {
  id?: string;
  org_id: string;
  company_name: string;
  timezone: string;
  currency_code: string;
  date_format: string;
  logo_url?: string;
  reminder_due_today: boolean;
  reminder_overdue_1d: boolean;
  reminder_overdue_multi: boolean;
  reminder_due_soon_2d: boolean;
  payment_mode: 'automated' | 'manual';
  tests_last_run_dashboard?: string;
  tests_last_result_dashboard?: any;
  tests_last_run_rental?: string;
  tests_last_result_rental?: any;
  tests_last_run_finance?: string;
  tests_last_result_finance?: any;
  // Branding fields
  app_name?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  // Theme-specific colors
  light_primary_color?: string;
  light_secondary_color?: string;
  light_accent_color?: string;
  dark_primary_color?: string;
  dark_secondary_color?: string;
  dark_accent_color?: string;
  // Background colors
  light_background_color?: string;
  dark_background_color?: string;
  // Header/Footer colors
  light_header_footer_color?: string;
  dark_header_footer_color?: string;
  // Meta tags
  meta_title?: string;
  meta_description?: string;
  og_image_url?: string;
  favicon_url?: string;
  created_at?: string;
  updated_at?: string;
}

// In-memory cache for settings (60 seconds)
let settingsCache: { data: OrgSettings | null; timestamp: number } = {
  data: null,
  timestamp: 0
};

const CACHE_DURATION = 60 * 1000; // 60 seconds

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Client with user's auth - for operations that respect RLS
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Service client for audit logging (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const currentTime = Date.now();

    // Debug: Log the request method
    console.log('📥 Settings function called with method:', req.method);

    if (req.method === 'GET') {
      // Check cache first
      if (settingsCache.data && (currentTime - settingsCache.timestamp) < CACHE_DURATION) {
        console.log('Returning cached settings');
        return new Response(JSON.stringify(settingsCache.data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch from database
      const { data: settings, error } = await supabaseClient
        .from('org_settings')
        .select('*')
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching settings:', error);
        throw error;
      }

      // Auto-seed if no settings exist
      if (!settings) {
        console.log('No settings found, seeding default settings');
        const defaultSettings: Partial<OrgSettings> = {
          company_name: 'Fleet Management System',
          timezone: 'Europe/London',
          currency_code: 'GBP',
          date_format: 'DD/MM/YYYY',
          reminder_due_today: true,
          reminder_overdue_1d: true,
          reminder_overdue_multi: true,
          reminder_due_soon_2d: false,
          payment_mode: 'automated',
          // Branding defaults
          app_name: 'Drive 917',
          primary_color: '#C6A256',
          secondary_color: '#C6A256',
          accent_color: '#C6A256',
          meta_title: 'Drive 917 - Portal',
          meta_description: 'Fleet management portal',
        };

        const { data: newSettings, error: insertError } = await supabaseClient
          .from('org_settings')
          .insert(defaultSettings)
          .select()
          .single();

        if (insertError) {
          console.error('Error creating default settings:', insertError);
          throw insertError;
        }

        // Update cache
        settingsCache = { data: newSettings, timestamp: currentTime };

        return new Response(JSON.stringify(newSettings), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Update cache
      settingsCache = { data: settings, timestamp: currentTime };

      return new Response(JSON.stringify(settings), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

        if (req.method === 'POST') {
      // Handle body - always use text() and parse manually
      let body;

      // 1. Validation of body presence and JSON parsing
      try {
        const rawBody = await req.text();
        console.log('Raw body received:', rawBody);

        if (rawBody && rawBody.trim()) {
          body = JSON.parse(rawBody);
        } else {
          body = {};
        }
        console.log('Parsed body:', JSON.stringify(body));
      } catch (parseError) {
        console.error('Failed to parse request body:', parseError);
        return new Response(JSON.stringify({ error: 'Invalid request body: ' + parseError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Extract and remove _tenant_id from body (used for audit logging, not saved to settings)
      const requestTenantId: string | undefined = body._tenant_id;
      delete body._tenant_id;
      console.log('🔍 Request tenant_id from frontend:', requestTenantId);

      // ✨ 2. Get the authenticated user and app_user (MOVED HERE - BEFORE validation)
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        throw new Error('No authorization header');
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

      if (userError || !user) {
        throw new Error('Failed to get user from token');
      }

      console.log('Auth user making settings change:', user.id);

      // Get the app_user record for audit logging (use serviceClient to bypass RLS)
      const { data: appUser, error: appUserError } = await serviceClient
        .from('app_users')
        .select('id, name, email, tenant_id, is_super_admin')
        .eq('auth_user_id', user.id)
        .single();

      if (appUserError || !appUser) {   
        console.error('Failed to fetch app_user:', appUserError);
        console.error('Looking for auth_user_id:', user.id);
        throw new Error('User not found in app_users table');
      }

      console.log('App user found:', appUser.email, 'ID:', appUser.id, 'tenant_id:', appUser.tenant_id);

      // 3. Validate required fields
      const validFields = [
        'company_name', 'timezone', 'currency_code', 'date_format',
        'logo_url', 'reminder_due_today', 'reminder_overdue_1d',
        'reminder_overdue_multi', 'reminder_due_soon_2d', 'payment_mode',
        'tests_last_run_dashboard', 'tests_last_result_dashboard',
        'tests_last_run_rental', 'tests_last_result_rental',
        'tests_last_run_finance', 'tests_last_result_finance',
        // Branding fields
        'app_name', 'primary_color', 'secondary_color', 'accent_color',
        // Theme-specific colors
        'light_primary_color', 'light_secondary_color', 'light_accent_color',
        'dark_primary_color', 'dark_secondary_color', 'dark_accent_color',
        // Background colors
        'light_background_color', 'dark_background_color',
        // Header/Footer colors
        'light_header_footer_color', 'dark_header_footer_color',
        // Meta tags
        'meta_title', 'meta_description', 'og_image_url', 'favicon_url'
      ];

      // Filter out invalid fields
      const filteredUpdate: Partial<OrgSettings> = {};
      for (const [key, value] of Object.entries(body)) {
        if (validFields.includes(key)) {
          filteredUpdate[key as keyof OrgSettings] = value;
        }
      }

      // 4. Validation
      if (filteredUpdate.timezone && !['Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles'].includes(filteredUpdate.timezone)) {
        return new Response(JSON.stringify({ error: 'Invalid timezone' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (filteredUpdate.currency_code && !['GBP', 'EUR', 'USD'].includes(filteredUpdate.currency_code)) {
        return new Response(JSON.stringify({ error: 'Invalid currency code' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (filteredUpdate.date_format && !['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].includes(filteredUpdate.date_format)) {
        return new Response(JSON.stringify({ error: 'Invalid date format' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (filteredUpdate.payment_mode && !['automated', 'manual'].includes(filteredUpdate.payment_mode)) {
        return new Response(JSON.stringify({ error: 'Invalid payment mode' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 5. Check if settings exist
      const { data: existingSettings } = await supabaseClient
        .from('org_settings')
        .select('id, tenant_id')
        .limit(1)
        .single();

      let updatedSettings;
      let tenantId: string | undefined;

      if (existingSettings) {
        // Update existing settings
        tenantId = existingSettings.tenant_id || appUser.tenant_id;
        
        const { data, error: updateError } = await supabaseClient
          .from('org_settings')
          .update(filteredUpdate)
          .eq('id', existingSettings.id)
          .select()
          .single();

        if (updateError) {
          console.error('Error updating settings:', updateError);
          throw updateError;
        }
        updatedSettings = data;
      } else {
        // Insert new settings if none exist
        const { data, error: insertError } = await supabaseClient
          .from('org_settings')
          .insert(filteredUpdate)
          .select()
          .single();

        if (insertError) {
          console.error('Error creating settings:', insertError);
          throw insertError;
        }
        updatedSettings = data;
        tenantId = data.tenant_id || appUser.tenant_id;
      }

      // Use requestTenantId (from frontend context) first, then appUser.tenant_id as fallback
      // For super admins (who have null tenant_id), the frontend MUST provide the tenant context
      let auditTenantId = requestTenantId || tenantId || appUser.tenant_id;
      
      console.log('🔍 Tenant ID resolution:');
      console.log('  - requestTenantId (from frontend):', requestTenantId);
      console.log('  - tenantId (from org_settings):', tenantId);
      console.log('  - appUser.tenant_id:', appUser.tenant_id);
      console.log('  - Final auditTenantId:', auditTenantId);
      
      // If still no tenant_id (super admin case without frontend context), try to find tenant from the settings being updated
      if (!auditTenantId && updatedSettings?.org_id) {
        console.log('🔍 No tenant_id, trying to find tenant by org_id:', updatedSettings.org_id);
        const { data: orgTenant } = await serviceClient
          .from('tenants')
          .select('id')
          .eq('org_id', updatedSettings.org_id)
          .single();
        if (orgTenant) {
          auditTenantId = orgTenant.id;
          console.log('🔍 Found tenant by org_id:', auditTenantId);
        }
      }
      
      // If still no tenant_id, try to get it from the settings record itself
      if (!auditTenantId && updatedSettings?.tenant_id) {
        auditTenantId = updatedSettings.tenant_id;
        console.log('🔍 Using tenant_id from updated settings:', auditTenantId);
      }
      
      // Super admins acting on behalf of a tenant should have the tenant context
      // If no tenant can be determined, log a warning but don't use hardcoded value
      if (!auditTenantId) {
        console.warn('⚠️ Could not determine tenant_id for audit log - super admin without tenant context');
      }

      // Create audit log entry using service client (bypasses RLS)
      console.log('🔍 AUDIT LOG DEBUG:');
      console.log('  - tenantId:', tenantId);
      console.log('  - appUser.tenant_id:', appUser.tenant_id);
      console.log('  - auditTenantId:', auditTenantId);
      console.log('  - appUser.id:', appUser.id);
      console.log('  - appUser.is_super_admin:', appUser.is_super_admin);
      console.log('  - entity_id:', existingSettings?.id || updatedSettings?.id);
      console.log('  - filteredUpdate keys:', Object.keys(filteredUpdate));
      console.log('  - SUPABASE_SERVICE_ROLE_KEY exists:', !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
      
      if (auditTenantId && appUser.id) {
        try {
          console.log('📝 Attempting to insert audit log...');
          const auditPayload = {
            tenant_id: auditTenantId,
            actor_id: appUser.id,
            action: 'update_settings',
            entity_type: 'settings',
            entity_id: existingSettings?.id || updatedSettings.id,
            details: {
              updated_fields: Object.keys(filteredUpdate),
              changes: filteredUpdate,
              timestamp: new Date().toISOString(),
              actor_email: appUser.email,
              actor_name: appUser.name,
            },
          };
          console.log('📝 Audit payload:', JSON.stringify(auditPayload));
          
          const { data: insertedLog, error: auditError } = await serviceClient
            .from('audit_logs')
            .insert(auditPayload)
            .select();

          if (auditError) {
            console.error('❌ Failed to create audit log:', JSON.stringify(auditError));
            // Include audit error in response for debugging
            updatedSettings._audit_error = auditError.message || JSON.stringify(auditError);
          } else {
            console.log('✅ Audit log created successfully! ID:', insertedLog?.[0]?.id);
            console.log('✅ Actor:', appUser.email);
            // Include audit success in response for debugging
            updatedSettings._audit_log_id = insertedLog?.[0]?.id;
          }
        } catch (auditError) {
          console.error('❌ Audit log creation exception:', auditError);
          updatedSettings._audit_exception = auditError.message || String(auditError);
        }
      } else {
        console.warn('⚠️ Missing tenant_id or app_user.id for audit log');
        console.warn('  - auditTenantId:', auditTenantId);
        console.warn('  - appUser.id:', appUser.id);
        updatedSettings._audit_skipped = `Missing: tenant=${auditTenantId}, appUser=${appUser?.id}`;
      }

      // 7. Bust cache
      settingsCache = { data: null, timestamp: 0 };

      console.log('Settings updated successfully');
      return new Response(JSON.stringify(updatedSettings), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Settings API error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});