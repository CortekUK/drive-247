'use client';

/**
 * The Glass look, for the whole v2 portal (Ghulam, Nov 2026).
 *
 * Mounted once by the dashboard layout for v2 chrome. While the tenant is
 * offered Glass (`isGlassTenant`, northwind only for now) and has it chosen
 * (Settings → Branding → Theme; it is the default), this:
 *
 *   - marks <html data-portal-look="glass">, which every Glass rule hangs off,
 *   - injects the Glass stylesheet (dashboard-v2/glass-look.ts),
 *   - runs the pointer light and, in Chromium, the real edge refraction.
 *
 * Renders nothing and touches nothing otherwise, so the Standard look, every
 * other tenant and v1 never meet any of it.
 */

import { useLayoutEffect } from 'react';

import { GLASS_PALETTE, useGlassPointerLight } from '@/components/dashboard-v2/glass-look';
import { useGlassRefraction } from '@/components/dashboard-v2/glass-refraction';
import { useTenant } from '@/contexts/TenantContext';
import { isGlassTenant, usePortalLook } from '@/lib/appearance/portal-look';

export function GlassRoot() {
  const { tenant } = useTenant();
  const [look] = usePortalLook(tenant?.id);
  const glass = isGlassTenant(tenant?.slug) && look === 'glass';

  useLayoutEffect(() => {
    if (!glass) return;
    const root = document.documentElement;
    root.setAttribute('data-portal-look', 'glass');
    return () => root.removeAttribute('data-portal-look');
  }, [glass]);

  useGlassPointerLight(glass);
  useGlassRefraction(glass);

  return glass ? <style>{GLASS_PALETTE}</style> : null;
}
