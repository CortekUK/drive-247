import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import UniversalHero from "@/components/UniversalHero";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import SEO from "@/components/SEO";
import luxuryHero from "@/assets/luxury-fleet-hero.jpg";
import {
  Car,
  CarFront,
  Crown,
  User,
  Fuel,
  Wifi,
  Phone,
  Plane,
  Droplets,
  Clock,
  Sparkles,
  Shield,
  GlassWater,
  Wrench,
  ArrowUpDown,
  Receipt,
  Baby,
  MapPin,
  FileCheck,
} from "lucide-react";

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
  photo_url?: string | null;
  created_at?: string;
}

interface ServiceInclusion {
  id: string;
  title: string;
  icon_name: string;
  category: string;
  display_order: number;
  is_active: boolean;
}

interface PricingExtra {
  id: string;
  extra_name: string;
  price: number;
  description: string | null;
  is_active: boolean;
}

// Helper to get vehicle display name
const getVehicleName = (vehicle: Vehicle) => {
  if (vehicle.make && vehicle.model) {
    return `${vehicle.make} ${vehicle.model}`;
  }
  return vehicle.reg;
};

// Map icon names to actual icon components
const getIconComponent = (iconName: string) => {
  const icons: Record<string, any> = {
    User,
    Fuel,
    Droplets,
    Wifi,
    Plane,
    Shield,
    Clock,
    Phone,
    GlassWater,
    Sparkles,
    Car,
    Crown,
    CarFront,
    Wrench,
    Receipt,
    Baby,
    MapPin,
    FileCheck,
  };
  return icons[iconName] || Shield;
};

