import { MapPin } from 'lucide-react-nw';

import { DEFAULT_SITE_CONTACT, DEFAULT_SITE_LOGO, EMPTY_CONTACT_INFO } from '@nw/lib/cms/defaults';
import { cmsSection } from '@nw/lib/cms/editable';
import { loadSection } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';
import { CARD, SITE_WIDE } from '@nw/site-v2/kit';
import { OpeningHoursCard, loadOpeningHours } from '@nw/site-v2/sections/contact-hours';

/**
 * Northwind booking site v2 — the lower half of /contact: on the left, when
 * a renter can come by (`contact-hours.tsx`) and where (the map); on the
 * right, the message form (passed in as `children`).
 *
 * The map follows the current section's rules
 * (`components/sections/contact-map-section.tsx`, which documents why): no
 * findable address means no map, the contact page's own office field wins
 * over Site Settings. With neither hours nor a map, the form stands alone.
 */
function joinAddress(parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter((part) => part !== '').join(', ');
}

export async function ContactMapSection({ children }: { children?: React.ReactNode }) {
  const [site, logo, info, hours] = await Promise.all([
    loadSection('site-settings', 'contact', DEFAULT_SITE_CONTACT),
    loadSection('site-settings', 'logo', DEFAULT_SITE_LOGO),
    loadSection('contact', 'contact_info', EMPTY_CONTACT_INFO),
    loadOpeningHours(),
  ]);

  const hasSiteAddress = site.address_line1.trim() !== '' || site.city.trim() !== '';
  const siteAddress = hasSiteAddress
    ? joinAddress([site.address_line1, site.address_line2, site.city, site.state, site.zip, site.country])
    : '';
  const address = info.office.address.trim() || siteAddress;

  const form = (
    <div id="contact-form" className="h-full min-w-0 scroll-mt-24">
      {children}
    </div>
  );

  if (address === '' && !hours) {
    return (
      <section className={cn(SITE_WIDE, 'pb-16 pt-16 md:pb-28 md:pt-24')}>
        <div className="mx-auto max-w-3xl">{form}</div>
      </section>
    );
  }

  const name = logo.logo_alt.trim() || 'Our';

  return (
    <section className={cn(SITE_WIDE, 'grid gap-6 pb-16 pt-16 md:pb-28 md:pt-24 lg:grid-cols-2 lg:gap-10')}>
      <div data-reveal className="flex min-w-0 flex-col gap-6">
        {hours ? <OpeningHoursCard hours={hours} /> : null}
        {address !== '' ? (
          <div {...cmsSection('site-settings.contact', 'Map')} className="flex flex-1 flex-col">
            <h2 className="flex items-center gap-2 text-[20px] font-extrabold tracking-[-0.03em] text-pv-fg md:text-[22px]">
              <MapPin aria-hidden className="size-5 text-pv-primary" strokeWidth={2.25} />
              Where we are
            </h2>
            <p className="mt-1.5 text-[14.5px] text-pv-muted-fg">{address}</p>
            <div className={cn(CARD, 'mt-4 flex min-h-[280px] flex-1 overflow-hidden md:min-h-[320px]')}>
              <iframe
                src={`https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=14&output=embed&iwloc=near`}
                title={`Map: ${name === 'Our' ? 'where we are' : name}`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="block min-h-full w-full flex-1 border-0"
              />
            </div>
          </div>
        ) : null}
      </div>
      {/* Stretched to the left column's height, so both end on one line. */}
      <div data-reveal style={{ '--d': '100ms' } as React.CSSProperties}>
        {form}
      </div>
    </section>
  );
}
