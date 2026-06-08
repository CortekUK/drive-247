"use client";

import { useEffect, useState } from "react";
import { CheckCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tile, Eyebrow } from "@/components/bento";

export default function VeriffCallbackPage() {
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
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Tile pad="roomy" className="p-8 md:p-12 max-w-md w-full text-center">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 [background:var(--bento-success-weak)]">
          <CheckCircle className="w-12 h-12 text-[color:var(--bento-success)]" />
        </div>

        <Eyebrow className="text-center mb-2">Identity check</Eyebrow>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground mb-4">Verification Complete!</h1>

        <p className="text-base text-muted-foreground mb-6">
          The identity verification has been submitted successfully.
        </p>

        {countdown > 0 ? (
          <p className="text-sm text-muted-foreground mb-6 font-mono tabular-nums">
            This window will close automatically in {countdown} second
            {countdown !== 1 ? "s" : ""}…
          </p>
        ) : (
          <p className="text-sm text-muted-foreground mb-6">
            You can now close this window.
          </p>
        )}

        <Button onClick={handleManualClose} className="w-full sm:w-auto">
          <X className="w-4 h-4 mr-2" />
          Close Window
        </Button>

        <p className="text-xs text-muted-foreground mt-6">
          Return to the previous page to check verification status.
        </p>
      </Tile>
    </div>
  );
}
