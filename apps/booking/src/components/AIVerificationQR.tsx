'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  Clock,
  CheckCircle,
  RefreshCw,
  Smartphone,
  Loader2,
  AlertCircle,
  Camera,
  FileCheck,
  User,
  Upload,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AIVerificationQRProps {
  sessionId: string;
  qrUrl: string;
  expiresAt: Date;
  onVerified: (data: VerificationResult) => void;
  onExpired: () => void;
  onRetry?: () => void;
}

interface VerificationResult {
  first_name?: string | null;
  last_name?: string | null;
  document_number?: string | null;
  review_result?: string;
  ai_face_match_score?: number;
}

interface VerificationData {
  status: string;
  review_status: string | null;
  review_result: string | null;
  first_name: string | null;
  last_name: string | null;
  document_number: string | null;
  ai_face_match_score: number | null;
  verification_step: string | null;
  upload_progress: {
    document_front?: boolean;
    document_back?: boolean;
    selfie?: boolean;
  } | null;
  document_front_url: string | null;
  document_back_url: string | null;
  selfie_image_url: string | null;
}

// Step configuration for display
const STEP_CONFIG = {
  init: { label: 'Waiting for scan', icon: Smartphone, progress: 0 },
  qr_scanned: { label: 'QR Code scanned', icon: CheckCircle, progress: 10 },
  document_front: { label: 'Capturing ID front', icon: Camera, progress: 20 },
  document_front_captured: { label: 'ID front captured', icon: FileCheck, progress: 35 },
  document_back: { label: 'Capturing ID back', icon: Camera, progress: 45 },
  document_back_captured: { label: 'ID back captured', icon: FileCheck, progress: 55 },
  selfie: { label: 'Taking selfie', icon: User, progress: 65 },
  selfie_captured: { label: 'Selfie captured', icon: FileCheck, progress: 75 },
  uploading: { label: 'Uploading images', icon: Upload, progress: 85 },
  processing: { label: 'Verifying identity', icon: Sparkles, progress: 95 },
  completed: { label: 'Verification complete', icon: CheckCircle, progress: 100 },
};

// Generate a real QR code URL using quickchart.io API
function getQRCodeUrl(text: string, size: number = 300): string {
  return `https://quickchart.io/qr?text=${encodeURIComponent(text)}&size=${size}&margin=3&dark=000000&light=ffffff&ecLevel=M&format=png`;
}

