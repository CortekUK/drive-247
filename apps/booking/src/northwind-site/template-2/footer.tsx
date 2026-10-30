import Link from 'next/link';
import { ArrowUpRight, Mail, MapPin, Phone } from 'lucide-react-nw';

import { loadFleetSeed } from '@nw/components/fleet/fleet-seed';
import { BrandMark } from '@nw/components/layout/brand-mark';
import { DEFAULT_SITE_CONTACT, DEFAULT_SITE_SOCIAL } from '@nw/lib/cms/defaults';
import { getTenantSlug, loadBlogEnabled, loadSection } from '@nw/lib/cms/server';
import { socialLinks } from '@nw/lib/cms/social';
import { FOOTER_LINKS } from '@nw/lib/constants';
import type { PageSections } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';
import { T2_HOME, t2Href } from '@nw/template-2/links';

/**
 * Template 2 ("Glass") — the footer, on every page (the layout hands it to the
 * shell). One last pane of glass over the photograph, as wide as the navbar
 * (1400px, same side padding) so the page opens and closes on the same edges,
 * and carrying the same logo. Laid out as a footer: the operator and the way
 * in, the columns, then the small print under a hairline.
 *
 * Fed by the same reads as site-v2's footer: `site-settings / contact` for
 * their details, `site-settings / social` for their networks (configured ones
 * only: a placeholder icon is a dead link), five of their cars, and the blog
 * switch. A column with nothing in it is left out, not shown blank.
 */

const FOOTER_VEHICLES = 5;

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';
const LINK = cn(
  'block w-fit max-w-full rounded text-[14px] leading-5 text-[var(--g2-ink-soft)] transition-colors duration-200 hover:text-[var(--g2-ink)]',
  FOCUS,
);
const HEADING = 'text-[13.5px] font-semibold text-[var(--g2-ink)]';

