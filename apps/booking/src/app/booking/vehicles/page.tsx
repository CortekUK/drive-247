'use client'

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";
import { toast } from "sonner";
import { useBookingStore } from "@/stores/booking-store";
import { Car, Users, Briefcase, Check, ArrowLeft, Loader2 } from "lucide-react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { formatInTimeZone } from "date-fns-tz";
import { calculateRentalPriceBreakdown, parseDateString } from "@/lib/calculate-rental-price";
import { useDynamicPricing } from "@/hooks/use-dynamic-pricing";

interface VehiclePhoto {
  photo_url: string;
}

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
  monthly_rent?: number;
  daily_rent?: number;
  weekly_rent?: number;
  vehicle_photos?: VehiclePhoto[];
}

const BookingVehiclesContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const { updateContext } = useBookingStore();
  // Tenant-level holidays for surcharge-aware price displays (no vehicleId → tenant holidays only)
  const { holidays } = useDynamicPricing();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const enquiriesEnabled = tenant?.enquiries_enabled !== false;

  // Extract booking context from URL
  const pickupDate = searchParams?.get("pickup") || "";
  const returnDate = searchParams?.get("return") || "";
  const pickupLocation = searchParams?.get("pl") || "";
  const returnLocation = searchParams?.get("rl") || "";
  const driverAge = searchParams?.get("age") || "";
  const promoCode = searchParams?.get("promo") || "";

  useEffect(() => {
    if (!pickupDate || !returnDate) {
      toast.error("Missing rental details. Redirecting...");
      router.push("/booking");
      return;
    }
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    setLoading(true);
    try {
      // Determine rental period type based on booking duration
      const days = calculateRentalDays();

      // Fetch vehicles that are Available or Rented (Rented vehicles may be available for non-overlapping dates)
      // Excludes Maintenance, Disposed, Sold etc. The overlap check below handles date-based blocking.
      let query = supabase
        .from("vehicles")
        .select(`
          *,
          vehicle_photos (
            photo_url,
            display_order
          )
        `)
        .in("status", ["Available", "Rented"]);

      // Filter by availability based on rental duration
      const mtd = tenant?.monthly_tier_days ?? 30;
      if (days >= mtd) {
        query = query.eq("available_monthly", true);
      } else if (days >= 7) {
        query = query.eq("available_weekly", true);
      } else {
        query = query.eq("available_daily", true);
      }

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query.order("monthly_rent", { ascending: true });

      if (error) throw error;

      console.log(`Loaded ${data?.length || 0} available/rented vehicles (overlap check filters by dates)`);
      console.log('First vehicle data:', data?.[0]);
      console.log('Vehicle photos:', data?.[0]?.vehicle_photos);

      let filteredData = data || [];

      // Buffer time: hide vehicles whose last completed rental ended within the buffer period
      const bufferMinutes = tenant?.buffer_time_minutes || 0;
      if (bufferMinutes > 0 && filteredData.length > 0 && tenant?.id && pickupDate) {
        const { data: rentalsData } = await supabase
          .from("rentals")
          .select("id, vehicle_id, start_date, end_date, pickup_time, dropoff_time")
          .eq("tenant_id", tenant.id)
          .eq("status", "Completed")
          .not("vehicle_id", "is", null);

        if (rentalsData && rentalsData.length > 0) {
          const bufferMs = bufferMinutes * 60 * 1000;
          const pickupDateTime = parseDateString(pickupDate);

          filteredData = filteredData.filter(vehicle => {
            const vehicleRentals = rentalsData.filter(r => r.vehicle_id === vehicle.id);
            for (const rental of vehicleRentals) {
              const rentalEnd = new Date(`${rental.end_date}T${rental.dropoff_time || '23:59'}`);
              const bufferDeadline = new Date(rentalEnd.getTime() + bufferMs);
              // If pickup falls within the buffer window after rental ended, hide it
              if (pickupDateTime < bufferDeadline && pickupDateTime >= rentalEnd) {
                return false;
              }
            }
            return true;
          });
        }
      }

      // Hide any vehicle that has a live booking (Pending, Active, or upcoming
      // reservation) regardless of dates — we don't want to show vehicles that
      // are already claimed on any non-terminal rental.
      if (tenant?.id) {
        const { data: blockedRentals } = await supabase
          .from("rentals")
          .select("vehicle_id")
          .eq("tenant_id", tenant.id)
          .not("status", "in", "(Cancelled,Rejected,Closed,Completed)");

        if (blockedRentals && blockedRentals.length > 0) {
          const blockedIds = new Set(blockedRentals.map(r => r.vehicle_id).filter(Boolean));
          filteredData = filteredData.filter(v => !blockedIds.has(v.id));
        }
      }

      // Hide vehicles manually blocked (blocked_dates) for the requested window —
      // e.g. operator marked the car as rented out on Turo. A block overlaps the
      // request when block.start <= reqEnd AND block.end >= reqStart. A block with
      // vehicle_id = null is tenant-wide and blocks every vehicle for that window.
      if (tenant?.id && pickupDate && returnDate) {
        const reqStart = pickupDate.split("T")[0];
        const reqEnd = returnDate.split("T")[0];
        const { data: overlappingBlocks } = await supabase
          .from("blocked_dates")
          .select("vehicle_id")
          .eq("tenant_id", tenant.id)
          .lte("start_date", reqEnd)
          .gte("end_date", reqStart);

        if (overlappingBlocks && overlappingBlocks.length > 0) {
          if (overlappingBlocks.some(b => !b.vehicle_id)) {
            // Tenant-wide block covering the window — nothing is bookable
            filteredData = [];
          } else {
            const blockedVehicleIds = new Set(
              overlappingBlocks.map(b => b.vehicle_id).filter(Boolean) as string[]
            );
            filteredData = filteredData.filter(v => !blockedVehicleIds.has(v.id));
          }
        }
      }

      if (filteredData.length === 0) {
        toast.info("No vehicles available at the moment");
      }

      // Sort vehicle_photos by display_order for each vehicle
      const vehiclesWithSortedPhotos = filteredData.map(vehicle => ({
        ...vehicle,
        vehicle_photos: (vehicle as any).vehicle_photos
          ? [...(vehicle as any).vehicle_photos].sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0))
          : []
      }));
      setVehicles(vehiclesWithSortedPhotos as any);
    } catch (error: any) {
      toast.error("Failed to load vehicles");
      console.error("Error loading vehicles:", error);
    } finally {
      setLoading(false);
    }
  };

  const calculateRentalDays = () => {
    const pickup = parseDateString(pickupDate);
    const dropoff = parseDateString(returnDate);
    const diffTime = Math.abs(dropoff.getTime() - pickup.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const calculatePrice = (vehicle: Vehicle) => {
    const days = calculateRentalDays();

    // If we have a rate and valid dates, compute the tier-correct,
    // surcharge-inclusive total via the shared pricing engine.
    const hasRate = vehicle.daily_rent || vehicle.weekly_rent || vehicle.monthly_rent;
    if (hasRate && pickupDate && returnDate) {
      const weekendConfig = (tenant?.weekend_surcharge_percent && tenant.weekend_surcharge_percent > 0)
        ? { weekend_surcharge_percent: tenant.weekend_surcharge_percent, weekend_days: tenant.weekend_days || [6, 0] }
        : null;
      const result = calculateRentalPriceBreakdown(
        pickupDate,
        returnDate,
        {
          daily_rent: vehicle.daily_rent || 0,
          weekly_rent: vehicle.weekly_rent || 0,
          monthly_rent: vehicle.monthly_rent || 0,
        },
        weekendConfig,
        holidays,
        // Page renders many vehicles — per-vehicle overrides aren't fetched here;
        // tenant-level weekend + holiday surcharges still apply.
        [],
        vehicle.id,
        tenant?.monthly_tier_days ?? 30
      );
      return result.rentalPrice;
    }

    // Fallback: tier-correct base rate when no dates, else estimate $50/day
    if (vehicle.monthly_rent) {
      return vehicle.monthly_rent;
    }
    return days * 50;
  };

  const handleVehicleSelect = (vehicleId: string) => {
    setSelectedVehicle(vehicleId);

    // Store in Zustand
    updateContext({ selectedVehicleId: vehicleId });

    // Navigate to checkout
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("vehicle", vehicleId);
    router.push(`/booking/checkout?${params.toString()}`);
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
              onClick={() => router.push("/booking")}
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
              <p className="text-lg text-muted-foreground mb-2">
                No vehicles available for selected dates
              </p>
              {enquiriesEnabled ? (
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Use the <strong>Submit enquiry</strong> button in the top navigation
                  and our team will reach out about availability for the car and dates
                  you'd like.
                </p>
              ) : null}
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {vehicles.map((vehicle) => (
                <Card key={vehicle.id} className="overflow-hidden hover:shadow-glow transition-all">
                  <div className="aspect-[4/3] overflow-hidden bg-muted">
                    {vehicle.vehicle_photos?.[0]?.photo_url ? (
                      <img
                        src={vehicle.vehicle_photos[0].photo_url}
                        alt={`${vehicle.make} ${vehicle.model}`}
                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Car className="w-24 h-24 text-muted-foreground/30" />
                      </div>
                    )}
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
                          {formatCurrency(calculatePrice(vehicle), tenant?.currency_code || 'USD')}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {pickupDate && returnDate ? `total / ${calculateRentalDays()} days` : 'monthly'}
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
const BookingVehicles = () => {
  return (
    <Suspense fallback={
      <>
        <Navigation />
        <main className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-12 h-12 text-accent animate-spin" />
        </main>
        <Footer />
      </>
    }>
      <BookingVehiclesContent />
    </Suspense>
  );
};

export default BookingVehicles;
