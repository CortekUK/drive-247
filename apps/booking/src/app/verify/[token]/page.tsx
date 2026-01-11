'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Camera,
  CheckCircle,
  XCircle,
  Loader2,
  RotateCcw,
  Upload,
  User,
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  Sparkles,
  Shield,
  ScanLine
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

  // Sync verification step to database for real-time updates on desktop
  const syncStepToDatabase = useCallback(async (
    newStep: string,
    uploadProgress?: { document_front?: boolean; document_back?: boolean; selfie?: boolean }
  ) => {
    if (!sessionData?.sessionId) return;

    try {
      const updateData: any = {
        verification_step: newStep,
        updated_at: new Date().toISOString()
      };

      if (uploadProgress) {
        updateData.upload_progress = uploadProgress;
      }

      await supabase
        .from('identity_verifications')
        .update(updateData)
        .eq('session_id', sessionData.sessionId);
    } catch (err) {
      console.error('Failed to sync step:', err);
    }
  }, [sessionData?.sessionId]);

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

  // Sync step changes to database for real-time desktop updates
  useEffect(() => {
    if (!sessionData?.sessionId) return;

    // Map internal step to database step
    const stepMap: Record<VerificationStep, string> = {
      'loading': 'init',
      'error': 'init',
      'document-front': 'document_front',
      'document-back': 'document_back',
      'selfie': 'selfie',
      'processing': 'processing',
      'success': 'completed',
      'failed': 'completed',
      'review': 'completed'
    };

    const dbStep = stepMap[step] || step;
    syncStepToDatabase(dbStep);
  }, [step, sessionData?.sessionId, syncStepToDatabase]);

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

      // Mark QR as scanned in database immediately
      try {
        await supabase
          .from('identity_verifications')
          .update({
            verification_step: 'qr_scanned',
            updated_at: new Date().toISOString()
          })
          .eq('session_id', data.sessionId);
      } catch (syncErr) {
        console.error('Failed to sync QR scan:', syncErr);
      }

      setStep('document-front');
    } catch (err) {
      console.error('Session validation error:', err);
      setError('Failed to validate session. Please try again.');
      setStep('error');
    }
  };

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    try {
      setCameraError(null);
      setIsCameraActive(false);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera not supported');
      }

      let stream: MediaStream | null = null;
      const constraintOptions = [
        { video: { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 } } },
        { video: { facingMode: { exact: mode } } },
        { video: true }
      ];

      for (const constraints of constraintOptions) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) break;
        } catch (e) { }
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
      // Sync capture to database
      syncStepToDatabase('document_front_captured', { document_front: true });
    } else if (step === 'document-back') {
      setDocumentBackImage(blob);
      setDocumentBackPreview(previewUrl);
      // Sync capture to database
      syncStepToDatabase('document_back_captured', { document_front: true, document_back: true });
    } else if (step === 'selfie') {
      setSelfieImage(blob);
      setSelfiePreview(previewUrl);
      // Sync capture to database
      syncStepToDatabase('selfie_captured', { document_front: true, document_back: !!documentBackImage, selfie: true });
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

  const handleBack = () => {
    stopCamera();
    if (step === 'document-back') {
      setStep('document-front');
    } else if (step === 'selfie') {
      setStep('document-back');
    }
  };

  const handleSkipBack = () => {
    stopCamera();
    setStep('selfie');
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
      const fileName = `ai-verification/${sessionData?.sessionId}/${type}.jpg`;
      const { data, error } = await supabase.storage
        .from('customer-documents')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) return null;
      return data.path;
    } catch (err) {
      return null;
    }
  };

  const processVerification = async () => {
    if (!sessionData || !documentFrontImage || !selfieImage) {
      toast.error('Missing required images');
      return;
    }

    setStep('processing');
    setProcessingMessage('Uploading documents...');

    // Sync uploading state to database
    syncStepToDatabase('uploading');

    try {
      const documentFrontPath = await uploadImage(documentFrontImage, 'document-front');
      if (!documentFrontPath) throw new Error('Failed to upload document');

      let documentBackPath: string | undefined;
      if (documentBackImage) {
        setProcessingMessage('Uploading document back...');
        documentBackPath = await uploadImage(documentBackImage, 'document-back') || undefined;
      }

      setProcessingMessage('Uploading selfie...');
      const selfiePath = await uploadImage(selfieImage, 'selfie');
      if (!selfiePath) throw new Error('Failed to upload selfie');

      setProcessingMessage('Verifying your identity...');
      // Sync processing state to database
      syncStepToDatabase('processing');

      const { data, error } = await supabase.functions.invoke('process-ai-verification', {
        body: { sessionId: sessionData.sessionId, documentFrontPath, documentBackPath, selfiePath }
      });

      if (error) throw new Error(error.message);

      setVerificationResult(data);
      if (data.result === 'verified') setStep('success');
      else if (data.result === 'review_required') setStep('review');
      else setStep('failed');
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
      setError(err.message || 'Verification failed');
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

  // Get step info
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

  // Loading state
  if (step === 'loading') {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-white/80" />
          <p className="text-white/60">Validating session...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (step === 'error') {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-gray-900 to-black flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
            <XCircle className="h-10 w-10 text-red-500" />
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Session Expired</h1>
          <p className="text-gray-400 mb-8">{error}</p>
          <p className="text-sm text-gray-500">Please request a new verification link.</p>
        </div>
      </div>
    );
  }

  // Processing state
  if (step === 'processing') {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-gray-900 to-black flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-white/10"></div>
            <div className="absolute inset-0 rounded-full border-4 border-t-white animate-spin"></div>
            <Shield className="absolute inset-0 m-auto h-10 w-10 text-white/80" />
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Verifying Identity</h1>
          <p className="text-gray-400">{processingMessage}</p>
        </div>
      </div>
    );
  }

  // Success state
  if (step === 'success') {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-green-900/50 to-black flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6 animate-pulse">
            <CheckCircle className="h-12 w-12 text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Verified!</h1>
          <p className="text-gray-300 mb-8">Your identity has been successfully verified.</p>
          {verificationResult?.details?.ocrData && (
            <div className="bg-white/10 backdrop-blur rounded-xl p-4 mb-6 text-left">
              <p className="text-white/60 text-xs uppercase tracking-wider mb-2">Verified As</p>
              <p className="text-white font-medium">
                {verificationResult.details.ocrData.firstName} {verificationResult.details.ocrData.lastName}
              </p>
            </div>
          )}
          <p className="text-sm text-gray-500">You can close this window now.</p>
        </div>
      </div>
    );
  }

  // Failed state
  if (step === 'failed') {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-red-900/30 to-black flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
            <XCircle className="h-10 w-10 text-red-500" />
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Verification Failed</h1>
          <p className="text-gray-400 mb-6">{verificationResult?.detail || 'We could not verify your identity.'}</p>
          <p className="text-sm text-gray-500">Please ensure your photos are clear and try again.</p>
        </div>
      </div>
    );
  }

  // Review state
  if (step === 'review') {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-yellow-900/30 to-black flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="h-10 w-10 text-yellow-500" />
          </div>
          <h1 className="text-xl font-semibold text-white mb-2">Manual Review Required</h1>
          <p className="text-gray-400 mb-6">Your verification needs additional review. You'll be notified once complete.</p>
          <p className="text-sm text-gray-500">You can close this window now.</p>
        </div>
      </div>
    );
  }

  // Capture steps - Professional fullscreen UI
  const stepInfo = getStepInfo();
  const preview = getCurrentPreview();
  const hasCapture = getCurrentImage() !== null;
  const isDocumentStep = step === 'document-front' || step === 'document-back';
  const isSelfieStep = step === 'selfie';

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 safe-area-inset-top">
        <div className="flex items-center justify-between p-4">
          {/* Back button */}
          {step !== 'document-front' && !hasCapture && (
            <button
              onClick={handleBack}
              className="w-10 h-10 rounded-full bg-black/40 backdrop-blur flex items-center justify-center"
            >
              <ArrowLeft className="h-5 w-5 text-white" />
            </button>
          )}
          {(step === 'document-front' || hasCapture) && <div className="w-10" />}

          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((num) => (
              <div
                key={num}
                className={`h-1.5 rounded-full transition-all ${
                  num < stepInfo.number ? 'w-6 bg-green-500' :
                  num === stepInfo.number ? 'w-8 bg-white' : 'w-6 bg-white/30'
                }`}
              />
            ))}
          </div>

          {/* Tenant branding */}
          <div className="w-10 h-10 flex items-center justify-center">
            {sessionData?.tenantLogo ? (
              <img src={sessionData.tenantLogo} alt="" className="h-8 w-8 object-contain rounded" />
            ) : (
              <Shield className="h-5 w-5 text-white/60" />
            )}
          </div>
        </div>
      </div>

      {/* Camera / Preview Area */}
      <div className="flex-1 relative">
        {/* Video element - always rendered */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover ${isSelfieStep ? 'scale-x-[-1]' : ''} ${(!isCameraActive || hasCapture) ? 'invisible' : ''}`}
        />

        {/* Captured preview */}
        {hasCapture && preview && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <img src={preview} alt="Captured" className="max-w-full max-h-full object-contain" />
          </div>
        )}

        {/* Camera loading/error state */}
        {!isCameraActive && !hasCapture && (
          <div className="absolute inset-0 flex items-center justify-center">
            {cameraError ? (
              <div className="text-center p-6">
                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
                  <Camera className="h-8 w-8 text-white/40" />
                </div>
                <p className="text-white/60 mb-4">{cameraError}</p>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Photo
                </Button>
              </div>
            ) : (
              <div className="text-center">
                <Loader2 className="h-10 w-10 animate-spin text-white/40 mx-auto mb-4" />
                <p className="text-white/40">Starting camera...</p>
              </div>
            )}
          </div>
        )}

        {/* Overlay guides */}
        {isCameraActive && !hasCapture && (
          <>
            {/* Darkened corners for document */}
            {isDocumentStep && (
              <>
                <div className="absolute inset-0 pointer-events-none">
                  {/* Corner brackets */}
                  <div className="absolute top-[15%] left-[8%] w-12 h-12 border-l-4 border-t-4 border-white/80 rounded-tl-lg" />
                  <div className="absolute top-[15%] right-[8%] w-12 h-12 border-r-4 border-t-4 border-white/80 rounded-tr-lg" />
                  <div className="absolute bottom-[30%] left-[8%] w-12 h-12 border-l-4 border-b-4 border-white/80 rounded-bl-lg" />
                  <div className="absolute bottom-[30%] right-[8%] w-12 h-12 border-r-4 border-b-4 border-white/80 rounded-br-lg" />
                </div>
                {/* Scanning line animation */}
                <div className="absolute top-[15%] left-[8%] right-[8%] bottom-[30%] overflow-hidden pointer-events-none">
                  <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-white/60 to-transparent animate-scan" />
                </div>
              </>
            )}

            {/* Face oval for selfie */}
            {isSelfieStep && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative">
                  <div className="w-56 h-72 rounded-full border-4 border-white/60" />
                  <Sparkles className="absolute -top-2 left-1/2 -translate-x-1/2 h-6 w-6 text-white/80" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 z-20 safe-area-inset-bottom">
        <div className="bg-gradient-to-t from-black via-black/90 to-transparent pt-16 pb-8 px-6">
          {/* Step info */}
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold text-white mb-1">{stepInfo.title}</h2>
            <p className="text-white/60 text-sm">{stepInfo.subtitle}</p>
          </div>

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
          {!hasCapture ? (
            <div className="flex flex-col items-center gap-3">
              {/* Main capture button */}
              <button
                onClick={isCameraActive ? handleCapture : () => fileInputRef.current?.click()}
                disabled={!isCameraActive && !cameraError}
                className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-lg active:scale-95 transition-transform disabled:opacity-50"
              >
                <div className="w-16 h-16 rounded-full border-4 border-black/20" />
              </button>

              {/* Upload alternative */}
              {isCameraActive && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-white/60 text-sm flex items-center gap-1 py-2"
                >
                  <Upload className="h-4 w-4" />
                  Upload from gallery
                </button>
              )}

              {/* Skip for document back */}
              {step === 'document-back' && (
                <button
                  onClick={handleSkipBack}
                  className="text-white/40 text-sm py-2"
                >
                  Skip this step
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-4">
              {/* Retake button */}
              <button
                onClick={handleRetake}
                className="flex-1 max-w-[140px] h-14 rounded-full bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center gap-2 text-white"
              >
                <RotateCcw className="h-5 w-5" />
                <span>Retake</span>
              </button>

              {/* Next/Submit button */}
              <button
                onClick={handleNext}
                className="flex-1 max-w-[180px] h-14 rounded-full bg-white flex items-center justify-center gap-2 text-black font-semibold"
              >
                <span>{step === 'selfie' ? 'Verify Identity' : 'Continue'}</span>
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* CSS for scanning animation */}
      <style jsx>{`
        @keyframes scan {
          0% { top: 0; }
          50% { top: 100%; }
          100% { top: 0; }
        }
        .animate-scan {
          animation: scan 2s ease-in-out infinite;
        }
        .safe-area-inset-top {
          padding-top: env(safe-area-inset-top, 0);
        }
        .safe-area-inset-bottom {
          padding-bottom: env(safe-area-inset-bottom, 0);
        }
      `}</style>
    </div>
  );
}
