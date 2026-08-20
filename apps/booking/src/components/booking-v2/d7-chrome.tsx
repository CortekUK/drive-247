"use client";

import { useTenant } from "@/contexts/TenantContext";
import { Footer as D7Footer } from "./d7-close";
import { D7Nav } from "./d7-nav";
import { useD7Chrome } from "./use-d7-content";

/** True when this tenant's site should render the booking-v2 design. */
export function useIsBookingV2() {
  const { tenant } = useTenant();
  return tenant?.booking_v2_enabled === true;
}

/**
 * The booking-v2 header, for pages that mount the shared <Navigation />.
 *
 * D7Nav is `fixed`, so it needs a spacer beneath it. The landing supplies its
 * own via the hero's top padding; every other page gets one from here.
 */
export function D7NavBar() {
  const c = useD7Chrome();
  return (
    <>
      <D7Nav appName={c.appName} logoUrl={c.logoUrl} phone={c.phone} bookCta={c.bookCta} />
      <div aria-hidden className="h-[74px]" />
    </>
  );
}

/** The booking-v2 footer, for pages that mount the shared <Footer />. */
export function D7FooterBar() {
  const c = useD7Chrome();
  return (
    <D7Footer
      appName={c.appName}
      logoUrl={c.darkLogoUrl}
      blurb={c.blurb}
      contact={c.contact}
      socials={c.socials}
    />
  );
}
