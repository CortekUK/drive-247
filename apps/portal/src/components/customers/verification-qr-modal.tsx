import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Clock, Smartphone, Loader2, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AISessionData {
  sessionId: string;
  qrUrl: string;
  expiresAt: Date;
}

interface VerificationQRModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionData: AISessionData | null;
  onComplete?: (result: 'GREEN' | 'RED' | 'RETRY') => void;
}

export function VerificationQRModal({ open, onOpenChange, sessionData, onComplete }: VerificationQRModalProps) {
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Start polling when modal opens with session data
  useEffect(() => {
    if (open && sessionData) {
      setIsPolling(true);
    } else {
      setIsPolling(false);
    }
  }, [open, sessionData]);

  // Timer for QR expiry countdown
  useEffect(() => {
    if (!open || !sessionData) return;

    const updateTime = () => {
      const now = new Date();
      const remaining = Math.max(0, Math.floor((sessionData.expiresAt.getTime() - now.getTime()) / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0) {
        handleClose();
        toast.error('QR code expired. Please try again.');
      }
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [open, sessionData]);

  // Poll for verification completion
  const checkStatus = useCallback(async () => {
    if (!isPolling || !sessionData) return;

    try {
      const { data, error } = await supabase
        .from('identity_verifications')
        .select('status, review_status, review_result')
        .eq('session_id', sessionData.sessionId)
        .single();

      if (error) return;

      if (data.status === 'completed') {
        setIsPolling(false);
        handleClose();

        const result = data.review_result as 'GREEN' | 'RED' | 'RETRY';
        if (result === 'GREEN') {
          toast.success('Identity verified successfully!');
        } else if (result === 'RED') {
          toast.error('Identity verification failed');
        } else {
          toast.info('Verification needs manual review');
        }
        onComplete?.(result);
      }
    } catch (err) {
      console.error('Status check error:', err);
    }
  }, [sessionData, isPolling, onComplete]);

  // Set up polling interval
  useEffect(() => {
    if (isPolling && sessionData) {
      const initialTimeout = setTimeout(checkStatus, 5000);
      pollIntervalRef.current = setInterval(checkStatus, 3000);

      return () => {
        clearTimeout(initialTimeout);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }
  }, [isPolling, sessionData, checkStatus]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleClose = () => {
    setIsPolling(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o) handleClose();
      else onOpenChange(o);
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            Identity Verification
          </DialogTitle>
          <DialogDescription>
            Have the customer scan this QR code with their phone camera.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center space-y-6 py-6">
          {sessionData && (
            <div
              className="rounded-xl shadow-lg border-2 border-gray-200"
              style={{
                backgroundColor: '#FFFFFF',
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <img
                src={`https://quickchart.io/qr?text=${encodeURIComponent(sessionData.qrUrl)}&size=300&margin=3&dark=000000&light=ffffff&ecLevel=M&format=png`}
                alt="Scan QR code to verify identity"
                width={300}
                height={300}
                style={{ display: 'block', imageRendering: 'pixelated' }}
              />
            </div>
          )}

          <div className="w-full space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-4 w-4" />
                Time remaining
              </span>
              <span className={`font-mono font-medium ${timeRemaining < 60 ? 'text-destructive' : 'text-foreground'}`}>
                {formatTime(timeRemaining)}
              </span>
            </div>
            <Progress value={(timeRemaining / 900) * 100} className="h-2" />
          </div>

          <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-full text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Waiting for customer to complete verification...</span>
          </div>

          {sessionData && (
            <div className="w-full space-y-2">
              <p className="text-xs text-center text-muted-foreground">
                Can't scan? Share this link with the customer:
              </p>
              <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                <input
                  type="text"
                  readOnly
                  value={sessionData.qrUrl}
                  className="flex-1 bg-transparent text-xs truncate border-none focus:outline-none"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(sessionData.qrUrl);
                    toast.success('Link copied to clipboard');
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
