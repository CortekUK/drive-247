'use client'

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { format, addDays, differenceInHours, differenceInDays, parseISO } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { CalendarIcon, MapPin, Clock, ChevronRight, AlertCircle, Loader2, Truck, RotateCcw, Car } from "lucide-react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import LocationAutocomplete from "@/components/LocationAutocomplete";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTenant } from "@/contexts/TenantContext";
import { useDeliveryLocations, type DeliveryLocation } from "@/hooks/useDeliveryLocations";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useBookingStore } from "@/stores/booking-store";
import { formatCurrency, kmToDisplayUnit, getDistanceUnitShort } from "@/lib/format-utils";
import type { DistanceUnit } from "@/lib/format-utils";

const TIMEZONE = "America/Los_Angeles";
const MIN_RENTAL_DAYS = 30;
const MAX_RENTAL_DAYS = 90;

// Helper to calculate age from DOB
const calculateAge = (dob: Date): number => {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
};

// Create form schema with dynamic minimum age
const createRentalDetailsSchema = (minimumAge: number = 18) => z.object({
  pickupLocation: z.string().min(5, "Please enter a valid pickup location"),
  returnLocation: z.string().min(5, "Please enter a valid return location"),
  sameAsPickup: z.boolean(),
  pickupDate: z.date({ required_error: "Pickup date is required" }),
  pickupTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format"),
  returnDate: z.date({ required_error: "Return date is required" }),
  returnTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format"),
  driverDOB: z.date({
    required_error: "Date of birth is required"
  }).refine((date) => {
    return calculateAge(date) >= minimumAge;
  }, {
    message: `You must be at least ${minimumAge} years old to rent a vehicle`
  }),
  promoCode: z.string().optional(),
  // Customer fields
  customerName: z.string().min(2, "Name must be at least 2 characters"),
  customerEmail: z.string().email("Please enter a valid email address"),
  customerPhone: z.string().regex(/^[\d\s\-\+\(\)]{10,}$/, "Please enter a valid phone number (min 10 digits)"),
  customerType: z.enum(["Individual", "Company"], {
    required_error: "Please select customer type"
  }),
}).refine((data) => {
  // Combine date and time for comparison
  const pickup = new Date(`${format(data.pickupDate, "yyyy-MM-dd")}T${data.pickupTime}`);
  const returnDt = new Date(`${format(data.returnDate, "yyyy-MM-dd")}T${data.returnTime}`);
  const daysDiff = differenceInDays(returnDt, pickup);
  return daysDiff >= MIN_RENTAL_DAYS;
}, {
  message: `Minimum rental period is ${MIN_RENTAL_DAYS} days (1 month)`,
  path: ["returnDate"]
}).refine((data) => {
  const pickup = new Date(`${format(data.pickupDate, "yyyy-MM-dd")}T${data.pickupTime}`);
  const returnDt = new Date(`${format(data.returnDate, "yyyy-MM-dd")}T${data.returnTime}`);
  const daysDiff = differenceInDays(returnDt, pickup);
  return daysDiff <= MAX_RENTAL_DAYS;
}, {
  message: `Maximum rental period is ${MAX_RENTAL_DAYS} days`,
  path: ["returnDate"]
});

// Default schema for type inference
const defaultSchema = createRentalDetailsSchema(18);
type RentalDetailsForm = z.infer<typeof defaultSchema>;

