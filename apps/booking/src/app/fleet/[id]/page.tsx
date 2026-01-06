'use client'

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import SEO from "@/components/SEO";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { ArrowLeft, Users, Briefcase, Gauge, Droplet, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface VehiclePhoto {
  photo_url: string;
}

interface Vehicle {
  id: string;
  reg: string;
  make: string;
  model: string;
  year?: number;
  colour: string;
  daily_rent: number;
  weekly_rent: number;
  monthly_rent: number;
  status: string;
  vehicle_photos?: VehiclePhoto[];
  created_at?: string;
  description?: string | null;
}

interface ServiceInclusion {
  id: string;
  title: string;
  category: string;
}

interface PricingExtra {
  id: string;
  extra_name: string;
  description: string;
  price: number;
}

export default function FleetDetail() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [similarVehicles, setSimilarVehicles] = useState<Vehicle[]>([]);
  const [serviceInclusions, setServiceInclusions] = useState<ServiceInclusion[]>([]);
  const [pricingExtras, setPricingExtras] = useState<PricingExtra[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  // Description helper
  const MAX_DESCRIPTION_LENGTH = 200;

  const getDisplayDescription = () => {
    if (!vehicle?.description) return null;
    const needsTruncation = vehicle.description.length > MAX_DESCRIPTION_LENGTH;

    if (isDescriptionExpanded || !needsTruncation) {
      return vehicle.description;
    }

    return vehicle.description.substring(0, MAX_DESCRIPTION_LENGTH) + '...';
  };

  useEffect(() => {
    loadVehicleData();
  }, [id]);

  const loadVehicleData = async () => {
    if (!id) return;

    setLoading(true);
    try {
      // Load vehicle details
      const { data: vehicleData, error: vehicleError } = await supabase
        .from("vehicles")
        .select(`
          *,
          vehicle_photos (
            photo_url
          )
        `)
        .eq("id", id)
        .single();

      if (vehicleError) throw vehicleError;
      setVehicle(vehicleData as any);

      // Load similar vehicles (same make)
      if (vehicleData && vehicleData.make) {
        const { data: similarData } = await supabase
          .from("vehicles")
          .select(`
            *,
            vehicle_photos (
              photo_url
            )
          `)
          .eq("make", vehicleData.make)
          .neq("id", id)
          .limit(3);

        setSimilarVehicles(similarData as any || []);
      }

      // Load service inclusions
      const { data: inclusionsData } = await supabase
        .from("service_inclusions")
        .select("*")
        .eq("is_active", true)
        .order("display_order");

      setServiceInclusions(inclusionsData || []);
    } catch (error) {
      console.error("Error loading vehicle:", error);
      toast.error("Failed to load vehicle details");
    } finally {
      setLoading(false);
    }
  };

  const scrollToBooking = () => {
    router.push("/#booking");
  };

  const getStatusBadge = () => {
    if (!vehicle) return null;

    const statusColors: Record<string, { variant: "default" | "destructive" | "secondary"; className: string }> = {
      "Available": { variant: "default", className: "bg-green-500/20 text-green-400 border-green-500/30" },
      "Rented": { variant: "secondary", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
      "Maintenance": { variant: "destructive", className: "" },
    };

    const status = statusColors[vehicle.status] || { variant: "secondary" as const, className: "" };

    return (
      <Badge
        variant={status.variant}
        className={status.className}
      >
        {vehicle.status}
      </Badge>
    );
  };

  const getVehicleName = (vehicle: Vehicle) => {
    if (vehicle.make && vehicle.model) {
      return `${vehicle.make} ${vehicle.model}`;
    }
    return vehicle.reg;
  };

  const standardInclusions = serviceInclusions.filter(s => s.category === "standard");
  const premiumInclusions = serviceInclusions.filter(s => s.category === "premium");

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="container mx-auto px-4 py-20">
          <Skeleton className="h-[500px] w-full mb-8" />
          <div className="grid md:grid-cols-2 gap-8">
            <Skeleton className="h-[300px]" />
            <Skeleton className="h-[300px]" />
          </div>
        </div>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="container mx-auto px-4 py-20 text-center">
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-3xl font-bold mb-4">Vehicle Not Found</h1>
          <p className="text-muted-foreground mb-8">The vehicle you're looking for doesn't exist or has been removed.</p>
          <Button asChild>
            <Link href="/fleet">Back to Fleet</Link>
          </Button>
        </div>
      </div>
    );
  }

  const vehicleName = getVehicleName(vehicle);

  return (
    <>
      <SEO
        title={`${vehicleName} - Drive 917 Fleet`}
        description={`Rent the ${vehicleName} from Drive 917. Premium luxury car rental with transparent pricing.`}
      />

      <div className="min-h-screen bg-background">
        <Navigation />

        {/* Hero Section */}
        <section className="relative h-[55vh] min-h-[450px] overflow-hidden">
          {/* Background Image */}
          <div
            className="absolute inset-0 bg-cover bg-center scale-105"
            style={{
              backgroundImage: `url(${vehicle.vehicle_photos?.[0]?.photo_url || '/placeholder.svg'})`,
            }}
          />

          {/* Premium Overlay - Dark for readability over image */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/30" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />

          {/* Decorative Elements */}
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-accent/50 via-accent to-accent/50" />

          <div className="relative container mx-auto px-4 h-full flex flex-col justify-end pb-12">
            {/* Status Badge - Top */}
            <div className="absolute top-8 left-4 md:left-8">
              {vehicle.status === 'Available' ? (
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/20 border border-green-500/30 backdrop-blur-sm">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm text-green-500 dark:text-green-400 font-medium">Available Now</span>
                </span>
              ) : (
                getStatusBadge()
              )}
            </div>

            {/* Main Content */}
            <div className="max-w-3xl">
              {/* Vehicle Make Badge */}
              <p className="text-accent text-sm tracking-[0.3em] uppercase mb-3">{vehicle.make}</p>

              {/* Vehicle Name */}
              <h1 className="font-serif text-5xl md:text-6xl lg:text-7xl font-bold text-white mb-4 leading-tight">
                {vehicle.model || vehicleName}
              </h1>

              {/* Vehicle Details */}
              <div className="flex items-center gap-4 text-white/70 mb-6">
                <span className="text-sm">{vehicle.year || 'Modern'}</span>
                <span className="w-1 h-1 rounded-full bg-accent" />
                <span className="text-sm">{vehicle.colour}</span>
                <span className="w-1 h-1 rounded-full bg-accent" />
                <span className="text-sm font-mono">{vehicle.reg}</span>
              </div>

              {/* Price Preview */}
              <div className="flex items-baseline gap-2 mb-8">
                <span className="text-white/50 text-sm">From</span>
                <span className="text-3xl font-serif font-bold text-accent">${vehicle.daily_rent}</span>
                <span className="text-white/50 text-sm">/ day</span>
              </div>

              {/* CTA Buttons */}
              <div className="flex flex-wrap gap-4">
                <Button
                  size="lg"
                  onClick={scrollToBooking}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 px-8 shadow-lg shadow-accent/25 font-medium"
                >
                  Reserve Now
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="border-white/30 text-white bg-black/20 hover:bg-black/30 backdrop-blur-sm px-8"
                >
                  <Link href="/fleet">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    View All Vehicles
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Vehicle Overview Section */}
        <section className="py-12 md:py-16">
          <div className="container mx-auto px-4">
            <div className="grid md:grid-cols-2 gap-8 items-start">
              {/* Left Column - Details */}
              <div>
                <h2 className="font-serif text-xl md:text-2xl font-bold mb-4">
                  Vehicle Overview
                </h2>
                {vehicle.description ? (
                  <div className="mb-8">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {getDisplayDescription()}
                    </p>
                    {vehicle.description.length > MAX_DESCRIPTION_LENGTH && (
                      <button
                        onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                        className="mt-3 text-sm text-accent hover:text-accent/80 font-medium transition-colors"
                      >
                        {isDescriptionExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                    Experience unparalleled luxury and comfort with the {vehicleName}. This exceptional vehicle combines elegant design with cutting-edge technology, ensuring every journey is memorable.
                  </p>
                )}

                <div className="space-y-1">
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-accent mt-0.5" />
                    <p className="text-sm text-muted-foreground">Premium leather interior with climate control</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-accent mt-0.5" />
                    <p className="text-sm text-muted-foreground">Advanced safety systems and driver assistance</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-accent mt-0.5" />
                    <p className="text-sm text-muted-foreground">State-of-the-art entertainment and connectivity</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-accent mt-0.5" />
                    <p className="text-sm text-muted-foreground">Exceptional performance and smooth handling</p>
                  </div>
                </div>
              </div>

              {/* Right Column - Specifications */}
              <div>
                <Card className="bg-card border-accent/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-lg">
                      <span>Specifications</span>
                      {getStatusBadge()}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/5">
                        <Users className="w-3 h-3 text-accent" />
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Reg</p>
                          <p className="text-sm font-semibold">{vehicle.reg}</p>
                        </div>
                      </div>
                      {vehicle.year && (
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/5">
                          <Gauge className="w-3 h-3 text-accent" />
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase">Year</p>
                            <p className="text-sm font-semibold">{vehicle.year}</p>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/5">
                        <Droplet className="w-3 h-3 text-accent" />
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Colour</p>
                          <p className="text-sm font-semibold">{vehicle.colour}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/5">
                        <Briefcase className="w-3 h-3 text-accent" />
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase">Status</p>
                          <p className="text-sm font-semibold">{vehicle.status}</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section className="py-16 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-accent/10 dark:from-accent/5 via-transparent to-accent/10 dark:to-accent/5" />
          <div className="container mx-auto px-4 relative">
            <div className="max-w-4xl mx-auto">
              {/* Elegant Header */}
              <div className="text-center mb-10">
                <p className="text-accent text-sm tracking-[0.3em] uppercase mb-2">Transparent Pricing</p>
                <h2 className="font-serif text-3xl font-bold">Select Your Rate</h2>
              </div>

              {/* Premium Pricing Cards */}
              <div className="grid md:grid-cols-3 gap-6">
                {/* Daily */}
                <div className="group relative">
                  <div className="p-8 rounded-2xl border border-accent/10 bg-card dark:bg-card/50 backdrop-blur-sm text-center hover:border-accent/30 hover:shadow-[0_0_30px_-10px] hover:shadow-accent/30 transition-all duration-300">
                    <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">Daily</p>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-lg text-muted-foreground">$</span>
                      <span className="text-4xl font-serif font-bold text-foreground">{vehicle.daily_rent}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">Perfect for day trips</p>
                  </div>
                </div>

                {/* Weekly - Featured */}
                <div className="group relative -mt-2 md:-mt-4">
                  <div className="p-8 pt-10 rounded-2xl bg-card text-center border-2 border-accent shadow-[0_0_40px_-10px] shadow-accent/50">
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-accent text-accent-foreground text-[10px] tracking-[0.15em] uppercase px-4 py-1.5 rounded-full font-semibold shadow-lg">Most Popular</span>
                    </div>
                    <p className="text-xs tracking-[0.2em] uppercase text-accent mb-4">Weekly</p>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-lg text-accent">$</span>
                      <span className="text-5xl font-serif font-bold text-foreground">{vehicle.weekly_rent}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">Best value for your journey</p>
                    <div className="mt-6">
                      <Button onClick={scrollToBooking} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
                        Select Weekly
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Monthly */}
                <div className="group relative">
                  <div className="p-8 rounded-2xl border border-accent/10 bg-card dark:bg-card/50 backdrop-blur-sm text-center hover:border-accent/30 hover:shadow-[0_0_30px_-10px] hover:shadow-accent/30 transition-all duration-300">
                    <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">Monthly</p>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-lg text-muted-foreground">$</span>
                      <span className="text-4xl font-serif font-bold text-foreground">{vehicle.monthly_rent}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">Extended luxury experience</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What's Included Section */}
        <section className="py-16 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-accent/10 dark:via-accent/5 to-transparent" />
          <div className="container mx-auto px-4 relative">
            <div className="max-w-5xl mx-auto">
              {/* Header */}
              <div className="text-center mb-10">
                <p className="text-accent text-xs tracking-[0.3em] uppercase mb-2">Premium Service</p>
                <h3 className="font-serif text-2xl font-bold">Included with Every Rental</h3>
              </div>

              {/* Features Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="group p-6 rounded-2xl border border-accent/10 bg-card dark:bg-card/30 backdrop-blur-sm text-center hover:border-accent/30 transition-all duration-300">
                  <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4 group-hover:bg-accent/20 transition-colors">
                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h4 className="font-medium text-sm mb-1">Full Insurance</h4>
                  <p className="text-xs text-muted-foreground">Comprehensive coverage</p>
                </div>

                <div className="group p-6 rounded-2xl border border-accent/10 bg-card dark:bg-card/30 backdrop-blur-sm text-center hover:border-accent/30 transition-all duration-300">
                  <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4 group-hover:bg-accent/20 transition-colors">
                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h4 className="font-medium text-sm mb-1">24/7 Concierge</h4>
                  <p className="text-xs text-muted-foreground">Always available</p>
                </div>

                <div className="group p-6 rounded-2xl border border-accent/10 bg-card dark:bg-card/30 backdrop-blur-sm text-center hover:border-accent/30 transition-all duration-300">
                  <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4 group-hover:bg-accent/20 transition-colors">
                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <h4 className="font-medium text-sm mb-1">Free Delivery</h4>
                  <p className="text-xs text-muted-foreground">To your location</p>
                </div>

                <div className="group p-6 rounded-2xl border border-accent/10 bg-card dark:bg-card/30 backdrop-blur-sm text-center hover:border-accent/30 transition-all duration-300">
                  <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4 group-hover:bg-accent/20 transition-colors">
                    <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                  </div>
                  <h4 className="font-medium text-sm mb-1">Premium Detail</h4>
                  <p className="text-xs text-muted-foreground">Immaculate condition</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Similar Vehicles Section */}
        {similarVehicles.length > 0 && (
          <section className="py-10 bg-accent/10 dark:bg-accent/5">
            <div className="container mx-auto px-4">
              <h2 className="font-serif text-2xl md:text-3xl font-bold mb-8 text-center">
                Similar {vehicle.make} Vehicles
              </h2>

              <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
                {similarVehicles.map((similarVehicle) => {
                  const similarVehicleName = getVehicleName(similarVehicle);
                  return (
                    <Card
                      key={similarVehicle.id}
                      className="overflow-hidden hover:shadow-[0_10px_40px_rgba(255,215,0,0.25)] transition-all duration-300 group"
                    >
                      <div className="aspect-[16/9] overflow-hidden">
                        <img
                          src={similarVehicle.vehicle_photos?.[0]?.photo_url || "/placeholder.svg"}
                          alt={similarVehicleName}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      </div>
                      <CardContent className="p-4">
                        <Badge className="mb-2 bg-accent/20 text-accent border-accent/30">
                          {similarVehicle.status}
                        </Badge>
                        <h3 className="font-serif text-lg font-bold mb-1">{similarVehicleName}</h3>
                        <p className="text-lg font-bold text-accent mb-3">
                          ${similarVehicle.daily_rent}
                          <span className="text-sm text-muted-foreground font-normal ml-1">per day</span>
                        </p>
                        <Button asChild className="w-full">
                          <Link href={`/fleet/${similarVehicle.id}`}>View Details</Link>
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Booking CTA Section */}
        <section className="py-20 relative overflow-hidden" id="booking">
          <div className="absolute inset-0 bg-gradient-to-r from-accent/10 dark:from-accent/5 via-accent/15 dark:via-accent/10 to-accent/10 dark:to-accent/5" />
          <div className="container mx-auto px-4 relative">
            <div className="max-w-3xl mx-auto text-center">
              <p className="text-accent text-sm tracking-[0.3em] uppercase mb-4">Reserve Your Experience</p>
              <h2 className="font-serif text-4xl md:text-5xl font-bold mb-4">
                Ready to Drive?
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                The <span className="text-foreground font-medium">{vehicleName}</span> awaits you from{' '}
                <span className="text-accent font-semibold">${vehicle.daily_rent}</span> per day
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button
                  size="lg"
                  onClick={scrollToBooking}
                  className="bg-accent text-accent-foreground hover:bg-accent/90 px-10 text-base font-medium shadow-lg shadow-accent/25"
                >
                  Book {vehicleName}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="border-foreground/20 hover:bg-foreground/5 px-10 text-base"
                >
                  <Link href="/contact">Speak to Our Team</Link>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-8">
                Complimentary cancellation up to 24 hours before pickup
              </p>
            </div>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
