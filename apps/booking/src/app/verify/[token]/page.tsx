'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  Camera,
  CheckCircle,
  XCircle,
  Loader2,
  RotateCcw,
  Upload,
  IdCard,
  User,
  AlertCircle,
  ChevronRight
} from 'lucide-react';

type VerificationStep = 'loading' | 'error' | 'document-front' | 'document-back' | 'selfie' | 'processing' | 'success' | 'failed' | 'review';

interface SessionData {
  sessionId: string;
  tenantSlug: string;
  tenantName: string;
  tenantLogo: string;
  customerName: string;
  expiresAt: string;
}

export default function VerifyPage() {
  const params = useParams();
  const token = params.token as string;

  const [step, setStep] = useState<VerificationStep>('loading');
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [error, setError] = useState<string>('');

  // Image data
  const [documentFrontImage, setDocumentFrontImage] = useState<Blob | null>(null);
  const [documentBackImage, setDocumentBackImage] = useState<Blob | null>(null);
  const [selfieImage, setSelfieImage] = useState<Blob | null>(null);

  // Preview URLs
  const [documentFrontPreview, setDocumentFrontPreview] = useState<string>('');
  const [documentBackPreview, setDocumentBackPreview] = useState<string>('');
  const [selfiePreview, setSelfiePreview] = useState<string>('');

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processing state
  const [processingMessage, setProcessingMessage] = useState('');
  const [verificationResult, setVerificationResult] = useState<any>(null);

  // Validate session on mount
  useEffect(() => {
    if (token) {
      validateSession();
    }
  }, [token]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const validateSession = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('validate-ai-session', {
        body: { qrToken: token }
      });

      if (error || !data?.ok) {
        setError(data?.detail || data?.error || 'Invalid or expired QR code');
        setStep('error');
        return;
      }

      setSessionData(data);
      setStep('document-front');
    } catch (err) {
      console.error('Session validation error:', err);
      setError('Failed to validate session. Please try again.');
      setStep('error');
    }
  };

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    try {
      console.log('[Camera] Starting camera with mode:', mode);
      setCameraError(null);
      setIsCameraActive(false);

      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera not supported. Please use file upload.');
      }

      // Try different constraint configurations for better compatibility
      let stream: MediaStream | null = null;
      const constraintOptions = [
        // Try with specific facing mode first
        { video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } } },
        // Fallback to exact facing mode
        { video: { facingMode: { exact: mode } } },
        // Fallback to any camera
        { video: true }
      ];

      for (const constraints of constraintOptions) {
        try {
          console.log('[Camera] Trying constraints:', JSON.stringify(constraints));
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) {
            console.log('[Camera] Got stream with constraints:', JSON.stringify(constraints));
            break;
          }
        } catch (e) {
          console.log('[Camera] Failed with constraints:', JSON.stringify(constraints));
        }
      }

      if (!stream) {
        throw new Error('Could not access any camera. Please use file upload.');
      }

      streamRef.current = stream;
      setFacingMode(mode);

      // Wait a bit for video element to be in DOM
      await new Promise(resolve => setTimeout(resolve, 100));

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        // Wait for video to be ready
        await new Promise<void>((resolve, reject) => {
          const video = videoRef.current!;
          video.onloadedmetadata = () => {
            console.log('[Camera] Video metadata loaded');
            video.play()
              .then(() => {
                console.log('[Camera] Video playing successfully');
                resolve();
              })
              .catch(reject);
          };
          video.onerror = () => reject(new Error('Video element error'));
          // Timeout after 5 seconds
          setTimeout(() => reject(new Error('Camera timeout')), 5000);
        });

        setIsCameraActive(true);
        console.log('[Camera] Camera active and playing');
      } else {
        throw new Error('Video element not ready');
      }
    } catch (err: any) {
      console.error('[Camera] Error:', err);
      let errorMsg = 'Unable to access camera';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMsg = 'Camera permission denied. Tap below to upload a photo instead.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMsg = 'No camera found. Tap below to upload a photo instead.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMsg = 'Camera is in use by another app. Tap below to upload a photo instead.';
      } else if (err.message) {
        errorMsg = err.message;
      }
      setCameraError(errorMsg);
      setIsCameraActive(false);
    }
  }, []);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current) return null;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Mirror the image if using front camera
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0);

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', 0.9);
    });
  }, [facingMode]);

  const handleCapture = async () => {
    const blob = await capturePhoto();
    if (!blob) {
      toast.error('Failed to capture photo');
      return;
    }

    const previewUrl = URL.createObjectURL(blob);

    if (step === 'document-front') {
      setDocumentFrontImage(blob);
      setDocumentFrontPreview(previewUrl);
    } else if (step === 'document-back') {
      setDocumentBackImage(blob);
      setDocumentBackPreview(previewUrl);
    } else if (step === 'selfie') {
      setSelfieImage(blob);
      setSelfiePreview(previewUrl);
    }

    stopCamera();
  };

  const handleRetake = () => {
    if (step === 'document-front') {
      setDocumentFrontImage(null);
      setDocumentFrontPreview('');
      startCamera('environment');
    } else if (step === 'document-back') {
      setDocumentBackImage(null);
      setDocumentBackPreview('');
      startCamera('environment');
    } else if (step === 'selfie') {
      setSelfieImage(null);
      setSelfiePreview('');
      startCamera('user');
    }
  };

  const handleNext = () => {
    stopCamera();
    if (step === 'document-front' && documentFrontImage) {
      setStep('document-back');
    } else if (step === 'document-back') {
      setStep('selfie');
    } else if (step === 'selfie' && selfieImage) {
      processVerification();
    }
  };

  const handleSkipBack = () => {
    stopCamera();
    setStep('selfie');
  };

  // Handle file upload as fallback for camera
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Maximum 10MB allowed.');
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    if (step === 'document-front') {
      setDocumentFrontImage(file);
      setDocumentFrontPreview(previewUrl);
    } else if (step === 'document-back') {
      setDocumentBackImage(file);
      setDocumentBackPreview(previewUrl);
    } else if (step === 'selfie') {
      setSelfieImage(file);
      setSelfiePreview(previewUrl);
    }

    stopCamera();

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const uploadImage = async (blob: Blob, type: string): Promise<string | null> => {
    try {
      const fileName = `ai-verification/${sessionData?.sessionId}/${type}.jpg`;
      const { data, error } = await supabase.storage
        .from('customer-documents')
        .upload(fileName, blob, {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (error) {
        console.error('Upload error:', error);
        return null;
      }

      return data.path;
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    }
  };

  const processVerification = async () => {
    if (!sessionData || !documentFrontImage || !selfieImage) {
      toast.error('Missing required images');
      return;
    }

    setStep('processing');
    setProcessingMessage('Uploading document...');

    try {
      // Upload document front
      const documentFrontPath = await uploadImage(documentFrontImage, 'document-front');
      if (!documentFrontPath) {
        throw new Error('Failed to upload document front');
      }

      // Upload document back if captured
      let documentBackPath: string | undefined;
      if (documentBackImage) {
        setProcessingMessage('Uploading document back...');
        documentBackPath = await uploadImage(documentBackImage, 'document-back') || undefined;
      }

      // Upload selfie
      setProcessingMessage('Uploading selfie...');
      const selfiePath = await uploadImage(selfieImage, 'selfie');
      if (!selfiePath) {
        throw new Error('Failed to upload selfie');
      }

      // Process verification
      setProcessingMessage('Verifying identity...');
      const { data, error } = await supabase.functions.invoke('process-ai-verification', {
        body: {
          sessionId: sessionData.sessionId,
          documentFrontPath,
          documentBackPath,
          selfiePath
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      setVerificationResult(data);

      if (data.result === 'verified') {
        setStep('success');
      } else if (data.result === 'review_required') {
        setStep('review');
      } else {
        setStep('failed');
      }
    } catch (err: any) {
      console.error('Verification error:', err);
      toast.error(err.message || 'Verification failed');
      setError(err.message || 'Verification failed');
      setStep('failed');
    }
  };

  // Start camera when entering a capture step
  useEffect(() => {
    console.log('[Camera Effect] Step changed to:', step);

    // Small delay to ensure DOM is ready
    const timeoutId = setTimeout(() => {
      if (step === 'document-front' && !documentFrontImage) {
        console.log('[Camera Effect] Starting camera for document-front');
        startCamera('environment');
      } else if (step === 'document-back' && !documentBackImage) {
        console.log('[Camera Effect] Starting camera for document-back');
        startCamera('environment');
      } else if (step === 'selfie' && !selfieImage) {
        console.log('[Camera Effect] Starting camera for selfie');
        startCamera('user');
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [step, documentFrontImage, documentBackImage, selfieImage, startCamera]);

  // Get current preview based on step
  const getCurrentPreview = () => {
    if (step === 'document-front') return documentFrontPreview;
    if (step === 'document-back') return documentBackPreview;
    if (step === 'selfie') return selfiePreview;
    return '';
  };

  const getCurrentImage = () => {
    if (step === 'document-front') return documentFrontImage;
    if (step === 'document-back') return documentBackImage;
    if (step === 'selfie') return selfieImage;
    return null;
  };

  // Render loading state
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Validating session...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render error state
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
            <CardTitle>Verification Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Please request a new QR code and try again.
            </p>
            <Button variant="outline" onClick={() => window.close()}>
              Close
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render processing state
  if (step === 'processing') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium mb-2">Processing Verification</p>
            <p className="text-muted-foreground text-center">{processingMessage}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render success state
  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <CardTitle className="text-green-600">Verification Successful!</CardTitle>
            <CardDescription>Your identity has been verified.</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            {verificationResult?.details?.ocrData && (
              <div className="bg-muted rounded-lg p-4 mb-4 text-left">
                <p className="text-sm font-medium mb-2">Verified Details:</p>
                <p className="text-sm">
                  Name: {verificationResult.details.ocrData.firstName} {verificationResult.details.ocrData.lastName}
                </p>
                {verificationResult.details.ocrData.documentNumber && (
                  <p className="text-sm">
                    Document: ****{verificationResult.details.ocrData.documentNumber.slice(-4)}
                  </p>
                )}
              </div>
            )}
            <p className="text-sm text-muted-foreground mb-4">
              You can now close this window and continue with your booking.
            </p>
            <Button onClick={() => window.close()}>Close Window</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render failed state
  if (step === 'failed') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
            <CardTitle className="text-destructive">Verification Failed</CardTitle>
            <CardDescription>
              {verificationResult?.detail || 'We could not verify your identity.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Please ensure your photos are clear and your face matches your ID document.
            </p>
            <Button onClick={() => window.close()}>Close Window</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render review required state
  if (step === 'review') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <AlertCircle className="h-16 w-16 text-yellow-500 mx-auto mb-4" />
            <CardTitle className="text-yellow-600">Manual Review Required</CardTitle>
            <CardDescription>
              Your verification needs additional review by our team.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              This usually takes a few minutes. You will be notified once the review is complete.
            </p>
            <Button onClick={() => window.close()}>Close Window</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render capture steps
  const isDocumentStep = step === 'document-front' || step === 'document-back';
  const isSelfieStep = step === 'selfie';
  const preview = getCurrentPreview();
  const hasCapture = getCurrentImage() !== null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted flex flex-col">
      {/* Header */}
      <div className="p-4 text-center border-b bg-background">
        {sessionData?.tenantLogo ? (
          <img
            src={sessionData.tenantLogo}
            alt={sessionData.tenantName}
            className="h-8 mx-auto mb-2"
          />
        ) : (
          <h1 className="text-lg font-bold">{sessionData?.tenantName || 'Identity Verification'}</h1>
        )}
        <p className="text-sm text-muted-foreground">
          {sessionData?.customerName ? `Verifying: ${sessionData.customerName}` : 'Secure Identity Verification'}
        </p>
      </div>

      {/* Progress */}
      <div className="p-4 bg-background border-b">
        <div className="flex items-center justify-center gap-2 text-sm">
          <div className={`flex items-center gap-1 ${step === 'document-front' ? 'text-primary font-medium' : documentFrontImage ? 'text-green-600' : 'text-muted-foreground'}`}>
            <IdCard className="h-4 w-4" />
            <span>Front</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className={`flex items-center gap-1 ${step === 'document-back' ? 'text-primary font-medium' : documentBackImage ? 'text-green-600' : 'text-muted-foreground'}`}>
            <IdCard className="h-4 w-4" />
            <span>Back</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className={`flex items-center gap-1 ${step === 'selfie' ? 'text-primary font-medium' : selfieImage ? 'text-green-600' : 'text-muted-foreground'}`}>
            <User className="h-4 w-4" />
            <span>Selfie</span>
          </div>
        </div>
      </div>

      {/* Camera / Preview Area */}
      <div className="flex-1 relative bg-black">
        {/* Always render video element but hide when not active */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${isSelfieStep ? 'scale-x-[-1]' : ''} ${(!isCameraActive || hasCapture) ? 'hidden' : ''}`}
        />

        {/* Show captured image preview */}
        {hasCapture && preview && (
          <img
            src={preview}
            alt="Captured"
            className="w-full h-full object-contain"
          />
        )}

        {/* Show loading/error state when camera not active and no capture */}
        {!isCameraActive && !hasCapture && (
          <div className="w-full h-full flex items-center justify-center text-white">
            <div className="text-center p-4">
              {cameraError ? (
                <>
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 text-yellow-500" />
                  <p className="mb-2">Camera unavailable</p>
                  <p className="text-sm text-gray-400 mb-4">{cameraError}</p>
                  <Button onClick={triggerFileUpload} variant="secondary">
                    <Upload className="mr-2 h-4 w-4" />
                    Upload from device
                  </Button>
                </>
              ) : (
                <>
                  <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin opacity-50" />
                  <p>Starting camera...</p>
                  <p className="text-sm text-gray-400 mt-2">Please allow camera access when prompted</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Overlay guides */}
        {isCameraActive && !hasCapture && (
          <div className="absolute inset-0 pointer-events-none">
            {isDocumentStep ? (
              // Document guide overlay
              <div className="absolute inset-8 border-2 border-white/50 rounded-lg">
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-white text-center text-sm bg-black/50 px-4 py-2 rounded">
                    {step === 'document-front' ? 'Position front of ID document' : 'Position back of ID document'}
                  </p>
                </div>
              </div>
            ) : (
              // Selfie guide overlay (oval)
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-64 border-4 border-white/50 rounded-full" />
                <p className="absolute bottom-20 text-white text-center text-sm bg-black/50 px-4 py-2 rounded">
                  Position your face in the oval
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="p-4 bg-background border-t">
        <p className="text-center text-sm text-muted-foreground mb-4">
          {step === 'document-front' && 'Take a clear photo of the front of your ID document'}
          {step === 'document-back' && 'Take a clear photo of the back of your ID document (optional)'}
          {step === 'selfie' && 'Take a selfie matching the photo on your ID'}
        </p>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture={step === 'selfie' ? 'user' : 'environment'}
          onChange={handleFileUpload}
          className="hidden"
        />

        {/* Action buttons */}
        <div className="flex flex-col gap-3 items-center">
          {!hasCapture ? (
            <>
              {isCameraActive ? (
                <Button
                  size="lg"
                  onClick={handleCapture}
                  className="w-full max-w-xs"
                >
                  <Camera className="mr-2 h-5 w-5" />
                  Capture Photo
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={triggerFileUpload}
                  className="w-full max-w-xs"
                >
                  <Upload className="mr-2 h-5 w-5" />
                  {step === 'selfie' ? 'Upload Selfie' : 'Upload Photo'}
                </Button>
              )}
              {/* Show both options */}
              {isCameraActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={triggerFileUpload}
                  className="text-muted-foreground"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Or upload from gallery
                </Button>
              )}
              {cameraError && !isCameraActive && (
                <p className="text-xs text-muted-foreground text-center">
                  {cameraError}
                </p>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" size="lg" onClick={handleRetake}>
                <RotateCcw className="mr-2 h-5 w-5" />
                Retake
              </Button>
              {step === 'document-back' && !documentBackImage && (
                <Button variant="outline" size="lg" onClick={handleSkipBack}>
                  Skip
                </Button>
              )}
              <Button size="lg" onClick={handleNext}>
                {step === 'selfie' ? (
                  <>
                    <Upload className="mr-2 h-5 w-5" />
                    Submit
                  </>
                ) : (
                  <>
                    Next
                    <ChevronRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </>
          )}
        </div>

        {/* Skip option for document back */}
        {step === 'document-back' && !hasCapture && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkipBack}
            className="w-full mt-2"
          >
            Skip - my ID doesn't have a back
          </Button>
        )}
      </div>
    </div>
  );
}