export default function Booking() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const { context: bookingContext, updateContext } = useBookingStore();
  const [sameAsPickup, setSameAsPickup] = useState(true);

  // Delivery option state: 'fixed' | 'location' | 'area' | null
  const { locations: deliveryLocations, isLoading: isLoadingDeliveryLocations } = useDeliveryLocations();
  const [deliveryOption, setDeliveryOption] = useState<'fixed' | 'location' | 'area' | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  // Legacy state for backward compatibility during transition
  const [requestDelivery, setRequestDelivery] = useState(false);
  const [deliveryLocationId, setDeliveryLocationId] = useState<string | null>(null);
  const [requestCollection, setRequestCollection] = useState(false);
  const [collectionLocationId, setCollectionLocationId] = useState<string | null>(null);

  // Create schema with tenant's minimum age
  const minimumAge = tenant?.minimum_rental_age || 18;
  const rentalDetailsSchema = createRentalDetailsSchema(minimumAge);

  const form = useForm<RentalDetailsForm>({
    resolver: zodResolver(rentalDetailsSchema),
    defaultValues: {
      pickupLocation: "",
      returnLocation: "",
      sameAsPickup: true,
      pickupDate: addDays(new Date(), 1),
      pickupTime: "10:00",
      returnDate: addDays(new Date(), 2),
      returnTime: "10:00",
      driverDOB: undefined,
      promoCode: "",
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      customerType: undefined,
    },
  });

  // Load from Zustand store on mount
  useEffect(() => {
    if (bookingContext.pickupDate || bookingContext.pickupLocation) {
      // Restore form from store
      const formData: any = {};
      if (bookingContext.pickupDate) formData.pickupDate = parseISO(bookingContext.pickupDate);
      if (bookingContext.returnDate) formData.returnDate = parseISO(bookingContext.returnDate);
      if (bookingContext.pickupTime) formData.pickupTime = bookingContext.pickupTime;
      if (bookingContext.returnTime) formData.returnTime = bookingContext.returnTime;
      if (bookingContext.pickupLocation) formData.pickupLocation = bookingContext.pickupLocation;
      if (bookingContext.returnLocation) formData.returnLocation = bookingContext.returnLocation;
      if (bookingContext.driverDOB) formData.driverDOB = parseISO(bookingContext.driverDOB);
      if (bookingContext.promoCode) formData.promoCode = bookingContext.promoCode;
      formData.sameAsPickup = bookingContext.sameAsPickup;

      form.reset(formData);
      setSameAsPickup(bookingContext.sameAsPickup);

      // Load delivery option state
      if (bookingContext.deliveryOption) {
        setDeliveryOption(bookingContext.deliveryOption);
        setSelectedLocationId(bookingContext.selectedLocationId ?? null);
      } else if (bookingContext.requestDelivery) {
        // Legacy data migration
        setDeliveryOption('location');
        setSelectedLocationId(bookingContext.deliveryLocationId ?? null);
      }
      // Load legacy state for backward compatibility
      setRequestDelivery(bookingContext.requestDelivery ?? false);
      setDeliveryLocationId(bookingContext.deliveryLocationId ?? null);
      setRequestCollection(bookingContext.requestCollection ?? false);
      setCollectionLocationId(bookingContext.collectionLocationId ?? null);
    }

    // Also check URL params
    const pl = searchParams?.get("pl");
    const rl = searchParams?.get("rl");
    if (pl) form.setValue("pickupLocation", pl);
    if (rl) form.setValue("returnLocation", rl);
  }, [searchParams]);

  // Watch sameAsPickup toggle
  const watchSameAsPickup = form.watch("sameAsPickup");
  useEffect(() => {
    setSameAsPickup(watchSameAsPickup);
    if (watchSameAsPickup) {
      const pickup = form.getValues("pickupLocation");
      form.setValue("returnLocation", pickup);
    }
  }, [watchSameAsPickup]);

  // Sync returnLocation when pickup changes and sameAsPickup is true
  const watchPickupLocation = form.watch("pickupLocation");
  useEffect(() => {
    if (sameAsPickup) {
      form.setValue("returnLocation", watchPickupLocation);
    }
  }, [watchPickupLocation, sameAsPickup]);

  const onSubmit = (data: RentalDetailsForm) => {
    // Validate delivery location selection if 'location' option is chosen
    if (deliveryOption === 'location' && !selectedLocationId) {
      toast.error("Please select a delivery location");
      return;
    }

    // Calculate age from DOB
    const calculateAge = (dob: Date): number => {
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
      }
      return age;
    };
    const driverAge = data.driverDOB ? calculateAge(data.driverDOB) : 0;

    // Build query params
    const params = new URLSearchParams({
      pickup: format(data.pickupDate, "yyyy-MM-dd"),
      pickupTime: data.pickupTime,
      return: format(data.returnDate, "yyyy-MM-dd"),
      returnTime: data.returnTime,
      pl: data.pickupLocation,
      rl: data.returnLocation,
      dob: data.driverDOB ? format(data.driverDOB, "yyyy-MM-dd") : "",
    });

    if (data.promoCode) {
      params.set("promo", data.promoCode);
    }

    // Get selected location object if applicable
    const selectedLocation = deliveryLocations.find(l => l.id === selectedLocationId) || null;

    // Calculate delivery fee based on option
    const calculateDeliveryFee = () => {
      if (deliveryOption === 'location' && selectedLocation) {
        return selectedLocation.delivery_fee || 0;
      }
      if (deliveryOption === 'area') {
        return tenant?.area_delivery_fee || 0;
      }
      return 0;
    };

    // Save to Zustand store
    updateContext({
      pickupDate: data.pickupDate.toISOString(),
      returnDate: data.returnDate.toISOString(),
      pickupTime: data.pickupTime,
      returnTime: data.returnTime,
      pickupLocation: data.pickupLocation,
      returnLocation: data.returnLocation,
      sameAsPickup: data.sameAsPickup,
      driverDOB: data.driverDOB ? data.driverDOB.toISOString() : null,
      driverAge: driverAge,
      promoCode: data.promoCode || null,
      // Delivery option data
      deliveryOption: deliveryOption || 'fixed',
      selectedLocationId,
      selectedLocation: selectedLocation ? {
        id: selectedLocation.id,
        name: selectedLocation.name,
        address: selectedLocation.address,
        delivery_fee: selectedLocation.delivery_fee,
      } : null,
      deliveryFee: calculateDeliveryFee(),
      // Legacy fields for backward compatibility
      requestDelivery: deliveryOption === 'location' || deliveryOption === 'area',
      deliveryLocationId: selectedLocationId,
      deliveryLocation: selectedLocation ? {
        id: selectedLocation.id,
        name: selectedLocation.name,
        address: selectedLocation.address,
        delivery_fee: selectedLocation.delivery_fee,
      } : null,
      requestCollection: false,
      collectionLocationId: null,
      collectionLocation: null,
    });

    // Analytics event
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag("event", "booking_step1_submitted", {
        pickup_location: data.pickupLocation,
        return_location: data.returnLocation,
        driver_age: driverAge,
        has_promo: !!data.promoCode,
      });
    }

    toast.success("Rental details saved. Loading available vehicles...");

    // Navigate to vehicles step
    router.push(`/booking/vehicles?${params.toString()}`);
  };

  const pickupDate = form.watch("pickupDate");
  const returnDate = form.watch("returnDate");
  const pickupTime = form.watch("pickupTime");
  const returnTime = form.watch("returnTime");

  // Calculate rental duration
  const rentalDurationContent = () => {
    if (!pickupDate || !returnDate || !pickupTime || !returnTime) return null;

    try {
      const pickup = new Date(`${format(pickupDate, "yyyy-MM-dd")}T${pickupTime}`);
      const returnDt = new Date(`${format(returnDate, "yyyy-MM-dd")}T${returnTime}`);
      const days = differenceInDays(returnDt, pickup);

      if (days < MIN_RENTAL_DAYS) {
        return { valid: false, text: `Min ${MIN_RENTAL_DAYS} days required`, days };
      }
      if (days > MAX_RENTAL_DAYS) {
        return { valid: false, text: `Max ${MAX_RENTAL_DAYS} days`, days };
      }

      return {
        valid: true,
        text: `${days} days`,
        days
      };
    } catch (e) {
      return null;
    }
  };

  const duration = rentalDurationContent();

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Rental Booking — Drive 247"
        description="Book your luxury vehicle rental with Drive 247. Choose pickup and return details for premium cars in Los Angeles."
        keywords="luxury car rental booking, Los Angeles car rental, premium vehicle booking"
        canonical={typeof window !== 'undefined' ? `${window.location.origin}/booking` : 'https://drive247.com/booking'}
      />
      <Navigation />

      <section className="pt-32 pb-24">
        <div className="container mx-auto px-4">
          {/* Progress Header */}
          <div className="max-w-5xl mx-auto mb-12">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-accent text-accent-foreground font-bold">
                  1
                </div>
                <span className="text-lg font-semibold text-foreground">Rental Details</span>
              </div>
              <ChevronRight className="text-muted-foreground" />
              <div className="flex items-center gap-3 opacity-50">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-muted">
                  2
                </div>
                <span className="text-lg font-medium text-muted-foreground">Vehicles</span>
              </div>
              <ChevronRight className="text-muted-foreground opacity-50" />
              <div className="flex items-center gap-3 opacity-50">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-muted">
                  3
                </div>
                <span className="text-lg font-medium text-muted-foreground">Extras & Payment</span>
              </div>
            </div>

            <h1 className="text-4xl md:text-5xl font-display font-bold text-gradient-metal mb-4">
              Plan Your Rental
            </h1>
            <p className="text-lg text-muted-foreground">
              Enter your rental details to view available luxury vehicles in Los Angeles.
            </p>
          </div>

          {/* Two Column Layout */}
          <div className="max-w-5xl mx-auto grid lg:grid-cols-3 gap-8">
            {/* Left Column - Form */}
            <div className="lg:col-span-2">
              <Card className="p-8 shadow-metal border-accent/20">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    {/* Pickup & Return Options - NEW UI */}
                    {(() => {
                      // Check which options are enabled
                      const fixedEnabled = tenant?.fixed_address_enabled ?? true;
                      const multipleEnabled = tenant?.multiple_locations_enabled && deliveryLocations.length > 0;
                      const areaEnabled = tenant?.area_around_enabled;

                      // Count enabled options
                      const enabledCount = [fixedEnabled, multipleEnabled, areaEnabled].filter(Boolean).length;

                      // If multiple options are available, show the selection UI
                      const showDeliveryOptions = enabledCount > 1 || multipleEnabled || areaEnabled;

                      const currencyCode = tenant?.currency_code || 'GBP';
                      const distanceUnit = (tenant?.distance_unit || 'miles') as DistanceUnit;
                      const fmtCurrency = (amount: number) => formatCurrency(amount, currencyCode);

                      // Calculate delivery fee based on selected option
                      const getDeliveryFee = () => {
                        if (deliveryOption === 'location' && selectedLocationId) {
                          const location = deliveryLocations.find(l => l.id === selectedLocationId);
                          return location?.delivery_fee || 0;
                        }
                        if (deliveryOption === 'area') {
                          return tenant?.area_delivery_fee || 0;
                        }
                        return 0;
                      };

                      const deliveryFee = getDeliveryFee();

                      if (!showDeliveryOptions) {
                        // Only fixed address enabled - show simple location input
                        return (
                          <>
                            {/* Pickup Location */}
                            <FormField
                              control={form.control}
                              name="pickupLocation"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-base flex items-center gap-2">
                                    <Car className="w-4 h-4 text-green-600" />
                                    Pickup *
                                  </FormLabel>
                                  {tenant?.fixed_pickup_address ? (
                                    <div className="p-3 bg-muted/30 rounded-lg border">
                                      <p className="text-sm flex items-center gap-2">
                                        <MapPin className="w-4 h-4 text-accent" />
                                        {tenant.fixed_pickup_address}
                                      </p>
                                    </div>
                                  ) : (
                                    <FormControl>
                                      <LocationAutocomplete
                                        id="pickupLocation"
                                        value={field.value}
                                        onChange={(value) => field.onChange(value)}
                                        placeholder="Enter pickup address"
                                        className="h-12"
                                      />
                                    </FormControl>
                                  )}
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            {/* Return Location */}
                            <FormField
                              control={form.control}
                              name="returnLocation"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-base flex items-center gap-2">
                                    <RotateCcw className="w-4 h-4 text-blue-600" />
                                    Return *
                                  </FormLabel>
                                  {tenant?.fixed_return_address || tenant?.fixed_pickup_address ? (
                                    <div className="p-3 bg-muted/30 rounded-lg border">
                                      <p className="text-sm flex items-center gap-2">
                                        <MapPin className="w-4 h-4 text-accent" />
                                        {tenant?.fixed_return_address || tenant?.fixed_pickup_address}
                                      </p>
                                    </div>
                                  ) : (
                                    <FormControl>
                                      <LocationAutocomplete
                                        id="returnLocation"
                                        value={field.value}
                                        onChange={(value) => field.onChange(value)}
                                        placeholder="Enter return address"
                                        className="h-12"
                                      />
                                    </FormControl>
                                  )}
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </>
                        );
                      }

                      // Multiple options available - show radio selection
                      return (
                        <div className="space-y-6">
                          <div>
                            <h3 className="text-xl font-semibold mb-4 flex items-center gap-2 text-foreground">
                              <Truck className="w-5 h-5 text-accent" />
                              Pickup & Return Options
                            </h3>

                            <RadioGroup
                              value={deliveryOption || (fixedEnabled ? 'fixed' : multipleEnabled ? 'location' : 'area')}
                              onValueChange={(value) => {
                                setDeliveryOption(value as 'fixed' | 'location' | 'area');
                                if (value !== 'location') {
                                  setSelectedLocationId(null);
                                }
                                // Set pickup/return location based on selection
                                if (value === 'fixed' && tenant?.fixed_pickup_address) {
                                  form.setValue('pickupLocation', tenant.fixed_pickup_address);
                                  form.setValue('returnLocation', tenant.fixed_return_address || tenant.fixed_pickup_address);
                                }
                              }}
                              className="space-y-3"
                            >
                              {/* Fixed Address Option (Free) */}
                              {fixedEnabled && (
                                <div
                                  className={cn(
                                    "rounded-lg border p-4 cursor-pointer transition-all",
                                    (deliveryOption === 'fixed' || (!deliveryOption && fixedEnabled))
                                      ? "border-accent bg-accent/5 ring-1 ring-accent"
                                      : "border-border hover:border-muted-foreground/50"
                                  )}
                                  onClick={() => {
                                    setDeliveryOption('fixed');
                                    if (tenant?.fixed_pickup_address) {
                                      form.setValue('pickupLocation', tenant.fixed_pickup_address);
                                      form.setValue('returnLocation', tenant.fixed_return_address || tenant.fixed_pickup_address);
                                    }
                                  }}
                                >
                                  <div className="flex items-start gap-3">
                                    <RadioGroupItem value="fixed" id="option-fixed" className="mt-1" />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <Label htmlFor="option-fixed" className="font-medium cursor-pointer">
                                          Self Pickup & Return
                                        </Label>
                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                          FREE
                                        </span>
                                      </div>
                                      <p className="text-sm text-muted-foreground mt-1">
                                        Pick up and return the vehicle at our location
                                      </p>
                                      {tenant?.fixed_pickup_address && (
                                        <p className="text-sm text-foreground mt-2 flex items-center gap-1">
                                          <MapPin className="w-3 h-3" />
                                          {tenant.fixed_pickup_address}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Multiple Locations Option (Paid) */}
                              {multipleEnabled && (
                                <div
                                  className={cn(
                                    "rounded-lg border p-4 cursor-pointer transition-all",
                                    deliveryOption === 'location'
                                      ? "border-accent bg-accent/5 ring-1 ring-accent"
                                      : "border-border hover:border-muted-foreground/50"
                                  )}
                                  onClick={() => setDeliveryOption('location')}
                                >
                                  <div className="flex items-start gap-3">
                                    <RadioGroupItem value="location" id="option-location" className="mt-1" />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <Label htmlFor="option-location" className="font-medium cursor-pointer">
                                          Delivery to Your Location
                                        </Label>
                                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                                          PAID
                                        </span>
                                      </div>
                                      <p className="text-sm text-muted-foreground mt-1">
                                        We deliver and collect from your chosen location
                                      </p>

                                      {deliveryOption === 'location' && (
                                        <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                                          <Select
                                            value={selectedLocationId || ""}
                                            onValueChange={(value) => {
                                              setSelectedLocationId(value || null);
                                              const loc = deliveryLocations.find(l => l.id === value);
                                              if (loc) {
                                                form.setValue('pickupLocation', loc.address);
                                                form.setValue('returnLocation', loc.address);
                                              }
                                            }}
                                          >
                                            <SelectTrigger className="h-12">
                                              <SelectValue placeholder="Select a location" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {deliveryLocations.map((loc) => (
                                                <SelectItem key={loc.id} value={loc.id}>
                                                  {loc.name} {loc.delivery_fee > 0 ? `- +${fmtCurrency(loc.delivery_fee)}` : '- Free'}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Area Delivery Option (Flat Fee) */}
                              {areaEnabled && (
                                <div
                                  className={cn(
                                    "rounded-lg border p-4 cursor-pointer transition-all",
                                    deliveryOption === 'area'
                                      ? "border-accent bg-accent/5 ring-1 ring-accent"
                                      : "border-border hover:border-muted-foreground/50"
                                  )}
                                  onClick={() => setDeliveryOption('area')}
                                >
                                  <div className="flex items-start gap-3">
                                    <RadioGroupItem value="area" id="option-area" className="mt-1" />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2">
                                        <Label htmlFor="option-area" className="font-medium cursor-pointer">
                                          Area Delivery
                                        </Label>
                                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                                          +{fmtCurrency(tenant?.area_delivery_fee || 0)}
                                        </span>
                                      </div>
                                      <p className="text-sm text-muted-foreground mt-1">
                                        We deliver and collect anywhere within {kmToDisplayUnit(tenant?.pickup_area_radius_km || 25, distanceUnit)} {getDistanceUnitShort(distanceUnit)}
                                      </p>

                                      {deliveryOption === 'area' && (
                                        <div className="mt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                                          <FormField
                                            control={form.control}
                                            name="pickupLocation"
                                            render={({ field }) => (
                                              <FormItem>
                                                <FormLabel className="text-sm">Delivery Address *</FormLabel>
                                                <FormControl>
                                                  <LocationAutocomplete
                                                    id="pickupLocation"
                                                    value={field.value}
                                                    onChange={(value) => {
                                                      field.onChange(value);
                                                      if (sameAsPickup) {
                                                        form.setValue('returnLocation', value);
                                                      }
                                                    }}
                                                    placeholder="Enter your delivery address"
                                                    className="h-12"
                                                  />
                                                </FormControl>
                                                <FormMessage />
                                              </FormItem>
                                            )}
                                          />

                                          <div className="flex items-center gap-2">
                                            <Checkbox
                                              id="sameAsPickupArea"
                                              checked={sameAsPickup}
                                              onCheckedChange={(checked) => {
                                                setSameAsPickup(checked as boolean);
                                                form.setValue('sameAsPickup', checked as boolean);
                                                if (checked) {
                                                  form.setValue('returnLocation', form.getValues('pickupLocation'));
                                                }
                                              }}
                                            />
                                            <Label htmlFor="sameAsPickupArea" className="text-sm cursor-pointer">
                                              Collection from same address
                                            </Label>
                                          </div>

                                          {!sameAsPickup && (
                                            <FormField
                                              control={form.control}
                                              name="returnLocation"
                                              render={({ field }) => (
                                                <FormItem>
                                                  <FormLabel className="text-sm">Collection Address *</FormLabel>
                                                  <FormControl>
                                                    <LocationAutocomplete
                                                      id="returnLocation"
                                                      value={field.value}
                                                      onChange={(value) => field.onChange(value)}
                                                      placeholder="Enter your collection address"
                                                      className="h-12"
                                                    />
                                                  </FormControl>
                                                  <FormMessage />
                                                </FormItem>
                                              )}
                                            />
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </RadioGroup>

                            {/* Fee Summary */}
                            {deliveryFee > 0 && (
                              <div className="p-3 bg-muted/30 rounded-lg mt-4">
                                <div className="flex justify-between font-semibold">
                                  <span>Delivery Fee</span>
                                  <span className="text-accent">+{fmtCurrency(deliveryFee)}</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Same fee applies for both delivery and collection
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}


                    {/* Pickup Date & Time */}
                    <div className="grid md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="pickupDate"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel className="text-base">Pickup Date *</FormLabel>
                            <Popover>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    className={cn(
                                      "h-12 pl-3 text-left font-normal",
                                      !field.value && "text-muted-foreground"
                                    )}
                                  >
                                    {field.value ? (
                                      format(field.value, "PPP")
                                    ) : (
                                      <span>Pick a date</span>
                                    )}
                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={field.value}
                                  onSelect={field.onChange}
                                  disabled={(date) => date < new Date()}
                                  initialFocus
                                  className={cn("p-3 pointer-events-auto")}
                                />
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="pickupTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-base">Pickup Time (PST) *</FormLabel>
                            <FormControl>
                              <Input
                                type="time"
                                {...field}
                                className="h-12"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Return Date & Time */}
                    <div className="grid md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="returnDate"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel className="text-base">Return Date *</FormLabel>
                            <Popover>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    className={cn(
                                      "h-12 pl-3 text-left font-normal",
                                      !field.value && "text-muted-foreground"
                                    )}
                                  >
                                    {field.value ? (
                                      format(field.value, "PPP")
                                    ) : (
                                      <span>Pick a date</span>
                                    )}
                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={field.value}
                                  onSelect={field.onChange}
                                  disabled={(date) => date < pickupDate}
                                  initialFocus
                                  className={cn("p-3 pointer-events-auto")}
                                />
                              </PopoverContent>
                            </Popover>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="returnTime"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-base">Return Time (PST) *</FormLabel>
                            <FormControl>
                              <Input
                                type="time"
                                {...field}
                                className="h-12"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Date of Birth */}
                    <FormField
                      control={form.control}
                      name="driverDOB"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel className="text-base">Date of Birth *</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  className={cn(
                                    "w-full h-12 justify-start text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {field.value ? format(field.value, "MMM dd, yyyy") : "Select date of birth"}
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) => {
                                  const today = new Date();
                                  const minDate = new Date();
                                  minDate.setFullYear(minDate.getFullYear() - 120);
                                  return date > today || date < minDate;
                                }}
                                defaultMonth={new Date(new Date().getFullYear() - 25, 0)}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Promo Code */}
                    <FormField
                      control={form.control}
                      name="promoCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-base">Promo Code (Optional)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="Enter promo code"
                              className="h-12 uppercase"
                              maxLength={20}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Customer Information Section */}
                    <div className="border-t border-accent/20 pt-6 mt-6">
                      <h3 className="text-xl font-semibold mb-4 text-foreground">Customer Information</h3>

                      {/* Customer Name */}
                      <FormField
                        control={form.control}
                        name="customerName"
                        render={({ field }) => (
                          <FormItem className="mb-4">
                            <FormLabel className="text-base">Full Name *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Enter your full name"
                                className="h-12"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Email and Phone */}
                      <div className="grid md:grid-cols-2 gap-4 mb-4">
                        <FormField
                          control={form.control}
                          name="customerEmail"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-base">Email *</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type="email"
                                  placeholder="your@email.com"
                                  className="h-12"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="customerPhone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-base">Phone Number *</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type="tel"
                                  placeholder="+1 (555) 123-4567"
                                  className="h-12"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* Customer Type */}
                      <FormField
                        control={form.control}
                        name="customerType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-base">Customer Type *</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="h-12">
                                  <SelectValue placeholder="Select customer type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="Individual">Individual</SelectItem>
                                <SelectItem value="Company">Company</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Submit Button */}
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full h-14 text-base shadow-glow hover:shadow-[0_0_40px_rgba(255,215,0,0.4)]"
                    >
                      View Available Vehicles
                      <ChevronRight className="ml-2" />
                    </Button>
                  </form>
                </Form>
              </Card>
            </div>

            {/* Right Column - Pricing Preview */}
            <div className="lg:col-span-1">
              <Card className="p-6 shadow-metal border-accent/20 sticky top-24">
                <h3 className="text-xl font-display font-bold mb-4 text-gradient-silver">
                  Booking Summary
                </h3>

                <div className="space-y-4">
                  {/* Duration Display */}
                  {duration && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                      <Clock className={`w-5 h-5 ${duration.valid ? 'text-accent' : 'text-destructive'}`} />
                      <div className="flex-1">
                        <p className="text-sm text-muted-foreground">Rental Duration</p>
                        <p className={`font-semibold ${duration.valid ? 'text-foreground' : 'text-destructive'}`}>
                          {duration.text}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Pricing Info */}
                  <div className="border-t border-accent/20 pt-4">
                    <div className="flex items-start gap-2 p-4 rounded-lg bg-accent/5 border border-accent/20">
                      <AlertCircle className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">
                          Pricing Information
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Final pricing will be calculated after you select your vehicle. Daily rates vary by vehicle class.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Estimated Total */}
                  <div className="border-t border-accent/20 pt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-base font-semibold text-muted-foreground">Estimated Total</span>
                      <span className="text-lg font-bold text-accent">TBD</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Price will be calculated after vehicle selection
                    </p>
                  </div>

                  {/* Additional Info */}
                  <div className="text-xs text-muted-foreground space-y-2 pt-2 border-t border-accent/20">
                    <p className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-accent" />
                      All rentals subject to availability
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-accent" />
                      30-day minimum rental period
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-accent" />
                      Security deposit required
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
