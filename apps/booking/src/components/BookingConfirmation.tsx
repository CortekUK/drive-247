import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

interface BookingConfirmationProps {
  bookingDetails: {
    pickupLocation: string;
    dropoffLocation: string;
    pickupDate: string;
    pickupTime: string;
    vehicleName: string;
    totalPrice: string;
    customerName: string;
    customerEmail: string;
  };
  onClose: () => void;
}

const BookingConfirmation = ({ bookingDetails, onClose }: BookingConfirmationProps) => {
  return (
    <Card className="p-8 shadow-metal bg-card/50 backdrop-blur max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-3xl font-display font-bold text-gradient-metal mb-2">
          Booking Confirmed!
        </h2>
        <p className="text-muted-foreground">
          Your booking request has been submitted successfully
        </p>
      </div>

      <div className="space-y-4 bg-secondary/30 p-6 rounded-lg mb-6">
        <h3 className="font-semibold text-lg mb-3">Booking Summary</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Pickup Location</p>
            <p className="font-medium">{bookingDetails.pickupLocation}</p>
          </div>
          
          <div>
            <p className="text-sm text-muted-foreground">Drop-off Location</p>
            <p className="font-medium">{bookingDetails.dropoffLocation}</p>
          </div>
          
          <div>
            <p className="text-sm text-muted-foreground">Date & Time</p>
            <p className="font-medium">
              {bookingDetails.pickupDate} at {bookingDetails.pickupTime}
            </p>
          </div>
          
          <div>
            <p className="text-sm text-muted-foreground">Vehicle</p>
            <p className="font-medium">{bookingDetails.vehicleName}</p>
          </div>
          
          <div>
            <p className="text-sm text-muted-foreground">Customer Name</p>
            <p className="font-medium">{bookingDetails.customerName}</p>
          </div>
          
          <div>
            <p className="text-sm text-muted-foreground">Email</p>
            <p className="font-medium">{bookingDetails.customerEmail}</p>
          </div>
        </div>

        <div className="pt-4 border-t border-border flex justify-between items-center">
          <span className="text-lg font-semibold">Total Price:</span>
          <span className="text-3xl font-display font-bold text-accent">
            ${bookingDetails.totalPrice}
          </span>
        </div>
      </div>

      <div className="space-y-3 text-sm text-muted-foreground">
        <p>✓ A confirmation email has been sent to {bookingDetails.customerEmail}</p>
        <p>✓ Our team will contact you shortly to confirm the details</p>
        <p>✓ You will receive payment instructions before your journey</p>
      </div>

      <Button
        onClick={onClose}
        className="w-full mt-6 gradient-accent shadow-glow"
        size="lg"
      >
        Book Another Journey
      </Button>
    </Card>
  );
};

export default BookingConfirmation;
