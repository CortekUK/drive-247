import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { XCircle, ArrowLeft, MessageCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const BookingCancelled = () => {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const rentalId = searchParams.get("rental_id");

  useEffect(() => {
    const cleanupFailedRental = async () => {
      if (rentalId) {
        try {
          // Step 1: Get the vehicle_id from the rental before deleting
          const { data: rental, error: fetchError } = await supabase
            .from("rentals")
            .select("vehicle_id")
            .eq("id", rentalId)
            .single();

          if (rental && !fetchError) {
            // Step 2: Delete the rental record (payment failed)
            const { error: deleteError } = await supabase
              .from("rentals")
              .delete()
              .eq("id", rentalId);

            if (deleteError) {
              console.error("Failed to delete rental:", deleteError);
            }

            // Step 3: Update vehicle status back to Available
            const { error: vehicleUpdateError } = await supabase
              .from("vehicles")
              .update({ status: "Available" })
              .eq("id", rental.vehicle_id);

            if (vehicleUpdateError) {
              console.error("Failed to update vehicle status:", vehicleUpdateError);
            }
          }
        } catch (error) {
          console.error("Error cleaning up failed rental:", error);
        }
      }
      setLoading(false);
    };

    cleanupFailedRental();
  }, [rentalId]);

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gradient-to-b from-background to-muted pt-24 pb-16">
        <div className="container mx-auto px-6 max-w-2xl">
          <div className="bg-card rounded-2xl shadow-metal border border-destructive/20 p-8 md:p-12 text-center">
            {loading ? (
              <div className="py-12">
                <Loader2 className="w-12 h-12 text-accent mx-auto mb-4 animate-spin" />
                <p className="text-muted-foreground">Processing cancellation...</p>
              </div>
            ) : (
              <>
                <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <XCircle className="w-12 h-12 text-destructive" />
                </div>

                <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
                  Payment Cancelled
                </h1>

                <p className="text-lg text-muted-foreground mb-8">
                  Your payment was cancelled. No charges have been made to your account.
                </p>

                <div className="bg-muted/50 border border-border rounded-lg p-6 mb-8 text-left">
                  <h2 className="text-xl font-semibold mb-4">What Happened?</h2>
                  <p className="text-muted-foreground mb-4">
                    You've cancelled the payment process. Your rental has not been confirmed and no payment has been processed.
                  </p>
                  <p className="text-muted-foreground">
                    If you experienced any issues or have questions, please don't hesitate to contact our support team.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link to="/">
                    <Button className="gradient-accent hover-lift w-full sm:w-auto">
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Try Again
                    </Button>
                  </Link>
                  <Link to="/contact">
                    <Button variant="outline" className="w-full sm:w-auto">
                      <MessageCircle className="w-4 h-4 mr-2" />
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

export default BookingCancelled;
