import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * What the booking site shows INSTEAD of Settings > General > Company details.
 *
 * The booking site builds its contact details CMS first, tenant row second
 * (apps/booking `useSiteSettings`): a published Site settings page whose
 * Contact section is filled wins over `tenants.contact_email` / `phone` /
 * `address`. The v2 Company details section says so (QA B1.7, 2026-11-10):
 * before it did, an operator who changed their details on General saw the
 * booking site keep showing the old ones with nothing to explain why.
 *
 * Null means the site shows the General details; a field is null when the
 * site's own value for it is blank.
 */
export interface CompanySiteOverrideV2 {
  email: string | null;
  phone: string | null;
  address: string | null;
}

interface SiteContactContent {
  email?: string | null;
  phone?: string | null;
  phone_display?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

const text = (value: unknown): string | null => {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : null;
};

/** The override, as the booking site derives it; null when its Contact section fills none of the three. */
export function companySiteOverrideFromContact(content: unknown): CompanySiteOverrideV2 | null {
  const contact = (content && typeof content === "object" ? content : {}) as SiteContactContent;
  const email = text(contact.email);
  const phone = text(contact.phone_display) ?? text(contact.phone);
  const address =
    [contact.address_line1, contact.address_line2, contact.city, contact.state, contact.zip]
      .map(text)
      .filter(Boolean)
      .join(", ") || null;
  return email || phone || address ? { email, phone, address } : null;
}

export const COMPANY_SITE_OVERRIDE_QUERY_KEY = "v2-company-site-override";

export function useCompanySiteOverrideV2(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: [COMPANY_SITE_OVERRIDE_QUERY_KEY, tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<CompanySiteOverrideV2 | null> => {
      const { data, error } = await supabase
        .from("cms_pages")
        .select("id, cms_page_sections(section_key, content)")
        .eq("tenant_id", tenantId as string)
        .eq("slug", "site-settings")
        .eq("status", "published")
        .maybeSingle();
      if (error) throw error;
      const sections = (data?.cms_page_sections ?? []) as { section_key: string; content: unknown }[];
      const contact = sections.find((s) => s.section_key === "contact");
      return contact ? companySiteOverrideFromContact(contact.content) : null;
    },
  });
}
