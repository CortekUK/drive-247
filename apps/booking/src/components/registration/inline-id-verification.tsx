'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  Camera,
  CheckCircle,
  XCircle,
  Loader2,
  RotateCcw,
  Upload,
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  Sparkles,
  Shield,
} from 'lucide-react';

type VerificationStep = 'init' | 'document-front' | 'document-back' | 'selfie' | 'processing' | 'success' | 'failed' | 'review';

interface InlineIdVerificationProps {
  tenantId: string;
  tenantSlug: string;
  customerName: string;
  email: string;
  phone: string;
  onComplete: (sessionId: string) => void;
  onSkip: () => void;
}

export function InlineIdVerification({
  tenantId,
  tenantSlug,
  customerName,
  email,
  phone,
  onComplete,
  onSkip,
}: InlineIdVerificationProps) {
  const [step, setStep] = useState<VerificationStep>('init');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Image data
  const [documentFrontImage, setDocumentFrontImage] = useState<Blob | null>(null);
  const [documentBackImage, setDocumentBackImage] = useState<Blob | null>(null);
  const [selfieImage, setSelfieImage] = useState<Blob | null>(null);

  // Preview URLs
  const [documentFrontPreview, setDocumentFrontPreview] = useState('');
  const [documentBackPreview, setDocumentBackPreview] = useState('');
  const [selfiePreview, setSelfiePreview] = useState('');

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Processing state
  const [processingMessage, setProcessingMessage] = useState('');
  const [verificationResult, setVerificationResult] = useState<any>(null);

  const startSession = async () => {
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-ai-verification-session', {
        body: {
          customerDetails: { name: customerName, email, phone },
          tenantId,
          tenantSlug,
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Failed to create verification session');

      setSessionId(data.sessionId);
      setStep('document-front');
    } catch (err: any) {
      toast.error(err.message || 'Failed to start verification');
    } finally {
      setCreating(false);
    }
  };

  // Cleanup camera on unmount
  useEffect(() => {
    return () => stopCamera();
  }, []);

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    try {
      setCameraError(null);
      setIsCameraActive(false);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera not supported');
      }

      let stream: MediaStream | null = null;
      const constraintOptions = [
        { video: { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 } } },
        { video: { facingMode: { exact: mode } } },
        { video: true },
      ];

      for (const constraints of constraintOptions) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) break;
        } catch {}
      }

      if (!stream) throw new Error('Could not access camera');

      streamRef.current = stream;
      setFacingMode(mode);

      await new Promise(resolve => setTimeout(resolve, 100));

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise<void>((resolve, reject) => {
          const video = videoRef.current!;
          video.onloadedmetadata = () => {
            video.play().then(resolve).catch(reject);
          };
          setTimeout(() => reject(new Error('Camera timeout')), 5000);
        });
        setIsCameraActive(true);
      }
    } catch (err: any) {
      let errorMsg = 'Camera unavailable';
      if (err.name === 'NotAllowedError') errorMsg = 'Camera permission denied';
      else if (err.name === 'NotFoundError') errorMsg = 'No camera found';
      else if (err.message) errorMsg = err.message;
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
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
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
    if (step === 'document-front' && documentFrontImage) setStep('document-back');
    else if (step === 'document-back') setStep('selfie');
    else if (step === 'selfie' && selfieImage) processVerification();
  };

  const handleBack = () => {
    stopCamera();
    if (step === 'document-back') setStep('document-front');
    else if (step === 'selfie') setStep('document-back');
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large (max 10MB)');
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadImage = async (blob: Blob, type: string): Promise<string | null> => {
    try {
      const fileName = `ai-verification/${sessionId}/${type}.jpg`;
      const { data, error } = await supabase.storage
        .from('customer-documents')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) return null;
      return data.path;
    } catch {
      return null;
    }
  };

  const processVerification = async () => {
    if (!sessionId || !documentFrontImage || !selfieImage) {
      toast.error('Missing required images');
      return;
    }

    setStep('processing');
    setProcessingMessage('Uploading documents...');

    try {
      const documentFrontPath = await uploadImage(documentFrontImage, 'document-front');
      if (!documentFrontPath) throw new Error('Failed to upload document');

      let documentBackPath: string | undefined;
      if (documentBackImage) {
        setProcessingMessage('Uploading document back...');
        documentBackPath = (await uploadImage(documentBackImage, 'document-back')) || undefined;
      }

      setProcessingMessage('Uploading selfie...');
      const selfiePath = await uploadImage(selfieImage, 'selfie');
      if (!selfiePath) throw new Error('Failed to upload selfie');

      setProcessingMessage('Verifying your identity...');

      const { data, error } = await supabase.functions.invoke('process-ai-verification', {
        body: { sessionId, documentFrontPath, documentBackPath, selfiePath },
      });

      if (error) throw new Error(error.message);

      setVerificationResult(data);
      if (data.result === 'verified') {
        setStep('success');
        onComplete(sessionId);
      } else if (data.result === 'review_required') {
        setStep('review');
        onComplete(sessionId);
      } else {
        setStep('failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
      setStep('failed');
    }
  };

  // Start camera when entering capture steps
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (step === 'document-front' && !documentFrontImage) startCamera('environment');
      else if (step === 'document-back' && !documentBackImage) startCamera('environment');
      else if (step === 'selfie' && !selfieImage) startCamera('user');
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [step, documentFrontImage, documentBackImage, selfieImage, startCamera]);

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

  const getStepInfo = () => {
    switch (step) {
      case 'document-front':
        return { number: 1, total: 3, title: 'Front of ID', subtitle: 'Position your ID document in the frame' };
      case 'document-back':
        return { number: 2, total: 3, title: 'Back of ID', subtitle: 'Capture the back of your ID (optional)' };
      case 'selfie':
        return { number: 3, total: 3, title: 'Take a Selfie', subtitle: 'Position your face in the circle' };
      default:
        return { number: 1, total: 3, title: '', subtitle: '' };
    }
  };

  // Init step - show start button
  if (step === 'init') {
    return (
      <div className="text-center space-y-4 py-6">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <Shield className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">ID Verification</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Verify your identity by taking photos of your ID and a selfie. This is optional but recommended.
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={onSkip}>
            Skip
          </Button>
          <Button onClick={startSession} disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-2" />
                Start Verification
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // Processing
  if (step === 'processing') {
    return (
      <div className="text-center space-y-4 py-12">
        <div className="relative w-20 h-20 mx-auto">
          <div className="absolute inset-0 rounded-full border-4 border-muted"></div>
          <div className="absolute inset-0 rounded-full border-4 border-t-primary animate-spin"></div>
          <Shield className="absolute inset-0 m-auto h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">Verifying Identity</h3>
        <p className="text-sm text-muted-foreground">{processingMessage}</p>
      </div>
    );
  }

  // Success
  if (step === 'success') {
    return (
      <div className="text-center space-y-4 py-12">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto">
          <CheckCircle className="h-10 w-10 text-green-600" />
        </div>
        <h3 className="text-lg font-semibold text-green-700">Verified!</h3>
        <p className="text-sm text-muted-foreground">Your identity has been successfully verified.</p>
      </div>
    );
  }

  // Failed
  if (step === 'failed') {
    return (
      <div className="text-center space-y-4 py-12">
        <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto">
          <XCircle className="h-10 w-10 text-red-600" />
        </div>
        <h3 className="text-lg font-semibold text-red-700">Verification Failed</h3>
        <p className="text-sm text-muted-foreground">
          {verificationResult?.detail || 'We could not verify your identity. You can still submit the form.'}
        </p>
        <Button variant="outline" onClick={onSkip}>
          Continue without verification
        </Button>
      </div>
    );
  }

  // Review
  if (step === 'review') {
    return (
      <div className="text-center space-y-4 py-12">
        <div className="w-20 h-20 rounded-full bg-yellow-100 flex items-center justify-center mx-auto">
          <AlertCircle className="h-10 w-10 text-yellow-600" />
        </div>
        <h3 className="text-lg font-semibold text-yellow-700">Manual Review Required</h3>
        <p className="text-sm text-muted-foreground">
          Your verification needs additional review. You'll be notified once complete.
        </p>
      </div>
    );
  }

  // Capture steps
  const stepInfo = getStepInfo();
  const preview = getCurrentPreview();
  const hasCapture = getCurrentImage() !== null;
  const isDocumentStep = step === 'document-front' || step === 'document-back';
  const isSelfieStep = step === 'selfie';

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {step !== 'document-front' && !hasCapture && (
            <button onClick={handleBack} className="p-1 rounded hover:bg-muted">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <span className="text-sm font-medium">{stepInfo.title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {[1, 2, 3].map((num) => (
            <div
              key={num}
              className={`h-1.5 rounded-full transition-all ${
                num < stepInfo.number ? 'w-5 bg-green-500' :
                num === stepInfo.number ? 'w-7 bg-primary' : 'w-5 bg-muted'
              }`}
            />
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">{stepInfo.subtitle}</p>

      {/* Camera / Preview */}
      <div className="relative aspect-[4/3] bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover ${isSelfieStep ? 'scale-x-[-1]' : ''} ${(!isCameraActive || hasCapture) ? 'invisible' : ''}`}
        />

        {hasCapture && preview && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <img src={preview} alt="Captured" className="max-w-full max-h-full object-contain" />
          </div>
        )}

        {!isCameraActive && !hasCapture && (
          <div className="absolute inset-0 flex items-center justify-center">
            {cameraError ? (
              <div className="text-center p-4">
                <Camera className="h-8 w-8 text-white/40 mx-auto mb-2" />
                <p className="text-white/60 text-sm mb-3">{cameraError}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                >
                  <Upload className="h-4 w-4 mr-1" />
                  Upload Photo
                </Button>
              </div>
            ) : (
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-white/40 mx-auto mb-2" />
                <p className="text-white/40 text-sm">Starting camera...</p>
              </div>
            )}
          </div>
        )}

        {/* Overlay guides */}
        {isCameraActive && !hasCapture && isDocumentStep && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-[10%] left-[5%] w-8 h-8 border-l-3 border-t-3 border-white/70 rounded-tl-md" />
            <div className="absolute top-[10%] right-[5%] w-8 h-8 border-r-3 border-t-3 border-white/70 rounded-tr-md" />
            <div className="absolute bottom-[10%] left-[5%] w-8 h-8 border-l-3 border-b-3 border-white/70 rounded-bl-md" />
            <div className="absolute bottom-[10%] right-[5%] w-8 h-8 border-r-3 border-b-3 border-white/70 rounded-br-md" />
          </div>
        )}

        {isCameraActive && !hasCapture && isSelfieStep && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-40 h-52 rounded-full border-3 border-white/50" />
          </div>
        )}
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture={step === 'selfie' ? 'user' : 'environment'}
        onChange={handleFileUpload}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Action buttons */}
      {!hasCapture ? (
        <div className="flex flex-col items-center gap-2">
          <Button
            onClick={isCameraActive ? handleCapture : () => fileInputRef.current?.click()}
            disabled={!isCameraActive && !cameraError}
            size="lg"
            className="rounded-full w-16 h-16"
          >
            <Camera className="h-6 w-6" />
          </Button>
          {isCameraActive && (
            <button
              onClick={() => galleryInputRef.current?.click()}
              className="text-muted-foreground text-xs flex items-center gap-1"
            >
              <Upload className="h-3 w-3" />
              Upload from gallery
            </button>
          )}
          {step === 'document-back' && (
            <button
              onClick={() => { stopCamera(); setStep('selfie'); }}
              className="text-muted-foreground text-xs"
            >
              Skip this step
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={handleRetake}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Retake
          </Button>
          <Button onClick={handleNext}>
            {step === 'selfie' ? 'Verify Identity' : 'Continue'}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
