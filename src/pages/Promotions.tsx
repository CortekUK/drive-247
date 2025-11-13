import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import UniversalHero from "@/components/UniversalHero";
import SEO from "@/components/SEO";
import luxuryHero from "@/assets/promotions-hero.jpg";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Crown, Calendar, Tag, ChevronRight, Info } from "lucide-react";
import { format, isBefore, isAfter, isToday } from "date-fns";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface Promotion {
  id: string;
  title: string;
  description: string;
  discount_type: string;
  discount_value: number;
  start_date: string;
  end_date: string;
  promo_code: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
}

interface Vehicle {
  id: string;
  name: string;
}

const Promotions = () => {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filteredPromotions, setFilteredPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [vehicleFilter, setVehicleFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    filterAndSortPromotions();
  }, [promotions, statusFilter, vehicleFilter, sortBy]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load promotions
      const { data: promoData, error: promoError } = await supabase
        .from("promotions")
        .select("*")
        .order("created_at", { ascending: false });

      if (promoError) throw promoError;
      setPromotions(promoData || []);

      // Load vehicles
      const { data: vehicleData } = await supabase
        .from("vehicles")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

      setVehicles(vehicleData || []);
    } catch (error) {
      console.error("Error loading promotions:", error);
    } finally {
      setLoading(false);
    }
  };

  const getPromotionStatus = (promo: Promotion) => {
    const now = new Date();
    const start = new Date(promo.start_date);
    const end = new Date(promo.end_date);

    if (!promo.is_active) return "inactive";
    if (isAfter(now, end)) return "expired";
    if (isBefore(now, start)) return "scheduled";
    return "active";
  };

  const filterAndSortPromotions = () => {
    let filtered = [...promotions];

    // Filter by status
    filtered = filtered.filter(promo => {
      const status = getPromotionStatus(promo);
      return statusFilter === "all" || status === statusFilter;
    });

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === "newest") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      } else if (sortBy === "ending_soon") {
        return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
      }
      return 0;
    });

    setFilteredPromotions(filtered);
  };

  const handleApplyBooking = (promo: Promotion) => {
    const params = new URLSearchParams();
    if (promo.promo_code) {
      params.set("promo", promo.promo_code);
    }
    window.location.href = `/#booking?${params.toString()}`;
  };

  const getDiscountBadge = (promo: Promotion) => {
    if (promo.discount_type === "percentage") {
      return `${promo.discount_value}% OFF`;
    }
    return `$${promo.discount_value} OFF`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-accent/20 text-accent border-accent/30">Active</Badge>;
      case "scheduled":
        return <Badge variant="outline" className="border-muted-foreground/30">Scheduled</Badge>;
      case "expired":
        return <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">Expired</Badge>;
      default:
        return null;
    }
  };

  return (
    <>
      <SEO
        title="Promotions & Offers | Drive 917 - Exclusive Luxury Car Rental Deals"
        description="Exclusive deals on luxury car rentals with daily, weekly, and monthly rates. Limited-time Drive 917 offers with transparent savings."
        keywords="luxury car rental deals, car rental promotions, exclusive offers, discount car hire, Drive 917 deals"
      />
      <div className="min-h-screen flex flex-col bg-background">
        <Navigation />

        <UniversalHero
          headline={<>Promotions & Offers</>}
          subheading="Exclusive rental offers with transparent savings."
          backgroundImage={luxuryHero}
          backgroundAlt="Drive 917 luxury car rental promotions"
          overlayStrength="medium"
          primaryCTA={{
            text: "View Fleet & Pricing",
            href: "/fleet"
          }}
          secondaryCTA={{
            text: "Book Now",
            onClick: () => {
              const bookingSection = document.getElementById("booking");
              if (bookingSection) {
                bookingSection.scrollIntoView({ behavior: "smooth" });
              } else {
                window.location.href = "/#booking";
              }
            }
          }}
        />

        <main className="flex-1">
          {/* Filters */}
          <section className="py-8 border-b border-border/50">
            <div className="container mx-auto px-4">
              <div className="flex flex-col sm:flex-row gap-4 max-w-4xl mx-auto">
                <div className="flex-1">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full bg-card/50 border-accent/20">
                      <SelectValue placeholder="Filter by Status" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-accent/20 z-50">
                      <SelectItem value="all">All Offers</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="w-full bg-card/50 border-accent/20">
                      <SelectValue placeholder="Sort By" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-accent/20 z-50">
                      <SelectItem value="newest">Newest First</SelectItem>
                      <SelectItem value="ending_soon">Ending Soon</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </section>

          {/* Promotions Grid */}
          <section className="py-16">
            <div className="container mx-auto px-4">
              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="space-y-4">
                      <Skeleton className="h-64 w-full rounded-lg" />
                      <Skeleton className="h-6 w-3/4" />
                      <Skeleton className="h-4 w-full" />
                    </div>
                  ))}
                </div>
              ) : filteredPromotions.length === 0 ? (
                <div className="text-center py-16 max-w-2xl mx-auto">
                  <Crown className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-2xl font-display font-bold mb-4">
                    {statusFilter === "active" 
                      ? "No active promotions right now"
                      : "No promotions found"}
                  </h3>
                  <p className="text-muted-foreground mb-8">
                    Check back soon or browse our Fleet & Pricing.
                  </p>
                  <Button asChild size="lg">
                    <a href="/fleet">Browse Fleet & Pricing</a>
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
                  {filteredPromotions.map((promo) => {
                    const status = getPromotionStatus(promo);
                    const isActive = status === "active";
                    const isScheduled = status === "scheduled";

                    return (
                      <Card
                        key={promo.id}
                        className={`overflow-hidden transition-all duration-500 ${
                          isActive
                            ? "hover:-translate-y-2 hover:shadow-[0_10px_40px_rgba(255,215,0,0.25)] cursor-pointer"
                            : "opacity-70"
                        }`}
                      >
                        {/* Image or Placeholder */}
                        <div className="relative aspect-[16/9] overflow-hidden bg-accent/10">
                          {promo.image_url ? (
                            <img
                              src={promo.image_url}
                              alt={promo.title}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Crown className="w-16 h-16 text-accent/40" />
                            </div>
                          )}
                          
                          {/* Discount Badge */}
                          <div className="absolute top-4 right-4">
                            <Badge className="text-lg font-bold px-4 py-2 bg-accent text-accent-foreground">
                              {getDiscountBadge(promo)}
                            </Badge>
                          </div>

                          {/* Status Badge */}
                          <div className="absolute top-4 left-4">
                            {getStatusBadge(status)}
                          </div>
                        </div>

                        <CardContent className="p-6">
                          <h3 className="font-serif text-2xl font-bold mb-3">{promo.title}</h3>
                          
                          <p className="text-muted-foreground mb-4 line-clamp-2">
                            {promo.description}
                          </p>

                          {/* Date Range */}
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                            <Calendar className="w-4 h-4" />
                            <span>
                              Valid: {format(new Date(promo.start_date), "dd MMM")} – {format(new Date(promo.end_date), "dd MMM yyyy")}
                            </span>
                          </div>

                          {/* Promo Code */}
                          {promo.promo_code && (
                            <div className="flex items-center gap-2 text-sm mb-4">
                              <Tag className="w-4 h-4 text-accent" />
                              <code className="px-2 py-1 rounded bg-accent/10 text-accent font-mono font-semibold">
                                {promo.promo_code}
                              </code>
                            </div>
                          )}

                          {/* CTAs */}
                          <div className="flex gap-3 mt-6">
                            <Button
                              onClick={() => handleApplyBooking(promo)}
                              disabled={!isActive}
                              className="flex-1"
                            >
                              {isScheduled ? "Starts Soon" : isActive ? "Apply & Book" : "Offer Ended"}
                              {isActive && <ChevronRight className="w-4 h-4 ml-2" />}
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => {
                                setSelectedPromotion(promo);
                                setShowDetailsModal(true);
                              }}
                            >
                              <Info className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* How Promotions Work */}
          <section className="py-20 bg-accent/5">
            <div className="container mx-auto px-4">
              <div className="max-w-4xl mx-auto text-center mb-12">
                <h2 className="font-serif text-4xl font-bold mb-4">How Promotions Work</h2>
                <p className="text-muted-foreground">Simple steps to save on your luxury car rental</p>
              </div>

              <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                <Card className="text-center p-8">
                  <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl font-bold text-accent">1</span>
                  </div>
                  <h3 className="font-bold text-xl mb-2">Select Offer</h3>
                  <p className="text-muted-foreground">Browse active promotions and choose your preferred deal</p>
                </Card>

                <Card className="text-center p-8">
                  <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl font-bold text-accent">2</span>
                  </div>
                  <h3 className="font-bold text-xl mb-2">Choose Vehicle</h3>
                  <p className="text-muted-foreground">Select from eligible vehicles in our premium fleet</p>
                </Card>

                <Card className="text-center p-8">
                  <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl font-bold text-accent">3</span>
                  </div>
                  <h3 className="font-bold text-xl mb-2">Apply at Checkout</h3>
                  <p className="text-muted-foreground">Discount automatically applied with promo code</p>
                </Card>
              </div>
            </div>
          </section>

          {/* Fine Print */}
          <section className="py-16">
            <div className="container mx-auto px-4">
              <div className="max-w-3xl mx-auto">
                <Card className="p-8 border-accent/20">
                  <h3 className="font-bold text-xl mb-4">Terms & Conditions</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>• Promotions are subject to availability and vehicle eligibility</li>
                    <li>• Discounts cannot be combined with other offers</li>
                    <li>• Valid for new bookings only during the promotional period</li>
                    <li>• Promo codes must be applied at the time of booking</li>
                    <li>• Drive 917 reserves the right to modify or cancel promotions at any time</li>
                    <li>• Standard rental terms and conditions apply</li>
                  </ul>
                </Card>
              </div>
            </div>
          </section>
        </main>

        <Footer />
      </div>

      {/* Details Modal */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedPromotion && (
            <>
              <DialogHeader>
                <DialogTitle className="font-serif text-3xl">{selectedPromotion.title}</DialogTitle>
                <DialogDescription>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge className="bg-accent/20 text-accent border-accent/30 text-lg font-bold px-4 py-2">
                      {getDiscountBadge(selectedPromotion)}
                    </Badge>
                    {selectedPromotion.promo_code && (
                      <code className="px-3 py-2 rounded bg-accent/10 text-accent font-mono font-semibold">
                        {selectedPromotion.promo_code}
                      </code>
                    )}
                  </div>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                {selectedPromotion.image_url && (
                  <div className="aspect-video rounded-lg overflow-hidden">
                    <img
                      src={selectedPromotion.image_url}
                      alt={selectedPromotion.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <div>
                  <h4 className="font-bold mb-2">Description</h4>
                  <p className="text-muted-foreground">{selectedPromotion.description}</p>
                </div>

                <div>
                  <h4 className="font-bold mb-2">Validity Period</h4>
                  <p className="text-muted-foreground">
                    {format(new Date(selectedPromotion.start_date), "MMMM dd, yyyy")} – {format(new Date(selectedPromotion.end_date), "MMMM dd, yyyy")}
                  </p>
                </div>

                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="terms">
                    <AccordionTrigger>Terms & Conditions</AccordionTrigger>
                    <AccordionContent>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li>• This promotion is valid only during the specified dates</li>
                        <li>• Discount applies to the base rental rate only</li>
                        <li>• Cannot be combined with other promotional offers</li>
                        <li>• Subject to vehicle availability</li>
                        <li>• Standard rental terms and conditions apply</li>
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <Button
                  onClick={() => {
                    setShowDetailsModal(false);
                    handleApplyBooking(selectedPromotion);
                  }}
                  className="w-full"
                  size="lg"
                  disabled={getPromotionStatus(selectedPromotion) !== "active"}
                >
                  Apply & Book Now
                  <ChevronRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Promotions;
