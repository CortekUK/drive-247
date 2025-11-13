import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Check, Shield, CreditCard } from "lucide-react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SEO from "@/components/SEO";
import { z } from "zod";
import BookingConfirmation from "@/components/BookingConfirmation";

const checkoutSchema = z.object({
  customerName: z.string().min(2, "Name must be at least 2 characters"),
  customerEmail: z.string().email("Invalid email address"),
  customerPhone: z.string().min(10, "Phone number must be at least 10 digits"),
  licenseNumber: z.string().min(5, "License number is required"),
  agreeTerms: z.boolean().refine(val => val === true, "You must agree to terms")
});

interface PricingExtra {
  id: string;
  extra_name: string;
  price: number;
  description: string | null;
}

const BookingCheckout = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [extras, setExtras] = useState<PricingExtra[]>([]);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [vehicleDetails, setVehicleDetails] = useState<any>(null);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    licenseNumber: "",
    agreeTerms: false
  });

  // Extract booking context
  const pickupDate = searchParams.get("pickup") || "";
  const returnDate = searchParams.get("return") || "";
  const pickupLocation = searchParams.get("pl") || "";
  const returnLocation = searchParams.get("rl") || "";
  const driverAge = searchParams.get("age") || "";
  const promoCode = searchParams.get("promo") || "";
  const vehicleId = searchParams.get("vehicle") || "";

  useEffect(() => {
    if (!vehicleId || !pickupDate || !returnDate) {
      toast.error("Missing booking details. Redirecting...");
      navigate("/booking");
      return;
    }
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load vehicle details
      const { data: vehicle, error: vError } = await supabase
        .from("vehicles")
        .select("*")
        .eq("id", vehicleId)
        .single();
      
      if (vError) throw vError;
      setVehicleDetails(vehicle);

      // Load extras
      const { data: extrasData, error: eError } = await supabase
        .from("pricing_extras")
        .select("*")
        .eq("is_active", true);
      
      if (eError) throw eError;
      setExtras(extrasData || []);
    } catch (error: any) {
      toast.error("Failed to load booking details");
      console.error(error);
    }
  };

  const calculateRentalDays = () => {
    const pickup = new Date(pickupDate);
    const dropoff = new Date(returnDate);
    const diffTime = Math.abs(dropoff.getTime() - pickup.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const calculateVehiclePrice = () => {
    if (!vehicleDetails) return 0;
    const days = calculateRentalDays();
    if (days >= 28) return vehicleDetails.monthly_rate;
    if (days >= 7) return Math.floor((days / 7) * vehicleDetails.weekly_rate);
    return days * vehicleDetails.daily_rate;
  };

  const calculateExtrasTotal = () => {
    return selectedExtras.reduce((sum, extraId) => {
      const extra = extras.find(e => e.id === extraId);
      return sum + (extra?.price || 0);
    }, 0);
  };

  const calculateTotal = () => {
    return calculateVehiclePrice() + calculateExtrasTotal();
  };

  const handleExtraToggle = (extraId: string) => {
    setSelectedExtras(prev =>
      prev.includes(extraId)
        ? prev.filter(id => id !== extraId)
        : [...prev, extraId]
    );
  };

  const validateForm = () => {
    try {
      checkoutSchema.parse(formData);
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: {[key: string]: string} = {};
        error.errors.forEach(err => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      toast.error("Please fill in all required fields correctly");
      return;
    }

    setLoading(true);
    try {
      // Get customer data from localStorage (saved in Step 1)
      const bookingContext = localStorage.getItem("booking_context");
      if (!bookingContext) {
        throw new Error("Customer information not found. Please restart booking.");
      }

      const context = JSON.parse(bookingContext);
      const { customerName, customerEmail, customerPhone, customerType } = context;

      // Step 1: Create or find customer
      let customer;
      const { data: existingCustomer, error: findError } = await supabase
        .from("customers")
        .select("*")
        .eq("email", customerEmail)
        .maybeSingle();

      if (existingCustomer) {
        customer = existingCustomer;
        toast.info("Welcome back! Using your existing account.");
      } else {
        // Create new customer
        const { data: newCustomer, error: createError } = await supabase
          .from("customers")
          .insert({
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            type: customerType,
            status: "Active"
          })
          .select()
          .single();

        if (createError) throw createError;
        customer = newCustomer;
      }

      // Step 2: Check if Individual customer already has active rental
      if (customer.type === "Individual") {
        const { data: activeRentals, error: checkError } = await supabase
          .from("rentals")
          .select("id")
          .eq("customer_id", customer.id)
          .eq("status", "Active");

        if (checkError) throw checkError;
        if (activeRentals && activeRentals.length > 0) {
          throw new Error("You already have an active rental. Individuals can only have one active rental at a time.");
        }
      }

      // Step 3: Calculate monthly amount
      const days = calculateRentalDays();
      const monthlyAmount = vehicleDetails.monthly_rate || calculateVehiclePrice();

      // Step 4: Create rental
      const { data: rental, error: rentalError } = await supabase
        .from("rentals")
        .insert({
          customer_id: customer.id,
          vehicle_id: vehicleId,
          start_date: pickupDate,
          end_date: returnDate,
          monthly_amount: monthlyAmount,
          status: "Active"
        })
        .select()
        .single();

      if (rentalError) throw rentalError;

      // Step 5: Update vehicle status to Rented
      const { error: vehicleError } = await supabase
        .from("vehicles")
        .update({ status: "Rented" })
        .eq("id", vehicleId);

      if (vehicleError) {
        console.error("Failed to update vehicle status:", vehicleError);
        // Don't throw - rental is already created
      }

      // Step 6: Generate rental charges (let database triggers handle this)
      await supabase.rpc("backfill_rental_charges_first_month_only").catch(err => {
        console.error("Failed to generate charges:", err);
        // Don't throw - rental is created
      });

      // Show confirmation screen
      setConfirmedBooking({
        pickupLocation,
        dropoffLocation: returnLocation || pickupLocation,
        pickupDate,
        pickupTime: "09:00",
        vehicleName: vehicleDetails?.name || vehicleDetails?.make + " " + vehicleDetails?.model || "Vehicle",
        totalPrice: monthlyAmount.toString(),
        customerName,
        customerEmail
      });
      setShowConfirmation(true);

      toast.success("Rental created successfully! Check portal for details.");
    } catch (error: any) {
      console.error("Rental creation error:", error);
      toast.error(error.message || "Failed to create rental");
    } finally {
      setLoading(false);
    }
  };

  if (showConfirmation && confirmedBooking) {
    return (
      <div className="min-h-screen bg-background">
        <SEO
          title="Booking Confirmed | Drive 917"
          description="Your luxury car rental booking has been confirmed"
        />
        <Navigation />
        <div className="pt-24 pb-16 px-4">
          <BookingConfirmation
            bookingDetails={confirmedBooking}
            onClose={() => navigate("/booking")}
          />
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Checkout | Drive 917"
        description="Complete your luxury car rental booking"
      />
      <Navigation />
      
      <div className="pt-24 pb-16 px-4">
        <div className="max-w-6xl mx-auto">
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
                <div className="w-8 h-8 rounded-full bg-accent/20 border-2 border-accent flex items-center justify-center">
                  <Check className="w-4 h-4 text-accent" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">Vehicle</span>
              </div>
              <div className="flex-1 h-0.5 bg-accent/30 mx-4" />
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-accent border-2 border-accent flex items-center justify-center text-background font-semibold text-sm">
                  3
                </div>
                <span className="text-sm font-medium">Checkout</span>
              </div>
            </div>
          </div>

          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="mb-6"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Vehicles
          </Button>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Left Column - Form */}
            <div className="lg:col-span-2 space-y-6">
              {/* Extras */}
              <Card className="p-6">
                <h2 className="text-xl font-semibold mb-4">Optional Extras</h2>
                {extras.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No extras available</p>
                ) : (
                  <div className="space-y-3">
                    {extras.map(extra => (
                      <div key={extra.id} className="flex items-start gap-3 p-3 rounded border border-border hover:bg-muted/50 transition-colors">
                        <Checkbox
                          checked={selectedExtras.includes(extra.id)}
                          onCheckedChange={() => handleExtraToggle(extra.id)}
                        />
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <Label className="font-medium cursor-pointer">{extra.extra_name}</Label>
                            <span className="text-sm font-semibold">${extra.price}</span>
                          </div>
                          {extra.description && (
                            <p className="text-xs text-muted-foreground mt-1">{extra.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Customer Details */}
              <Card className="p-6">
                <h2 className="text-xl font-semibold mb-4">Your Details</h2>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="customerName">Full Name *</Label>
                    <Input
                      id="customerName"
                      value={formData.customerName}
                      onChange={e => setFormData({...formData, customerName: e.target.value})}
                      className={errors.customerName ? "border-destructive" : ""}
                    />
                    {errors.customerName && (
                      <p className="text-xs text-destructive mt-1">{errors.customerName}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="customerEmail">Email Address *</Label>
                    <Input
                      id="customerEmail"
                      type="email"
                      value={formData.customerEmail}
                      onChange={e => setFormData({...formData, customerEmail: e.target.value})}
                      className={errors.customerEmail ? "border-destructive" : ""}
                    />
                    {errors.customerEmail && (
                      <p className="text-xs text-destructive mt-1">{errors.customerEmail}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="customerPhone">Phone Number *</Label>
                    <Input
                      id="customerPhone"
                      type="tel"
                      value={formData.customerPhone}
                      onChange={e => setFormData({...formData, customerPhone: e.target.value})}
                      className={errors.customerPhone ? "border-destructive" : ""}
                    />
                    {errors.customerPhone && (
                      <p className="text-xs text-destructive mt-1">{errors.customerPhone}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="licenseNumber">Driver's License Number *</Label>
                    <Input
                      id="licenseNumber"
                      value={formData.licenseNumber}
                      onChange={e => setFormData({...formData, licenseNumber: e.target.value})}
                      className={errors.licenseNumber ? "border-destructive" : ""}
                    />
                    {errors.licenseNumber && (
                      <p className="text-xs text-destructive mt-1">{errors.licenseNumber}</p>
                    )}
                  </div>

                  <div className="flex items-start gap-2 pt-4">
                    <Checkbox
                      checked={formData.agreeTerms}
                      onCheckedChange={(checked) => setFormData({...formData, agreeTerms: checked as boolean})}
                    />
                    <Label className="text-sm leading-relaxed cursor-pointer">
                      I agree to the{" "}
                      <a href="/terms" target="_blank" className="text-accent underline">Terms & Conditions</a>
                      {" "}and{" "}
                      <a href="/privacy" target="_blank" className="text-accent underline">Privacy Policy</a>
                    </Label>
                  </div>
                  {errors.agreeTerms && (
                    <p className="text-xs text-destructive">{errors.agreeTerms}</p>
                  )}
                </div>
              </Card>
            </div>

            {/* Right Column - Summary */}
            <div className="lg:col-span-1">
              <Card className="p-6 sticky top-24">
                <h3 className="text-lg font-semibold mb-4">Booking Summary</h3>
                
                {vehicleDetails && (
                  <div className="space-y-3 pb-4 border-b border-border">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Vehicle</span>
                      <span className="font-medium">{vehicleDetails.name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium">{calculateRentalDays()} days</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Vehicle Cost</span>
                      <span className="font-medium">${calculateVehiclePrice().toLocaleString()}</span>
                    </div>
                  </div>
                )}

                {selectedExtras.length > 0 && (
                  <div className="space-y-2 py-4 border-b border-border">
                    <p className="text-sm font-medium">Extras</p>
                    {selectedExtras.map(extraId => {
                      const extra = extras.find(e => e.id === extraId);
                      return extra ? (
                        <div key={extraId} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{extra.extra_name}</span>
                          <span className="font-medium">${extra.price}</span>
                        </div>
                      ) : null;
                    })}
                  </div>
                )}

                <div className="pt-4 space-y-4">
                  <div className="flex justify-between items-baseline">
                    <span className="text-lg font-semibold">Total</span>
                    <span className="text-2xl font-bold text-accent">${calculateTotal().toLocaleString()}</span>
                  </div>

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleSubmit}
                    disabled={loading}
                  >
                    {loading ? (
                      <>Processing...</>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Complete Booking
                      </>
                    )}
                  </Button>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Shield className="w-4 h-4" />
                    <span>Secure booking system</span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default BookingCheckout;
