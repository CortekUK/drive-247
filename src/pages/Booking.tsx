import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { format, addDays, differenceInHours, differenceInDays, parseISO } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { CalendarIcon, MapPin, Clock, ChevronRight, AlertCircle } from "lucide-react";
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

const TIMEZONE = "America/Los_Angeles";
const MIN_RENTAL_DAYS = 30;
const MAX_RENTAL_DAYS = 90;

// Form schema with validation
const rentalDetailsSchema = z.object({
  pickupLocation: z.string().min(5, "Please enter a valid pickup location"),
  returnLocation: z.string().min(5, "Please enter a valid return location"),
  sameAsPickup: z.boolean(),
  pickupDate: z.date({ required_error: "Pickup date is required" }),
  pickupTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format"),
  returnDate: z.date({ required_error: "Return date is required" }),
  returnTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format"),
  driverAge: z.enum(["under_25", "25_70", "over_70"], {
    required_error: "Please select driver age range"
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

type RentalDetailsForm = z.infer<typeof rentalDetailsSchema>;

export default function Booking() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sameAsPickup, setSameAsPickup] = useState(true);

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
      driverAge: "25_70",
      promoCode: "",
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      customerType: undefined,
    },
  });

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("booking_context");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.pickupDate) data.pickupDate = parseISO(data.pickupDate);
        if (data.returnDate) data.returnDate = parseISO(data.returnDate);
        form.reset(data);
        setSameAsPickup(data.sameAsPickup ?? true);
      } catch (e) {
        console.error("Failed to load booking context:", e);
      }
    }

    // Also check URL params
    const pl = searchParams.get("pl");
    const rl = searchParams.get("rl");
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
    // Build query params
    const params = new URLSearchParams({
      pickup: format(data.pickupDate, "yyyy-MM-dd"),
      pickupTime: data.pickupTime,
      return: format(data.returnDate, "yyyy-MM-dd"),
      returnTime: data.returnTime,
      pl: data.pickupLocation,
      rl: data.returnLocation,
      age: data.driverAge,
    });

    if (data.promoCode) {
      params.set("promo", data.promoCode);
    }

    // Save to localStorage
    const saveData = {
      ...data,
      pickupDate: data.pickupDate.toISOString(),
      returnDate: data.returnDate.toISOString(),
    };
    localStorage.setItem("booking_context", JSON.stringify(saveData));

    // Analytics event
    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "booking_step1_submitted", {
        pickup_location: data.pickupLocation,
        return_location: data.returnLocation,
        driver_age: data.driverAge,
        has_promo: !!data.promoCode,
      });
    }

    toast.success("Rental details saved. Loading available vehicles...");

    // Navigate to vehicles step
    navigate(`/booking/vehicles?${params.toString()}`);
  };

  const pickupDate = form.watch("pickupDate");
  const returnDate = form.watch("returnDate");
  const pickupTime = form.watch("pickupTime");
  const returnTime = form.watch("returnTime");

  // Calculate rental duration
  const rentalDuration = () => {
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

  const duration = rentalDuration();

  return (
    <div className="min-h-screen bg-background">
      <SEO 
        title="Rental Booking — Drive 917"
        description="Book your luxury vehicle rental with Drive 917. Choose pickup and return details for premium cars in Los Angeles."
        keywords="luxury car rental booking, Los Angeles car rental, premium vehicle booking"
        canonical={`${window.location.origin}/booking`}
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
                    {/* Pickup Location */}
                    <FormField
                      control={form.control}
                      name="pickupLocation"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-base flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-accent" />
                            Pickup Location *
                          </FormLabel>
                          <FormControl>
                            <LocationAutocomplete
                              id="pickupLocation"
                              value={field.value}
                              onChange={(value) => field.onChange(value)}
                              placeholder="Enter pickup address in Los Angeles"
                              className="h-12"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Same as Pickup Toggle */}
                    <FormField
                      control={form.control}
                      name="sameAsPickup"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              id="sameAsPickup"
                            />
                          </FormControl>
                          <FormLabel htmlFor="sameAsPickup" className="text-sm font-normal cursor-pointer">
                            Return to same location
                          </FormLabel>
                        </FormItem>
                      )}
                    />

                    {/* Return Location */}
                    {!sameAsPickup && (
                      <FormField
                        control={form.control}
                        name="returnLocation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-base flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-accent" />
                              Return Location *
                            </FormLabel>
                            <FormControl>
                              <LocationAutocomplete
                                id="returnLocation"
                                value={field.value}
                                onChange={(value) => field.onChange(value)}
                                placeholder="Enter return address in Los Angeles"
                                className="h-12"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

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

                    {/* Driver Age */}
                    <FormField
                      control={form.control}
                      name="driverAge"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-base">Driver Age *</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-12">
                                <SelectValue placeholder="Select driver age range" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="under_25">Under 25 (additional fee may apply)</SelectItem>
                              <SelectItem value="25_70">25 - 70</SelectItem>
                              <SelectItem value="over_70">Over 70</SelectItem>
                            </SelectContent>
                          </Select>
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
