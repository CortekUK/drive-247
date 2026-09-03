'use client';

import { notFound } from 'next/navigation';

import { useTenant } from '@/contexts/TenantContext';
import { isAreaHidden } from '@/lib/lean-areas';
import { WelcomePackView } from '@/components/welcome/welcome-pack-view';

export default function WelcomePage() {
  const { tenantSlug } = useTenant();
  // Load-bearing, and NOT redundant with the two sidebar gates. Hiding a nav
  // entry hides the link, not the page: typing /welcome, following a bookmark,
  // or clicking a `#section-…` deep link out of an email would still render
  // the whole pack for a lean tenant. The sidebars decide what is offered;
  // this decides what exists.
  //
  // Fails open on an unresolved slug (see isAreaHidden), so the 14 tenants
  // already reading the pack keep it during the first-paint tick when
  // TenantContext has not resolved yet.
  if (isAreaHidden('welcome', tenantSlug)) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl pt-4">
      <WelcomePackView />
    </div>
  );
}
