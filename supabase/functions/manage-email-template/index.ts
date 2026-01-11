import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Manage email templates - bypasses RLS using service role
 * Supports: create, update, delete operations
 */
serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        // Create client with service role to bypass RLS
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        const { action, tenantId, templateKey, templateName, subject, templateContent, templateId } = await req.json();

        if (!action) {
            return new Response(
                JSON.stringify({ success: false, error: "action is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log(`Email template action: ${action} for tenant: ${tenantId}`);

        switch (action) {
            case "create": {
                if (!tenantId || !templateKey || !templateName || !subject || !templateContent) {
                    return new Response(
                        JSON.stringify({ success: false, error: "Missing required fields" }),
                        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }

                // Check if template already exists
                const { data: existing } = await supabase
                    .from("email_templates")
                    .select("id")
                    .eq("tenant_id", tenantId)
                    .eq("template_key", templateKey)
                    .maybeSingle();

                if (existing) {
                    // Update instead of create
                    const { data, error } = await supabase
                        .from("email_templates")
                        .update({
                            template_name: templateName,
                            subject: subject,
                            template_content: templateContent,
                            updated_at: new Date().toISOString(),
                        })
                        .eq("id", existing.id)
                        .select()
                        .single();

                    if (error) {
                        console.error("Error updating template:", error);
                        return new Response(
                            JSON.stringify({ success: false, error: error.message }),
                            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                        );
                    }

                    return new Response(
                        JSON.stringify({ success: true, data, isUpdate: true }),
                        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }

                // Create new template
                const { data, error } = await supabase
                    .from("email_templates")
                    .insert({
                        tenant_id: tenantId,
                        template_key: templateKey,
                        template_name: templateName,
                        subject: subject,
                        template_content: templateContent,
                        is_active: true,
                    })
                    .select()
                    .single();

                if (error) {
                    console.error("Error creating template:", error);
                    return new Response(
                        JSON.stringify({ success: false, error: error.message }),
                        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }

                return new Response(
                    JSON.stringify({ success: true, data }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            case "update": {
                if (!templateId) {
                    return new Response(
                        JSON.stringify({ success: false, error: "templateId is required" }),
                        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }

                const { data, error } = await supabase
                    .from("email_templates")
                    .update({
                        template_name: templateName,
                        subject: subject,
                        template_content: templateContent,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", templateId)
                    .select()
                    .single();

                if (error) {
                    console.error("Error updating template:", error);
                    return new Response(
                        JSON.stringify({ success: false, error: error.message }),
                        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }

                return new Response(
                    JSON.stringify({ success: true, data }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            case "delete": {
                if (!templateId && !templateKey) {
                    return new Response(
                        JSON.stringify({ success: false, error: "templateId or templateKey is required" }),
                        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }

                let query = supabase.from("email_templates").delete();

                if (templateId) {
                    query = query.eq("id", templateId);
                } else {
                    query = query.eq("template_key", templateKey).eq("tenant_id", tenantId);
                }

                const { error } = await query;

                if (error) {
                    console.error("Error deleting template:", error);
                    return new Response(
                        JSON.stringify({ success: false, error: error.message }),
                        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }

                return new Response(
                    JSON.stringify({ success: true }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            default:
                return new Response(
                    JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
        }
    } catch (error: any) {
        console.error("Email template management error:", error);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
