'use client'

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { Clock, Mail, Phone, Calendar, Car, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

const BookingPending = () => {
  const searchParams = useSearchParams();
  const [bookingDetails, setBookingDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const sessionId = searchParams?.get("session_id");
  const rentalId = searchParams?.get("rental_id");

  useEffect(() => {
    const fetchBookingDetails = async () => {
      if (!rentalId) {
        setLoading(false);
        return;
      }

      try {
        // Fetch rental details with customer and vehicle info
        const { data: rental, error: fetchError } = await supabase
          .from("rentals")
          .select(`
            *,
            customer:customers(*),
            vehicle:vehicles(*)
          `)
          .eq("id", rentalId)
          .single();

        if (fetchError) {
          console.error("Failed to fetch rental details:", fetchError);
          toast.error("Unable to load booking details. Please contact support.");
        } else if (rental) {
          // Format rental details for display
          const vehicleName = rental.vehicle.make && rental.vehicle.model
            ? `${rental.vehicle.make} ${rental.vehicle.model}`
            : rental.vehicle.reg;

          setBookingDetails({
            rental_id: rental.id,
            booking_ref: rental.id.substring(0, 8).toUpperCase(),
            customer_name: rental.customer.name,
            customer_email: rental.customer.email,
            vehicle_name: vehicleName,
            vehicle_reg: rental.vehicle.reg,
            pickup_date: format(new Date(rental.start_date), "MMM dd, yyyy"),
            return_date: format(new Date(rental.end_date), "MMM dd, yyyy"),
            rental_period_type: rental.rental_period_type,
            monthly_amount: rental.monthly_amount,
            status: rental.status,
          });
        }

        // Clear localStorage
        localStorage.removeItem('pendingPaymentDetails');
      } catch (error) {
        console.error('Error fetching booking details:', error);
        toast.error("An error occurred. Please contact support.");
      } finally {
        setLoading(false);
      }
    };

    fetchBookingDetails();
  }, [rentalId]);

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center py-16">
        <div className="container mx-auto px-6 max-w-2xl">
          <div className="bg-card rounded-2xl shadow-metal border border-accent/20 p-8 md:p-12">
            {loading ? (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 text-accent mx-auto mb-4 animate-spin" />
                <p className="text-muted-foreground">Loading booking details...</p>
              </div>
            ) : (
              <>
                {/* Status Icon */}
                <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Clock className="w-12 h-12 text-amber-500" />
                </div>

                <h1 className="text-3xl md:text-4xl font-display font-bold text-gradient-metal mb-2 text-center">
                  Booking Submitted
                </h1>

                {bookingDetails?.booking_ref && (
                  <p className="text-lg text-center mb-6">
                    Reference: <span className="font-semibold text-accent">{bookingDetails.booking_ref}</span>
                  </p>
                )}

                <p className="text-lg text-muted-foreground mb-8 text-center">
                  Thank you for your booking request! We're reviewing your information and will confirm within 24 hours.
                </p>

                {/* Info Banner */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-8">
                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-amber-800">Your card has been authorized</h3>
                      <p className="text-sm text-amber-700 mt-1">
                        A temporary hold has been placed on your card. You will <strong>only be charged</strong> once your booking is approved.
                        If your booking is not approved, the hold will be released automatically.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Booking Summary */}
                {bookingDetails && (
                  <div className="bg-accent/5 border border-accent/20 rounded-lg p-6 mb-8 text-left space-y-4">
                    <h2 className="text-xl font-semibold mb-4">Booking Summary</h2>

                    <div className="grid gap-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-2">
                          <Car className="w-4 h-4" />
                          Vehicle:
                        </span>
                        <span className="font-medium">{bookingDetails.vehicle_name}</span>
                      </div>
                      {bookingDetails.vehicle_reg && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Registration:</span>
                          <span className="font-medium">{bookingDetails.vehicle_reg}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          Pickup Date:
                        </span>
                        <span className="font-medium">{bookingDetails.pickup_date}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Return Date:</span>
                        <span className="font-medium">{bookingDetails.return_date}</span>
                      </div>
                      <div className="border-t pt-3 mt-2 flex justify-between">
                        <span className="font-medium">Total Amount (Held):</span>
                        <span className="font-bold text-accent">
                          ${bookingDetails.monthly_amount?.toLocaleString() || "N/A"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* What Happens Next */}
                <div className="bg-muted/50 rounded-lg p-6 mb-8">
                  <h2 className="text-lg font-semibold mb-4">What Happens Next?</h2>
                  <ol className="space-y-3 text-sm text-muted-foreground">
                    <li className="flex items-start gap-3">
                      <span className="bg-accent text-background w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                      <span>Our team will review your booking request within 24 hours</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="bg-accent text-background w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                      <span>You'll receive an email confirmation once approved</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="bg-accent text-background w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                      <span>Your rental agreement will be sent via DocuSign for signature</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="bg-accent text-background w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
                      <span>Your card will be charged upon approval</span>
                    </li>
                  </ol>
                </div>

                {/* Contact Information */}
                <div className="text-center text-muted-foreground mb-8">
                  <p className="mb-2">Questions about your booking?</p>
                  <div className="flex items-center justify-center gap-6 text-sm">
                    <a href="mailto:support@drive-247.com" className="flex items-center gap-2 hover:text-accent transition-colors">
                      <Mail className="w-4 h-4" />
                      support@drive-247.com
                    </a>
                    <a href="tel:+1234567890" className="flex items-center gap-2 hover:text-accent transition-colors">
                      <Phone className="w-4 h-4" />
                      (123) 456-7890
                    </a>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link href="/">
                    <Button variant="outline" className="w-full sm:w-auto">
                      Return Home
                    </Button>
                  </Link>
                  <Link href="/booking">
                    <Button className="w-full sm:w-auto gradient-accent">
                      Book Another Vehicle
                    </Button>
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
};

export default BookingPending;
