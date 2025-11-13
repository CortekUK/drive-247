import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Car, Users, Briefcase, Check, ArrowLeft } from "lucide-react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { formatInTimeZone } from "date-fns-tz";

interface Vehicle {
  id: string;
  // Portal schema fields
  reg: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  acquisition_type: string | null;
  purchase_price: number | null;
  acquisition_date: string | null;
  status: string;
  created_at: string;
  // Optional fields that might exist
  monthly_rate?: number;
  daily_rate?: number;
  weekly_rate?: number;
}

const BookingVehicles = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);

  // Extract booking context from URL
  const pickupDate = searchParams.get("pickup") || "";
  const returnDate = searchParams.get("return") || "";
  const pickupLocation = searchParams.get("pl") || "";
  const returnLocation = searchParams.get("rl") || "";
  const driverAge = searchParams.get("age") || "";
  const promoCode = searchParams.get("promo") || "";

  useEffect(() => {
    if (!pickupDate || !returnDate) {
      toast.error("Missing rental details. Redirecting...");
      navigate("/booking");
      return;
    }
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    setLoading(true);
    try {
      // Fetch only vehicles with status "Available" (not rented, not in maintenance)
      const { data, error } = await supabase
        .from("vehicles")
        .select("*")
        .eq("status", "Available")
        .order("monthly_rate", { ascending: true });

      if (error) throw error;

      console.log(`Loaded ${data?.length || 0} available (non-rented) vehicles`);

      if (!data || data.length === 0) {
        toast.info("No vehicles available at the moment");
      }

      setVehicles(data || []);
    } catch (error: any) {
      toast.error("Failed to load vehicles");
      console.error("Error loading vehicles:", error);
    } finally {
      setLoading(false);
    }
  };

  const calculateRentalDays = () => {
    const pickup = new Date(pickupDate);
    const dropoff = new Date(returnDate);
    const diffTime = Math.abs(dropoff.getTime() - pickup.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const calculatePrice = (vehicle: Vehicle) => {
    const days = calculateRentalDays();
    // Use monthly_rate if available, otherwise estimate
    if (vehicle.monthly_rate) {
      return vehicle.monthly_rate;
    }
    // Fallback: estimate $50/day if no rate exists
    return days * 50;
  };

  const handleVehicleSelect = (vehicleId: string) => {
    setSelectedVehicle(vehicleId);
    
    // Store in localStorage
    const bookingContext = {
      pickupDate,
      returnDate,
      pickupLocation,
      returnLocation,
      driverAge,
      promoCode,
      vehicleId
    };
    localStorage.setItem("booking_context", JSON.stringify(bookingContext));

    // Navigate to checkout
    const params = new URLSearchParams(searchParams);
    params.set("vehicle", vehicleId);
    navigate(`/booking/checkout?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Select Your Vehicle | Drive 917"
        description="Choose from our premium fleet of luxury vehicles in Los Angeles"
      />
      <Navigation />
      
      <div className="pt-24 pb-16 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Progress Bar */}
          <div className="mb-12">
            <div className="flex items-center justify-between max-w-2xl mx-auto mb-8">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center">
                  <Check className="w-4 h-4 text-accent" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Rental Details</span>
              </div>
              <div className="flex-1 h-0.5 bg-accent/30 mx-4" />
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-accent border-2 border-accent flex items-center justify-center text-background font-semibold text-sm">
                  2
                </div>
                <span className="text-sm font-medium">Select Vehicle</span>
              </div>
              <div className="flex-1 h-0.5 bg-border mx-4" />
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-muted border-2 border-border flex items-center justify-center text-muted-foreground text-sm">
                  3
                </div>
                <span className="text-sm font-medium text-muted-foreground">Extras & Payment</span>
              </div>
            </div>
          </div>

          {/* Header */}
          <div className="text-center mb-12">
            <Button
              variant="ghost"
              onClick={() => navigate("/booking")}
              className="mb-6"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Rental Details
            </Button>
            <h1 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal mb-4">
              Select Your Vehicle
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {pickupLocation && `${pickupLocation} • `}
              {pickupDate && returnDate && `${calculateRentalDays()} days`}
            </p>
          </div>

          {/* Vehicle Grid */}
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto" />
              <p className="mt-4 text-muted-foreground">Loading vehicles...</p>
            </div>
          ) : vehicles.length === 0 ? (
            <Card className="p-12 text-center">
              <Car className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg text-muted-foreground">No vehicles available for selected dates</p>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {vehicles.map((vehicle) => (
                <Card key={vehicle.id} className="overflow-hidden hover:shadow-glow transition-all">
                  <div className="aspect-[4/3] overflow-hidden bg-muted flex items-center justify-center">
                    <Car className="w-24 h-24 text-muted-foreground/30" />
                  </div>
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-xs text-accent uppercase tracking-wider font-medium mb-1">
                          {vehicle.reg}
                        </p>
                        <h3 className="text-xl font-semibold">
                          {vehicle.make && vehicle.model
                            ? `${vehicle.make} ${vehicle.model}`
                            : vehicle.make || vehicle.model || 'Vehicle'}
                        </h3>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                      {vehicle.colour && (
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Colour:</span>
                          <span>{vehicle.colour}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <span className="font-medium">Status:</span>
                        <span className="text-green-600">{vehicle.status}</span>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-border">
                      <div className="flex items-baseline justify-between mb-4">
                        <span className="text-2xl font-bold text-accent">
                          ${calculatePrice(vehicle).toLocaleString()}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          monthly
                        </span>
                      </div>
                      <Button
                        className="w-full"
                        onClick={() => handleVehicleSelect(vehicle.id)}
                      >
                        Select Vehicle
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default BookingVehicles;
