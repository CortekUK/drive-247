import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PortfolioGallery } from "@/components/portfolio/PortfolioGallery";
import { PortfolioCard } from "@/components/portfolio/PortfolioCard";
import { Calendar, MapPin, Clock, Car, Shield, ArrowLeft, ChevronRight, Quote, Eye, EyeOff, DollarSign } from "lucide-react";
import { format } from "date-fns";

interface PortfolioItem {
  id: string;
  title: string;
  slug: string;
  summary: string;
  full_description: string | null;
  cover_image_url: string;
  service_type: string;
  vehicle_used: string;
  location: string;
  event_date: string;
  duration: string;
  special_requirements: string;
  testimonial_quote: string | null;
  testimonial_author: string | null;
  price_range: string | null;
  gallery_images: any;
  is_featured: boolean;
}

const PortfolioDetail = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<PortfolioItem | null>(null);
  const [relatedItems, setRelatedItems] = useState<PortfolioItem[]>([]);
  const [galleryImages, setGalleryImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPrice, setShowPrice] = useState(false);

  useEffect(() => {
    if (slug) {
      fetchPortfolioItem();
    }
  }, [slug]);

  const fetchPortfolioItem = async () => {
    try {
      const { data, error } = await supabase
        .from("portfolio")
        .select("*")
        .eq("slug", slug)
        .eq("is_active", true)
        .single();

      if (error) throw error;
      setItem(data as any);

      // Fetch gallery images from portfolio_images table (including cover)
      const { data: images } = await supabase
        .from("portfolio_images")
        .select("*")
        .eq("portfolio_id", data.id)
        .eq("is_visible", true)
        .order("display_order", { ascending: true });

      setGalleryImages(images || []);

      // Fetch related items
      const { data: related } = await supabase
        .from("portfolio")
        .select("*")
        .eq("service_type", data.service_type)
        .eq("is_active", true)
        .neq("id", data.id)
        .limit(3);

      setRelatedItems(related || []);
    } catch (error) {
      console.error("Error fetching portfolio item:", error);
      navigate("/portfolio");
    } finally {
      setLoading(false);
    }
  };

  if (loading || !item) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
        <Footer />
      </>
    );
  }

  const schema = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: item.title,
    description: item.summary,
    image: item.cover_image_url,
    datePublished: item.event_date,
    locationCreated: {
      "@type": "Place",
      name: item.location,
    },
  };

  return (
    <>
      <SEO
        title={item.title}
        description={item.summary}
        keywords={`${item.service_type}, ${item.location}, luxury chauffeur, executive transport`}
        canonical={`https://10055aaf-5ac9-4da5-a157-7c78ce8e9d2c.lovableproject.com/portfolio/${item.slug}`}
        schema={schema}
      />
      <div className="min-h-screen flex flex-col bg-background">
        <Navigation />

        <main className="flex-1">
          {/* Back Button */}
          <div className="container mx-auto px-4 py-6">
            <Button 
              onClick={() => navigate("/portfolio")} 
              className="gap-2 border border-accent text-accent bg-transparent hover:bg-accent hover:text-black transition-all duration-200"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Portfolio
            </Button>
          </div>

          {/* Hero Section */}
          <section className="relative h-[50vh] md:h-[60vh] min-h-[400px] w-full overflow-hidden">
            <div className="w-full h-full overflow-hidden">
              <img
                src={item.cover_image_url}
                alt={item.title}
                className="w-full h-full object-cover hero-zoom"
                loading="eager"
              />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent pointer-events-none" />
            <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12">
              <div className="container mx-auto">
                <span className="pill-badge mb-4 inline-flex">
                  <Car className="h-3 w-3" />
                  {item.service_type === "chauffeur" ? "Chauffeur Service" : "Close Protection"}
                </span>
                <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-4 leading-tight">
                  {item.title}
                </h1>
                <div className="flex flex-wrap gap-4 text-white/80">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" strokeWidth={1.5} />
                    <span>{item.location}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" strokeWidth={1.5} />
                    <span>{format(new Date(item.event_date), "MMMM d, yyyy")}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="container mx-auto px-4 py-12">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
              {/* Main Content */}
              <div className="lg:col-span-2 space-y-8">
                {/* Summary */}
                <div className="animate-fade-in">
                  <h2 className="text-3xl font-display font-semibold section-heading">Overview</h2>
                  <p className="text-lg text-white/90 leading-relaxed">{item.summary}</p>
                </div>

                {/* Full Description */}
                {item.full_description && (
                  <div className="animate-fade-in animation-delay-100 mt-8">
                    <h2 className="text-3xl font-display font-semibold section-heading">Detailed Description</h2>
                    <p className="text-white/80 leading-relaxed whitespace-pre-line">
                      {item.full_description}
                    </p>
                  </div>
                )}

                {/* Special Requirements */}
                {item.special_requirements && (
                  <div className="animate-fade-in animation-delay-200 mt-8">
                    <h2 className="text-3xl font-display font-semibold section-heading">Service Details</h2>
                    <p className="text-white/80 leading-relaxed whitespace-pre-line">
                      {item.special_requirements}
                    </p>
                  </div>
                )}

                {/* Gallery */}
                {galleryImages.length > 0 && (
                  <div className="animate-fade-in animation-delay-400 mt-8">
                    <h2 className="text-3xl font-display font-semibold section-heading mb-6">Gallery</h2>
                    <PortfolioGallery images={galleryImages.map(img => ({
                      url: img.image_url,
                      alt: img.alt_text || item.title,
                      caption: img.caption
                    }))} />
                  </div>
                )}

                {/* Testimonial */}
                {item.testimonial_quote && (
                  <div className="animate-fade-in animation-delay-600 mt-8">
                    <Card className="card-glass border-l-2 border-l-accent/65">
                      <CardContent className="p-6">
                        <Quote className="h-5 w-5 text-accent/70 mb-3" />
                        <blockquote className="text-lg italic text-white/90 leading-relaxed mb-4">
                          "{item.testimonial_quote}"
                        </blockquote>
                        {item.testimonial_author && (
                          <p className="text-sm font-medium text-white/60">
                            — {item.testimonial_author}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                <div className="animate-fade-in animation-delay-200">
                  <Card className="card-glass sticky top-24">
                    <CardContent className="p-6">
                      <h3 className="text-xl font-display font-semibold mb-4">Project Summary</h3>
                      <dl className="space-y-4">
                        <div className="flex items-start gap-3">
                          {item.service_type === "chauffeur" ? (
                            <Car className="h-5 w-5 text-accent mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                          ) : (
                            <Shield className="h-5 w-5 text-accent mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                          )}
                          <div className="flex-1 min-w-0">
                            <dt className="text-sm text-white/55">Service Type</dt>
                            <dd className="font-medium text-white/90">
                              {item.service_type === "chauffeur" ? "Chauffeur" : "Close Protection"}
                            </dd>
                          </div>
                        </div>
                        
                        {item.vehicle_used && (
                          <div className="flex items-start gap-3">
                            <Car className="h-5 w-5 text-accent mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                            <div className="flex-1 min-w-0">
                              <dt className="text-sm text-white/55">Vehicle</dt>
                              <dd className="font-medium text-white/90">{item.vehicle_used}</dd>
                            </div>
                          </div>
                        )}
                        
                        {item.duration && (
                          <div className="flex items-start gap-3">
                            <Clock className="h-5 w-5 text-accent mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                            <div className="flex-1 min-w-0">
                              <dt className="text-sm text-white/55">Duration</dt>
                              <dd className="font-medium text-white/90">{item.duration}</dd>
                            </div>
                          </div>
                        )}
                        
                        <div className="flex items-start gap-3">
                          <MapPin className="h-5 w-5 text-accent mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                          <div className="flex-1 min-w-0">
                            <dt className="text-sm text-white/55">Location</dt>
                            <dd className="font-medium text-white/90">{item.location}</dd>
                          </div>
                        </div>
                        
                        <div className="flex items-start gap-3">
                          <Calendar className="h-5 w-5 text-accent mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                          <div className="flex-1 min-w-0">
                            <dt className="text-sm text-white/55">Date</dt>
                            <dd className="font-medium text-white/90">
                              {format(new Date(item.event_date), "MMMM d, yyyy")}
                            </dd>
                          </div>
                        </div>
                        
                        {item.price_range && (
                          <>
                            <Separator className="bg-white/8" />
                            <div className="flex items-start gap-3">
                              <DollarSign className="h-5 w-5 text-accent mt-0.5 flex-shrink-0" strokeWidth={1.5} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <dt className="text-sm text-white/55">Price Range</dt>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowPrice(!showPrice)}
                                    className="h-auto p-1 hover:bg-accent/10 text-accent"
                                  >
                                    {showPrice ? (
                                      <Eye className="h-4 w-4" />
                                    ) : (
                                      <EyeOff className="h-4 w-4" />
                                    )}
                                  </Button>
                                </div>
                                <dd className="font-medium text-white/90">
                                  {showPrice ? item.price_range : '••••••'}
                                </dd>
                              </div>
                            </div>
                          </>
                        )}
                      </dl>
                    </CardContent>
                  </Card>
                </div>

                {/* CTA Buttons */}
                <div className="space-y-3">
                  {item.service_type === "chauffeur" ? (
                    <Button asChild className="w-full" size="lg">
                      <Link to="/chauffeur-services">
                        Book Your Journey
                        <ChevronRight className="w-4 h-4 ml-2" />
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild variant="secondary" className="w-full" size="lg">
                      <Link to="/close-protection">
                        Request Consultation
                        <ChevronRight className="w-4 h-4 ml-2" />
                      </Link>
                    </Button>
                  )}
                  <Button asChild variant="outline" className="w-full">
                    <Link to="/contact">Contact Us</Link>
                  </Button>
                </div>
              </div>
            </div>

            {/* Related Items */}
            {relatedItems.length > 0 && (
              <section className="mt-20">
                <h2 className="text-3xl font-bold mb-8">Related Projects</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {relatedItems.map((relatedItem) => (
                    <PortfolioCard key={relatedItem.id} item={relatedItem} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </main>

      <div className="border-t border-white/6 pt-6">
        <Footer />
      </div>
      </div>
    </>
  );
};

export default PortfolioDetail;
