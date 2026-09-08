import { Facebook, Instagram, Twitter, Youtube } from "lucide-react";
import Link from "next/link";

import { FOOTER_LINKS } from "@/lib/constants";
import { DEFAULT_SITE_CONTACT } from "@/lib/cms/defaults";
import { loadSection, getTenantSlug } from "@/lib/cms/server";
import { loadFleetSeed } from "@/components/fleet/fleet-seed";

const SOCIALS = [
  { Icon: Youtube, href: "#", label: "YouTube" },
  { Icon: Instagram, href: "#", label: "Instagram" },
  { Icon: Facebook, href: "#", label: "Facebook" },
  { Icon: Twitter, href: "#", label: "X" },
];

/**
 * The site footer.
 *
 * The "Contact us" column was a hardcoded `CONTACT_INFO` constant —
 * `support@carrentals.io` and `+133-394-3439-1435` — rendered on EVERY page of
 * EVERY tenant. Neither reaches the operator whose site it is, and the phone
 * number is not a real one, so a customer at the bottom of any page was given a
 * dead line and someone else's inbox.
 *
 * It now reads `site-settings / contact`, the one place a tenant enters their
 * business details for the whole site, and a detail they have not filled in is
 * simply not shown. An absent row is honest; a fabricated one is not.
 */
/** How many of the operator's cars the footer advertises. */
const FOOTER_VEHICLES = 5;

export async function Footer() {
  const slug = await getTenantSlug();
  const [site, fleet] = await Promise.all([
    loadSection("site-settings", "contact", DEFAULT_SITE_CONTACT),
    /* The operator's real cars, for the column that used to invent five. Same
       loader the /fleet page uses, so the same filters apply — hidden, paused
       and disposed vehicles are already excluded, and a car that reaches this
       list is one a customer can actually open and book. */
    slug ? loadFleetSeed(slug) : Promise.resolve(null),
  ]);

  const vehicles = (fleet?.vehicles ?? []).slice(0, FOOTER_VEHICLES);

  const email = site.email.trim();
  /* `phone_display` is the formatted version a visitor reads; `phone` is the
     dialable one. Either alone is enough to show the row. */
  const phone = site.phone_display.trim() || site.phone.trim();
  const dial = (site.phone.trim() || site.phone_display.trim()).replace(/[^+\d]/g, "");

  return (
    <footer className="bg-brand-forest-darker text-white/80">
      <div className="container-page py-16 lg:py-20">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <div key={heading} className="space-y-4">
              <h3 className="text-sm font-medium text-white/60">{heading}</h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/85 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* The operator's own cars. Absent entirely for a tenant with an
              empty fleet — a column headed "Our Cars" with nothing under it is
              worse than one column fewer. */}
          {vehicles.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-white/60">Our Cars</h3>
              <ul className="space-y-3">
                {vehicles.map((vehicle) => (
                  <li key={vehicle.id}>
                    <Link
                      href={`/booking/${vehicle.id}`}
                      className="text-sm text-white/85 transition-colors hover:text-white"
                    >
                      {vehicle.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The whole column goes when a tenant has filled in neither: a
              heading called "Contact us" with nothing under it reads as a
              broken page. */}
          {(email !== "" || phone !== "") && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-white/60">Contact us</h3>
              <ul className="space-y-3 text-sm text-white/85">
                {email !== "" && (
                  <li>
                    <a
                      href={`mailto:${email}`}
                      className="transition-colors hover:text-white"
                    >
                      {email}
                    </a>
                  </li>
                )}
                {phone !== "" && (
                  <li>
                    <a
                      href={`tel:${dial}`}
                      className="transition-colors hover:text-white"
                    >
                      {phone}
                    </a>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-6 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-white/60">
            © 2026 Copyright. All Right Reserved
          </p>
          <ul className="flex items-center gap-4">
            {SOCIALS.map(({ Icon, href, label }) => (
              <li key={label}>
                <Link
                  href={href}
                  aria-label={label}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white/85 transition-colors hover:border-white/40 hover:text-white"
                >
                  <Icon className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
