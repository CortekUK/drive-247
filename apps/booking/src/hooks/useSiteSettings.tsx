'use client';

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LogoContent, SiteContactContent, SocialLinksContent, FooterSettingsContent } from "./usePageContent";
import { useTenant } from "@/contexts/TenantContext";

export interface SiteSettings {
  id: string;
  company_name: string;
  phone: string;
  phone_display: string;
  email: string;
  office_address: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  google_maps_url: string;
  availability: string;
  whatsapp_number: string | null;
  light_logo_url: string | null;
  dark_logo_url: string | null;
  logo_url: string | null;
  logo_alt: string;
  favicon_url: string | null;
  accent_color: string;
  notification_emails: string[];
  notify_new_booking: boolean;
  notify_new_enquiry: boolean;
  privacy_policy_url: string | null;
  terms_url: string | null;
  footer_tagline: string | null;
  copyright_text: string;
  facebook_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  youtube_url: string | null;
  tiktok_url: string | null;
  created_at: string;
  updated_at: string;
}

const defaultSettings: SiteSettings = {
  id: "",
  company_name: "Drive917",
  phone: "",
  phone_display: "",
  email: "",
  office_address: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  zip: "",
  country: "",
  google_maps_url: "",
  availability: "7 days a week",
  whatsapp_number: null,
  light_logo_url: null,
  dark_logo_url: null,
  logo_url: null,
  logo_alt: "Drive 917",
  favicon_url: null,
  accent_color: "#F5B942",
  notification_emails: [],
  notify_new_booking: true,
  notify_new_enquiry: true,
  privacy_policy_url: "/privacy",
  terms_url: "/terms",
  footer_tagline: "Reliable Dallas Car Rentals",
  copyright_text: `© ${new Date().getFullYear()} Drive917. All rights reserved.`,
  facebook_url: null,
  instagram_url: null,
  twitter_url: null,
  linkedin_url: null,
  youtube_url: null,
  tiktok_url: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

interface CMSPage {
  id: string;
  slug: string;
  status: string;
  cms_page_sections: Array<{
    section_key: string;
    content: any;
  }>;
}

/**
 * Hook to get site settings for the current tenant
 *
 * Priority order:
 * 1. CMS site-settings page (if exists and published)
 * 2. Tenant table settings (from TenantContext)
 * 3. Default settings
 */
export const useSiteSettings = () => {
  const { tenant, loading: tenantLoading } = useTenant();

  const { data: settings, isLoading, error } = useQuery({
    queryKey: ["site-settings-cms", tenant?.id],
    queryFn: async () => {
      // Build settings from tenant data first (as base)
      const tenantSettings: Partial<SiteSettings> = {};

      if (tenant) {
        tenantSettings.id = tenant.id;
        tenantSettings.company_name = tenant.company_name || defaultSettings.company_name;
        tenantSettings.phone = tenant.phone || defaultSettings.phone;
        tenantSettings.phone_display = tenant.phone || defaultSettings.phone_display;
        tenantSettings.email = tenant.contact_email || defaultSettings.email;
        tenantSettings.office_address = tenant.address || defaultSettings.office_address;
        tenantSettings.google_maps_url = tenant.google_maps_url || defaultSettings.google_maps_url;
        tenantSettings.availability = tenant.business_hours || defaultSettings.availability;
        tenantSettings.logo_url = tenant.logo_url || null;
        tenantSettings.logo_alt = tenant.app_name || tenant.company_name || defaultSettings.logo_alt;
        tenantSettings.favicon_url = tenant.favicon_url || null;
        tenantSettings.accent_color = tenant.accent_color || defaultSettings.accent_color;
        tenantSettings.facebook_url = tenant.facebook_url || null;
        tenantSettings.instagram_url = tenant.instagram_url || null;
        tenantSettings.twitter_url = tenant.twitter_url || null;
        tenantSettings.linkedin_url = tenant.linkedin_url || null;
        tenantSettings.copyright_text = `© ${new Date().getFullYear()} ${tenant.company_name}. All rights reserved.`;
      }

      // Try to fetch CMS overrides if tenant exists
      if (tenant?.id) {
        try {
          const { data: page, error: cmsError } = await supabase
            .from("cms_pages")
            .select(`
              id,
              slug,
              status,
              cms_page_sections(
                section_key,
                content
              )
            `)
            .eq("tenant_id", tenant.id)
            .eq("slug", "site-settings")
            .eq("status", "published")
            .single();

          if (!cmsError && page) {
            // Extract sections from CMS
            const sections: Record<string, any> = {};
            (page as CMSPage).cms_page_sections?.forEach((section) => {
              sections[section.section_key] = section.content;
            });

            // Apply CMS overrides
            const logo = sections.logo as LogoContent | undefined;
            const contact = sections.contact as SiteContactContent | undefined;
            const social = sections.social as SocialLinksContent | undefined;
            const footer = sections.footer as FooterSettingsContent | undefined;

            if (logo) {
              tenantSettings.logo_url = logo.logo_url || tenantSettings.logo_url;
              tenantSettings.logo_alt = logo.logo_alt || tenantSettings.logo_alt;
              tenantSettings.favicon_url = logo.favicon_url || tenantSettings.favicon_url;
            }

            if (contact) {
              tenantSettings.phone = contact.phone || tenantSettings.phone;
              tenantSettings.phone_display = contact.phone_display || tenantSettings.phone_display;
              tenantSettings.email = contact.email || tenantSettings.email;
              tenantSettings.address_line1 = contact.address_line1 || "";
              tenantSettings.address_line2 = contact.address_line2 || "";
              tenantSettings.city = contact.city || "Dallas";
              tenantSettings.state = contact.state || "TX";
              tenantSettings.zip = contact.zip || "";
              tenantSettings.country = contact.country || "USA";
              tenantSettings.google_maps_url = contact.google_maps_url || tenantSettings.google_maps_url;

              // Build full address for legacy field
              const addressParts = [
                contact.address_line1,
                contact.address_line2,
                contact.city,
                contact.state,
                contact.zip
              ].filter(Boolean);
              if (addressParts.length > 0) {
                tenantSettings.office_address = addressParts.join(", ");
              }
            }

            if (social) {
              tenantSettings.facebook_url = social.facebook || tenantSettings.facebook_url;
              tenantSettings.instagram_url = social.instagram || tenantSettings.instagram_url;
              tenantSettings.twitter_url = social.twitter || tenantSettings.twitter_url;
              tenantSettings.linkedin_url = social.linkedin || tenantSettings.linkedin_url;
              tenantSettings.youtube_url = social.youtube || null;
              tenantSettings.tiktok_url = social.tiktok || null;
            }

            if (footer) {
              tenantSettings.copyright_text = footer.copyright_text || tenantSettings.copyright_text;
              tenantSettings.footer_tagline = footer.tagline || null;
            }
          }
        } catch (err) {
          // CMS fetch failed, continue with tenant settings
          console.log("CMS site-settings not found, using tenant settings");
        }
      }

      return { ...defaultSettings, ...tenantSettings } as SiteSettings;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1,
    enabled: !tenantLoading, // Wait for tenant to load
  });

  return {
    settings: settings || defaultSettings,
    isLoading: isLoading || tenantLoading,
    error,
  };
};
