import { useEffect, useState } from "react";
import { CheckCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const VeriffCallback = () => {
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    // Start countdown
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          // Try to close the window
          window.close();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, []);

  const handleManualClose = () => {
    window.close();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center p-6">
      <div className="bg-card rounded-2xl shadow-metal border border-accent/20 p-8 md:p-12 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-12 h-12 text-green-500" />
        </div>

        <h1 className="text-3xl font-display font-bold text-gradient-metal mb-4">
          Verification Complete!
        </h1>

        <p className="text-lg text-muted-foreground mb-6">
          Your identity verification has been submitted successfully.
        </p>

        {countdown > 0 ? (
          <p className="text-sm text-muted-foreground mb-6">
            This window will close automatically in {countdown} second{countdown !== 1 ? 's' : ''}...
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mb-6">
            You can now close this window.
          </p>
        )}

        <Button
          onClick={handleManualClose}
          className="gradient-accent hover-lift"
        >
          <X className="w-4 h-4 mr-2" />
          Close Window
        </Button>

        <p className="text-xs text-muted-foreground mt-6">
          Return to the previous page to continue with your booking.
        </p>
      </div>
    </div>
  );
};

export default VeriffCallback;
