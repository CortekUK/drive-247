import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

const TWILIO_CONTENT_API = 'https://content.twilio.com/v1';

function twilioAuth(): string {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID') || '';
  const token = Deno.env.get('TWILIO_AUTH_TOKEN') || '';
  return `Basic ${btoa(`${sid}:${token}`)}`;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return errorResponse('Unauthorized', 401);

    const { data: appUser } = await supabase
      .from('app_users')
      .select('id, tenant_id, role, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (!appUser) return errorResponse('User not found', 403);

    const body = await req.json();
    const { action } = body;
    const tenantId = appUser.tenant_id || (appUser.is_super_admin ? body.tenantId : null);
    if (!tenantId) return errorResponse('No tenant context', 403);

    // --- LIST templates ---
    if (action === 'list') {
      const { data: templates, error } = await supabase
        .from('whatsapp_content_templates')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return jsonResponse({ templates: templates || [] });
    }

    // --- CREATE template on Twilio ---
    if (action === 'create') {
      const { friendlyName, bodyText, variables, templateType } = body;
      if (!friendlyName || !bodyText) return errorResponse('friendlyName and bodyText required');

      // Build Twilio Content API request
      // Variables: array of strings like ["lockbox_code", "vehicle_info", "address"]
      const vars = variables || [];

      // Example values for Meta review — REQUIRED for approval
      const exampleValues: Record<string, string> = {
        'lockbox_code': '4829',
        'vehicle_info': 'Toyota Camry (AB12 XYZ)',
        'address': '123 High Street, London EC2A 1NT',
        'company_name': 'Acme Car Rentals',
        'customer_name': 'John Smith',
        'booking_ref': 'BK-00123',
      };

      // Build the content body with {{1}}, {{2}} etc for Twilio (Meta only supports positional variables)
      let twilioBody = bodyText;
      vars.forEach((v: string, i: number) => {
        twilioBody = twilioBody.replace(new RegExp(`\\{\\{${v}\\}\\}`, 'g'), `{{${i + 1}}}`);
      });

      // Unique name with timestamp to avoid duplicate name rejections
      const uniqueName = `${friendlyName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;

      const contentPayload: any = {
        friendly_name: uniqueName,
        language: 'en',
        variables: {},
        types: {
          'twilio/text': {
            body: twilioBody,
          },
        },
      };

      // Add variables with example values — Meta requires realistic examples for approval
      vars.forEach((v: string, i: number) => {
        contentPayload.variables[String(i + 1)] = exampleValues[v] || `sample_${v}`;
      });

      console.log('[WhatsApp Templates] Creating content template:', JSON.stringify(contentPayload));

      const twilioRes = await fetch(`${TWILIO_CONTENT_API}/Content`, {
        method: 'POST',
        headers: {
          'Authorization': twilioAuth(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(contentPayload),
      });

      const twilioData = await twilioRes.json();

      if (!twilioRes.ok) {
        console.error('[WhatsApp Templates] Twilio error:', twilioData);
        return errorResponse(twilioData?.message || 'Failed to create template on Twilio', 400);
      }

      const contentSid = twilioData.sid;
      console.log('[WhatsApp Templates] Created content SID:', contentSid);

      // Submit for WhatsApp approval
      try {
        const approvalRes = await fetch(`${TWILIO_CONTENT_API}/Content/${contentSid}/ApprovalRequests/whatsapp`, {
          method: 'POST',
          headers: {
            'Authorization': twilioAuth(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: uniqueName,
            category: 'MARKETING',
            allow_category_change: true,
          }),
        });

        const approvalData = await approvalRes.json();
        console.log('[WhatsApp Templates] Approval submission:', approvalRes.status, JSON.stringify(approvalData));
      } catch (approvalErr: any) {
        console.warn('[WhatsApp Templates] Approval submission error (non-fatal):', approvalErr.message);
      }

      // Save to DB
      const { data: template, error: insertError } = await supabase
        .from('whatsapp_content_templates')
        .insert({
          tenant_id: tenantId,
          name: friendlyName.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
          friendly_name: friendlyName,
          body: bodyText,
          variables: vars,
          twilio_content_sid: contentSid,
          approval_status: 'pending',
          template_type: templateType || 'lockbox_code',
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // If this is a lockbox template, save the SID to tenant for quick lookup
      if (templateType === 'lockbox_code') {
        await supabase
          .from('tenants')
          .update({ twilio_whatsapp_lockbox_template_sid: contentSid })
          .eq('id', tenantId);
      }

      return jsonResponse({ success: true, template, contentSid });
    }

    // --- CHECK approval status ---
    if (action === 'check_status') {
      const { templateId } = body;
      if (!templateId) return errorResponse('templateId required');

      const { data: template } = await supabase
        .from('whatsapp_content_templates')
        .select('twilio_content_sid, approval_status, template_type')
        .eq('id', templateId)
        .eq('tenant_id', tenantId)
        .single();

      if (!template?.twilio_content_sid) return errorResponse('Template not found');

      // Check status on Twilio
      const statusRes = await fetch(`${TWILIO_CONTENT_API}/Content/${template.twilio_content_sid}/ApprovalRequests`, {
        headers: { 'Authorization': twilioAuth() },
      });

      const statusData = await statusRes.json();
      const whatsappStatus = statusData?.whatsapp?.status || 'unknown';
      const rejectionReason = statusData?.whatsapp?.rejection_reason || null;

      // Map Twilio status to our status
      let dbStatus = template.approval_status;
      if (whatsappStatus === 'approved') dbStatus = 'approved';
      else if (whatsappStatus === 'rejected') dbStatus = 'rejected';
      else if (whatsappStatus === 'pending') dbStatus = 'pending';

      // Update DB if changed
      if (dbStatus !== template.approval_status) {
        await supabase
          .from('whatsapp_content_templates')
          .update({ approval_status: dbStatus })
          .eq('id', templateId);

        // If lockbox template was rejected, clear the tenant's SID
        if (dbStatus === 'rejected' && template.template_type === 'lockbox_code') {
          await supabase
            .from('tenants')
            .update({ twilio_whatsapp_lockbox_template_sid: null })
            .eq('id', tenantId);
        }
      }

      return jsonResponse({ status: dbStatus, twilioStatus: whatsappStatus, rejectionReason });
    }

    // --- DELETE template ---
    if (action === 'delete') {
      const { templateId } = body;
      if (!templateId) return errorResponse('templateId required');

      const { data: template } = await supabase
        .from('whatsapp_content_templates')
        .select('twilio_content_sid, template_type')
        .eq('id', templateId)
        .eq('tenant_id', tenantId)
        .single();

      // Delete from Twilio if has SID
      if (template?.twilio_content_sid) {
        try {
          await fetch(`${TWILIO_CONTENT_API}/Content/${template.twilio_content_sid}`, {
            method: 'DELETE',
            headers: { 'Authorization': twilioAuth() },
          });
        } catch (err: any) {
          console.warn('[WhatsApp Templates] Twilio delete error:', err.message);
        }

        // Clear tenant lockbox SID if this was the lockbox template
        if (template.template_type === 'lockbox_code') {
          await supabase
            .from('tenants')
            .update({ twilio_whatsapp_lockbox_template_sid: null })
            .eq('id', tenantId);
        }
      }

      await supabase
        .from('whatsapp_content_templates')
        .delete()
        .eq('id', templateId)
        .eq('tenant_id', tenantId);

      return jsonResponse({ success: true });
    }

    return errorResponse('Unknown action. Use: list, create, check_status, delete');
  } catch (err: any) {
    console.error('[WhatsApp Templates] Error:', err);
    return errorResponse(err.message || 'Internal error', 500);
  }
});
