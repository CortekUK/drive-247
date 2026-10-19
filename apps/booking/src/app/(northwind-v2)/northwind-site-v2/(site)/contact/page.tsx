import { pageMetadata } from '@nw/lib/cms/metadata';
import { ContactDetailsSection } from '@nw/site-v2/sections/contact-details-section';
import { ContactHeroSection } from '@nw/site-v2/sections/contact-hero-section';
import { ContactMapSection } from '@nw/site-v2/sections/contact-map-section';

/** Northwind booking site v2 — /contact: the intro, details beside the form, then the map. */

export function generateMetadata() {
  return pageMetadata('contact', 'Contact');
}

export default function ContactPage() {
  return (
    <>
      <ContactHeroSection />
      <ContactDetailsSection />
      <ContactMapSection />
    </>
  );
}
