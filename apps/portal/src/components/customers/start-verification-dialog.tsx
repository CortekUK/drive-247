'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Shield, Loader2, Clock, Copy, CheckCircle, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

const VERIFICATION_DOC_OPTIONS = [
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'passport', label: 'Passport' },
  { value: 'id_card', label: 'ID Card' },
];

interface StartVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
}

export function StartVerificationDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
}: StartVerificationDialogProps) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const [docType, setDocType] = useState<string>(
    tenant?.accepted_verification_document || 'drivers_license'
  );
  const [creating, setCreating] = useState(false);
  const [aiSessionData, setAiSessionData] = useState<{ sessionId: string; qrUrl: string; expiresAt: Date } | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const [verificationDone, setVerificationDone] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const verificationMode = tenant?.integration_veriff !== false ? 'veriff' : 'ai';

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setDocType(tenant?.accepted_verification_document || 'drivers_license');
      setCreating(false);
      setAiSessionData(null);
      setTimeRemaining(0);
      setIsPolling(false);
      setVerificationDone(false);
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }
  }, [open, tenant?.accepted_verification_document]);

  // Timer countdown
  useEffect(() => {
    if (!aiSessionData) return;
    const updateTime = () => {
      const remaining = Math.max(0, Math.floor((aiSessionData.expiresAt.getTime() - Date.now()) / 1000));
      setTimeRemaining(remaining);
      if (remaining === 0) {
        setIsPolling(false);
        setAiSessionData(null);
        toast.error('QR code expired. Please try again.');
      }
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [aiSessionData]);

  // Poll for completion
  const checkStatus = useCallback(async () => {
    if (!isPolling || !aiSessionData) return;
    try {
      const { data, error } = await supabase
        .from('identity_verifications')
        .select('status, review_status, review_result')
        .eq('session_id', aiSessionData.sessionId)
        .single();
      if (error) return;
      if (data.status === 'completed') {
        setIsPolling(false);
        setVerificationDone(true);
        queryClient.invalidateQueries({ queryKey: ['customer-verification', customerId] });
        queryClient.invalidateQueries({ queryKey: ['customers-list'] });
        if (data.review_result === 'GREEN') {
          toast.success('Identity verified successfully!');
        } else if (data.review_result === 'RED') {
          toast.error('Identity verification failed');
        } else {
          toast.info('Verification needs manual review');
        }
      }
    } catch {}
  }, [aiSessionData, isPolling, customerId, queryClient]);

  useEffect(() => {
    if (isPolling && aiSessionData) {
      const initialTimeout = setTimeout(checkStatus, 5000);
      pollIntervalRef.current = setInterval(checkStatus, 3000);
      return () => {
        clearTimeout(initialTimeout);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      };
    }
  }, [isPolling, aiSessionData, checkStatus]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStart = async () => {
    if (!customerId || !tenant) return;
    setCreating(true);
    try {
      if (verificationMode === 'ai') {
        const { data, error } = await supabase.functions.invoke('create-ai-verification-session', {
          body: { customerId, tenantId: tenant.id, tenantSlug: tenant.slug },
        });
        if (error) throw error;
        if (!data.ok) throw new Error(data.detail || data.error || 'Failed to create AI verification session');

        toast.success('AI verification session created');
        setAiSessionData({
          sessionId: data.sessionId,
          qrUrl: data.qrUrl,
          expiresAt: new Date(data.expiresAt),
        });
        setIsPolling(true);
      } else {
        const { data, error } = await supabase.functions.invoke('create-veriff-session', {
          body: { customerId },
        });
        if (error) throw error;
        if (!data.ok) throw new Error(data.detail || data.error || 'Failed to create verification session');

        toast.success('Verification session created');
        if (data.sessionUrl) window.open(data.sessionUrl, '_blank');
        queryClient.invalidateQueries({ queryKey: ['customer-verification', customerId] });
        queryClient.invalidateQueries({ queryKey: ['customers-list'] });
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create verification session');
    } finally {
      setCreating(false);
    }
  };

  const docLabel = VERIFICATION_DOC_OPTIONS.find(o => o.value === docType)?.label || 'Identity';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {docLabel} Verification
          </DialogTitle>
          <DialogDescription>
            Start identity verification for <strong>{customerName}</strong>
          </DialogDescription>
        </DialogHeader>

        {verificationDone ? (
          <div className="flex items-center gap-2 px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-600 dark:text-green-400">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span>Verification completed</span>
          </div>
        ) : aiSessionData ? (
          /* QR code active */
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-4 p-4 rounded-lg border border-muted-foreground/20">
              <div
                className="rounded-xl shadow-lg border-2 border-gray-200"
                style={{ backgroundColor: '#FFFFFF', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <img
                  src={`https://quickchart.io/qr?text=${encodeURIComponent(aiSessionData.qrUrl)}&size=220&margin=3&dark=000000&light=ffffff&ecLevel=M&format=png`}
                  alt="Scan QR code to verify identity"
                  width={220}
                  height={220}
                  style={{ display: 'block', imageRendering: 'pixelated' }}
                />
              </div>

              <div className="w-full space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Time remaining
                  </span>
                  <span className={`font-mono font-medium ${timeRemaining < 60 ? 'text-destructive' : 'text-foreground'}`}>
                    {formatTime(timeRemaining)}
                  </span>
                </div>
                <Progress value={(timeRemaining / 900) * 100} className="h-1.5" />
              </div>

              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs dark:bg-blue-950 dark:text-blue-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Waiting for verification...</span>
              </div>

              <div className="w-full space-y-1">
                <p className="text-[10px] text-center text-muted-foreground">
                  Can't scan? Open this link on your phone:
                </p>
                <div className="flex items-center gap-2 p-1.5 bg-muted rounded-lg">
                  <input
                    type="text"
                    readOnly
                    value={aiSessionData.qrUrl}
                    className="flex-1 bg-transparent text-xs truncate border-none focus:outline-none"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-7 w-7 p-0"
                    onClick={() => {
                      navigator.clipboard.writeText(aiSessionData.qrUrl);
                      toast.success('Link copied to clipboard');
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Not started — show doc type + start button */
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg border border-dashed border-muted-foreground/25">
              <div className="p-2 bg-primary/10 rounded-full shrink-0">
                <Smartphone className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Verify with {verificationMode === 'ai' ? 'AI' : 'Veriff'}</p>
                <p className="text-xs text-muted-foreground">
                  {verificationMode === 'ai'
                    ? `Scan a QR code to take photos of the customer's ${docLabel.toLowerCase()} and a selfie.`
                    : 'Open a verification session in a new window.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="w-[180px] h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VERIFICATION_DOC_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button onClick={handleStart} disabled={creating} size="sm">
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Shield className="h-4 w-4 mr-2" />
                    Start Verification
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