export default function AIVerificationQR({
  sessionId,
  qrUrl,
  expiresAt,
  onVerified,
  onExpired,
  onRetry
}: AIVerificationQRProps) {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [status, setStatus] = useState<'pending' | 'verified' | 'expired' | 'failed'>('pending');
  const [currentStep, setCurrentStep] = useState<string>('init');
  const [verificationData, setVerificationData] = useState<VerificationData | null>(null);
  const subscriptionRef = useRef<any>(null);
  const hasCalledOnVerified = useRef(false);

  // Generate QR code URL using external API for reliable scanning
  const qrCodeImageUrl = getQRCodeUrl(qrUrl, 300);

  // Get step display info
  const stepInfo = STEP_CONFIG[currentStep as keyof typeof STEP_CONFIG] || STEP_CONFIG.init;
  const StepIcon = stepInfo.icon;

  // Calculate remaining time
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const expiry = new Date(expiresAt);
      const remaining = Math.max(0, Math.floor((expiry.getTime() - now.getTime()) / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0 && status === 'pending') {
        setStatus('expired');
        onExpired();
      }
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, status, onExpired]);

  // Handle verification data changes
  const handleVerificationUpdate = useCallback((data: VerificationData) => {
    setVerificationData(data);

    // Update current step
    if (data.verification_step) {
      setCurrentStep(data.verification_step);
    }

    // Check for completion
    if (data.status === 'completed' && !hasCalledOnVerified.current) {
      hasCalledOnVerified.current = true;

      if (data.review_result === 'GREEN') {
        setStatus('verified');
        onVerified(data);
        toast.success('Identity verified successfully!');
      } else if (data.review_result === 'RED') {
        setStatus('failed');
        toast.error('Identity verification failed');
      } else if (data.review_result === 'RETRY') {
        // Manual review needed - still allow to proceed
        setStatus('verified');
        onVerified(data);
        toast.info('Verification submitted for review');
      }
    }
  }, [onVerified]);

  // Set up Supabase Realtime subscription
  useEffect(() => {
    if (status !== 'pending') return;

    // First, do an initial fetch to get current state
    const fetchInitialState = async () => {
      const { data, error } = await supabase
        .from('identity_verifications')
        .select('status, review_status, review_result, first_name, last_name, document_number, ai_face_match_score, verification_step, upload_progress, document_front_url, document_back_url, selfie_image_url')
        .eq('session_id', sessionId)
        .single();

      if (!error && data) {
        handleVerificationUpdate(data as VerificationData);
      }
    };

    fetchInitialState();

    // Subscribe to realtime changes
    const channel = supabase
      .channel(`verification-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'identity_verifications',
          filter: `session_id=eq.${sessionId}`
        },
        (payload) => {
          console.log('Realtime update received:', payload.new);
          handleVerificationUpdate(payload.new as VerificationData);
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
      });

    subscriptionRef.current = channel;

    // Cleanup subscription on unmount
    return () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
      }
    };
  }, [sessionId, status, handleVerificationUpdate]);

  // Format time remaining
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle retry - properly cleanup and call parent
  const handleRetry = useCallback(() => {
    // Cleanup subscription
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
      subscriptionRef.current = null;
    }

    // Reset state
    hasCalledOnVerified.current = false;
    setStatus('pending');
    setCurrentStep('init');
    setVerificationData(null);

    // Call parent retry handler
    if (onRetry) {
      onRetry();
    }
  }, [onRetry]);

  // Render expired state
  if (status === 'expired') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-2" />
          <CardTitle>QR Code Expired</CardTitle>
          <CardDescription>
            The verification session has expired. Please request a new QR code.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button onClick={handleRetry}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Get New QR Code
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Render verified state
  if (status === 'verified') {
    return (
      <Card className="w-full max-w-md mx-auto border-green-500">
        <CardHeader className="text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
          <CardTitle className="text-green-600">Verified!</CardTitle>
          <CardDescription>
            Your identity has been successfully verified.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Render failed state
  if (status === 'failed') {
    return (
      <Card className="w-full max-w-md mx-auto border-destructive">
        <CardHeader className="text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-2" />
          <CardTitle className="text-destructive">Verification Failed</CardTitle>
          <CardDescription>
            We could not verify your identity. Please try again.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button onClick={handleRetry} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Check if user has scanned QR (any step beyond init)
  const hasScanned = currentStep !== 'init';

  // Render QR code with real-time progress
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center pb-2">
        <div className="flex items-center justify-center gap-2 text-primary mb-2">
          <Smartphone className="h-5 w-5" />
          <span className="text-sm font-medium">
            {hasScanned ? 'Verification in progress' : 'Scan with your phone'}
          </span>
        </div>
        <CardTitle className="text-lg">Identity Verification</CardTitle>
        <CardDescription>
          {hasScanned
            ? 'Complete the verification steps on your phone'
            : 'Scan this QR code with your phone camera to verify your identity'
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        {/* Show QR Code when not scanned, or show progress when scanned */}
        {!hasScanned ? (
          <>
            {/* QR Code */}
            <div className="relative bg-white p-4 rounded-lg shadow-sm mb-4">
              <img
                src={qrCodeImageUrl}
                alt="Verification QR Code"
                className="w-64 h-64"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>

            {/* Timer */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Clock className="h-4 w-4" />
              <span>Expires in {formatTime(timeRemaining)}</span>
            </div>

            {/* Instructions */}
            <div className="text-center text-sm text-muted-foreground space-y-2">
              <p className="font-medium">How to verify:</p>
              <ol className="text-left space-y-1 pl-4">
                <li>1. Open your phone's camera</li>
                <li>2. Point it at the QR code</li>
                <li>3. Tap the link that appears</li>
                <li>4. Follow the prompts to take photos</li>
              </ol>
            </div>

            {/* Manual URL option */}
            <details className="mt-4 w-full">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Can't scan? Click for manual link
              </summary>
              <div className="mt-2 p-2 bg-muted rounded text-xs break-all">
                <a href={qrUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {qrUrl}
                </a>
              </div>
            </details>
          </>
        ) : (
          <>
            {/* Real-time Progress Display */}
            <div className="w-full space-y-6">
              {/* Progress bar */}
              <div className="w-full">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-muted-foreground">Progress</span>
                  <span className="text-sm font-medium text-primary">{stepInfo.progress}%</span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
                    style={{ width: `${stepInfo.progress}%` }}
                  />
                </div>
              </div>

              {/* Current step indicator */}
              <div className="flex items-center justify-center gap-3 py-4 px-4 bg-muted/50 rounded-lg">
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center",
                  currentStep === 'completed' ? 'bg-green-500/20' : 'bg-primary/20'
                )}>
                  {currentStep === 'uploading' || currentStep === 'processing' ? (
                    <Loader2 className={cn(
                      "h-6 w-6 animate-spin",
                      currentStep === 'completed' ? 'text-green-500' : 'text-primary'
                    )} />
                  ) : (
                    <StepIcon className={cn(
                      "h-6 w-6",
                      currentStep === 'completed' ? 'text-green-500' : 'text-primary'
                    )} />
                  )}
                </div>
                <div className="text-left">
                  <p className="font-medium">{stepInfo.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {currentStep === 'processing' ? 'This may take a few seconds...' : 'Continue on your phone'}
                  </p>
                </div>
              </div>

              {/* Step indicators */}
              <div className="flex justify-between items-center px-2">
                {[
                  { key: 'qr_scanned', label: 'Scanned' },
                  { key: 'document_front_captured', label: 'ID Front' },
                  { key: 'document_back_captured', label: 'ID Back' },
                  { key: 'selfie_captured', label: 'Selfie' },
                  { key: 'completed', label: 'Done' }
                ].map((s, index) => {
                  const stepProgress = STEP_CONFIG[s.key as keyof typeof STEP_CONFIG]?.progress || 0;
                  const isComplete = stepInfo.progress >= stepProgress;
                  const isCurrent = currentStep === s.key ||
                    (currentStep.includes(s.key.replace('_captured', '')) && !currentStep.includes('captured'));

                  return (
                    <div key={s.key} className="flex flex-col items-center">
                      <div className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-all",
                        isComplete ? 'bg-primary text-primary-foreground' :
                        isCurrent ? 'bg-primary/20 text-primary border-2 border-primary' :
                        'bg-muted text-muted-foreground'
                      )}>
                        {isComplete ? <CheckCircle className="h-3.5 w-3.5" /> : index + 1}
                      </div>
                      <span className={cn(
                        "text-[10px] mt-1",
                        isComplete ? 'text-primary font-medium' : 'text-muted-foreground'
                      )}>
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Uploaded Images Display */}
              {(verificationData?.document_front_url || verificationData?.document_back_url || verificationData?.selfie_image_url) && (
                <div className="w-full space-y-3">
                  <p className="text-sm font-medium text-muted-foreground text-center">Uploaded Images</p>
                  <div className="grid grid-cols-3 gap-2">
                    {/* ID Front */}
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "w-full aspect-[3/4] rounded-lg overflow-hidden border-2 bg-muted/50",
                        verificationData?.document_front_url ? "border-primary/30" : "border-muted"
                      )}>
                        {verificationData?.document_front_url ? (
                          <img
                            src={verificationData.document_front_url}
                            alt="ID Front"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Camera className="h-6 w-6 text-muted-foreground/50" />
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] mt-1 text-muted-foreground">ID Front</span>
                    </div>

                    {/* ID Back */}
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "w-full aspect-[3/4] rounded-lg overflow-hidden border-2 bg-muted/50",
                        verificationData?.document_back_url ? "border-primary/30" : "border-muted"
                      )}>
                        {verificationData?.document_back_url ? (
                          <img
                            src={verificationData.document_back_url}
                            alt="ID Back"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Camera className="h-6 w-6 text-muted-foreground/50" />
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] mt-1 text-muted-foreground">ID Back</span>
                    </div>

                    {/* Selfie */}
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "w-full aspect-[3/4] rounded-lg overflow-hidden border-2 bg-muted/50",
                        verificationData?.selfie_image_url ? "border-primary/30" : "border-muted"
                      )}>
                        {verificationData?.selfie_image_url ? (
                          <img
                            src={verificationData.selfie_image_url}
                            alt="Selfie"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <User className="h-6 w-6 text-muted-foreground/50" />
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] mt-1 text-muted-foreground">Selfie</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Timer (still show while in progress) */}
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Session expires in {formatTime(timeRemaining)}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
