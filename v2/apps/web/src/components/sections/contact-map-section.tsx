import { CornerUpRight } from "lucide-react";
import Link from "next/link";

import {
  DEFAULT_SITE_CONTACT,
  DEFAULT_SITE_LOGO,
  EMPTY_CONTACT_INFO,
} from "@/lib/cms/defaults";
import { loadSection } from "@/lib/cms/server";
import { Editable, cmsSection } from "@/lib/cms/editable";

/**
 * The location card and map.
 *
 * ── no address means no map ─────────────────────────────────────────────────
 *
 * This used to fall back to Drive247's own Dubai office, embedded by
 * coordinates, with our street address printed on the card as the tenant's.
 * The comment defending it argued the constant lived here rather than in
 * `DEFAULT_SITE_CONTACT` so an operator's default address "must never silently
 * be ours" — but that is precisely what it rendered: a US operator's contact
 * page showed a map of Dubai Silicon Oasis captioned as their office, and the
 * "Get directions" link sent their customer there.
 *
 * A missing address is now a missing SECTION. There is no honest map to draw
 * for a business whose location we do not know, and a wrong one is worse than
 * none — someone acts on it.
 *
 * Once an operator fills in `site-settings / contact` (or the contact page's
 * `office.address`), the embed queries THEIR address and the links point at
 * their `google_maps_url` when they set one.
 */

function joinAddress(parts: readonly string[]): string {
  return parts.map((part) => part.trim()).filter((part) => part !== "").join(", ");
}

export async function ContactMapSection() {
  const [site, logo, info] = await Promise.all([
    loadSection("site-settings", "contact", DEFAULT_SITE_CONTACT),
    loadSection("site-settings", "logo", DEFAULT_SITE_LOGO),
    // EMPTY, not the default: this section has to know whether the operator
    // actually supplied an address, because a fallback address must not become
    // the map's search query. The default is applied further down, for display
    // only.
    loadSection("contact", "contact_info", EMPTY_CONTACT_INFO),
  ]);

  // A street line or a city is what makes an address findable. Without one,
  // the site-settings block is not an address at all — the seeded tenant has
  // only `country: "USA"`, and feeding that to Google returns a map of the
  // United States sitting under a card captioned with one word.
  const hasSiteAddress =
    site.address_line1.trim() !== "" || site.city.trim() !== "";

  const siteAddress = hasSiteAddress
    ? joinAddress([
        site.address_line1,
        site.address_line2,
        site.city,
        site.state,
        site.zip,
        site.country,
      ])
    : "";

  // The contact page's own office field wins — it is the one an operator edits
  // while they are looking at this page.
  const address = info.office.address.trim() || siteAddress;
  const hasAddress = address !== "";

  /* Nothing to show, so show nothing. Returning null drops the whole section
     rather than leaving an empty framed box on the page. */
  if (!hasAddress) return null;

  const embedSrc = `https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=14&output=embed&iwloc=near`;

  const mapLink =
    site.google_maps_url.trim() ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

  const displayAddress = address;
  /* The iframe title is read aloud, so it must name the TENANT. It fell back to
     "Drive247", announcing us on their page. */
  const name = logo.logo_alt.trim() || "Our";

  return (
    <section {...cmsSection("site-settings.contact", "Map")} className="bg-brand-cream">
      <div className="container-page pb-12">
        <div className="relative overflow-hidden rounded-[16px] ring-1 ring-brand-border">
          <iframe
            src={embedSrc}
            title={`${name} location`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="block h-[420px] w-full border-0 lg:h-[520px]"
          />

          {/* Overlay to mask Google Maps' default "Open in Maps" button (top-right
              of the iframe) and route the click to our own Google Maps link.
              Hidden on mobile where the address card already takes that area. */}
          <a
            href={mapLink}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in Google Maps"
            className="absolute right-0 top-0 z-20 hidden h-10 w-28 bg-brand-cream sm:block"
          />

          <article className="pointer-events-auto absolute left-4 top-4 z-30 w-[calc(100%-2rem)] max-w-[280px] rounded-[12px] bg-white p-3 shadow-[0_12px_24px_-8px_rgba(0,0,0,0.18)] ring-1 ring-brand-border-soft sm:left-8 sm:top-8 sm:w-[320px] sm:max-w-none">
            <div className="flex gap-3">
              <div
                aria-hidden
                className="size-[68px] shrink-0 rounded-[8px] bg-[linear-gradient(135deg,#3a4f6b,#1a2638)] shadow-inner"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 truncate text-[13px] font-semibold text-brand-text">
                    {logo.logo_alt.trim() !== "" ? (
                      <Editable path="site-settings.logo.logo_alt">{name}</Editable>
                    ) : (
                      name
                    )}
                  </h3>
                  <a
                    href={mapLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-brand-progress-bar hover:underline"
                  >
                    <CornerUpRight className="size-3" strokeWidth={2} />
                    Directions
                  </a>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-brand-text-soft">
                  {/* Editable only when it IS the contact page's own field. The
                      site-settings address is a join of six fields and cannot
                      round-trip from one text node. */}
                  {info.office.address.trim() !== "" ? (
                    <Editable path="contact.contact_info.office.address">{displayAddress}</Editable>
                  ) : (
                    displayAddress
                  )}
                </p>
              </div>
            </div>

            <Link
              href={mapLink}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-brand-forest px-4 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
            >
              Open in Google Maps
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}
