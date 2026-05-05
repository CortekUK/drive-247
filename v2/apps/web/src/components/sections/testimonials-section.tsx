import { TestimonialCard } from "@/components/cards/testimonial-card";
import { TESTIMONIALS } from "@/lib/fixtures/landing";

export function TestimonialsSection() {
  return (
    <section className="bg-background">
      <div className="container-page py-16 lg:py-20">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {TESTIMONIALS.map((testimonial) => (
            <TestimonialCard
              key={testimonial.id}
              quote={testimonial.quote}
              author={testimonial.author}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
