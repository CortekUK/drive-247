'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@drive247/ui';
import {
  ID_VERIFICATION_ACCEPTED_MIME_TYPES,
  ID_VERIFICATION_MAX_FILE_SIZE_BYTES,
  ID_VERIFICATION_STATUS_POLL_INTERVAL_MS,
  IdVerificationStatus,
  REQUIRED_DOCUMENT_TYPE_LABELS,
  type PublicSessionResponse,
  type UploadFileField,
} from '@drive247/shared-types';
import { idVerificationApi } from '@/lib/api';

type FlowStep =
  | 'loading'
  | 'doc_front'
  | 'doc_back'
  | 'selfie'
  | 'processing'
  | 'result';

export default function VerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [session, setSession] = useState<PublicSessionResponse | null>(null);
  const [flowStep, setFlowStep] = useState<FlowStep>('loading');
  const [error, setError] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        const { data: res } = await idVerificationApi.publicGetSession(token);
        if (!res.success) throw new Error('Invalid session');
        setSession(res.data);
        setFlowStep(determineStep(res.data));
      } catch (err: unknown) {
        const e = err as {
          response?: { status?: number; data?: { message?: string } };
        };
        const msg =
          e.response?.data?.message ??
          (e.response?.status === 410
            ? 'This session has expired.'
            : 'Invalid or expired link.');
        setError(msg);
      }
    })();
  }, [token]);

  // Poll for terminal status while processing
  useEffect(() => {
    if (flowStep !== 'processing') return;
    const t = setInterval(async () => {
      try {
        const { data: res } = await idVerificationApi.publicGetSession(token);
        if (!res.success) return;
        setSession(res.data);
        if (
          res.data.status === IdVerificationStatus.APPROVED ||
          res.data.status === IdVerificationStatus.REJECTED ||
          res.data.status === IdVerificationStatus.REVIEW_REQUIRED
        ) {
          setFlowStep('result');
        }
      } catch {
        // keep polling
      }
    }, ID_VERIFICATION_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [flowStep, token]);

  const handleUploaded = useCallback(
    (field: UploadFileField) => {
      if (!session) return;
      if (field === 'document_front') {
        setFlowStep(session.documentRequiresBack ? 'doc_back' : 'selfie');
      } else if (field === 'document_back') {
        setFlowStep('selfie');
      } else if (field === 'selfie') {
        // Trigger submit + move to processing
        (async () => {
          try {
            await idVerificationApi.publicSubmit(token);
            setFlowStep('processing');
          } catch (err: unknown) {
            const e = err as { response?: { data?: { message?: string } } };
            setError(e.response?.data?.message ?? 'Submit failed');
          }
        })();
      }
    },
    [session, token],
  );

  if (error) return <ErrorScreen message={error} />;
  if (flowStep === 'loading' || !session) return <LoadingScreen />;

  return (
    <>
      <BrandHeader tenantName={session.tenantName} />
      <main className="flex-1 flex flex-col items-center px-4 py-6 w-full max-w-md mx-auto">
        <Stepper
          current={flowStep}
          hasBack={session.documentRequiresBack}
        />

        <div className="w-full mt-6">
          {flowStep === 'doc_front' && (
            <CaptureStep
              key="front"
              title={`Photo of the FRONT of your ${REQUIRED_DOCUMENT_TYPE_LABELS[session.requiredDocumentType]}`}
              instruction="Make sure all four corners are visible and the text is readable."
              field="document_front"
              facingMode="environment"
              token={token}
              onUploaded={() => handleUploaded('document_front')}
            />
          )}
          {flowStep === 'doc_back' && (
            <CaptureStep
              key="back"
              title={`Photo of the BACK of your ${REQUIRED_DOCUMENT_TYPE_LABELS[session.requiredDocumentType]}`}
              instruction="Flip the document over and capture the back side."
              field="document_back"
              facingMode="environment"
              token={token}
              onUploaded={() => handleUploaded('document_back')}
            />
          )}
          {flowStep === 'selfie' && (
            <CaptureStep
              key="selfie"
              title="Take a selfie"
              instruction="Face the camera directly. Remove glasses and hats if possible."
              field="selfie"
              facingMode="user"
              token={token}
              onUploaded={() => handleUploaded('selfie')}
            />
          )}
          {flowStep === 'processing' && <ProcessingScreen />}
          {flowStep === 'result' && <ResultScreen status={session.status} />}
        </div>
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------

function determineStep(session: PublicSessionResponse): FlowStep {
  if (
    session.status === IdVerificationStatus.APPROVED ||
    session.status === IdVerificationStatus.REJECTED ||
    session.status === IdVerificationStatus.REVIEW_REQUIRED
  ) {
    return 'result';
  }
  if (session.status === IdVerificationStatus.PROCESSING) return 'processing';
  if (session.currentStep === 'document_back') return 'doc_back';
  if (session.currentStep === 'selfie') return 'selfie';
  if (session.currentStep === 'processing') return 'processing';
  return 'doc_front';
}

// ---------------------------------------------------------------------------

function BrandHeader({ tenantName }: { tenantName: string }) {
  return (
    <header className="bg-white border-b border-[#f1f5f9] px-4 py-3">
      <p className="text-xs text-muted-foreground">ID Verification for</p>
      <h1 className="text-base font-medium text-[#080812]">
        {tenantName || 'Drive 247'}
      </h1>
    </header>
  );
}

function Stepper({
  current,
  hasBack,
}: {
  current: FlowStep;
  hasBack: boolean;
}) {
  const steps: Array<{ key: FlowStep; label: string }> = [
    { key: 'doc_front', label: 'Front' },
    ...(hasBack ? [{ key: 'doc_back' as FlowStep, label: 'Back' }] : []),
    { key: 'selfie', label: 'Selfie' },
    { key: 'processing', label: 'Review' },
  ];
  const currentIndex = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center w-full">
      {steps.map((s, i) => {
        const done = i < currentIndex || current === 'result';
        const active = i === currentIndex;
        return (
          <div key={s.key} className="flex-1 flex items-center">
            <div
              className={
                'h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium ' +
                (done
                  ? 'bg-[#16a34a] text-white'
                  : active
                    ? 'bg-[#6366f1] text-white'
                    : 'bg-[#f1f5f9] text-[#737373]')
              }
            >
              {done ? '✓' : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div
                className={
                  'flex-1 h-[2px] ' +
                  (done ? 'bg-[#16a34a]' : 'bg-[#f1f5f9]')
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capture step — camera + file fallback
// ---------------------------------------------------------------------------

function CaptureStep({
  title,
  instruction,
  field,
  facingMode,
  token,
  onUploaded,
}: {
  title: string;
  instruction: string;
  field: UploadFileField;
  facingMode: 'environment' | 'user';
  token: string;
  onUploaded: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync step with backend so mobile-resume works
  useEffect(() => {
    (async () => {
      const stepName =
        field === 'document_front'
          ? 'document_front'
          : field === 'document_back'
            ? 'document_back'
            : 'selfie';
      try {
        await idVerificationApi.publicSyncStep(token, { step: stepName });
      } catch {
        // non-fatal
      }
    })();
  }, [field, token]);

  // Start camera
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraError('Camera not supported on this device');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        setCameraError(
          'Camera permission denied or unavailable. Use the upload button below.',
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facingMode]);

  useEffect(() => {
    if (preview) {
      const url = URL.createObjectURL(preview);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [preview]);

  const handleCaptureFromVideo = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setPreview(blob);
      },
      'image/jpeg',
      0.92,
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (
      !(ID_VERIFICATION_ACCEPTED_MIME_TYPES as readonly string[]).includes(
        file.type,
      )
    ) {
      setError('Please pick a JPEG, PNG, or WEBP image.');
      return;
    }
    if (file.size > ID_VERIFICATION_MAX_FILE_SIZE_BYTES) {
      setError(
        `File too large. Max ${ID_VERIFICATION_MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }
    setError(null);
    setPreview(file);
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setUploading(true);
    setError(null);
    try {
      await idVerificationApi.publicUploadFile(token, field, preview);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onUploaded();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Upload failed. Try again.');
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-medium text-[#080812]">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{instruction}</p>
      </div>

      <div className="relative bg-black rounded-lg overflow-hidden aspect-[4/3]">
        {previewUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previewUrl}
            alt="Preview"
            className="w-full h-full object-contain"
          />
        ) : cameraError ? (
          <div className="w-full h-full flex items-center justify-center text-white text-sm text-center px-4">
            {cameraError}
          </div>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}
      </div>

      {error && (
        <p className="text-sm text-[#dc2626] bg-[#fef2f2] p-2 rounded">
          {error}
        </p>
      )}

      {!preview ? (
        <div className="space-y-2">
          {!cameraError && (
            <Button
              onClick={handleCaptureFromVideo}
              className="w-full h-12 text-base"
            >
              Capture photo
            </Button>
          )}
          <label className="block">
            <input
              type="file"
              accept={ID_VERIFICATION_ACCEPTED_MIME_TYPES.join(',')}
              onChange={handleFileChange}
              className="sr-only"
            />
            <span className="block w-full h-12 text-base rounded-md border border-[#e2e8f0] bg-white text-[#080812] hover:bg-[#f1f5f9] cursor-pointer flex items-center justify-center">
              Upload from gallery instead
            </span>
          </label>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setPreview(null)}
            disabled={uploading}
            className="flex-1"
          >
            Retake
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={uploading}
            className="flex-1"
          >
            {uploading ? 'Uploading...' : 'Use this photo'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Processing + result screens
// ---------------------------------------------------------------------------

function ProcessingScreen() {
  return (
    <div className="flex flex-col items-center text-center py-10 space-y-4">
      <div className="h-12 w-12 rounded-full border-4 border-[#e0e7ff] border-t-[#6366f1] animate-spin" />
      <h2 className="text-lg font-medium text-[#080812]">
        Verifying your ID...
      </h2>
      <p className="text-sm text-muted-foreground max-w-xs">
        This usually takes less than a minute. Please keep this page open.
      </p>
    </div>
  );
}

function ResultScreen({ status }: { status: IdVerificationStatus }) {
  const meta = RESULT_META[status] ?? RESULT_META[IdVerificationStatus.REVIEW_REQUIRED];
  return (
    <div className="flex flex-col items-center text-center py-10 space-y-4">
      <div
        className="h-16 w-16 rounded-full flex items-center justify-center text-3xl"
        style={{ background: meta.bg, color: meta.fg }}
      >
        {meta.icon}
      </div>
      <h2 className="text-xl font-medium text-[#080812]">{meta.title}</h2>
      <p className="text-sm text-muted-foreground max-w-xs">{meta.body}</p>
    </div>
  );
}

const RESULT_META: Record<
  string,
  { title: string; body: string; icon: string; bg: string; fg: string }
> = {
  [IdVerificationStatus.APPROVED]: {
    title: 'Verification approved',
    body: 'You can close this page. Your rental representative will see the result shortly.',
    icon: '✓',
    bg: '#bbf7d0',
    fg: '#16a34a',
  },
  [IdVerificationStatus.REJECTED]: {
    title: 'Verification declined',
    body: 'Please contact your rental representative for next steps.',
    icon: '✕',
    bg: '#fecaca',
    fg: '#dc2626',
  },
  [IdVerificationStatus.REVIEW_REQUIRED]: {
    title: 'Submitted for review',
    body: 'Your verification is being reviewed. You can close this page — the rental agent will follow up.',
    icon: '⏳',
    bg: '#fed7aa',
    fg: '#d97706',
  },
};

function LoadingScreen() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center space-y-3">
        <div className="h-16 w-16 rounded-full bg-[#fecaca] text-[#dc2626] flex items-center justify-center text-2xl mx-auto">
          !
        </div>
        <h1 className="text-lg font-medium text-[#080812]">
          Can&apos;t open verification
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
      </div>
    </div>
  );
}
