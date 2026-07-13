'use client';

import Link from "next/link";
import { Phone, Mail, MapPin } from "lucide-react";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useHasFaqs } from "@/hooks/useHasFaqs";

const Footer = () => {
  const { settings } = useSiteSettings();
  const hasFaqs = useHasFaqs();

  // Format phone for tel: link
  const phoneLink = settings.phone.replace(/[^\d+]/g, '');

  // Build address display - only include city/state/zip if they have values
  const cityStateZip = [settings.city, settings.state, settings.zip].filter(Boolean).join(', ').replace(/, $/, '');
  const addressParts = [
    settings.address_line1,
    settings.address_line2,
    cityStateZip
  ].filter(Boolean);
  const addressDisplay = addressParts.length > 0 ? addressParts.join(", ") : settings.office_address;

  // Build Google Maps URL
  const mapsUrl = settings.google_maps_url ||
    `https://maps.google.com/?q=${encodeURIComponent(addressDisplay)}`;

  return (
    <footer className="py-10 sm:py-14 md:py-20" style={{ backgroundColor: 'hsl(var(--nav-bg))' }}>
      <div className="container mx-auto px-4">
        {/* Brand block — full width on mobile */}
        <div className="mb-8 sm:mb-10 md:hidden">
          {settings.logo_url ? (
            <img
              src={settings.dark_logo_url || settings.logo_url}
              alt={settings.logo_alt || "Drive247"}
              className="h-14 w-auto max-w-[140px] mb-3 object-contain"
            />
          ) : (
            <>
              <h3 className="text-lg font-display font-bold text-white mb-2 uppercase tracking-wide">
                {settings.company_name || "Drive247"}
              </h3>
              <div className="w-10 h-[2px] mb-3" style={{ backgroundColor: 'hsl(var(--accent))' }}></div>
            </>
          )}
          <p className="text-xs text-[#EAEAEA]/80">
            {settings.footer_tagline || "Reliable Car Rentals"}
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 md:gap-12">
          <div className="hidden md:block">
            {settings.logo_url ? (
              <img
                src={settings.dark_logo_url || settings.logo_url}
                alt={settings.logo_alt || "Drive247"}
                className="h-20 w-auto max-w-[160px] mb-4 object-contain"
              />
            ) : (
              <>
                <h3 className="text-xl font-display font-bold text-white mb-2 uppercase tracking-wide">
                  {settings.company_name || "Drive247"}
                </h3>
                <div className="w-12 h-[2px] mb-4" style={{ backgroundColor: 'hsl(var(--accent))' }}></div>
              </>
            )}
            <p className="text-sm text-[#EAEAEA]">
              {settings.footer_tagline || "Reliable Car Rentals"}
            </p>
          </div>

          <div>
            <h4 className="text-sm md:text-base font-semibold text-white mb-1.5 md:mb-2">Services</h4>
            <div className="w-8 md:w-12 h-[2px] mb-2 md:mb-4" style={{ backgroundColor: 'hsl(var(--accent))' }}></div>
            <ul className="space-y-1.5 md:space-y-2">
              <li>
                <Link href="/fleet" className="text-xs md:text-sm footer-link">
                  Fleet & Pricing
                </Link>
              </li>
              <li>
                <Link href="/#booking" className="text-xs md:text-sm footer-link">
                  Book a Vehicle
                </Link>
              </li>
              <li>
                <Link href="/promotions" className="text-xs md:text-sm footer-link">
                  Promotions
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm md:text-base font-semibold text-white mb-1.5 md:mb-2">Company</h4>
            <div className="w-8 md:w-12 h-[2px] mb-2 md:mb-4" style={{ backgroundColor: 'hsl(var(--accent))' }}></div>
            <ul className="space-y-1.5 md:space-y-2">
              <li>
                <Link href="/about" className="text-xs md:text-sm footer-link">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/testimonials" className="text-xs md:text-sm footer-link">
                  Reviews
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-xs md:text-sm footer-link">
                  Contact
                </Link>
              </li>
              {hasFaqs && (
                <li>
                  <Link href="/faq" className="text-xs md:text-sm footer-link">
                    FAQ
                  </Link>
                </li>
              )}
            </ul>
          </div>

          <div className="col-span-2 md:col-span-1">
            <h4 className="text-sm md:text-base font-semibold text-white mb-1.5 md:mb-2">Contact</h4>
            <div className="w-8 md:w-12 h-[2px] mb-2 md:mb-4" style={{ backgroundColor: 'hsl(var(--accent))' }}></div>
            <ul className="space-y-1.5 md:space-y-2">
              {settings.phone && (
                <li className="flex items-center gap-2 text-xs md:text-sm text-[#EAEAEA]">
                  <Phone className="w-3.5 h-3.5 md:w-4 md:h-4 flex-shrink-0" />
                  <a href={`tel:${phoneLink}`} className="footer-link break-all">
                    {settings.phone_display || settings.phone}
                  </a>
                </li>
              )}
              {settings.email && (
                <li className="flex items-center gap-2 text-xs md:text-sm text-[#EAEAEA]">
                  <Mail className="w-3.5 h-3.5 md:w-4 md:h-4 flex-shrink-0" />
                  <a href={`mailto:${settings.email}`} className="footer-link break-all">
                    {settings.email}
                  </a>
                </li>
              )}
              {addressDisplay && (
                <li className="flex items-start gap-2 text-xs md:text-sm text-[#EAEAEA]">
                  <MapPin className="w-3.5 h-3.5 md:w-4 md:h-4 flex-shrink-0 mt-0.5" />
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="footer-link"
                  >
                    {addressDisplay}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-8 sm:mt-10 md:mt-12 pt-4 sm:pt-6 md:pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-3 md:gap-4">
          <p className="text-[11px] md:text-sm text-[#CCCCCC] text-center md:text-left">
            {settings.copyright_text}
          </p>
          <div className="flex gap-4 md:gap-6">
            <Link href="/privacy" className="text-[11px] md:text-sm footer-link-muted">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-[11px] md:text-sm footer-link-muted">
              Terms of Service
            </Link>
            <Link href="/sms-opt-in" className="text-[11px] md:text-sm footer-link-muted">
              SMS Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
