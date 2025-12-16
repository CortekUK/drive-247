'use client';

import { useEffect } from 'react';
import { useDynamicTheme } from '@/hooks/useDynamicTheme';

interface ThemeInitializerProps {
  children: React.ReactNode;
}

/**
 * ThemeInitializer component
 *
 * This component initializes the dynamic theme from branding settings.
 * It fetches colors from org_settings and applies them as CSS variables.
 *
 * Place this component inside QueryClientProvider but wrapping the main app content.
 */
export function ThemeInitializer({ children }: ThemeInitializerProps) {
  // Initialize dynamic theme from branding settings
  const { branding } = useDynamicTheme();

  // Debug: log when branding is loaded
  useEffect(() => {
    if (branding) {
      console.log('Branding loaded:', {
        primary: branding.primary_color,
        accent: branding.accent_color,
        app_name: branding.app_name,
      });
    }
  }, [branding]);

  return <>{children}</>;
}

export default ThemeInitializer;