export async function Template2Footer({
  tenantName,
  tenantLogoUrl,
  siteSettings,
}: {
  tenantName: string | null;
  tenantLogoUrl: string | null;
  siteSettings: PageSections | null;
}) {
  const slug = await getTenantSlug();
  const [contact, social, fleet, blogEnabled] = await Promise.all([
    loadSection('site-settings', 'contact', DEFAULT_SITE_CONTACT),
    loadSection('site-settings', 'social', DEFAULT_SITE_SOCIAL),
    slug ? loadFleetSeed(slug) : Promise.resolve(null),
    loadBlogEnabled(),
  ]);

  const vehicles = (fleet?.vehicles ?? []).slice(0, FOOTER_VEHICLES);
  const email = contact.email.trim();
  // `phone_display` is what a visitor reads; `phone` is the one to dial.
  const phone = contact.phone_display.trim() || contact.phone.trim();
  const dial = (contact.phone.trim() || contact.phone_display.trim()).replace(/[^+\d]/g, '');
  const address = [
    contact.address_line1,
    contact.address_line2,
    [contact.city, contact.state, contact.zip].map((part) => part.trim()).filter(Boolean).join(', '),
    contact.country,
  ]
    .map((part) => part.trim())
    .filter(Boolean);
  const mapsUrl = contact.google_maps_url.trim();
  const socials = socialLinks(social).filter((link) => link.href !== '#');
  const hasContact = email !== '' || phone !== '' || address.length > 0;

  const columns: Record<string, ReadonlyArray<{ href: string; label: string }>> = {
    ...FOOTER_LINKS,
    Company: blogEnabled ? [...FOOTER_LINKS.Company, { href: '/blog', label: 'Blog' }] : FOOTER_LINKS.Company,
  };

  return (
    <footer className="px-3 pb-3 pt-3 sm:px-5 sm:pb-4">
      <div className="g2-glass mx-auto max-w-[1400px] rounded-[32px] px-6 pb-4 pt-9 sm:rounded-[40px] sm:px-10 sm:pt-12">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 xl:grid-cols-[minmax(0,1.7fr)_repeat(4,minmax(0,1fr))_minmax(0,1.5fr)] xl:gap-x-8">
          <div className="col-span-2 sm:col-span-3 xl:col-span-1 xl:pr-6">
            <BrandMark
              href={T2_HOME}
              seed={siteSettings}
              nameSeed={tenantName}
              logoSeed={tenantLogoUrl}
              className={cn(
                'inline-flex min-h-11 min-w-0 items-center rounded-full',
                FOCUS,
                '[&_img]:max-h-9 [&_img]:max-w-[150px] [&_span]:truncate [&_span]:text-[17px] [&_span]:font-semibold [&_span]:tracking-[-0.02em] [&_span]:text-[var(--g2-ink)]',
              )}
            />
            <p className="mt-3 max-w-[290px] text-[14.5px] leading-relaxed text-[var(--g2-ink-soft)]">
              Book your car online, day or night. It is ready when you arrive.
            </p>
            <Link href="/booking" className={cn('g2-cta mt-6 inline-flex h-11 items-center gap-1.5 rounded-full px-5 text-[14px] font-semibold', FOCUS)}>
              Book a car
              <ArrowUpRight aria-hidden className="size-4" strokeWidth={2.25} />
            </Link>
          </div>

          {Object.entries(columns).map(([heading, links]) => (
            <nav key={heading} aria-label={heading} className="space-y-3.5">
              <h3 className={HEADING}>{heading}</h3>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link href={t2Href(link.href)} className={LINK}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          {vehicles.length > 0 ? (
            <div className="space-y-3.5">
              <h3 className={HEADING}>Our cars</h3>
              <ul className="space-y-2.5">
                {vehicles.map((vehicle) => (
                  <li key={vehicle.id} className="min-w-0">
                    <Link href={`/booking/${vehicle.id}`} className={cn(LINK, 'truncate')}>
                      {vehicle.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {hasContact ? (
            <div className="col-span-2 space-y-3.5 xl:col-span-1">
              <h3 className={HEADING}>Contact us</h3>
              <ul className="space-y-2.5">
                {email !== '' ? (
                  <li>
                    <a href={`mailto:${email}`} className={cn(LINK, 'flex items-start gap-2 [overflow-wrap:anywhere]')}>
                      <Mail aria-hidden className="mt-[3px] size-3.5 shrink-0 text-[var(--g2-accent-ink)]" />
                      {email}
                    </a>
                  </li>
                ) : null}
                {phone !== '' ? (
                  <li>
                    <a href={`tel:${dial}`} className={cn(LINK, 'flex items-start gap-2')}>
                      <Phone aria-hidden className="mt-[3px] size-3.5 shrink-0 text-[var(--g2-accent-ink)]" />
                      {phone}
                    </a>
                  </li>
                ) : null}
                {address.length > 0 ? (
                  <li>
                    {mapsUrl !== '' ? (
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className={cn(LINK, 'flex items-start gap-2')}>
                        <MapPin aria-hidden className="mt-[3px] size-3.5 shrink-0 text-[var(--g2-accent-ink)]" />
                        <span>{address.join(', ')}</span>
                      </a>
                    ) : (
                      <span className="flex items-start gap-2 text-[14px] leading-5 text-[var(--g2-ink-soft)]">
                        <MapPin aria-hidden className="mt-[3px] size-3.5 shrink-0 text-[var(--g2-accent-ink)]" />
                        <span>{address.join(', ')}</span>
                      </span>
                    )}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="mt-12 flex flex-col items-center gap-3 border-t border-[rgb(13_12_29/0.08)] pt-4 sm:flex-row sm:justify-between">
          <p className="text-[13px] text-[var(--g2-ink-soft)]">
            © {new Date().getFullYear()} {tenantName ?? ''}. All rights reserved.
          </p>
          {socials.length > 0 ? (
            <ul className="flex items-center gap-0.5 sm:-mr-2">
              {socials.map(({ key, href, label, Icon }) => (
                <li key={key}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className={cn(
                      'grid size-10 place-items-center rounded-full text-[var(--g2-ink-soft)] transition-colors duration-200 hover:bg-white/70 hover:text-[var(--g2-ink)]',
                      FOCUS,
                    )}
                  >
                    <Icon className="size-4" />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
