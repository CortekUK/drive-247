'use client';

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Crown, Calendar, Tag, ChevronRight, Info } from "lucide-react";
import { format, isBefore, isAfter, isToday } from "date-fns";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { usePageContent, defaultPromotionsContent, mergeWithDefaults } from "@/hooks/usePageContent";
import { useBrandingSettings } from "@/hooks/useBrandingSettings";
import { createCompanyNameReplacer } from "@/utils/tenantName";

interface Promotion {
  id: string;
  title: string;
  description: string;
  discount_type: string;
  discount_value: number;
  start_date: string | null;
  end_date: string | null;
  promo_code: string | null;
  // When set, the code auto-applies by rental length — it is advertised as automatic
  // and must NOT be stashed as a manual code (that would bypass the duration gate).
  min_duration_days?: number | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  // "promo_code" = auto-generated card sourced from an active promo code
  // (so operators don't have to hand-build a banner for every code).
  source?: "promotion" | "promo_code";
}

interface Vehicle {
  id: string;
  name: string;
}

const Promotions = () => {
  const { tenant } = useTenant();
  const { branding } = useBrandingSettings();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filteredPromotions, setFilteredPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [vehicleFilter, setVehicleFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("newest");
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // CMS Content
  const { data: rawContent } = usePageContent("promotions");
  const content = mergeWithDefaults(rawContent, defaultPromotionsContent);

  // Use the tenant's app_name for dynamic titles
  const appName = branding.app_name || 'Drive 247';
  const replaceCompanyName = createCompanyNameReplacer(appName);

  useEffect(() => {
    loadData();
  }, [tenant?.id]);

  useEffect(() => {
    filterAndSortPromotions();
  }, [promotions, statusFilter, vehicleFilter, sortBy]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Promotions are driven entirely by promo codes now. A code appears here when
      // its "Show on promotions page" flag is on (and it hasn't expired). The card's
      // image, title and description are set on the code itself in Settings → Promos;
      // anything left blank falls back to friendly auto-generated copy.
      let codeQuery = (supabase as any)
        .from("promocodes")
        .select("*")
        .order("created_at", { ascending: false });

      if (tenant?.id) {
        codeQuery = codeQuery.eq("tenant_id", tenant.id);
      }

      const { data: codeData } = await codeQuery;

      const now = new Date();
      const codePromotions: Promotion[] = (codeData || [])
        .filter((c: any) => c.show_on_promotions)
        .filter((c: any) => !c.expires_at || new Date(c.expires_at) >= now)
        .map((c: any) => {
          // promocodes.type is 'percentage' or 'value' (fixed amount)
          const isPercentage = c.type !== "value";
          const value = Number(c.value) || 0;
          const amountLabel = isPercentage ? `${value}%` : `$${value}`;
          // A duration code auto-applies by rental length (no typing) — advertise it
          // as such instead of as a code to enter.
          const minDays = Number(c.min_duration_days) || 0;
          const isDuration = minDays > 0;
          const fallbackTitle = isDuration
            ? `Rent ${minDays}+ days and save ${amountLabel}`
            : c.name && c.name.trim().toLowerCase() !== (c.code || "").trim().toLowerCase()
              ? c.name
              : `Save ${amountLabel} on your rental`;
          const fallbackDesc = isDuration
            ? `Automatically applied to rentals of ${minDays} days or more — ${amountLabel} off, no code needed.`
            : `Enter code ${c.code} at checkout to get ${amountLabel} off your booking.`;

          return {
            id: `promocode-${c.id}`,
            title: (c.title && String(c.title).trim()) || fallbackTitle,
            description: (c.description && String(c.description).trim()) || fallbackDesc,
            discount_type: isPercentage ? "percentage" : "fixed",
            discount_value: value,
            start_date: c.created_at,
            end_date: c.expires_at || null,
            promo_code: c.code,
            min_duration_days: isDuration ? minDays : null,
            image_url: c.image_url || null,
            is_active: true,
            created_at: c.created_at,
            source: "promo_code",
          } as Promotion;
        });

      setPromotions(codePromotions);

      // Load vehicles with tenant filtering
      let vehicleQuery = supabase
        .from("vehicles")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

      if (tenant?.id) {
        vehicleQuery = vehicleQuery.eq("tenant_id", tenant.id);
      }

      const { data: vehicleData } = await vehicleQuery;

      setVehicles(vehicleData || []);
    } catch (error) {
      console.error("Error loading promotions:", error);
    } finally {
      setLoading(false);
    }
  };

  const getPromotionStatus = (promo: Promotion) => {
    const now = new Date();
    if (!promo.is_active) return "inactive";
    const start = promo.start_date ? new Date(promo.start_date) : null;
    const end = promo.end_date ? new Date(promo.end_date) : null;
    if (end && isAfter(now, end)) return "expired";
    if (start && isBefore(now, start)) return "scheduled";
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

  const handleApplyBooking = async (promo: Promotion) => {
    if (typeof window === "undefined") return;

    // The home-page booking widget is the only booking flow. It restores any
    // applied promo from localStorage on mount, so we stash the (validated) code
    // there and send the customer home — never into the deprecated /booking pages.
    //
    // Duration codes are the exception: they apply automatically based on rental
    // length. Stashing one as a manual code would bypass the duration gate (e.g. give
    // a 14-day discount on a 3-day booking), so we just send the customer to the
    // widget and let its auto-apply pick the right tier from the actual dates.
    if (promo.promo_code && !promo.min_duration_days) {
      const { data } = await (supabase as any)
        .from("promocodes")
        .select("*")
        .ilike("code", promo.promo_code)
        .eq("tenant_id", tenant?.id)
        .maybeSingle();

      if (data && (!data.expires_at || new Date(data.expires_at) >= new Date())) {
        const promoDetails = {
          code: data.code,
          type: data.type === "value" ? "fixed_amount" : "percentage",
          value: Number(data.value) || 0,
          id: data.id,
        };
        localStorage.setItem("appliedPromoCode", promoDetails.code);
        localStorage.setItem("appliedPromoDetails", JSON.stringify(promoDetails));
      }
    }

    window.location.href = "/";
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
        title={content.seo?.title ? replaceCompanyName(content.seo.title) : `Promotions & Offers | ${appName} - Exclusive Luxury Car Rental Deals`}
        description={content.seo?.description ? replaceCompanyName(content.seo.description) : `Exclusive deals on luxury car rentals with daily, weekly, and monthly rates. Limited-time ${appName} offers with transparent savings.`}
        keywords={content.seo?.keywords ? replaceCompanyName(content.seo.keywords) : `luxury car rental deals, car rental promotions, exclusive offers, discount car hire, ${appName} deals`}
      />
      <div className="min-h-screen flex flex-col bg-background">
        <Navigation />

        <main className="flex-1 pt-20">
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
          <section className="py-8 sm:py-12 md:py-16">
            <div className="container mx-auto px-4">
              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8 max-w-7xl mx-auto">
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
                      ? (content.empty_state?.title_active || "No active promotions right now")
                      : (content.empty_state?.title_default || "No promotions found")}
                  </h3>
                  <p className="text-muted-foreground mb-8">
                    {content.empty_state?.description || "Check back soon or browse our Fleet & Pricing."}
                  </p>
                  <Button asChild size="lg">
                    <a href="/fleet">{content.empty_state?.button_text || "Browse Fleet & Pricing"}</a>
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8 max-w-7xl mx-auto">
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

                        <CardContent className="p-4 sm:p-5 md:p-6">
                          <h3 className="font-serif text-lg sm:text-xl md:text-2xl font-bold mb-2 sm:mb-3 break-words">{promo.title}</h3>

                          <p className="text-sm sm:text-base text-muted-foreground mb-3 sm:mb-4 line-clamp-2 whitespace-pre-line">
                            {promo.description}
                          </p>

                          {/* Date Range */}
                          <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
                            <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                            <span>
                              {promo.start_date && promo.end_date
                                ? `Valid: ${format(new Date(promo.start_date), "MMM dd")} – ${format(new Date(promo.end_date), "MMM dd, yyyy")}`
                                : promo.end_date
                                  ? `Valid until ${format(new Date(promo.end_date), "MMM dd, yyyy")}`
                                  : "Available now — no expiry"}
                            </span>
                          </div>

                          {/* Promo Code */}
                          {promo.promo_code && (
                            <div className="flex items-center gap-2 text-sm mb-3 sm:mb-4">
                              <Tag className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent shrink-0" />
                              <code className="px-2 py-1 rounded bg-accent/10 text-accent font-mono font-semibold text-xs sm:text-sm break-all">
                                {promo.promo_code}
                              </code>
                            </div>
                          )}

                          {/* CTAs */}
                          <div className="flex gap-2 sm:gap-3 mt-4 sm:mt-6">
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
          <section className="py-10 sm:py-14 md:py-20 bg-accent/5">
            <div className="container mx-auto px-4">
              <div className="max-w-4xl mx-auto text-center mb-8 sm:mb-10 md:mb-12">
                <h2 className="font-serif text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">
                  {content.how_it_works?.title || "How Promotions Work"}
                </h2>
                <p className="text-sm sm:text-base text-muted-foreground">
                  {content.how_it_works?.subtitle || "Simple steps to save on your luxury car rental"}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 md:gap-8 max-w-5xl mx-auto">
                {(content.how_it_works?.steps && content.how_it_works.steps.length > 0
                  ? content.how_it_works.steps
                  : [
                      { number: "1", title: "Select Offer", description: "Browse active promotions and choose your preferred deal" },
                      { number: "2", title: "Choose Vehicle", description: "Select from eligible vehicles in our premium fleet" },
                      { number: "3", title: "Apply at Checkout", description: "Discount automatically applied with promo code" },
                    ]
                ).map((step, index) => (
                  <Card key={index} className="text-center p-5 sm:p-6 md:p-8">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-3 sm:mb-4">
                      <span className="text-2xl sm:text-3xl font-bold text-accent">{step.number}</span>
                    </div>
                    <h3 className="font-bold text-base sm:text-lg md:text-xl mb-1.5 sm:mb-2">{step.title}</h3>
                    <p className="text-sm sm:text-base text-muted-foreground">{step.description}</p>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          {/* Fine Print */}
          <section className="py-8 sm:py-12 md:py-16">
            <div className="container mx-auto px-4">
              <div className="max-w-3xl mx-auto">
                <Card className="p-5 sm:p-6 md:p-8 border-accent/20">
                  <h3 className="font-bold text-xl mb-4">
                    {content.terms?.title || "Terms & Conditions"}
                  </h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {(content.terms?.terms && content.terms.terms.length > 0
                      ? content.terms.terms
                      : [
                          "Promotions are subject to availability and vehicle eligibility",
                          "Discounts cannot be combined with other offers",
                          "Valid for new bookings only during the promotional period",
                          "Promo codes must be applied at the time of booking",
                          "Drive 917 reserves the right to modify or cancel promotions at any time",
                          "Standard rental terms and conditions apply",
                        ]
                    ).map((term, index) => (
                      <li key={index}>• {term}</li>
                    ))}
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
                <DialogDescription className="sr-only">
                  Promotion details for {selectedPromotion.title}
                </DialogDescription>
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
                  <p className="text-muted-foreground whitespace-pre-line">{selectedPromotion.description}</p>
                </div>

                <div>
                  <h4 className="font-bold mb-2">Validity Period</h4>
                  <p className="text-muted-foreground">
                    {selectedPromotion.start_date && selectedPromotion.end_date
                      ? `${format(new Date(selectedPromotion.start_date), "MMMM dd, yyyy")} – ${format(new Date(selectedPromotion.end_date), "MMMM dd, yyyy")}`
                      : selectedPromotion.end_date
                        ? `Valid until ${format(new Date(selectedPromotion.end_date), "MMMM dd, yyyy")}`
                        : "Available now — no expiry"}
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
