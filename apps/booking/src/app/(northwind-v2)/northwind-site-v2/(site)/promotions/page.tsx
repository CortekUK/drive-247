import { pageMetadata } from '@nw/lib/cms/metadata';
import { AboutHeroSection } from '@nw/site-v2/sections/about-hero-section';
import { CtaBanner } from '@nw/site-v2/sections/cta-banner';
import { PromotionsListSection } from '@nw/site-v2/sections/promotions-list-section';

/** Northwind booking site v2 — /promotions. */

export function generateMetadata() {
  return pageMetadata('promotions', 'Promotions');
}

export default function PromotionsPage() {
  return (
    <>
      <AboutHeroSection
        imageSrc="/booking_landingpage/promotions-hero.jpg"
        imageAlt="SUV driving on an open road toward distant snow-capped mountains"
        imageObjectPosition="50% 65%"
        heading="Drive More. Spend Less."
        body={
          <>
            Discover today’s top-tier offers on premium SUVs and fuel-efficient commuters.
            <br className="hidden sm:inline" />
            No hidden fees, just pure value delivered 24/7.
          </>
        }
      />
      <PromotionsListSection />
      <CtaBanner />
    </>
  );
}
