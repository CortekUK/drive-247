import { ContactDetailsSection } from "@nw/components/sections/contact-details-section";
import { ContactHeroSection } from "@nw/components/sections/contact-hero-section";
import { ContactMapSection } from "@nw/components/sections/contact-map-section";
import { pageMetadata } from "@nw/lib/cms/metadata";

export function generateMetadata() {
  return pageMetadata("contact", "Contact");
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
