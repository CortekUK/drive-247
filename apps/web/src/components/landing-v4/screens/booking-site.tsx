import { LogIn, MessageSquarePlus, Phone, Sun } from "lucide-react";
import "./booking-site.css";

/* ===================================================================== *
 * Booking website — the ORIGINAL tenant site's home page, which is what
 * every tenant except `northwind` is served (apps/booking/src/lib/
 * booking-design.ts NEW_DESIGN_TENANTS, routed by src/middleware.ts), at a
 * 1280 × 800 window: the fixed nav over the full-height hero carousel. The
 * service highlights and the booking widget sit below the fold.
 *
 * Mirrors, in apps/booking:
 *   src/app/(legacy)/page.tsx            — booking_v2_enabled off → <LegacyHome />
 *   src/app/(legacy)/layout.tsx          — Inter on <body>; theme 'dark' unless
 *                                          the tenant picked a customer_theme_mode
 *   src/components/home/legacy-home.tsx  — hero markup, CMS fallbacks
 *   src/components/Navigation.tsx        — xl layout (1280 is exactly `xl`):
 *                                          text logo, links, Login, Inquiry,
 *                                          icon-only phone (label is 2xl only)
 *   src/components/ThemeToggle.tsx       — ghost sm, Sun in dark mode
 *   src/components/HeroCarousel.tsx      — medium overlay, scale-105, dots,
 *                                          scroll indicator
 *   src/components/ui/button.tsx         — outline / default / lg sizes
 *   src/hooks/useDynamicTheme.ts         — accent → --primary/--accent,
 *                                          header colour → --nav-bg
 *   src/hooks/usePageContent.ts          — defaultHomeCarouselImages[0] = car1
 *   src/app/(legacy)/globals.css         — --radius .75rem, .dark tokens,
 *                                          h1 → font-display (Playfair Display)
 *   tailwind.config.ts                   — default container, Playfair/Inter
 *
 * Tenant: what a brand-new self-serve signup gets, named "Northwind Rentals".
 * The web signup sends only a company name, so (supabase/functions/
 * signup-provision + _shared/brand-colors.ts DEFAULT_PALETTE/buildTenantPalette)
 * the site is dark-mode with dark_accent #6366F1, dark_header_footer #0F172A,
 * dark_background #0B1120; no logo, so the nav shows the company name; no phone,
 * so the hero's call button is hidden; and the hero copy is the CMS seed from
 * _shared/tenant-cms-content.ts buildCmsContent (no location given).
 * The first-visit cookie banner (GDPRConsent) is left closed.
 * ===================================================================== */

const COMPANY = "Northwind Rentals";

/** Navigation.tsx navLinks — no FAQ (no active FAQs yet) and no Blog (blog_enabled defaults false). */
const NAV = ["Home", "About", "Fleet & Pricing", "Reviews", "Promotions", "Contact"];

export function BookingSiteScreen() {
  return (
    <div className="scr-site">
      <nav className="nav">
        <div className="row">
          <span className="logo">
            <span className="name">{COMPANY}</span>
            <span className="rule" />
          </span>
          <span className="links">
            {NAV.map((l, i) => (
              <span key={l} className={i === 0 ? "on" : undefined}>
                {l}
              </span>
            ))}
          </span>
          <span className="acts">
            <span className="btn out">
              <LogIn />
              Login
            </span>
            <span className="btn out">
              <MessageSquarePlus />
              Inquiry
            </span>
            <span className="btn call">
              <Phone />
            </span>
            <span className="btn ghost">
              <Sun />
            </span>
          </span>
        </div>
      </nav>

      <section className="hero">
        <div className="media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/landing-v4/site/car1.webp" alt="" />
          <span className="ov" />
        </div>
        <div className="content">
          <div className="box">
            <h1>Car Rentals with {COMPANY}</h1>
            <p className="sub">Quality vehicles and straightforward pricing.</p>
            <div className="ctas">
              <span className="book">Book Your Ride</span>
            </div>
            <p className="trust">Quality Fleet • Clear Pricing • Local Service</p>
          </div>
        </div>
        <span className="mouse">
          <span />
        </span>
        <span className="dots">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={i === 0 ? "on" : undefined} />
          ))}
        </span>
      </section>
    </div>
  );
}
