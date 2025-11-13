import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { CheckCircle, Download, Mail, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

const BookingSuccess = () => {
  const [searchParams] = useSearchParams();
  const [bookingDetails, setBookingDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const sessionId = searchParams.get("session_id");
  const rentalId = searchParams.get("rental_id");

  useEffect(() => {
    const updateRentalStatus = async () => {
      if (!sessionId) {
        setLoading(false);
        return;
      }

      try {
        // If we have a rentalId from URL params (portal integration)
        if (rentalId) {
          // Step 1: Update rental status to Active
          const { error: rentalUpdateError } = await supabase
            .from("rentals")
            .update({ status: "Active" })
            .eq("id", rentalId);

          if (rentalUpdateError) {
            console.error("Failed to update rental status:", rentalUpdateError);

            // Provide specific error messages based on error type
            let errorMessage = "Failed to confirm rental. Please contact support.";

            if (rentalUpdateError.code === 'PGRST116') {
              errorMessage = "Rental not found. Please contact support with your payment confirmation.";
            } else if (rentalUpdateError.message?.includes('permission')) {
              errorMessage = "Access denied. Please contact support to complete your rental confirmation.";
            } else if (rentalUpdateError.message?.includes('network') || rentalUpdateError.message?.includes('timeout')) {
              errorMessage = "Network error. Your payment was successful, but confirmation failed. Please refresh the page or contact support.";
            }

            toast.error(errorMessage, { duration: 8000 });
          }

          // Step 2: Fetch rental details with customer and vehicle info
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

            // Provide specific error messages
            let errorMessage = "Unable to load rental details.";

            if (fetchError.code === 'PGRST116') {
              errorMessage = "Rental details not found. Your payment was successful. Please contact support.";
            } else if (fetchError.message?.includes('permission')) {
              errorMessage = "Access error loading rental details. Please contact support.";
            }

            toast.error(errorMessage, {
              duration: 8000,
              description: "Your payment was processed successfully. We'll send confirmation details to your email."
            });
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

            // TODO: Send confirmation email if needed
            // await supabase.functions.invoke('send-rental-confirmation-email', {
            //   body: { rentalId: rental.id }
            // });
          }
        } else {
          // Fallback: Try to get from localStorage (legacy bookings)
          const bookingData = localStorage.getItem('pending_booking');
          if (bookingData) {
            const booking = JSON.parse(bookingData);
            setBookingDetails(booking);
            localStorage.removeItem('pending_booking');
          }
        }
      } catch (error) {
        console.error('Error processing booking confirmation:', error);

        // Provide specific error messages based on error type
        let errorMessage = "An error occurred while processing your confirmation.";

        if (error instanceof TypeError && error.message?.includes('fetch')) {
          errorMessage = "Network connection error. Please check your internet connection and refresh the page.";
        } else if (error.message?.includes('JSON')) {
          errorMessage = "Data processing error. Please refresh the page or contact support.";
        } else if (error.message?.includes('session_id')) {
          errorMessage = "Invalid payment session. If your payment was processed, please contact support with your payment confirmation.";
        }

        toast.error(errorMessage, {
          duration: 10000,
          description: "If your payment was successful, your rental will be confirmed. Please contact support if you need assistance."
        });
      } finally {
        setLoading(false);
      }
    };

    updateRentalStatus();
  }, [sessionId, rentalId]);

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center py-16">
        <div className="container mx-auto px-6 max-w-2xl">
          <div className="bg-card rounded-2xl shadow-metal border border-accent/20 p-8 md:p-12">
            {loading ? (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 text-accent mx-auto mb-4 animate-spin" />
                <p className="text-muted-foreground">Processing your booking confirmation...</p>
              </div>
            ) : (
              <>
                <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle className="w-12 h-12 text-green-500" />
                </div>

                <h1 className="text-3xl md:text-4xl font-display font-bold text-gradient-metal mb-2 text-center">
                  Rental Confirmed
                </h1>

                {bookingDetails?.booking_ref && (
                  <p className="text-lg text-center mb-6">
                    Reference: <span className="font-semibold text-accent">{bookingDetails.booking_ref}</span>
                  </p>
                )}

                <p className="text-lg text-muted-foreground mb-8 text-center">
                  Thank you for your rental. Your payment has been processed successfully.
                </p>

                {/* Rental Summary */}
                {bookingDetails && (
                  <div className="bg-accent/5 border border-accent/20 rounded-lg p-6 mb-8 text-left space-y-4">
                    <h2 className="text-xl font-semibold mb-4">Rental Summary</h2>

                    <div className="grid gap-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Vehicle:</span>
                        <span className="font-medium">{bookingDetails.vehicle_name}</span>
                      </div>
                      {bookingDetails.vehicle_reg && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Registration:</span>
                          <span className="font-medium">{bookingDetails.vehicle_reg}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Start Date:</span>
                        <span className="font-medium">{bookingDetails.pickup_date || bookingDetails.pickup_date}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">End Date:</span>
                        <span className="font-medium">{bookingDetails.return_date}</span>
                      </div>
                      {bookingDetails.rental_period_type && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Period Type:</span>
                          <span className="font-medium">{bookingDetails.rental_period_type}</span>
                        </div>
                      )}
                      {bookingDetails.monthly_amount && (
                        <div className="flex justify-between pt-3 border-t border-accent/20">
                          <span className="text-muted-foreground font-medium">Rental Amount:</span>
                          <span className="font-bold text-accent text-lg">${bookingDetails.monthly_amount?.toLocaleString()}</span>
                        </div>
                      )}
                      {bookingDetails.total && (
                        <div className="flex justify-between pt-3 border-t border-accent/20">
                          <span className="text-muted-foreground font-medium">Amount Paid:</span>
                          <span className="font-bold text-accent text-lg">${bookingDetails.total?.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="bg-accent/5 border border-accent/20 rounded-lg p-6 mb-8 text-left">
                  <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <Mail className="w-5 h-5 text-accent" />
                    What's Next?
                  </h2>
                  <ul className="space-y-3 text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                      <span>A confirmation email will be sent to your email address with your rental details</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                      <span>Your rental is confirmed and ready for pickup at the scheduled time</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                      <span>You will receive pickup instructions 24 hours before your rental period</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
                      <span>Your security deposit is held and will be released after the rental period</span>
                    </li>
                  </ul>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link to="/">
                    <Button className="gradient-accent hover-lift w-full sm:w-auto">
                      Return to Home
                    </Button>
                  </Link>
                  <Link to="/contact">
                    <Button variant="outline" className="w-full sm:w-auto">
                      Contact Support
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

export default BookingSuccess;
