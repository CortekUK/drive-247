import { Star } from "lucide-react";

import { AboutHeroSection } from "@/components/sections/about-hero-section";
import { CtaBanner } from "@/components/sections/cta-banner";
import { RealStoriesSection } from "@/components/sections/real-stories-section";
import { TestimonialsSection } from "@/components/sections/testimonials-section";
import { WhyChooseUsSection } from "@/components/sections/why-choose-us-section";

export const metadata = { title: "Reviews" };

export default function ReviewsPage() {
  return (
    <>
      <AboutHeroSection
        imageSrc="/booking_landingpage/reviews-hero.jpg"
        imageAlt="Customer enjoying a drive at golden hour"
        imageObjectPosition="center"
        topBadge={<TrustpilotBadge />}
        heading="What it’s Really Like to Drive with Us"
        body={
          <>
            Explore reviews on vehicle cleanliness, app ease-of-use,
            <br className="hidden sm:inline" />
            and our commitment to a “No Hidden Fees” policy.
          </>
        }
      />
      <RealStoriesSection />
      <WhyChooseUsSection />
      <TestimonialsSection />
      <CtaBanner />
    </>
  );
}

function TrustpilotBadge() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-[12px] leading-tight text-brand-text shadow-sm ring-1 ring-brand-border-soft backdrop-blur-sm">
      <Star
        className="size-4 fill-[#00b67a] text-[#00b67a]"
        strokeWidth={0}
      />
      <span className="font-semibold">Trustpilot</span>
      <span className="text-brand-text-subtle">5.0 Rating</span>
    </div>
  );
}
