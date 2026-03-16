'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Shield, Loader2, Clock, Copy, CheckCircle, Link2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

const VERIFICATION_DOC_OPTIONS = [
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'passport', label: 'Passport' },
  { value: 'id_card', label: 'ID Card' },
];

const EXPIRY_SECONDS = 3 * 60 * 60; // 3 hours

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
  const [sessionData, setSessionData] = useState<{ sessionId: string; url: string; expiresAt: Date } | null>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const [verificationDone, setVerificationDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const verificationMode = tenant?.integration_veriff !== false ? 'veriff' : 'ai';

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setDocType(tenant?.accepted_verification_document || 'drivers_license');
      setCreating(false);
      setSessionData(null);
      setTimeRemaining(0);
      setIsPolling(false);
      setVerificationDone(false);
      setCopied(false);
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }
  }, [open, tenant?.accepted_verification_document]);

  // Timer countdown
  useEffect(() => {
    if (!sessionData) return;
    const updateTime = () => {
      const remaining = Math.max(0, Math.floor((sessionData.expiresAt.getTime() - Date.now()) / 1000));
      setTimeRemaining(remaining);
      if (remaining === 0) {
        setIsPolling(false);
        setSessionData(null);
        toast.error('Verification link expired. Please generate a new one.');
      }
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [sessionData]);

  // Poll for completion (every 10s since 3 hour window)
  const checkStatus = useCallback(async () => {
    if (!isPolling || !sessionData) return;
    try {
      const { data, error } = await (supabase as any)
        .from('identity_verifications')
        .select('status, review_status, review_result')
        .eq('session_id', sessionData.sessionId)
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
  }, [sessionData, isPolling, customerId, queryClient]);

  useEffect(() => {
    if (isPolling && sessionData) {
      const initialTimeout = setTimeout(checkStatus, 5000);
      pollIntervalRef.current = setInterval(checkStatus, 10000);
      return () => {
        clearTimeout(initialTimeout);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      };
    }
  }, [isPolling, sessionData, checkStatus]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopyLink = () => {
    if (!sessionData) return;
    navigator.clipboard.writeText(sessionData.url);
    setCopied(true);
    toast.success('Verification link copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
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
        if (!data.ok) throw new Error(data.detail || data.error || 'Failed to create verification session');

        toast.success('Verification link generated');
        setSessionData({
          sessionId: data.sessionId,
          url: data.qrUrl,
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
        if (data.sessionUrl) {
          setSessionData({
            sessionId: data.sessionId || '',
            url: data.sessionUrl,
            expiresAt: new Date(Date.now() + EXPIRY_SECONDS * 1000),
          });
        }
        queryClient.invalidateQueries({ queryKey: ['customer-verification', customerId] });
        queryClient.invalidateQueries({ queryKey: ['customers-list'] });
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
            {sessionData
              ? <>Send this link to <strong>{customerName}</strong> to complete verification.</>
              : <>Generate a verification link for <strong>{customerName}</strong>.</>
            }
          </DialogDescription>
        </DialogHeader>

        {verificationDone ? (
          <div className="flex items-center gap-2 px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm text-green-600 dark:text-green-400">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span>Verification completed</span>
          </div>
        ) : sessionData ? (
          /* Link generated — show copy UI */
          <div className="space-y-4">
            {/* Verification link */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Verification Link</label>
              <div className="flex items-center gap-2 p-2.5 bg-muted rounded-lg border">
                <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  readOnly
                  value={sessionData.url}
                  className="flex-1 bg-transparent text-sm truncate border-none focus:outline-none"
                />
                <Button
                  type="button"
                  variant={copied ? 'default' : 'outline'}
                  size="sm"
                  className="shrink-0 h-7 gap-1 text-xs"
                  onClick={handleCopyLink}
                >
                  {copied ? (
                    <>
                      <CheckCircle className="h-3 w-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Expiry info */}
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Expires in {formatTime(timeRemaining)}
              </span>
              {isPolling && (
                <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Waiting for customer...
                </span>
              )}
            </div>

            {/* Open in new tab */}
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 text-xs"
              onClick={() => window.open(sessionData.url, '_blank')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open link in new tab
            </Button>
          </div>
        ) : (
          /* Not started — doc type + generate button */
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Document Type</label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VERIFICATION_DOC_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The customer will receive a public link valid for 3 hours to verify their {docLabel.toLowerCase()}.
              </p>
            </div>

            <Button onClick={handleStart} disabled={creating} className="w-full gap-2">
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4" />
                  Generate Verification Link
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
