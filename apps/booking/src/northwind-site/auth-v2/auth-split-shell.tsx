'use client';

/**
 * The frame login v2, signup v2 and forgot-password v2 sit in: the tenant's brand wash dissolving across the page, the typed
 * hero and the operator's logo on the left, the form on the right with no card
 * behind it, and on phones the wash coming down from the top edge.
 *
 * Also mounts v1's `RedirectWhenSignedIn`, which is what v1's auth layout does
 * for these pages: a customer already signed in goes straight on to `next`.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import { useTenant } from '@nw/contexts/TenantContext';
import { brandHslVars } from '@nw/portal-v2/brand';
import { RedirectWhenSignedIn } from '@/app/(northwind)/northwind-site/(auth)/_components/redirect-when-signed-in';

import { brandInk, brandSurface, MOBILE_WASH_MASK, PHOTO_MASK, WASH_MASK } from './brand-surface';
import { HeroTypedHeadline } from './hero-typed-headline';

/** The v2 motion: 200ms ease-out in, opacity only, none for reduced motion. */
const FADE_CLASSES = 'transition-opacity duration-200 ease-out motion-reduce:transition-none';

type Tenant = ReturnType<typeof useTenant>['tenant'];

/** The brand-hued link colour login-v2 uses for its links. */
export function authLinkInk(tenant: Tenant): string {
  return brandInk(tenant?.light_primary_color || tenant?.primary_color, false);
}

export function AuthSplitShell({ children }: { children: ReactNode }) {
  const { tenant, isLoading: tenantLoading } = useTenant();

  const appName = tenant?.company_name || tenant?.app_name || 'your rental company';
  const brandName = tenant?.app_name || tenant?.company_name || null;

  // Brand layers wait for the tenant row, then fade in, so no default colour
  // paints first and swaps.
  const brandFade = `${FADE_CLASSES} ${tenantLoading ? 'opacity-0' : 'opacity-100'}`;

  const accentSource =
    tenant?.light_accent_color || tenant?.accent_color || tenant?.light_primary_color || tenant?.primary_color;

  const hero = brandSurface(accentSource, false);
  const heroImage = tenant?.hero_background_url || null;
  const heroOnDark = !!heroImage || !hero.isLight;
  const accentInk = brandInk(accentSource, heroOnDark);
  const mobileOnDark = !hero.isLight;
  const mobileAccentInk = brandInk(accentSource, mobileOnDark);

  const heroLogo = (heroOnDark ? tenant?.dark_logo_url || tenant?.logo_url : tenant?.logo_url) || null;
  const mobileLogo = (mobileOnDark ? tenant?.dark_logo_url || tenant?.logo_url : tenant?.logo_url) || null;
  const brandVars = brandHslVars(tenant?.primary_color);

  return (
    <div
      className="pv2-tokens relative min-h-svh overflow-hidden bg-white font-[family-name:var(--font-manrope)] lg:grid lg:grid-cols-2"
      style={(brandVars ?? undefined) as React.CSSProperties | undefined}
    >
      <RedirectWhenSignedIn />

      {/* Brand wash, spanning the page and dissolved by the mask. */}
      <div
        aria-hidden
        className={`absolute inset-y-0 left-0 hidden overflow-hidden lg:block ${brandFade} ${heroImage ? 'w-[58%]' : 'w-full'}`}
        style={
          heroImage
            ? {
                backgroundImage: `url(${heroImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                maskImage: PHOTO_MASK,
                WebkitMaskImage: PHOTO_MASK,
              }
            : { backgroundColor: hero.color, maskImage: WASH_MASK, WebkitMaskImage: WASH_MASK }
        }
      >
        {heroImage && <div className="absolute inset-0 bg-gradient-to-tr from-black/75 via-black/55 to-black/35" />}
      </div>

      {/* Phones: the colour comes down from the top edge and fades out above the fields. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 h-[42vh] lg:hidden ${brandFade}`}
        style={{ backgroundColor: hero.color, maskImage: MOBILE_WASH_MASK, WebkitMaskImage: MOBILE_WASH_MASK }}
      />

      {/* ---------- Left: what the portal is for (lg and up) ---------- */}
      <aside
        className={`relative hidden overflow-hidden p-12 lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col lg:justify-between ${brandFade} ${
          heroOnDark ? 'text-white' : 'text-pv-fg'
        }`}
      >
        <div className="relative z-10">
          <BrandLogo src={heroLogo} name={brandName} className="h-14 max-w-[220px]" onDark={heroOnDark} />
        </div>

        <div className="relative z-10">
          <HeroTypedHeadline appName={appName} accentInk={accentInk} onDark={heroOnDark} />
        </div>

        <p className={`relative z-10 text-xs ${heroOnDark ? 'text-white/60' : 'text-pv-fg/50'}`}>
          © {new Date().getFullYear()} {brandName ?? appName}. All rights reserved.
        </p>
      </aside>

      {/* Phone brand mark, pinned near the top edge rather than riding on the form. */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-8 lg:hidden ${brandFade}`}>
        <BrandLogo src={mobileLogo} name={brandName} className="h-8 max-w-[180px]" onDark={mobileOnDark} />
      </div>

      {/* ---------- Right: the form ---------- */}
      <main className="relative flex min-h-svh items-start justify-center px-6 pt-[104px] pb-10 sm:px-10 lg:items-center lg:py-12">
        <div className="pv2-enter w-full max-w-[480px]">
          <div className="mb-7 lg:hidden">
            <HeroTypedHeadline appName={appName} accentInk={mobileAccentInk} onDark={mobileOnDark} compact />
          </div>

          {children}

          <p className="mt-3 text-center text-xs text-pv-muted-fg">
            <Link href="/" className="-my-3.5 inline-flex min-h-11 items-center transition-colors hover:text-pv-fg">
              Back to the website
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

/** The operator's own logo, falling back to their name in type (as login-v2). */
function BrandLogo({
  src,
  name,
  className,
  onDark,
}: {
  src: string | null;
  name: string | null;
  className: string;
  onDark: boolean;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name ?? ''} className={`w-auto object-contain ${className}`} />;
  }
  if (!name) return null;
  return (
    <span className={`text-2xl font-extrabold tracking-tight ${onDark ? 'text-white' : 'text-pv-fg'}`}>{name}</span>
  );
}
