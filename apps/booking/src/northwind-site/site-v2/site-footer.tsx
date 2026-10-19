import Link from 'next/link';
import { Mail, MapPin, Phone } from 'lucide-react-nw';

import { loadFleetSeed } from '@nw/components/fleet/fleet-seed';
import { DEFAULT_SITE_CONTACT, DEFAULT_SITE_SOCIAL } from '@nw/lib/cms/defaults';
import { getTenantSlug, loadBlogEnabled, loadSection } from '@nw/lib/cms/server';
import { socialLinks } from '@nw/lib/cms/social';
import { FOOTER_LINKS } from '@nw/lib/constants';
import { cn } from '@nw/lib/utils';

import { SITE_CONTAINER } from './kit';

/**
 * Northwind booking site v2 — the footer. Server component, like v1's
 * components/layout/footer.tsx, and fed by the same reads: `site-settings /
 * contact` for the operator's details, `site-settings / social` for their
 * networks, the /fleet loader for the "Our cars" column, and the blog switch.
 * Every column that would be empty is left out rather than shown blank.
 *
 * Calm columns, muted text, one 1px top border — no dark slab as in v1.
 */

/** How many of the operator's cars the footer lists (v1's number). */
const FOOTER_VEHICLES = 5;

const LINK = 'block w-fit max-w-full text-[13px] leading-5 text-pv-muted-fg transition-colors duration-200 hover:text-pv-fg motion-reduce:transition-none';
const HEADING = 'text-xs font-semibold text-pv-fg';

export async function SiteV2Footer({ tenantName }: { tenantName: string | null }) {
  const slug = await getTenantSlug();
  const [contact, social, fleet, blogEnabled] = await Promise.all([
    loadSection('site-settings', 'contact', DEFAULT_SITE_CONTACT),
    loadSection('site-settings', 'social', DEFAULT_SITE_SOCIAL),
    slug ? loadFleetSeed(slug) : Promise.resolve(null),
    loadBlogEnabled(),
  ]);

  const vehicles = (fleet?.vehicles ?? []).slice(0, FOOTER_VEHICLES);

  const email = contact.email.trim();
  /* `phone_display` is what a visitor reads; `phone` is the dialable one. */
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
  /* Configured networks only. `socialLinks` falls back to `#` placeholders for
     the v1 hero rows; a footer icon that goes nowhere is a dead link, so v2
     drops them. */
  const socials = socialLinks(social).filter((link) => link.href !== '#');

  /* Blog joins the Company column when the operator has it switched on. */
  const columns: Record<string, ReadonlyArray<{ href: string; label: string }>> = {
    ...FOOTER_LINKS,
    Company: blogEnabled ? [...FOOTER_LINKS.Company, { href: '/blog', label: 'Blog' }] : FOOTER_LINKS.Company,
  };

  const hasContact = email !== '' || phone !== '' || address.length > 0;

  return (
    <footer className="mt-20 border-t border-pv-border">
      <div className={cn(SITE_CONTAINER, 'py-12 md:py-14')}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(columns).map(([heading, links]) => (
            <div key={heading} className="space-y-3">
              <h3 className={HEADING}>{heading}</h3>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={LINK}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {vehicles.length > 0 ? (
            <div className="space-y-3">
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
            <div className="col-span-2 space-y-3 sm:col-span-1">
              <h3 className={HEADING}>Contact us</h3>
              <ul className="space-y-2.5">
                {email !== '' ? (
                  <li>
                    <a href={`mailto:${email}`} className={cn(LINK, 'flex items-start gap-2 break-all')}>
                      <Mail className="mt-[3px] size-3.5 shrink-0" />
                      {email}
                    </a>
                  </li>
                ) : null}
                {phone !== '' ? (
                  <li>
                    <a href={`tel:${dial}`} className={cn(LINK, 'flex items-start gap-2')}>
                      <Phone className="mt-[3px] size-3.5 shrink-0" />
                      {phone}
                    </a>
                  </li>
                ) : null}
                {address.length > 0 ? (
                  <li>
                    {mapsUrl !== '' ? (
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className={cn(LINK, 'flex items-start gap-2')}>
                        <MapPin className="mt-[3px] size-3.5 shrink-0" />
                        <span>{address.join(', ')}</span>
                      </a>
                    ) : (
                      <span className="flex items-start gap-2 text-[13px] leading-5 text-pv-muted-fg">
                        <MapPin className="mt-[3px] size-3.5 shrink-0" />
                        <span>{address.join(', ')}</span>
                      </span>
                    )}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-pv-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-pv-muted-fg">
            © {new Date().getFullYear()} {tenantName ?? ''}. All rights reserved.
          </p>
          {socials.length > 0 ? (
            <ul className="flex items-center gap-1">
              {socials.map(({ key, href, label, Icon }) => (
                <li key={key}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="grid size-11 place-items-center rounded-full text-pv-muted-fg transition-colors duration-200 hover:bg-pv-hover hover:text-pv-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
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
