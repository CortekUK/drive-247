import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PortfolioCard } from "./PortfolioCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PortfolioCarouselProps {
  serviceType: "chauffeur" | "close_protection";
  title: string;
  subtitle?: string;
}

export const PortfolioCarousel = ({ serviceType, title, subtitle }: PortfolioCarouselProps) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    fetchPortfolioItems();
  }, [serviceType]);

  const fetchPortfolioItems = async () => {
    try {
      const column = serviceType === "chauffeur" 
        ? "show_on_chauffeur_page" 
        : "show_on_close_protection_page";

      const { data, error } = await supabase
        .from("portfolio")
        .select("*")
        .eq("is_published", true)
        .eq("is_active", true)
        .or(`${column}.eq.true,service_type.eq.both`)
        .order("is_featured", { ascending: false })
        .order("event_date", { ascending: false })
        .limit(6);

      if (error) {
        console.error("Portfolio fetch error:", error);
        throw error;
      }
      
      console.log(`Fetched ${data?.length || 0} portfolio items for ${serviceType}:`, data);
      setItems(data || []);
    } catch (error) {
      console.error("Error fetching portfolio items:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? items.length - 2 : prev - 2));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev >= items.length - 2 ? 0 : prev + 2));
  };

  if (loading) {
    return (
      <section className="py-24 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12 space-y-4">
              <Skeleton className="h-12 w-64 mx-auto" />
              <Skeleton className="h-6 w-96 mx-auto" />
            </div>
            <div className="grid md:grid-cols-2 gap-10">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="space-y-4">
                  <Skeleton className="h-64 w-full rounded-lg" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="py-24 md:py-28 lg:py-32 bg-muted/30 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-accent/5 to-transparent pointer-events-none" />
      <div className="container mx-auto px-4 md:px-6 lg:px-10 relative">
        <div className="max-w-[1400px] mx-auto">
          <div className="text-center mb-16 space-y-6 animate-fade-in">
            <h2 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal pb-2">
              {title}
            </h2>
            {subtitle && (
              <p className="text-base text-muted-foreground max-w-2xl mx-auto uppercase tracking-wider">
                {subtitle}
              </p>
            )}
            <div className="flex items-center justify-center">
              <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
            </div>
          </div>

          <div className="relative">
            {/* Navigation Buttons */}
            {items.length > 2 && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute -left-4 top-1/2 -translate-y-1/2 z-10 bg-background/80 backdrop-blur-sm hover:bg-background hover:border-accent transition-all shadow-lg"
                  onClick={handlePrevious}
                  aria-label="Previous items"
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 bg-background/80 backdrop-blur-sm hover:bg-background hover:border-accent transition-all shadow-lg"
                  onClick={handleNext}
                  aria-label="Next items"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </>
            )}

            {/* Carousel */}
            <div className="overflow-hidden">
              <div
                className="grid md:grid-cols-2 gap-6 transition-transform duration-500 ease-out"
                style={{
                  transform: `translateX(-${currentIndex * (100 / 2)}%)`,
                  width: `${(items.length / 2) * 100}%`
                }}
              >
                {items.map((item, index) => (
                  <div
                    key={item.id}
                    className="animate-fade-in"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <PortfolioCard item={item} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
