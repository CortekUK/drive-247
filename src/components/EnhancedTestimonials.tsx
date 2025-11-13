import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Testimonial {
  id: string;
  author: string;
  company_name: string;
  review: string;
  stars: number;
  created_at: string;
}

const EnhancedTestimonials = () => {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    loadTestimonials();
  }, []);

  useEffect(() => {
    if (testimonials.length === 0) return;

    const totalPages = Math.ceil(testimonials.length / 3);
    const interval = setInterval(() => {
      setActiveIndex((current) => (current + 1) % totalPages);
    }, 5000);

    return () => clearInterval(interval);
  }, [testimonials.length]);

  const loadTestimonials = async () => {
    const { data } = await supabase
      .from("testimonials")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) {
      console.log("Loaded testimonials:", data.length, data);
      setTestimonials(data);
    }
  };

  if (testimonials.length === 0) return null;

  const itemsPerPage = 3;
  const totalPages = Math.ceil(testimonials.length / itemsPerPage);
  const startIndex = activeIndex * itemsPerPage;
  const visibleTestimonials = testimonials.slice(startIndex, startIndex + itemsPerPage);

  console.log('Active Index:', activeIndex);
  console.log('Total testimonials:', testimonials.length);
  console.log('Total pages:', totalPages);
  console.log('Visible testimonials:', visibleTestimonials.map(t => t.author));

  return (
    <section className="py-24 md:py-28 lg:py-32 bg-muted/20">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16 animate-fade-in">
          <h2 className="text-4xl md:text-5xl font-display font-bold mb-4 text-foreground">
            Why Dallas Drivers Choose Drive917
          </h2>
          <div className="flex items-center justify-center mt-6">
            <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-[#F5B942] to-transparent" />
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto" key={activeIndex}>
          {visibleTestimonials.map((testimonial, index) => (
            <Card
              key={testimonial.id}
              className="p-8 bg-card shadow-[0_4px_20px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.3)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)] transition-all duration-300 hover:-translate-y-1 flex flex-col animate-fade-in border border-border"
              style={{
                animationDelay: `${index * 0.1}s`
              }}
            >
              <div className="flex gap-1 mb-6">
                {[...Array(testimonial.stars || 5)].map((_, i) => (
                  <Star
                    key={i}
                    className="w-5 h-5 fill-[#F5B942] text-[#F5B942]"
                    aria-hidden="true"
                  />
                ))}
              </div>

              <p className="text-foreground/80 mb-6 italic leading-relaxed min-h-[7rem] text-base break-words overflow-wrap-anywhere hyphens-auto">
                "{testimonial.review}"
              </p>

              <div className="border-t border-border pt-4 mt-auto">
                <p className="font-bold text-foreground font-display text-lg">{testimonial.author}</p>
                {testimonial.company_name && (
                  <p className="text-sm text-muted-foreground uppercase tracking-wider mt-1 font-light">{testimonial.company_name}</p>
                )}
              </div>
            </Card>
          ))}
        </div>

        <div className="flex justify-center gap-3 mt-12">
          {[...Array(totalPages)].map((_, index) => (
            <button
              key={index}
              onClick={() => setActiveIndex(index)}
              className={`h-2 rounded-full transition-all duration-300 ${
                index === activeIndex
                  ? 'bg-[#F5B942] w-8'
                  : 'bg-muted-foreground/30 w-2 hover:bg-muted-foreground/50'
              }`}
              aria-label={`View page ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default EnhancedTestimonials;
