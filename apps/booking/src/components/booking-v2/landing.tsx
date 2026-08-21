import { sans, serif } from "./fonts";
import { DemoForm, Hero, Nav } from "./hero";
import { Modules } from "./modules";
import { CtaBar, DashboardShowcase, FleetShowcase, Footer, Outcomes } from "./showcase";
import "./styles.css";

/**
 * Drive247 — booking-v2.
 *
 * A single premium editorial landing page, and nothing more. There is no data
 * layer here: no tenant context, no Supabase, no auth, no booking flow. Every
 * value on the page is a constant in `data.ts`, and the product screenshots
 * are markup rather than images so they stay sharp at any zoom.
 *
 * Whether a tenant's home page serves this is decided upstream by their
 * `booking_v2_enabled` flag — see `src/app/page.tsx`. This component knows
 * nothing about that.
 *
 * nav → hero → demo form → five modules → dashboard → fleet →
 * outcomes → cta → footer
 *
 * Everything is namespaced under `.bv2`, so none of this design's tokens reach
 * the rest of the booking app.
 */
export default function BookingV2Landing() {
  return (
    <div className={`bv2 ${serif.variable} ${sans.variable}`}>
      <Nav />
      <main>
        <Hero />
        <DemoForm />
        <Modules />
        <DashboardShowcase />
        <FleetShowcase />
        <Outcomes />
        <CtaBar />
      </main>
      <Footer />
    </div>
  );
}
