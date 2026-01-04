'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  QrCode,
  Clock,
  CheckCircle,
  RefreshCw,
  Smartphone,
  Loader2,
  AlertCircle
} from 'lucide-react';

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

// Simple QR code generator using canvas
async function generateQRCode(text: string, size: number = 256): Promise<string> {
  // Use a simple QR code generation approach
  // For production, you might want to use a library like qrcode
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (!ctx) return '';

  // Try to use the QRCode library if available
  if (typeof window !== 'undefined' && (window as any).QRCode) {
    return new Promise((resolve) => {
      const qr = new (window as any).QRCode(canvas, {
        text,
        width: size,
        height: size,
        colorDark: '#000000',
        colorLight: '#ffffff',
      });
      setTimeout(() => {
        resolve(canvas.toDataURL('image/png'));
      }, 100);
    });
  }

  // Fallback: Create a simple placeholder with the URL
  // In production, include qrcode library
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';

  // Draw a simple QR-like pattern (not a real QR code)
  const moduleSize = size / 25;
  for (let y = 0; y < 25; y++) {
    for (let x = 0; x < 25; x++) {
      // Position detection patterns
      if ((x < 7 && y < 7) || (x >= 18 && y < 7) || (x < 7 && y >= 18)) {
        if (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4) ||
            (x >= 18 && (x === 18 || x === 24)) || (y >= 18 && (y === 18 || y === 24)) ||
            (x >= 20 && x <= 22 && y >= 2 && y <= 4) || (x >= 2 && x <= 4 && y >= 20 && y <= 22)) {
          ctx.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize);
        }
      } else {
        // Random data pattern based on text hash
        const hash = text.charCodeAt((x + y * 25) % text.length) + x * y;
        if (hash % 3 === 0) {
          ctx.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize);
        }
      }
    }
  }

  return canvas.toDataURL('image/png');
}

export default function AIVerificationQR({
  sessionId,
  qrUrl,
  expiresAt,
  onVerified,
  onExpired,
  onRetry
}: AIVerificationQRProps) {
  const [qrCodeImage, setQrCodeImage] = useState<string>('');
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [status, setStatus] = useState<'pending' | 'checking' | 'verified' | 'expired' | 'failed'>('pending');
  const [isPolling, setIsPolling] = useState(true);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Generate QR code on mount
  useEffect(() => {
    generateQRCode(qrUrl, 256).then(setQrCodeImage);
  }, [qrUrl]);

  // Calculate remaining time
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const expiry = new Date(expiresAt);
      const remaining = Math.max(0, Math.floor((expiry.getTime() - now.getTime()) / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0 && status === 'pending') {
        setStatus('expired');
        setIsPolling(false);
        onExpired();
      }
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);

    return () => clearInterval(timer);
  }, [expiresAt, status, onExpired]);

  // Poll for verification status
  const checkStatus = useCallback(async () => {
    if (!isPolling || status !== 'pending') return;

    try {
      setStatus('checking');

      const { data, error } = await supabase
        .from('identity_verifications')
        .select('status, review_status, review_result, first_name, last_name, document_number, ai_face_match_score')
        .eq('id', sessionId)
        .single();

      if (error) {
        console.error('Status check error:', error);
        setStatus('pending');
        return;
      }

      if (data.status === 'completed') {
        setIsPolling(false);

        if (data.review_result === 'GREEN') {
          setStatus('verified');
          onVerified(data);
          toast.success('Identity verified successfully!');
        } else if (data.review_result === 'RED') {
          setStatus('failed');
          toast.error('Identity verification failed');
        } else if (data.review_result === 'RETRY') {
          setStatus('pending');
          toast.info('Verification needs manual review');
          onVerified(data); // Still notify parent
        }
      } else {
        setStatus('pending');
      }
    } catch (err) {
      console.error('Status check error:', err);
      setStatus('pending');
    }
  }, [sessionId, isPolling, status, onVerified]);

  // Set up polling
  useEffect(() => {
    if (isPolling && status === 'pending') {
      // Initial check after 5 seconds
      const initialTimeout = setTimeout(checkStatus, 5000);

      // Then poll every 3 seconds
      pollIntervalRef.current = setInterval(checkStatus, 3000);

      return () => {
        clearTimeout(initialTimeout);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
      };
    }
  }, [isPolling, status, checkStatus]);

  // Format time remaining
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
          {onRetry && (
            <Button onClick={onRetry}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Get New QR Code
            </Button>
          )}
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
          {onRetry && (
            <Button onClick={onRetry} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // Render QR code
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center pb-2">
        <div className="flex items-center justify-center gap-2 text-primary mb-2">
          <Smartphone className="h-5 w-5" />
          <span className="text-sm font-medium">Scan with your phone</span>
        </div>
        <CardTitle className="text-lg">Identity Verification</CardTitle>
        <CardDescription>
          Scan this QR code with your phone camera to verify your identity
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        {/* QR Code */}
        <div className="relative bg-white p-4 rounded-lg shadow-sm mb-4">
          {qrCodeImage ? (
            <img
              src={qrCodeImage}
              alt="Verification QR Code"
              className="w-64 h-64"
            />
          ) : (
            <div className="w-64 h-64 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Status overlay when checking */}
          {status === 'checking' && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Checking status...</p>
              </div>
            </div>
          )}
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
      </CardContent>
    </Card>
  );
}