const Pricing = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [serviceInclusions, setServiceInclusions] = useState<ServiceInclusion[]>([]);
  const [pricingExtras, setPricingExtras] = useState<PricingExtra[]>([]);
  const [makeFilter, setMakeFilter] = useState<string>("all");
  const [colourFilter, setColourFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("daily_asc");

  useEffect(() => {
    loadVehicles();
    loadServiceInclusions();
    loadPricingExtras();
  }, []);

  const loadVehicles = async () => {
    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .order("daily_rent");

    if (!error && data) {
      setVehicles(data);
    } else if (error) {
      console.error("Error loading vehicles:", error);
    }
  };

  const loadServiceInclusions = async () => {
    const { data, error } = await supabase
      .from("service_inclusions")
      .select("*")
      .eq("is_active", true)
      .order("category, display_order");

    if (!error && data) {
      setServiceInclusions(data);
    }
  };

  const loadPricingExtras = async () => {
    const { data, error } = await supabase.from("pricing_extras").select("*").eq("is_active", true).order("price");

    if (!error && data) {
      setPricingExtras(data);
    }
  };

  const standardInclusions = serviceInclusions.filter((inc) => inc.category === "standard");
  const premiumInclusions = serviceInclusions.filter((inc) => inc.category === "premium");

  // Get unique makes and colours for filters
  const uniqueMakes = Array.from(new Set(vehicles.map(v => v.make).filter(Boolean))).sort();
  const uniqueColours = Array.from(new Set(vehicles.map(v => v.colour).filter(Boolean))).sort();

  // Filter and sort vehicles
  const filteredAndSortedVehicles = vehicles
    .filter((vehicle) => {
      // Make filter
      const makeMatch = makeFilter === "all" || vehicle.make === makeFilter;

      // Colour filter
      const colourMatch = colourFilter === "all" || vehicle.colour === colourFilter;

      return makeMatch && colourMatch;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "daily_asc":
          return a.daily_rent - b.daily_rent;
        case "daily_desc":
          return b.daily_rent - a.daily_rent;
        case "name_asc":
          return `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`);
        case "name_desc":
          return `${b.make} ${b.model}`.localeCompare(`${a.make} ${a.model}`);
        default:
          return 0;
      }
    });

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Fleet & Pricing | Drive 917 - Premium Luxury Car Rentals"
        description="Browse our exclusive fleet of luxury vehicles including Rolls-Royce, Bentley, and Range Rover. Transparent daily, weekly, and monthly rental rates with no hidden fees."
        keywords="luxury car rental pricing, Rolls-Royce rental rates, premium vehicle hire, executive car rental, London luxury cars"
      />
      <Navigation />

      {/* Hero Section */}
      <UniversalHero
        headline="Fleet & Pricing"
        subheading="Browse our premium vehicles with clear daily, weekly, and monthly rates."
        backgroundImage={luxuryHero}
        backgroundAlt="Drive 917 luxury vehicle fleet"
        overlayStrength="medium"
        minHeight="min-h-screen"
        primaryCTA={{
          text: "Book Now",
          onClick: () => {
            const bookingSection = document.getElementById("booking");
            if (bookingSection) {
              bookingSection.scrollIntoView({ behavior: "smooth" });
            } else {
              window.location.href = "/#booking";
            }
          },
        }}
        secondaryCTA={{
          text: "View Fleet Below",
          onClick: () => {
            const fleetSection = document.getElementById("fleet-section");
            if (fleetSection) {
              fleetSection.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          },
        }}
        showScrollIndicator={true}
      />

      {/* Fleet Section */}
      <section className="py-16">
        <div className="container mx-auto px-4" id="fleet-section">
          {/* Filter & Sort Controls */}
          <div className="flex flex-col sm:flex-row gap-4 mb-12 max-w-5xl mx-auto">
            <div className="flex-1">
              <Select value={makeFilter} onValueChange={setMakeFilter}>
                <SelectTrigger className="w-full bg-card/50 border-accent/20">
                  <SelectValue placeholder="Filter by Make" />
                </SelectTrigger>
                <SelectContent className="bg-card border-accent/20 z-50">
                  <SelectItem value="all">All Makes</SelectItem>
                  {uniqueMakes.map((make) => (
                    <SelectItem key={make} value={make}>
                      {make}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Select value={colourFilter} onValueChange={setColourFilter}>
                <SelectTrigger className="w-full bg-card/50 border-accent/20">
                  <SelectValue placeholder="Filter by Colour" />
                </SelectTrigger>
                <SelectContent className="bg-card border-accent/20 z-50">
                  <SelectItem value="all">All Colours</SelectItem>
                  {uniqueColours.map((colour) => (
                    <SelectItem key={colour} value={colour}>
                      {colour}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full bg-card/50 border-accent/20">
                  <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent className="bg-card border-accent/20 z-50">
                  <SelectItem value="daily_asc">Price: Low to High</SelectItem>
                  <SelectItem value="daily_desc">Price: High to Low</SelectItem>
                  <SelectItem value="name_asc">Name: A to Z</SelectItem>
                  <SelectItem value="name_desc">Name: Z to A</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Vehicle Pricing Cards */}
          <div className="space-y-8 mb-24">
            {filteredAndSortedVehicles.length === 0 ? (
              <Card className="p-12 text-center">
                <p className="text-muted-foreground text-lg">No vehicles found matching your filters.</p>
              </Card>
            ) : (
              filteredAndSortedVehicles.map((vehicle, index) => {
                const vehicleName = getVehicleName(vehicle);
                return (
                  <Card
                    key={vehicle.id}
                    className="group relative overflow-hidden transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_10px_40px_rgba(255,215,0,0.25)]"
                  >
                    {/* Gradient Background */}
                    <div className="absolute inset-0 bg-gradient-to-br from-card via-card to-secondary/20 opacity-80" />

                    <div className="relative p-8 md:p-10">
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-8">
                        {/* Vehicle Image */}
                        {vehicle.photo_url ? (
                          <div className="w-full lg:w-64 flex-shrink-0">
                            <div className="relative aspect-[4/3] rounded-lg overflow-hidden shadow-glow border border-accent/20">
                              <img
                                src={vehicle.photo_url}
                                alt={`${vehicleName} - Luxury vehicle`}
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                loading="lazy"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                            </div>
                          </div>
                        ) : (
                          <div className="hidden lg:flex w-64 aspect-[4/3] items-center justify-center rounded-lg bg-accent/10 border border-accent/20">
                            <Car className="w-16 h-16 text-accent/40" />
                          </div>
                        )}

                        {/* Left Content */}
                        <div className="flex-1 space-y-6">
                          <div className="flex items-start gap-4">
                            {!vehicle.photo_url && (
                              <div className="lg:hidden p-3 rounded-lg bg-accent/10 border border-accent/20 group-hover:bg-accent/20 transition-colors">
                                <Car className="w-6 h-6 text-accent" />
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-3xl md:text-4xl font-display font-bold text-gradient-silver">
                                  {vehicleName}
                                </h3>
                              </div>
                              <p className="text-sm uppercase tracking-widest text-accent/80 font-medium">
                                {vehicle.reg}
                              </p>
                            </div>
                          </div>

                          {/* Vehicle Details */}
                          <div className="flex flex-wrap gap-2">
                            {vehicle.year && (
                              <Badge
                                variant="outline"
                                className="px-4 py-2 rounded-full bg-secondary/50 border-accent/30 text-foreground"
                              >
                                {vehicle.year}
                              </Badge>
                            )}
                            <Badge
                              variant="outline"
                              className="px-4 py-2 rounded-full bg-secondary/50 border-accent/30 text-foreground"
                            >
                              {vehicle.colour}
                            </Badge>
                            <Badge
                              variant="outline"
                              className="px-4 py-2 rounded-full bg-secondary/50 border-accent/30 text-foreground"
                            >
                              {vehicle.status}
                            </Badge>
                          </div>
                        </div>

                        {/* Right Pricing Column */}
                        <div className="lg:text-right space-y-6 lg:min-w-[280px]">
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <div className="text-4xl font-display font-bold text-gradient-metal">
                                £{vehicle.daily_rent}
                              </div>
                              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                                per day
                              </div>
                            </div>

                            <Separator className="my-2 bg-accent/10" />

                            <div className="space-y-1">
                              <div className="text-3xl font-display font-semibold text-accent">
                                £{vehicle.weekly_rent}
                              </div>
                              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                                per week
                              </div>
                            </div>

                            <Separator className="my-2 bg-accent/10" />

                            <div className="space-y-1">
                              <div className="text-3xl font-display font-semibold text-accent/80">
                                £{vehicle.monthly_rent}
                              </div>
                              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                                per month
                              </div>
                            </div>
                          </div>

                          {/* CTA Buttons */}
                          <div className="flex flex-col gap-3 pt-4">
                            <a href="/#booking">
                              <Button className="w-full gradient-accent hover:shadow-[0_0_30px_rgba(255,215,0,0.4)] transition-all duration-300">
                                Book Now
                              </Button>
                            </a>
                            <Link to={`/fleet/${vehicle.id}`}>
                              <Button
                                variant="outline"
                                className="w-full border-accent/30 hover:bg-accent/10 hover:border-accent/50 transition-all duration-300"
                              >
                                View Details
                              </Button>
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </div>

          {/* What's Included Section */}
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal mb-4">
                Flexible Rental Rates
              </h2>
              <div className="flex items-center justify-center">
                <div className="h-[1px] w-32 bg-gradient-to-r from-transparent via-accent to-transparent" />
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-8 mb-16">
              <Card className="p-8 bg-card/50 backdrop-blur shadow-metal border-accent/20 text-center group hover:shadow-[0_0_30px_rgba(255,215,0,0.2)] transition-all duration-500">
                <div className="text-5xl font-display font-bold text-gradient-metal mb-4 group-hover:scale-105 transition-transform duration-300">
                  Daily
                </div>
                <p className="text-muted-foreground leading-relaxed">Ideal for short stays and one-day hires.</p>
              </Card>
              <Card className="p-8 bg-card/50 backdrop-blur shadow-metal border-accent/20 text-center group hover:shadow-[0_0_30px_rgba(255,215,0,0.2)] transition-all duration-500">
                <div className="text-5xl font-display font-bold text-gradient-metal mb-4 group-hover:scale-105 transition-transform duration-300">
                  Weekly
                </div>
                <p className="text-muted-foreground leading-relaxed">Perfect balance of flexibility and value.</p>
              </Card>
              <Card className="p-8 bg-card/50 backdrop-blur shadow-metal border-accent/20 text-center group hover:shadow-[0_0_30px_rgba(255,215,0,0.2)] transition-all duration-500">
                <div className="text-5xl font-display font-bold text-gradient-metal mb-4 group-hover:scale-105 transition-transform duration-300">
                  Monthly
                </div>
                <p className="text-muted-foreground leading-relaxed">Exclusive long-term rates for regular clients.</p>
              </Card>
            </div>

            <div className="text-center mb-16 space-y-4">
              <h3 className="text-3xl md:text-4xl font-display font-bold text-gradient-metal">
                Every Drive917 Rental Includes
              </h3>
              <div className="flex items-center justify-center">
                <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
              </div>
              <p className="text-base text-muted-foreground max-w-2xl mx-auto pt-2">
                Peace of mind and premium service come standard with every vehicle.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 mb-12">
              {/* Standard Service */}
              <Card className="p-8 bg-card/50 backdrop-blur shadow-metal border-accent/20">
                <div className="mb-6">
                  <h4 className="text-2xl font-display font-semibold mb-2 text-gradient-silver">Standard Inclusions</h4>
                  <div className="h-[1px] w-20 bg-gradient-to-r from-accent to-transparent" />
                </div>
                <ul className="space-y-4">
                  {standardInclusions.map((inclusion) => {
                    const IconComponent = getIconComponent(inclusion.icon_name);
                    return (
                      <li key={inclusion.id} className="flex items-start gap-3 text-muted-foreground">
                        <IconComponent className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                        <span>{inclusion.title}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>

              {/* Premium Add-ons */}
              <Card className="p-8 bg-card/50 backdrop-blur shadow-metal border-accent/20">
                <div className="mb-6">
                  <h4 className="text-2xl font-display font-semibold mb-2 text-gradient-silver">Premium Add-ons</h4>
                  <div className="h-[1px] w-20 bg-gradient-to-r from-accent to-transparent" />
                </div>
                <ul className="space-y-4">
                  {premiumInclusions.map((inclusion) => {
                    const IconComponent = getIconComponent(inclusion.icon_name);
                    return (
                      <li key={inclusion.id} className="flex items-start gap-3 text-muted-foreground">
                        <IconComponent className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                        <span>{inclusion.title}</span>
                      </li>
                    );
                  })}
                  {pricingExtras.map((extra) => (
                    <li key={extra.id} className="flex items-start justify-between gap-3 text-muted-foreground">
                      <div className="flex items-start gap-3">
                        <Sparkles className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                        <div>
                          <span className="block">{extra.extra_name}</span>
                          {extra.description && (
                            <span className="text-xs text-muted-foreground/70">{extra.description}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-accent font-semibold whitespace-nowrap text-sm">£{extra.price}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <p className="text-center text-sm text-muted-foreground mb-12 italic">
              All add-ons can be selected and customized during booking.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
              <Link to="/booking">
                <Button size="lg" className="text-base px-8 py-6" aria-label="Start your booking">
                  Start Your Booking
                </Button>
              </Link>
              <Link to="/fleet">
                <Button size="lg" variant="outline" className="text-base px-8 py-6" aria-label="View fleet and pricing">
                  View Fleet & Pricing
                </Button>
              </Link>
            </div>
          </div>

          {/* Assurance Strip */}
          <Card className="p-8 md:p-12 bg-gradient-to-br from-card via-secondary/20 to-card shadow-metal border-accent/20">
            <div className="flex flex-col md:flex-row items-center justify-center gap-8 text-center">
              <div className="flex items-center gap-6">
                <div className="p-3 rounded-full border-2 border-accent/30 bg-accent/5">
                  <Shield className="w-8 h-8 text-accent flex-shrink-0" strokeWidth={1.5} />
                </div>
                <Separator orientation="vertical" className="h-16 hidden md:block bg-accent/30" />
              </div>
              <p className="text-base md:text-lg text-muted-foreground max-w-3xl leading-relaxed">
                Every Drive917 rental includes comprehensive insurance, roadside assistance, and premium support for
                complete peace of mind.
              </p>
              <div className="flex items-center gap-6">
                <Separator orientation="vertical" className="h-16 hidden md:block bg-accent/30" />
                <div className="p-3 rounded-full border-2 border-accent/30 bg-accent/5">
                  <Wrench className="w-8 h-8 text-accent flex-shrink-0" strokeWidth={1.5} />
                </div>
                <Separator orientation="vertical" className="h-16 hidden md:block bg-accent/30" />
                <div className="p-3 rounded-full border-2 border-accent/30 bg-accent/5">
                  <Crown className="w-8 h-8 text-accent flex-shrink-0" strokeWidth={1.5} />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Pricing;
