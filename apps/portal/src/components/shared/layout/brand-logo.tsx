"use client";

import { useEffectiveTheme } from "@/hooks/use-effective-theme";
import { useTenantBranding } from "@/hooks/use-tenant-branding";
import { cn } from "@/lib/utils";

/**
 * Compact wordmark for tight surfaces (collapsed sidebar, avatars).
 * "Alpha Rentals" → "AR", "Drive247" → "DR".
 */
export function getBrandInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

interface BrandLogoProps {
  /** Render the compact (icon-width) variant — used when the sidebar is collapsed. */
  collapsed?: boolean;
  className?: string;
}

/**
 * Square tenant mark for avatar-sized slots (the sidebar org switcher).
 *
 * Shares `BrandLogo`'s theme-aware source rule rather than re-deriving it —
 * `dark_logo_url` wins in dark mode, and a tenant with no logo gets a chip of
 * their own initials, never the platform's brand.
 */
export function BrandMark({ className }: { className?: string }) {
  // Not `resolvedTheme` — see `useEffectiveTheme`: on a forced-light route
  // it still reports "dark", which picks the dark logo onto a light page.
  const { isDark } = useEffectiveTheme();
  const { branding, brandName } = useTenantBranding();

  const logoUrl =
    isDark && branding?.dark_logo_url
      ? branding.dark_logo_url
      : branding?.logo_url;

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={brandName}
        className={cn(
          "h-8 w-8 shrink-0 rounded-md bg-sidebar-accent object-contain p-0.5",
          className
        )}
      />
    );
  }

  return (
    <div
      title={brandName}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-[12px] font-semibold text-primary-foreground",
        className
      )}
    >
      {getBrandInitials(brandName) || "O"}
    </div>
  );
}

/**
 * Tenant logo for portal chrome.
 *
 * Renders the uploaded logo when the tenant has one (theme-aware: `dark_logo_url`
 * wins in dark mode), otherwise falls back to a text wordmark built from the
 * tenant's own name — the same behaviour the booking site has. It never renders
 * the platform's default brand for a tenant that hasn't uploaded a logo.
 */
export function BrandLogo({ collapsed = false, className }: BrandLogoProps) {
  // Not `resolvedTheme` — see `useEffectiveTheme`: on a forced-light route
  // it still reports "dark", which picks the dark logo onto a light page.
  const { isDark } = useEffectiveTheme();
  const { branding, brandName } = useTenantBranding();

  const logoUrl =
    isDark && branding?.dark_logo_url
      ? branding.dark_logo_url
      : branding?.logo_url;

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={brandName}
        className={cn(
          "object-contain transition-all duration-300 ease-in-out",
          collapsed ? "h-10 w-10" : "h-16 w-full max-w-[180px]",
          className
        )}
        style={{ imageRendering: "auto" }}
      />
    );
  }

  if (collapsed) {
    return (
      <span
        title={brandName}
        className={cn(
          "text-sm font-bold tracking-wide text-primary transition-all duration-300 ease-in-out",
          className
        )}
      >
        {getBrandInitials(brandName)}
      </span>
    );
  }

  // Long names would otherwise overflow the 280px sidebar — step the size down
  // before falling back to truncation.
  const textSize = brandName.length > 22 ? "text-base" : brandName.length > 14 ? "text-lg" : "text-xl";

  return (
    <span
      title={brandName}
      className={cn(
        "max-w-[200px] truncate px-2 font-bold tracking-wide text-primary transition-all duration-300 ease-in-out",
        textSize,
        className
      )}
    >
      {brandName}
    </span>
  );
}

export default BrandLogo;
