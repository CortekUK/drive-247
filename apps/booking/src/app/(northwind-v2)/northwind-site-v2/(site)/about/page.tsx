import { pageMetadata } from '@nw/lib/cms/metadata';
import { AboutBackdrop } from '@nw/site-v2/sections/about-backdrop';
import { AboutIntro } from '@nw/site-v2/sections/about-intro';
import { AboutStory } from '@nw/site-v2/sections/about-story';
import { AboutToday } from '@nw/site-v2/sections/about-today';
import { HomeCta } from '@nw/site-v2/sections/home-cta';
import { ScrollReveal } from '@nw/site-v2/sections/scroll-reveal';
import { TestimonialsSection } from '@nw/site-v2/sections/testimonials-section';

/**
 * Northwind booking site v2 — /about: who the operator is, and nothing that
 * is not about them. Their headline, their story on a tinted band with
 * curved edges, where they are today in real numbers and real cars,
 * what customers say (only once there are reviews), and the closing scene.
 * Every word is the operator's, editable in place, or read from their fleet.
 */

export function generateMetadata() {
  return pageMetadata('about', 'About');
}

export default function AboutPage() {
  return (
    <>
      <ScrollReveal />
      <AboutIntro />
      <AboutBackdrop>
        <AboutStory />
      </AboutBackdrop>
      <AboutToday />
      <TestimonialsSection />
      <HomeCta page="about" />
    </>
  );
}
