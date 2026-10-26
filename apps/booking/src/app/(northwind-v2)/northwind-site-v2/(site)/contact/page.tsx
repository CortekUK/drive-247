import { pageMetadata } from '@nw/lib/cms/metadata';
import { ContactForm } from '@nw/site-v2/forms/contact-form';
import { ContactDetailsSection } from '@nw/site-v2/sections/contact-details-section';
import { ContactHeroSection } from '@nw/site-v2/sections/contact-hero-section';
import { ContactMapSection } from '@nw/site-v2/sections/contact-map-section';
import { ScrollReveal } from '@nw/site-v2/sections/scroll-reveal';

/**
 * Northwind booking site v2 — /contact. Its job is reaching a person, so the
 * ways to do it come first, as cards to tap; then the message form beside the
 * map, and the questions most people would have asked.
 */

export function generateMetadata() {
  return pageMetadata('contact', 'Contact');
}

export default function ContactPage() {
  return (
    <>
      <ScrollReveal />
      <ContactHeroSection />
      <ContactDetailsSection />
      <ContactMapSection>
        <ContactForm />
      </ContactMapSection>
    </>
  );
}
