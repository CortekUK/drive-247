import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
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
  category: string;
}

interface PricingExtra {
  id: string;
  extra_name: string;
  description: string;
  price: number;
}

export default function FleetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [similarVehicles, setSimilarVehicles] = useState<Vehicle[]>([]);
  const [serviceInclusions, setServiceInclusions] = useState<ServiceInclusion[]>([]);
  const [pricingExtras, setPricingExtras] = useState<PricingExtra[]>([]);
  const [loading, setLoading] = useState(true);

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
        .select("*")
        .eq("id", id)
        .single();

      if (vehicleError) throw vehicleError;
      setVehicle(vehicleData);

      // Load similar vehicles (same make)
      if (vehicleData && vehicleData.make) {
        const { data: similarData } = await supabase
          .from("vehicles")
          .select("*")
          .eq("make", vehicleData.make)
          .neq("id", id)
          .limit(3);

        setSimilarVehicles(similarData || []);
      }

      // Load service inclusions
      const { data: inclusionsData } = await supabase
        .from("service_inclusions")
        .select("*")
        .eq("is_active", true)
        .order("display_order");

      setServiceInclusions(inclusionsData || []);

      // Load pricing extras
      const { data: extrasData } = await supabase
        .from("pricing_extras")
        .select("*")
        .eq("is_active", true);

      setPricingExtras(extrasData || []);
    } catch (error) {
      console.error("Error loading vehicle:", error);
      toast.error("Failed to load vehicle details");
    } finally {
      setLoading(false);
    }
  };

  const scrollToBooking = () => {
    const bookingSection = document.getElementById("booking");
    if (bookingSection) {
      bookingSection.scrollIntoView({ behavior: "smooth" });
    } else {
      navigate("/#booking");
    }
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
            <Link to="/fleet">Back to Fleet</Link>
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
        <section className="relative h-[70vh] min-h-[500px] overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${vehicle.photo_url || '/placeholder.svg'})`,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black" />

          <div className="relative container mx-auto px-4 h-full flex flex-col justify-between py-12">
            {/* Status Badge */}
            <div>
              {getStatusBadge()}
            </div>

            {/* Vehicle Name & CTAs */}
            <div className="mb-8">
              <h1 className="font-serif text-5xl md:text-7xl font-bold text-white mb-4">
                {vehicleName}
              </h1>
              <p className="text-xl text-white/90 mb-8 max-w-2xl">
                {vehicle.reg} • {vehicle.year || 'Modern'} • {vehicle.colour}
              </p>
              <div className="flex flex-wrap gap-4">
                <Button 
                  size="lg" 
                  onClick={scrollToBooking}
                  className="bg-accent text-accent-foreground hover:bg-accent/90"
                >
                  Book Now
                </Button>
                <Button 
                  size="lg" 
                  variant="outline"
                  asChild
                  className="border-white/30 text-white hover:bg-white/10"
                >
                  <Link to="/fleet">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to Fleet
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Vehicle Overview Section */}
        <section className="py-20 md:py-32">
          <div className="container mx-auto px-4">
            <div className="grid md:grid-cols-2 gap-12 lg:gap-16">
              {/* Left Column - Details */}
              <div>
                <h2 className="font-serif text-3xl md:text-4xl font-bold mb-6">
                  Vehicle Overview
                </h2>
                <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                  Experience unparalleled luxury and comfort with the {vehicleName}. This exceptional vehicle combines elegant design with cutting-edge technology, ensuring every journey is memorable.
                </p>

                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-accent mt-0.5" />
                    <p className="text-muted-foreground">Premium leather interior with climate control</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-accent mt-0.5" />
                    <p className="text-muted-foreground">Advanced safety systems and driver assistance</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-accent mt-0.5" />
                    <p className="text-muted-foreground">State-of-the-art entertainment and connectivity</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-accent mt-0.5" />
                    <p className="text-muted-foreground">Exceptional performance and smooth handling</p>
                  </div>
                </div>
              </div>

              {/* Right Column - Specifications */}
              <div>
                <Card className="bg-card border-accent/20">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Specifications</span>
                      {getStatusBadge()}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center">
                        <Users className="w-6 h-6 text-accent" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Registration</p>
                        <p className="font-semibold">{vehicle.reg}</p>
                      </div>
                    </div>

                    {vehicle.year && (
                      <>
                        <Separator className="bg-accent/10" />
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center">
                            <Gauge className="w-6 h-6 text-accent" />
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">Year</p>
                            <p className="font-semibold">{vehicle.year}</p>
                          </div>
                        </div>
                      </>
                    )}

                    <Separator className="bg-accent/10" />

                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center">
                        <Droplet className="w-6 h-6 text-accent" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Colour</p>
                        <p className="font-semibold">{vehicle.colour}</p>
                      </div>
                    </div>

                    <Separator className="bg-accent/10" />

                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center">
                        <Briefcase className="w-6 h-6 text-accent" />
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Status</p>
                        <p className="font-semibold">{vehicle.status}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Breakdown Section */}
        <section className="py-20 bg-accent/5">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <h2 className="font-serif text-3xl md:text-4xl font-bold mb-4 text-center">
                Pricing Breakdown
              </h2>
              <p className="text-center text-muted-foreground mb-12">
                Transparent rates with no hidden fees
              </p>

              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-accent/20 bg-accent/5">
                        <th className="text-left p-4 font-semibold">Term</th>
                        <th className="text-right p-4 font-semibold">Price</th>
                        <th className="text-left p-4 font-semibold">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-accent/10">
                        <td className="p-4 font-medium">Daily</td>
                        <td className="p-4 text-right">
                          <span className="text-2xl font-bold text-accent">£{vehicle.daily_rent}</span>
                        </td>
                        <td className="p-4 text-muted-foreground">Ideal for short-term hires</td>
                      </tr>
                      <tr className="border-b border-accent/10">
                        <td className="p-4 font-medium">Weekly</td>
                        <td className="p-4 text-right">
                          <span className="text-2xl font-bold text-accent">£{vehicle.weekly_rent}</span>
                        </td>
                        <td className="p-4 text-muted-foreground">Best value for extended use</td>
                      </tr>
                      <tr>
                        <td className="p-4 font-medium">Monthly</td>
                        <td className="p-4 text-right">
                          <span className="text-2xl font-bold text-accent">£{vehicle.monthly_rent}</span>
                        </td>
                        <td className="p-4 text-muted-foreground">Perfect for long-term luxury</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="mt-8 text-center">
                <p className="text-sm text-muted-foreground mb-4">
                  All rates include comprehensive insurance and 24/7 roadside assistance.
                </p>
                <Button variant="outline" asChild>
                  <Link to="/pricing">View All Pricing Options</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Included Services Section */}
        <section className="py-20 md:py-32">
          <div className="container mx-auto px-4">
            <h2 className="font-serif text-3xl md:text-4xl font-bold mb-4 text-center">
              What's Included with Your Rental
            </h2>
            <p className="text-center text-muted-foreground mb-16 max-w-2xl mx-auto">
              Every Drive 917 rental comes with premium services as standard
            </p>

            <div className="grid md:grid-cols-2 gap-8 lg:gap-12 max-w-5xl mx-auto">
              {/* Standard Inclusions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl">Standard Inclusions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {standardInclusions.length > 0 ? (
                    standardInclusions.map((inclusion) => (
                      <div key={inclusion.id} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                          <Check className="w-4 h-4 text-accent" />
                        </div>
                        <span className="text-muted-foreground">{inclusion.title}</span>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                          <Check className="w-4 h-4 text-accent" />
                        </div>
                        <span className="text-muted-foreground">Comprehensive Insurance</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                          <Check className="w-4 h-4 text-accent" />
                        </div>
                        <span className="text-muted-foreground">24/7 Roadside Assistance</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                          <Check className="w-4 h-4 text-accent" />
                        </div>
                        <span className="text-muted-foreground">Delivery & Collection Service</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                          <Check className="w-4 h-4 text-accent" />
                        </div>
                        <span className="text-muted-foreground">Professional Vehicle Preparation</span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Optional Add-Ons */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl">Premium Add-Ons</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {pricingExtras.length > 0 ? (
                    pricingExtras.map((extra) => (
                      <div key={extra.id} className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Check className="w-4 h-4 text-accent" />
                          </div>
                          <div>
                            <p className="text-muted-foreground">{extra.extra_name}</p>
                            {extra.description && (
                              <p className="text-xs text-muted-foreground/70 mt-1">{extra.description}</p>
                            )}
                          </div>
                        </div>
                        <span className="text-sm font-semibold text-accent whitespace-nowrap">+£{extra.price}</span>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                            <Check className="w-4 h-4 text-accent" />
                          </div>
                          <span className="text-muted-foreground">Full Insurance Cover</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                            <Check className="w-4 h-4 text-accent" />
                          </div>
                          <span className="text-muted-foreground">Additional Driver</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                            <Check className="w-4 h-4 text-accent" />
                          </div>
                          <span className="text-muted-foreground">GPS Navigation</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                            <Check className="w-4 h-4 text-accent" />
                          </div>
                          <span className="text-muted-foreground">Child Seat / Luxury Booster</span>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            <p className="text-center text-sm text-muted-foreground mt-8">
              All add-ons can be selected during booking.
            </p>
          </div>
        </section>

        {/* Similar Vehicles Section */}
        {similarVehicles.length > 0 && (
          <section className="py-20 bg-accent/5">
            <div className="container mx-auto px-4">
              <h2 className="font-serif text-3xl md:text-4xl font-bold mb-12 text-center">
                Similar {vehicle.make} Vehicles
              </h2>

              <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                {similarVehicles.map((similarVehicle) => {
                  const similarVehicleName = getVehicleName(similarVehicle);
                  return (
                    <Card
                      key={similarVehicle.id}
                      className="overflow-hidden hover:shadow-[0_10px_40px_rgba(255,215,0,0.25)] transition-all duration-300 group"
                    >
                      <div className="aspect-[16/9] overflow-hidden">
                        <img
                          src={similarVehicle.photo_url || "/placeholder.svg"}
                          alt={similarVehicleName}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      </div>
                      <CardContent className="p-6">
                        <Badge className="mb-3 bg-accent/20 text-accent border-accent/30">
                          {similarVehicle.status}
                        </Badge>
                        <h3 className="font-serif text-xl font-bold mb-2">{similarVehicleName}</h3>
                        <p className="text-2xl font-bold text-accent mb-4">
                          £{similarVehicle.daily_rent}
                          <span className="text-sm text-muted-foreground font-normal ml-1">per day</span>
                        </p>
                        <Button asChild className="w-full">
                          <Link to={`/fleet/${similarVehicle.id}`}>View Details</Link>
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
        <section className="py-20 md:py-32" id="booking">
          <div className="container mx-auto px-4">
            <Card className="bg-gradient-to-br from-accent/10 to-accent/5 border-accent/20 max-w-4xl mx-auto">
              <CardContent className="p-12 text-center">
                <h2 className="font-serif text-3xl md:text-4xl font-bold mb-4">
                  Ready to Book This Vehicle?
                </h2>
                <p className="text-lg text-muted-foreground mb-8">
                  Experience luxury from £{vehicle.daily_rent} per day
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    size="lg"
                    onClick={scrollToBooking}
                    className="bg-accent text-accent-foreground hover:bg-accent/90 text-lg px-8"
                  >
                    Book {vehicleName}
                  </Button>
                  <Button 
                    size="lg"
                    variant="outline"
                    asChild
                  >
                    <Link to="/contact">Contact Us</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <Footer />
      </div>
    </>
  );
}
