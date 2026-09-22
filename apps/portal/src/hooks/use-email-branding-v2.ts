import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { EmailBrand } from "@/lib/notifications-v2/types";

/**
 * Notifications v2: the tenant branding the email layout needs, for the Gmail
 * preview (build-spec D15).
 *
 * The notification-test-v2 edge function reads the SAME columns from the SAME
 * row and maps them the same way (its emailBrandFromTenant), and both sides
 * call the same layout module, so the preview is what a test send delivers.
 * Change the columns or the mapping here, change them there.
 *
 * Portal's TenantContext loads only a few tenant fields, so this reads its own.
 * While it loads (or if it fails) the brand is built from what TenantContext
 * already has, so the preview never shows another company's name.
 */

export const EMAIL_BRANDING_V2_COLUMNS =
  "company_name, logo_url, primary_color, accent_color, contact_email, contact_phone, phone, slug";

export const emailBrandingV2QueryKey = (tenantId: string | null | undefined) => ["email-branding-v2", tenantId] as const;

export interface EmailBrandingRow {
  company_name?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  accent_color?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  phone?: string | null;
  slug?: string | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The layout brand from a tenants row: blanks become null (the layout then
 * uses its defaults), and the phone is contact_phone, else phone.
 */
export function emailBrandFromTenantRow(row: EmailBrandingRow | null | undefined): EmailBrand {
  return {
    companyName: text(row?.company_name) ?? "",
    logoUrl: text(row?.logo_url),
    primaryColor: text(row?.primary_color),
    accentColor: text(row?.accent_color),
    contactEmail: text(row?.contact_email),
    contactPhone: text(row?.contact_phone) ?? text(row?.phone),
  };
}

export function useEmailBrandingV2() {
  const { tenant } = useTenant();
  const tenantId = tenant?.id ?? null;

  const query = useQuery({
    queryKey: emailBrandingV2QueryKey(tenantId),
    queryFn: async (): Promise<EmailBrandingRow | null> => {
      const { data, error } = await supabase
        .from("tenants")
        .select(EMAIL_BRANDING_V2_COLUMNS)
        .eq("id", tenantId as string)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as EmailBrandingRow | null;
    },
    enabled: !!tenant,
    staleTime: 60_000,
    retry: 1,
  });

  const fallback: EmailBrandingRow | null = tenant
    ? { company_name: tenant.company_name, contact_email: tenant.contact_email, phone: tenant.phone, slug: tenant.slug }
    : null;
  const row = query.data ?? fallback;
  const brand = useMemo(() => emailBrandFromTenantRow(row), [
    row?.company_name,
    row?.logo_url,
    row?.primary_color,
    row?.accent_color,
    row?.contact_email,
    row?.contact_phone,
    row?.phone,
  ]);

  return {
    brand,
    /** For the sender line (settings-model `senderAddress`). */
    slug: text(row?.slug) ?? tenant?.slug ?? null,
    companyName: text(row?.company_name) ?? tenant?.company_name ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}
