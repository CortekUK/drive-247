import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LogoContent, SiteContactContent, SocialLinksContent, FooterSettingsContent } from "./usePageContent";

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
  phone: "+19725156635",
  phone_display: "(972) 515-6635",
  email: "info@drive917.com",
  office_address: "3626 N Hall St, Dallas, TX 75219",
  address_line1: "3626 N Hall St",
  address_line2: "",
  city: "Dallas",
  state: "TX",
  zip: "75219",
  country: "USA",
  google_maps_url: "https://maps.google.com/?q=3626+N+Hall+St,+Dallas,+TX+75219",
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

export const useSiteSettings = () => {
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ["site-settings-cms"],
    queryFn: async () => {
      // Fetch from CMS site-settings page
      const { data: page, error } = await supabase
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
        .eq("slug", "site-settings")
        .eq("status", "published")
        .single();

      if (error) {
        // If no CMS page found, return null (will use defaults)
        if (error.code === "PGRST116") {
          console.log("No published CMS site-settings found, using defaults");
          return null;
        }
        throw error;
      }

      if (!page) return null;

      // Extract sections
      const sections: Record<string, any> = {};
      (page as CMSPage).cms_page_sections?.forEach((section) => {
        sections[section.section_key] = section.content;
      });

      // Map CMS content to SiteSettings structure
      const logo = sections.logo as LogoContent | undefined;
      const contact = sections.contact as SiteContactContent | undefined;
      const social = sections.social as SocialLinksContent | undefined;
      const footer = sections.footer as FooterSettingsContent | undefined;

      const settingsFromCMS: Partial<SiteSettings> = {};

      if (logo) {
        settingsFromCMS.logo_url = logo.logo_url || null;
        settingsFromCMS.logo_alt = logo.logo_alt || "Drive 917";
        settingsFromCMS.favicon_url = logo.favicon_url || null;
      }

      if (contact) {
        settingsFromCMS.phone = contact.phone || defaultSettings.phone;
        settingsFromCMS.phone_display = contact.phone_display || defaultSettings.phone_display;
        settingsFromCMS.email = contact.email || defaultSettings.email;
        settingsFromCMS.address_line1 = contact.address_line1 || "";
        settingsFromCMS.address_line2 = contact.address_line2 || "";
        settingsFromCMS.city = contact.city || "Dallas";
        settingsFromCMS.state = contact.state || "TX";
        settingsFromCMS.zip = contact.zip || "";
        settingsFromCMS.country = contact.country || "USA";
        settingsFromCMS.google_maps_url = contact.google_maps_url || "";

        // Build full address for legacy field
        const addressParts = [
          contact.address_line1,
          contact.address_line2,
          contact.city,
          contact.state,
          contact.zip
        ].filter(Boolean);
        settingsFromCMS.office_address = addressParts.join(", ") || defaultSettings.office_address;
      }

      if (social) {
        settingsFromCMS.facebook_url = social.facebook || null;
        settingsFromCMS.instagram_url = social.instagram || null;
        settingsFromCMS.twitter_url = social.twitter || null;
        settingsFromCMS.linkedin_url = social.linkedin || null;
        settingsFromCMS.youtube_url = social.youtube || null;
        settingsFromCMS.tiktok_url = social.tiktok || null;
      }

      if (footer) {
        settingsFromCMS.copyright_text = footer.copyright_text || defaultSettings.copyright_text;
        settingsFromCMS.footer_tagline = footer.tagline || null;
      }

      return { ...defaultSettings, ...settingsFromCMS } as SiteSettings;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1,
  });

  return {
    settings: settings || defaultSettings,
    isLoading,
    error,
  };
};
