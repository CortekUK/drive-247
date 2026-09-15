import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { EmailTemplate } from "@/hooks/use-email-templates";

/**
 * v2 Settings: email template reads that do NOT swallow errors.
 *
 * `useEmailTemplates` / `useEmailTemplate` turn a failed read into "no custom
 * templates", so a tenant with customised emails was shown every template as
 * "Default", and the editor loaded the DEFAULT wording, which one click on
 * Save then wrote over the real template. Those hooks stay as they are for
 * v1; the v2 screens read through these instead and show a retry on failure.
 *
 * The keys extend `['email-templates', tenantId]`, so the existing save and
 * reset mutations (which invalidate that prefix) refresh these too.
 */
export function useEmailTemplatesStrict(enabled = true) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["email-templates", tenant?.id, "strict"],
    queryFn: async (): Promise<EmailTemplate[]> => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("template_key", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EmailTemplate[];
    },
    enabled: enabled && !!tenant?.id,
    retry: 1,
  });
}

export function useEmailTemplateStrict(templateKey: string, enabled = true) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["email-templates", tenant?.id, "strict", templateKey],
    queryFn: async (): Promise<{ customTemplate: EmailTemplate | null }> => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .eq("template_key", templateKey)
        .maybeSingle();
      if (error) throw error;
      return { customTemplate: (data ?? null) as EmailTemplate | null };
    },
    enabled: enabled && !!tenant?.id && !!templateKey,
    retry: 1,
  });
}
