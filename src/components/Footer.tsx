import { Link } from "react-router-dom";
import { Phone, Mail, MapPin } from "lucide-react";
import { useSiteSettings } from "@/hooks/useSiteSettings";

const Footer = () => {
  const { settings } = useSiteSettings();

  // Format phone for tel: link
  const phoneLink = settings.phone.replace(/[^\d+]/g, '');

  // Build address display
  const addressParts = [
    settings.address_line1,
    settings.address_line2,
    `${settings.city}, ${settings.state} ${settings.zip}`
  ].filter(Boolean);
  const addressDisplay = addressParts.join(", ") || settings.office_address;

  // Build Google Maps URL
  const mapsUrl = settings.google_maps_url ||
    `https://maps.google.com/?q=${encodeURIComponent(addressDisplay)}`;

  return (
    <footer className="py-16 md:py-20" style={{ backgroundColor: 'hsl(var(--nav-bg))' }}>
      <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-4 gap-8 md:gap-12">
          <div>
            {settings.logo_url ? (
              <img
                src={settings.logo_url}
                alt={settings.logo_alt || "Drive917"}
                className="h-10 mb-4 object-contain"
              />
            ) : (
              <>
                <h3 className="text-xl font-display font-bold text-white mb-2">
                  {settings.company_name || "Drive917"}
                </h3>
                <div className="w-12 h-[2px] bg-[#F5B942] mb-4"></div>
              </>
            )}
            <p className="text-sm text-[#EAEAEA]">
              {settings.footer_tagline || "Reliable Dallas Car Rentals"}
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-white mb-2">Services</h4>
            <div className="w-12 h-[2px] bg-[#F5B942] mb-4"></div>
            <ul className="space-y-2">
              <li>
                <Link to="/fleet" className="text-sm text-[#EAEAEA] hover:text-[#F5B942] transition-colors duration-200">
                  Fleet & Pricing
                </Link>
              </li>
              <li>
                <Link to="/#booking" className="text-sm text-[#EAEAEA] hover:text-[#F5B942] transition-colors duration-200">
                  Book a Vehicle
                </Link>
              </li>
              <li>
                <Link to="/promotions" className="text-sm text-[#EAEAEA] hover:text-[#F5B942] transition-colors duration-200">
                  Promotions
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-white mb-2">Company</h4>
            <div className="w-12 h-[2px] bg-[#F5B942] mb-4"></div>
            <ul className="space-y-2">
              <li>
                <Link to="/about" className="text-sm text-[#EAEAEA] hover:text-[#F5B942] transition-colors duration-200">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/testimonials" className="text-sm text-[#EAEAEA] hover:text-[#F5B942] transition-colors duration-200">
                  Testimonials
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-sm text-[#EAEAEA] hover:text-[#F5B942] transition-colors duration-200">
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-white mb-2">Contact</h4>
            <div className="w-12 h-[2px] bg-[#F5B942] mb-4"></div>
            <ul className="space-y-2">
              <li className="flex items-center gap-2 text-sm text-[#EAEAEA]">
                <Phone className="w-4 h-4 flex-shrink-0" />
                <a href={`tel:${phoneLink}`} className="hover:text-[#F5B942] transition-colors duration-200">
                  {settings.phone_display || settings.phone}
                </a>
              </li>
              <li className="flex items-center gap-2 text-sm text-[#EAEAEA]">
                <Mail className="w-4 h-4 flex-shrink-0" />
                <a href={`mailto:${settings.email}`} className="hover:text-[#F5B942] transition-colors duration-200">
                  {settings.email}
                </a>
              </li>
              <li className="flex items-start gap-2 text-sm text-[#EAEAEA]">
                <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#F5B942] transition-colors duration-200"
                >
                  {addressDisplay}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-[#CCCCCC]">
            {settings.copyright_text}
          </p>
          <div className="flex gap-6">
            <Link to="/privacy" className="text-sm text-[#CCCCCC] hover:text-[#F5B942] transition-colors duration-200">
              Privacy Policy
            </Link>
            <Link to="/terms" className="text-sm text-[#CCCCCC] hover:text-[#F5B942] transition-colors duration-200">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
