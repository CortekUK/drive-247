import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Star, MessageSquareQuote, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FeedbackModal } from "@/components/FeedbackModal";

interface Testimonial {
  id: string;
  author: string;
  company_name: string;
  review: string;
  stars: number;
  created_at: string;
  created_by?: string;
  updated_at?: string;
}

const ITEMS_PER_PAGE = 12;

const Testimonials = () => {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    loadTestimonials();
  }, [currentPage]);

  const loadTestimonials = async () => {
    // Get total count
    const { count } = await supabase
      .from("testimonials")
      .select("*", { count: "exact", head: true });

    setTotalCount(count || 0);

    // Get paginated data
    const { data, error } = await supabase
      .from("testimonials")
      .select("*")
      .order("created_at", { ascending: false })
      .range((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE - 1);

    if (!error && data) {
      setTestimonials(data);
    }
  };

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const getDisplayName = (testimonial: Testimonial) => {
    return testimonial.author;
  };

  return (
    <>
      <SEO
        title="Drive917 — Customer Reviews"
        description="Read verified customer reviews of Drive917's luxury car rentals. Real experiences from our distinguished clientele."
        keywords="Drive917 reviews, luxury car rental reviews, customer testimonials, verified reviews"
      />
      <div className="min-h-screen bg-background">
      <Navigation />
      
      {/* Hero Section */}
      <section className="pt-32 pb-24">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center mb-20 animate-fade-in">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-display font-bold mb-6 text-gradient-metal leading-tight">
              Customer Reviews
            </h1>
            <div className="flex items-center justify-center mb-8">
              <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
            </div>
            <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              What our customers say about their luxury vehicle rental experience.
            </p>
          </div>

          {/* Testimonials Grid */}
          <div className="max-w-5xl mx-auto">
            {testimonials.length > 0 ? (
              <>
                <div className="space-y-8 animate-fade-in animation-delay-200">
                  {testimonials.map((testimonial, index) => (
                    <Card
                      key={testimonial.id}
                      className="group p-8 md:p-10 shadow-metal bg-gradient-to-br from-card via-card to-secondary/20 backdrop-blur transition-all duration-500 hover:-translate-y-2 border-accent/10 hover:shadow-glow"
                      style={{ animationDelay: `${index * 100}ms` }}
                    >
                      {/* Star Rating */}
                      <div className="flex justify-center mb-6 gap-1">
                        {[...Array(5)].map((_, i) => (
                          <Star
                            key={i}
                            className={`w-6 h-6 transition-all duration-300 ${
                              i < testimonial.stars
                                ? "fill-accent text-accent drop-shadow-[0_0_8px_rgba(255,215,0,0.5)]"
                                : "text-muted-foreground/30"
                            }`}
                          />
                        ))}
                      </div>

                      {/* Quote Icon */}
                      <div className="flex justify-center mb-6">
                        <MessageSquareQuote className="w-8 h-8 text-accent/40" />
                      </div>

                      {/* Testimonial Content */}
                      <blockquote className="text-lg md:text-xl text-muted-foreground mb-8 italic text-center leading-relaxed max-w-3xl mx-auto">
                        "{testimonial.review}"
                      </blockquote>

                      {/* Customer Details */}
                      <div className="text-center space-y-1">
                        <p className="text-xl font-display font-semibold text-gradient-silver">
                          {getDisplayName(testimonial)}
                        </p>
                        {testimonial.company_name && (
                          <p className="text-sm uppercase tracking-wider text-accent/80">
                            {testimonial.company_name}
                          </p>
                        )}
                      </div>

                      {/* Decorative Line */}
                      <div className="flex items-center justify-center mt-6">
                        <div className="h-[1px] w-16 bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
                      </div>
                    </Card>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex justify-center items-center gap-4 mt-12">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="border-accent/30 hover:bg-accent/10"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    
                    <div className="flex items-center gap-2">
                      {[...Array(totalPages)].map((_, i) => (
                        <Button
                          key={i}
                          variant={currentPage === i + 1 ? "default" : "outline"}
                          size="icon"
                          onClick={() => setCurrentPage(i + 1)}
                          className={currentPage === i + 1 ? "" : "border-accent/30 hover:bg-accent/10"}
                        >
                          {i + 1}
                        </Button>
                      ))}
                    </div>

                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="border-accent/30 hover:bg-accent/10"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </>
            ) : (
              // Empty State
              <Card className="p-16 text-center shadow-metal bg-card/50 backdrop-blur border-accent/20 animate-fade-in">
                <div className="flex justify-center mb-6">
                  <div className="p-4 rounded-full bg-accent/10 border border-accent/20">
                    <Sparkles className="w-12 h-12 text-accent" />
                  </div>
                </div>
                <h3 className="text-2xl font-display font-semibold mb-4">
                  No reviews yet
                </h3>
                <p className="text-muted-foreground mb-8">
                  Be the first to share your Drive917 experience.
                </p>
                <Button 
                  size="lg"
                  onClick={() => setFeedbackModalOpen(true)}
                  className="shadow-glow"
                >
                  Submit Feedback
                </Button>
              </Card>
            )}
          </div>
        </div>
      </section>

      {/* Footer CTA Section */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <Card className="p-10 md:p-12 text-center shadow-metal bg-gradient-to-br from-card via-secondary/20 to-card backdrop-blur border-accent/20">
              <MessageSquareQuote className="w-12 h-12 text-accent mx-auto mb-6" />
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-4 text-gradient-silver">
                Would you like to share your experience?
              </h2>
              <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto leading-relaxed">
                We value your feedback and would love to hear about your rental experience with Drive917.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button 
                  size="lg" 
                  className="shadow-glow hover:shadow-[0_0_40px_rgba(255,215,0,0.4)] transition-all text-base px-10 py-6"
                  onClick={() => setFeedbackModalOpen(true)}
                >
                  Submit Feedback
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </section>

      <Footer />
      <FeedbackModal open={feedbackModalOpen} onOpenChange={setFeedbackModalOpen} />
    </div>
    </>
  );
};

export default Testimonials;
