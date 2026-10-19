import { CornerUpRight, MapPin } from 'lucide-react-nw';

import { DEFAULT_SITE_CONTACT, DEFAULT_SITE_LOGO, EMPTY_CONTACT_INFO } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { loadSection } from '@nw/lib/cms/server';
import { cn } from '@nw/lib/utils';
import { CARD, ICON_TILE, Section } from '@nw/site-v2/kit';

/**
 * Northwind booking site v2 — the map. Same rules as the current section
 * (`components/sections/contact-map-section.tsx`, which documents why): no
 * findable address means no section at all, the contact page's own office
 * field wins over Site Settings, and the links go to the operator's
 * `google_maps_url` when they set one.
 *
 * The floating address card is now a calm row under the map, so nothing has
 * to be masked over the embed.
 */
function joinAddress(parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter((part) => part !== '').join(', ');
}

export async function ContactMapSection() {
  const [site, logo, info] = await Promise.all([
    loadSection('site-settings', 'contact', DEFAULT_SITE_CONTACT),
    loadSection('site-settings', 'logo', DEFAULT_SITE_LOGO),
    loadSection('contact', 'contact_info', EMPTY_CONTACT_INFO),
  ]);

  const hasSiteAddress = site.address_line1.trim() !== '' || site.city.trim() !== '';
  const siteAddress = hasSiteAddress
    ? joinAddress([site.address_line1, site.address_line2, site.city, site.state, site.zip, site.country])
    : '';

  const address = info.office.address.trim() || siteAddress;
  if (address === '') return null;

  const embedSrc = `https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=14&output=embed&iwloc=near`;
  const mapLink =
    site.google_maps_url.trim() || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const name = logo.logo_alt.trim() || 'Our';

  return (
    <div {...cmsSection('site-settings.contact', 'Map')}>
      <Section className="pt-4 md:pt-6">
        <div className={cn(CARD, 'overflow-hidden')}>
          <iframe
            src={embedSrc}
            title={`${name} location`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="block h-[320px] w-full border-0 md:h-[440px]"
          />
          <div className="flex flex-col gap-4 border-t border-pv-border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div className="flex min-w-0 items-start gap-3">
              <span className={ICON_TILE}>
                <MapPin aria-hidden className="size-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-pv-fg">
                  {logo.logo_alt.trim() !== '' ? (
                    <Editable path="site-settings.logo.logo_alt">{name}</Editable>
                  ) : (
                    'Find us'
                  )}
                </p>
                <p className="mt-0.5 break-words text-[13px] leading-relaxed text-pv-muted-fg">
                  {info.office.address.trim() !== '' ? (
                    <Editable path="contact.contact_info.office.address">{address}</Editable>
                  ) : (
                    address
                  )}
                </p>
              </div>
            </div>
            <a
              href={mapLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-pv-border bg-pv-card px-5 text-sm font-medium text-pv-fg transition-colors duration-200 ease-out hover:border-pv-primary/40 hover:text-pv-primary motion-reduce:transition-none"
            >
              <CornerUpRight aria-hidden className="size-4" strokeWidth={1.75} />
              Get directions
            </a>
          </div>
        </div>
      </Section>
    </div>
  );
}
