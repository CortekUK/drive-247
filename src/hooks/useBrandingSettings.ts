import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BrandingSettings {
  // Base colors
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  // Light theme colors
  light_primary_color: string | null;
  light_secondary_color: string | null;
  light_accent_color: string | null;
  light_background_color: string | null;
  // Dark theme colors
  dark_primary_color: string | null;
  dark_secondary_color: string | null;
  dark_accent_color: string | null;
  dark_background_color: string | null;
  // Header/Footer colors
  light_header_footer_color: string | null;
  dark_header_footer_color: string | null;
  // Logo & branding
  logo_url: string | null;
  favicon_url: string | null;
  app_name: string;
  // SEO fields
  meta_title: string | null;
  meta_description: string | null;
  og_image_url: string | null;
}

const DEFAULT_BRANDING: BrandingSettings = {
  primary_color: '#223331',
  secondary_color: '#223331',
  accent_color: '#E9B63E',
  light_primary_color: null,
  light_secondary_color: null,
  light_accent_color: null,
  light_background_color: null,
  dark_primary_color: null,
  dark_secondary_color: null,
  dark_accent_color: null,
  dark_background_color: null,
  light_header_footer_color: null,
  dark_header_footer_color: null,
  logo_url: null,
  favicon_url: null,
  app_name: 'Drive 917',
  meta_title: null,
  meta_description: null,
  og_image_url: null,
};

export const useBrandingSettings = () => {
  const { data: branding, isLoading, error } = useQuery({
    queryKey: ["org-branding-settings"],
    queryFn: async () => {
      // Fetch branding from org_settings table
      const { data, error } = await supabase
        .from("org_settings")
        .select(`
          primary_color,
          secondary_color,
          accent_color,
          light_primary_color,
          light_secondary_color,
          light_accent_color,
          light_background_color,
          dark_primary_color,
          dark_secondary_color,
          dark_accent_color,
          dark_background_color,
          light_header_footer_color,
          dark_header_footer_color,
          logo_url,
          favicon_url,
          app_name,
          meta_title,
          meta_description,
          og_image_url
        `)
        .limit(1)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          console.log("No org_settings found, using defaults");
          return DEFAULT_BRANDING;
        }
        throw error;
      }

      return {
        ...DEFAULT_BRANDING,
        ...data,
      } as BrandingSettings;
    },
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    retry: 1,
  });

  return {
    branding: branding || DEFAULT_BRANDING,
    isLoading,
    error,
  };
};

export default useBrandingSettings;
