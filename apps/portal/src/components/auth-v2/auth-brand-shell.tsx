"use client";

import { useEffect, useState } from "react";

import { useTenantBranding } from "@/hooks/use-tenant-branding";
import {
  brandInk,
  brandSurface,
  MOBILE_WASH_MASK,
  PHOTO_MASK,
  WASH_MASK,
} from "@/components/auth-v2/brand-surface";

/**
 * The signed-out brand surface, for every screen that is not the login form.
 *
 * Reset-password landed on a bare white card: no logo, no tenant colour, no
 * footer — a different product from the page that sent them there two minutes
 * earlier. It is also the screen where somebody is being asked to type a new
 * password, which is precisely where an unbranded page reads as a phishing
 * attempt rather than as yours.
 *
 * ── WHY A SHELL AND NOT A COPY ──────────────────────────────────────────────
 *
 * The brand chain is nine fallbacks deep per colour (dark → light → accent →
 * primary) and the dissolve masks are tuned curves. Re-typing any of that here
 * would drift from the login within a release. So the colours come from
 * `brandSurface`/`brandInk` and the masks from the same module the login now
 * imports them from, and this component owns only the layout.
 *
 * The login does NOT use this yet. Its hero carries a typed headline and the
 * form column has its own scroll behaviour, so lifting it wholesale is a bigger
 * change than this screen needed. Everything shared already lives in
 * `brand-surface.ts`; moving the login onto this shell later changes no pixels.
 */

const PLATFORM_LOGO_LIGHT_GROUND = "/drive247-logo-light.png";
const PLATFORM_LOGO_DARK_GROUND = "/drive247-logo-dark.png";

export function AuthBrandShell({ children }: { children: React.ReactNode }) {
  const { branding } = useTenantBranding();

  /* The hero reads light-on-dark or dark-on-light from the resolved colour, so
     the theme has to be known before anything is painted. */
  const [isDarkMode, setIsDarkMode] = useState(false);
  useEffect(() => {
    const read = () => setIsDarkMode(document.documentElement.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const appName = branding?.app_name || "Drive247";

  // Same order as the login: dark-specific, then the shared value, then primary
  // as the last resort. A tenant that set only `primary_color` still gets it.
  const accentSource = isDarkMode
    ? branding?.dark_accent_color ||
      branding?.accent_color ||
      branding?.dark_primary_color ||
      branding?.primary_color
    : branding?.light_accent_color ||
      branding?.accent_color ||
      branding?.light_primary_color ||
      branding?.primary_color;

  const hero = brandSurface(accentSource, isDarkMode);
  const heroImage = branding?.hero_background_url || null;
  const heroOnDark = !!heroImage || !hero.isLight;
  const heroLogo = heroOnDark ? PLATFORM_LOGO_DARK_GROUND : PLATFORM_LOGO_LIGHT_GROUND;

  const mobile = brandSurface(accentSource, isDarkMode);
  const mobileOnDark = !mobile.isLight;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background lg:grid lg:grid-cols-2">
      {/* Spans the whole page and is dissolved by the mask, so the two halves
          read as one surface with no vertical seam down the middle. */}
      <div
        aria-hidden
        className={`absolute inset-y-0 left-0 hidden overflow-hidden lg:block ${
          heroImage ? "w-[58%]" : "w-full"
        }`}
        style={
          heroImage
            ? {
                backgroundImage: `url(${heroImage})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                maskImage: PHOTO_MASK,
                WebkitMaskImage: PHOTO_MASK,
              }
            : {
                backgroundColor: hero.color,
                maskImage: WASH_MASK,
                WebkitMaskImage: WASH_MASK,
              }
        }
      >
        {heroImage && (
          <div className="absolute inset-0 bg-gradient-to-tr from-black/75 via-black/55 to-black/35" />
        )}
      </div>

      {/* Below `lg` the hero column is hidden, and with it every trace of the
          tenant's colour. This brings the tint down from the top edge and fades
          it out above the fields. Always the flat colour, never the photograph. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[42vh] lg:hidden"
        style={{
          backgroundColor: mobile.color,
          maskImage: MOBILE_WASH_MASK,
          WebkitMaskImage: MOBILE_WASH_MASK,
        }}
      />

      <aside
        className={`relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between ${
          heroOnDark ? "text-white" : "text-foreground"
        }`}
      >
        <div className="relative z-10">
          {/* A file that ships with the app, not a URL out of the tenant row —
              a broken-image glyph where the brand should be is worse than a
              generic mark. */}
          <img src={heroLogo} alt={appName} className="h-14 w-auto max-w-[220px] object-contain" />
        </div>
        <p
          className={`relative z-10 text-xs ${
            heroOnDark ? "text-white/60" : "text-foreground/50"
          }`}
        >
          © {new Date().getFullYear()} {appName}. All rights reserved.
        </p>
      </aside>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-8 lg:hidden">
        <img
          src={mobileOnDark ? PLATFORM_LOGO_DARK_GROUND : PLATFORM_LOGO_LIGHT_GROUND}
          alt={appName}
          className="h-8 w-auto max-w-[180px] object-contain"
        />
      </div>

      <main className="relative flex min-h-screen items-start justify-center px-6 pt-[104px] pb-10 sm:px-10 lg:items-center lg:py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

/** The link/ink colour for a form inside the shell, matching the login's. */
export function useBrandInk(): string {
  const { branding } = useTenantBranding();
  const [isDarkMode, setIsDarkMode] = useState(false);
  useEffect(() => {
    const read = () => setIsDarkMode(document.documentElement.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const primarySource = isDarkMode
    ? branding?.dark_primary_color || branding?.primary_color
    : branding?.light_primary_color || branding?.primary_color;
  return brandInk(primarySource, isDarkMode);
}
