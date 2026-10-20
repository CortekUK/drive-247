import {
  Check,
  ChevronLeft,
  CircleCheckBig,
  LogIn,
  MessageSquarePlus,
  Phone,
  RefreshCw,
  Shield,
  Sun,
  Upload,
} from "lucide-react";
import "./checkout.css";

/* ===================================================================== *
 * Checkout — the insurance step (step 3 of 5) of the ORIGINAL booking
 * design, which every tenant except `northwind` gets (booking-design.ts,
 * middleware.ts). The widget lives on the tenant home page, in
 * <section id="booking">, and on a step change scrolls its card to 100px
 * below the top of the window — the position shown here at 1280 × 800.
 *
 * Mirrors, line for line:
 *   apps/booking/src/components/home/legacy-home.tsx   (#booking section,
 *       py-20 bg-muted/20, container mx-auto px-4)
 *   apps/booking/src/components/Navigation.tsx          (fixed nav, guest,
 *       xl layout: name + links + Login / Inquiry / phone / theme toggle)
 *   apps/booking/src/components/ThemeToggle.tsx
 *   apps/booking/src/components/MultiStepBookingWidget.tsx
 *       getStepTitle() + .bk-hero, the 5-step progress indicator (step 3
 *       current, highest reached 3), and step 3 "Insurance Verification" in
 *       its entry state (hasInsurance === null): "Do you have existing
 *       insurance coverage?" with the upload card and the Bonzah card
 *       (bonzahSellable, vehicle eligible, guest — no saved documents).
 *   apps/booking/src/components/ui/button.tsx, ui/card.tsx
 *   apps/booking/src/app/(legacy)/globals.css            (tokens, .bk-hero,
 *       .bk-step__node, .bk-step__line, .gradient-accent, .shadow-*)
 *   apps/booking/src/hooks/useDynamicTheme.ts            (runtime tokens)
 *   apps/booking/src/app/(legacy)/layout.tsx             (theme mode)
 *
 * Branding is what a new self-serve signup gets: signup-provision fills the
 * colour columns from supabase/functions/_shared/brand-colors.ts
 * (buildTenantPalette of the default palette — dark accent #6366F1, dark
 * header #0F172A, dark background #0B1120), customer_theme_mode is unset so
 * layout.tsx falls back to 'dark', and useDynamicTheme's dark branch writes
 * the accent into --primary as well (see checkout.css). No logo is set, so the nav shows the company name — the demo
 * tenant "Northwind Rentals" (the code fallback is "Your Rental Company").
 * The FAQ link is omitted: it only appears once a tenant has FAQs.
 * ===================================================================== */

const NAV_LINKS = ["Home", "About", "Fleet & Pricing", "Reviews", "Promotions", "Contact"];

const STEPS: [number, string][] = [
  [1, "Trip Details"],
  [2, "Choose Vehicle"],
  [3, "Insurance Verification"],
  [4, "Customer Details"],
  [5, "Review & Confirm"],
];
const CURRENT = 3;

export function CheckoutScreen() {
  return (
    <div className="scr-co">
      <div className="doc">
        {/* legacy-home.tsx — <section id="booking" className="py-20 bg-muted/20"> */}
        <section className="booking">
          <div className="wrap">
            {/* MultiStepBookingWidget — Booking Hero Header */}
            <section className="bk-hero">
              <div className="bk-hero__inner">
                <h1 className="bk-hero__title">Insurance Verification</h1>
                <div className="hero-rule">
                  <div />
                </div>
                <p className="bk-hero__subtitle">
                  Quick, easy, and affordable car rentals — from pickup to drop-off, we&apos;ve got you covered.
                </p>
                <p className="bk-hero__meta">Serving Your Area · Transparent Rates · 24/7 Support</p>
              </div>
            </section>

            <div className="wcard">
              <div className="bk-steps">
                {/* Enhanced Progress Indicator */}
                <div className="progress">
                  <div className="track">
                    {STEPS.map(([step, label], i) => (
                      <div key={step} className={`st${step > CURRENT ? " unreached" : ""}`}>
                        <div
                          className={`bk-step__node${step <= CURRENT ? " reached" : ""}${step === CURRENT ? " bk-step__node--active" : ""}`}
                        >
                          {step < CURRENT ? <Check /> : <span>{step}</span>}
                        </div>
                        <span className={`lbl${step <= CURRENT ? " on" : ""}`}>{label}</span>
                        {i < STEPS.length - 1 ? <div className="bk-step__line" /> : null}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Step 3: Insurance Verification */}
                <div className="step">
                  <div className="restart">
                    <span className="btn btn-sm btn-outline danger">
                      <RefreshCw /> Start over
                    </span>
                  </div>
                  <div className="head">
                    <div className="co-ring">
                      <Shield />
                    </div>
                    <h3>Insurance Verification</h3>
                    <p>
                      Protect your rental with insurance coverage. Choose from your existing policy or get instant coverage
                      through our partner.
                    </p>
                  </div>

                  <div className="question">
                    <div className="qcard">
                      <div className="qin">
                        <h4>Do you have existing insurance coverage?</h4>
                        <div className="opts">
                          {/* YES Option */}
                          <div className="opt yes">
                            <div className="oin">
                              <div className="top">
                                <div className="ico">
                                  <div className="co-ring">
                                    <CircleCheckBig />
                                  </div>
                                </div>
                                <div>
                                  <h5>Yes, I Have Insurance</h5>
                                  <p>Upload your current insurance certificate and we&apos;ll verify it instantly</p>
                                </div>
                              </div>
                              <div className="bot">
                                <span className="btn btn-lg btn-primary">
                                  <Upload />
                                  Upload New Certificate
                                </span>
                                <div className="fine">
                                  <p>
                                    Instant AI verification
                                    <br />
                                    Accepted formats: PDF, JPG, PNG
                                    <br />
                                    Max file size: 10MB
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* NO Option — Bonzah */}
                          <div className="opt no">
                            <div className="oin">
                              <div className="top">
                                <div className="ico">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src="/landing-v4/site/bonzah-logo-dark.svg" alt="Bonzah" />
                                </div>
                                <div>
                                  <h5>No, I Need Insurance</h5>
                                  <p>Get instant coverage through our trusted partner Bonzah</p>
                                </div>
                              </div>
                              <div className="bot">
                                <span className="btn btn-lg btn-accent">
                                  <Shield />
                                  Get Insurance Now
                                </span>
                                <div className="fine">
                                  <p>
                                    Instant online quotes
                                    <br />
                                    Affordable rates
                                    <br />
                                    Quick 5-minute setup
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="back">
                      <span className="btn btn-lg btn-outline">
                        <ChevronLeft /> Back to Vehicles
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Navigation.tsx — fixed top-0, bg hsl(var(--nav-bg)) */}
      <nav className="nav">
        <div className="wrap">
          <div className="row">
            <span className="brand">
              <span className="brand-col">
                <span className="name">Northwind Rentals</span>
                <span className="bar" />
              </span>
            </span>
            <div className="links">
              {NAV_LINKS.map((l, i) => (
                <span key={l} className={i === 0 ? "on" : undefined}>
                  {l}
                </span>
              ))}
            </div>
            <div className="acts">
              <span className="btn btn-outline nav-o">
                <LogIn />
                Login
              </span>
              <span className="btn btn-outline nav-o">
                <MessageSquarePlus />
                Inquiry
              </span>
              <span className="btn phone">
                <Phone />
              </span>
              <span className="btn btn-sm toggle">
                <Sun />
              </span>
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
}
