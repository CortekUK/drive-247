'use client'

import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import HeroCarousel from "@/components/HeroCarousel";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import Link from "next/link";
import SEO from "@/components/SEO";
import { usePageContent, defaultFleetContent, mergeWithDefaults, defaultFleetCarouselImages } from "@/hooks/usePageContent";
import { useBrandingSettings } from "@/hooks/useBrandingSettings";
import { createCompanyNameReplacer } from "@/utils/tenantName";
import { formatCurrency } from "@/lib/format-utils";
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
  photo_url?: string | null;
  vehicle_photos?: VehiclePhoto[];
  created_at?: string;
  description?: string | null;
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
  const { tenant } = useTenant();
  const { branding } = useBrandingSettings();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [makeFilter, setMakeFilter] = useState<string>("all");
  const [colourFilter, setColourFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("daily_asc");
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());

  // CMS Content
  const { data: rawContent } = usePageContent("fleet");
  const content = mergeWithDefaults(rawContent, defaultFleetContent);

  // Use the tenant's app_name for dynamic titles
  const appName = branding.app_name || 'Drive 247';
  const replaceCompanyName = createCompanyNameReplacer(appName);

  // Hero carousel images - use CMS images if set, otherwise use defaults
  const heroCarouselImages = content.fleet_hero?.carousel_images?.length
    ? content.fleet_hero.carousel_images
    : defaultFleetCarouselImages;

  // Hardcoded service inclusions
  const serviceInclusions: ServiceInclusion[] = [
    // Standard inclusions
    { id: '1', title: 'Comprehensive Insurance Coverage', icon_name: 'Shield', category: 'standard', display_order: 1, is_active: true },
    { id: '2', title: '24/7 Roadside Assistance', icon_name: 'Phone', category: 'standard', display_order: 2, is_active: true },
    { id: '3', title: 'Unlimited Mileage', icon_name: 'MapPin', category: 'standard', display_order: 3, is_active: true },
    { id: '4', title: 'Full Tank of Premium Fuel', icon_name: 'Fuel', category: 'standard', display_order: 4, is_active: true },
    { id: '5', title: 'Professional Vehicle Handover', icon_name: 'User', category: 'standard', display_order: 5, is_active: true },
    { id: '6', title: 'Vehicle Valeting & Cleaning', icon_name: 'Sparkles', category: 'standard', display_order: 6, is_active: true },

    // Premium add-ons
    { id: '7', title: 'Chauffeur Service (per hour)', icon_name: 'User', category: 'premium', display_order: 1, is_active: true },
    { id: '8', title: 'Airport Meet & Greet', icon_name: 'Plane', category: 'premium', display_order: 2, is_active: true },
    { id: '9', title: 'Additional Driver', icon_name: 'User', category: 'premium', display_order: 3, is_active: true },
    { id: '10', title: 'GPS Navigation System', icon_name: 'MapPin', category: 'premium', display_order: 4, is_active: true },
  ];

  // Hardcoded pricing extras
  const pricingExtras: PricingExtra[] = [
    { id: '1', extra_name: 'Child Safety Seat', price: 15, description: 'Per day', is_active: true },
    { id: '2', extra_name: 'Mobile WiFi Hotspot', price: 10, description: 'Per day', is_active: true },
    { id: '3', extra_name: 'Delivery & Collection', price: 50, description: 'Within 25 mi', is_active: true },
    { id: '4', extra_name: 'Extended Insurance', price: 25, description: 'Per day', is_active: true },
  ];

  // Description helper functions
  const MAX_DESCRIPTION_LENGTH = 150;

  const toggleDescription = (vehicleId: string) => {
    setExpandedDescriptions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(vehicleId)) {
        newSet.delete(vehicleId);
      } else {
        newSet.add(vehicleId);
      }
      return newSet;
    });
  };

  const getDisplayDescription = (vehicle: Vehicle) => {
    if (!vehicle.description) return null;
    const isExpanded = expandedDescriptions.has(vehicle.id);
    const needsTruncation = vehicle.description.length > MAX_DESCRIPTION_LENGTH;

    if (isExpanded || !needsTruncation) {
      return vehicle.description;
    }

    return vehicle.description.substring(0, MAX_DESCRIPTION_LENGTH) + '...';
  };

  useEffect(() => {
    loadVehicles();
  }, [tenant?.id]);

  const loadVehicles = async () => {
    let query = supabase
      .from("vehicles")
      .select(`
        *,
        vehicle_photos (
          photo_url,
          display_order
        )
      `)
      .order("daily_rent");

    // Add tenant filter if tenant context exists
    if (tenant?.id) {
      query = query.eq("tenant_id", tenant.id);
    }

    const { data, error } = await query;

    if (!error && data) {
      // Sort vehicle_photos by display_order for each vehicle
      const vehiclesWithSortedPhotos = data.map(vehicle => ({
        ...vehicle,
        vehicle_photos: vehicle.vehicle_photos
          ? [...vehicle.vehicle_photos].sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0))
          : []
      }));
      setVehicles(vehiclesWithSortedPhotos as any);
    } else if (error) {
      console.error("Error loading vehicles:", error);
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
        title={content.seo?.title ? replaceCompanyName(content.seo.title) : `Fleet & Pricing | ${appName} - Premium Luxury Car Rentals`}
        description={content.seo?.description ? replaceCompanyName(content.seo.description) : "Browse our exclusive fleet of luxury vehicles including Rolls-Royce, Bentley, and Range Rover. Transparent daily, weekly, and monthly rental rates with no hidden fees."}
        keywords={content.seo?.keywords ? replaceCompanyName(content.seo.keywords) : "luxury car rental pricing, Rolls-Royce rental rates, premium vehicle hire, executive car rental, Dallas luxury cars"}
      />
      <Navigation />

      {/* Hero Section with Carousel */}
      <section className="relative min-h-screen">
        <HeroCarousel
          images={heroCarouselImages}
          autoPlayInterval={5000}
          overlayStrength="medium"
          showScrollIndicator={true}
          className="min-h-screen"
        >
          {/* Hero Content */}
          <div className="flex items-center justify-center min-h-screen pt-20">
            <div className="container mx-auto px-4">
              <div className="max-w-4xl mx-auto text-center space-y-8 animate-fade-in">
                {/* Headline */}
                <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold text-white leading-tight [text-wrap:balance]">
                  {content.fleet_hero?.headline || 'Fleet & Pricing'}
                </h1>

                {/* Subheadline */}
                <p className="text-lg md:text-xl lg:text-2xl text-white/90 max-w-3xl mx-auto font-light leading-relaxed">
                  {content.fleet_hero?.subheading || 'Browse our premium vehicles with clear daily, weekly, and monthly rates.'}
                </p>

                {/* CTA Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
                  <a href="/#booking">
                    <Button size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base md:text-lg px-8 py-6 rounded-md shadow-glow hover:shadow-glow transition-all">
                      {content.fleet_hero?.primary_cta_text || 'Book Now'}
                    </Button>
                  </a>
                  <a href="#fleet-section">
                    <Button size="lg" variant="outline" className="bg-transparent border-2 border-white text-white hover:bg-white/10 hover:border-white font-semibold text-base md:text-lg px-8 py-6 rounded-md transition-all">
                      {content.fleet_hero?.secondary_cta_text || 'View Fleet Below'}
                    </Button>
                  </a>
                </div>

                {/* Trust Line */}
                <p className="text-sm md:text-base text-white/80 font-medium pt-4">
                  {content.fleet_hero?.trust_line || 'Premium Fleet • Flexible Rates • 24/7 Support'}
                </p>
              </div>
            </div>
          </div>
        </HeroCarousel>
      </section>

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
          <div className="space-y-4 mb-24">
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
                    className="group relative overflow-hidden transition-all duration-500 hover:-translate-y-1 hover:shadow-glow"
                  >
                    {/* Gradient Background */}
                    <div className="absolute inset-0 bg-gradient-to-br from-card via-card to-secondary/20 opacity-80" />

                    <div className="relative p-4 md:p-6">
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 lg:gap-6">
                        {/* Vehicle Image */}
                        {vehicle.vehicle_photos?.[0]?.photo_url || vehicle.photo_url ? (
                          <div className="w-full lg:w-48 flex-shrink-0">
                            <div className="relative aspect-[4/3] rounded-lg overflow-hidden shadow-glow border border-accent/20">
                              <img
                                src={vehicle.vehicle_photos?.[0]?.photo_url || vehicle.photo_url || ''}
                                alt={`${vehicleName} - Luxury vehicle`}
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                loading="lazy"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                            </div>
                          </div>
                        ) : (
                          <div className="hidden lg:flex w-48 aspect-[4/3] items-center justify-center rounded-lg bg-accent/10 border border-accent/20">
                            <Car className="w-12 h-12 text-accent/40" />
                          </div>
                        )}

                        {/* Left Content */}
                        <div className="flex-1 space-y-2">
                          <div className="flex items-start gap-3">
                            {!vehicle.vehicle_photos?.[0]?.photo_url && !vehicle.photo_url && (
                              <div className="lg:hidden p-2 rounded-lg bg-accent/10 border border-accent/20 group-hover:bg-accent/20 transition-colors">
                                <Car className="w-5 h-5 text-accent" />
                              </div>
                            )}
                            <div>
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-xl md:text-2xl font-display font-bold text-gradient-silver">
                                  {vehicleName}
                                </h3>
                              </div>
                              <p className="text-xs uppercase tracking-widest text-accent/80 font-medium">
                                {vehicle.reg}
                              </p>
                            </div>
                          </div>

                          {/* Vehicle Details */}
                          <div className="flex flex-wrap gap-1.5">
                            {vehicle.year && (
                              <Badge
                                variant="outline"
                                className="px-2 py-0.5 text-xs rounded-full bg-secondary/50 border-accent/30 text-foreground"
                              >
                                {vehicle.year}
                              </Badge>
                            )}
                            <Badge
                              variant="outline"
                              className="px-2 py-0.5 text-xs rounded-full bg-secondary/50 border-accent/30 text-foreground"
                            >
                              {vehicle.colour}
                            </Badge>
                            {/* Status badge with different styling for Rented */}
                            <Badge
                              variant="outline"
                              className={`px-2 py-0.5 text-xs rounded-full ${
                                vehicle.status === 'Rented'
                                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-600 dark:text-amber-400 font-medium'
                                  : vehicle.status === 'Available'
                                    ? 'bg-green-500/20 border-green-500/50 text-green-600 dark:text-green-400 font-medium'
                                    : 'bg-secondary/50 border-accent/30 text-foreground'
                              }`}
                            >
                              {vehicle.status}
                            </Badge>
                          </div>

                          {/* Description */}
                          {vehicle.description && (
                            <div className="space-y-1 mt-2">
                              <p className="text-xs text-muted-foreground leading-relaxed">
                                {getDisplayDescription(vehicle)}
                              </p>
                              {vehicle.description.length > MAX_DESCRIPTION_LENGTH && (
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    toggleDescription(vehicle.id);
                                  }}
                                  className="text-xs text-accent hover:text-accent/80 font-medium transition-colors"
                                >
                                  {expandedDescriptions.has(vehicle.id) ? 'Show less' : 'Show more'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Pricing & Actions */}
                        <div className="flex flex-col items-end gap-2">
                          <div className="flex items-center gap-3 text-right">
                            <div>
                              <div className="text-lg font-bold text-gradient-metal">{formatCurrency(vehicle.daily_rent, tenant?.currency_code || 'GBP')}</div>
                              <div className="text-[10px] text-muted-foreground">/day</div>
                            </div>
                            <div className="h-6 w-px bg-accent/20" />
                            <div>
                              <div className="text-sm font-semibold text-accent">{formatCurrency(vehicle.weekly_rent, tenant?.currency_code || 'GBP')}</div>
                              <div className="text-[10px] text-muted-foreground">/week</div>
                            </div>
                            <div className="h-6 w-px bg-accent/20" />
                            <div>
                              <div className="text-sm font-semibold text-accent/80">{formatCurrency(vehicle.monthly_rent, tenant?.currency_code || 'GBP')}</div>
                              <div className="text-[10px] text-muted-foreground">/month</div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {vehicle.status === 'Rented' ? (
                              <Button size="sm" disabled className="w-24 opacity-50 cursor-not-allowed">
                                Rented
                              </Button>
                            ) : (
                              <a href="/#booking">
                                <Button size="sm" className="gradient-accent w-24">Book Now</Button>
                              </a>
                            )}
                            <Link href={`/fleet/${vehicle.id}`}>
                              <Button size="sm" variant="outline" className="border-accent/30 w-24">Details</Button>
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
                {content.rental_rates?.section_title || "Flexible Rental Rates"}
              </h2>
              <div className="flex items-center justify-center">
                <div className="h-[1px] w-32 bg-gradient-to-r from-transparent via-accent to-transparent" />
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-8 mb-16">
              <Card className="p-8 bg-card/50 backdrop-blur shadow-metal border-accent/20 text-center group hover:shadow-glow transition-all duration-500">
                <div className="text-5xl font-display font-bold text-gradient-metal mb-4 group-hover:scale-105 transition-transform duration-300">
                  {content.rental_rates?.daily?.title || "Daily"}
                </div>
                <p className="text-muted-foreground leading-relaxed">{content.rental_rates?.daily?.description || "Ideal for short stays and one-day hires."}</p>
              </Card>
              <Card className="p-8 bg-card/50 backdrop-blur shadow-metal border-accent/20 text-center group hover:shadow-glow transition-all duration-500">
                <div className="text-5xl font-display font-bold text-gradient-metal mb-4 group-hover:scale-105 transition-transform duration-300">
                  {content.rental_rates?.weekly?.title || "Weekly"}
                </div>
                <p className="text-muted-foreground leading-relaxed">{content.rental_rates?.weekly?.description || "Perfect balance of flexibility and value."}</p>
              </Card>
              <Card className="p-8 bg-card/50 backdrop-blur shadow-metal border-accent/20 text-center group hover:shadow-glow transition-all duration-500">
                <div className="text-5xl font-display font-bold text-gradient-metal mb-4 group-hover:scale-105 transition-transform duration-300">
                  {content.rental_rates?.monthly?.title || "Monthly"}
                </div>
                <p className="text-muted-foreground leading-relaxed">{content.rental_rates?.monthly?.description || "Exclusive long-term rates for regular clients."}</p>
              </Card>
            </div>

            <div className="text-center mb-16 space-y-4">
              <h3 className="text-3xl md:text-4xl font-display font-bold text-gradient-metal">
                {content.inclusions?.section_title ? replaceCompanyName(content.inclusions.section_title) : `Every ${appName} Rental Includes`}
              </h3>
              <div className="flex items-center justify-center">
                <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
              </div>
              <p className="text-base text-muted-foreground max-w-2xl mx-auto pt-2">
                {content.inclusions?.section_subtitle || "Peace of mind and premium service come standard with every vehicle."}
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 mb-12">
              {/* Standard Service */}
              <Card className="p-8 bg-card/50 backdrop-blur shadow-metal border-accent/20">
                <div className="mb-6">
                  <h4 className="text-2xl font-display font-semibold mb-2 text-gradient-silver">{content.inclusions?.standard_title || "Standard Inclusions"}</h4>
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
                  <h4 className="text-2xl font-display font-semibold mb-2 text-gradient-silver">{content.inclusions?.premium_title || "Premium Add-ons"}</h4>
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
                      <span className="text-accent font-semibold whitespace-nowrap text-sm">{formatCurrency(extra.price, tenant?.currency_code || 'GBP')}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <p className="text-center text-sm text-muted-foreground mb-12 italic">
              {content.extras?.footer_text || "All add-ons can be selected and customized during booking."}
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
              <Link href="/booking">
                <Button size="lg" className="text-base px-8 py-6" aria-label="Start your booking">
                  Start Your Booking
                </Button>
              </Link>
              <Link href="/fleet">
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
                Every rental includes comprehensive insurance, roadside assistance, and premium support for
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
