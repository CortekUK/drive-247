'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, FileDown, ImageDown, Loader2, Send, ShieldCheck } from 'lucide-react';
import {
  Submission,
  SubmissionDetailTabs,
  generateSubmissionPdf,
  generateImagesZip,
} from '@/components/admin/BonzahSubmissions';

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

interface SendToBrandonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  tenantName: string;
  brandonSentAt: string | null;
  onSent: (tenantId: string, sentAt: string) => void;
}

export default function SendToBrandonDialog({
  open,
  onOpenChange,
  tenantId,
  tenantName,
  brandonSentAt,
  onSent,
}: SendToBrandonDialogProps) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState<'pdf' | 'zip' | null>(null);

  useEffect(() => {
    if (!open || !tenantId) {
      setSubmission(null);
      return;
    }
    setLoading(true);
    (supabase as any)
      .from('bonzah_onboarding_submissions')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }: any) => {
        if (error) toast.error('Failed to load submission: ' + error.message);
        setSubmission(data ?? null);
        setLoading(false);
      });
  }, [open, tenantId]);

  const handleDownloadPdf = async () => {
    if (!submission) return;
    setDownloading('pdf');
    try {
      await generateSubmissionPdf(submission);
      toast.success('PDF downloaded');
    } catch (err: any) {
      toast.error(`PDF failed: ${err.message || err}`);
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadZip = async () => {
    if (!submission) return;
    setDownloading('zip');
    try {
      const n = await generateImagesZip(submission);
      toast.success(`Downloaded ${n} image${n === 1 ? '' : 's'}`);
    } catch (err: any) {
      toast.error(`ZIP failed: ${err.message || err}`);
    } finally {
      setDownloading(null);
    }
  };

  const handleSend = async () => {
    if (!tenantId) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-bonzah-form-to-brandon', {
        body: { tenant_id: tenantId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const sentAt = data?.brandon_sent_at ?? new Date().toISOString();
      onSent(tenantId, sentAt);
      toast.success(`Form details sent to ${data?.sent_to || 'Brandon'}`);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Send failed: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <ShieldCheck className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold truncate">
                {submission?.business_trade_name || tenantName}
              </div>
              <div className="text-xs text-muted-foreground font-normal">
                Bonzah application — review before sending to Brandon
              </div>
            </div>
          </DialogTitle>
          <DialogDescription>
            {submission
              ? `Submitted ${fmtDate(submission.submitted_at)}`
              : 'Latest Bonzah onboarding form for this tenant'}
          </DialogDescription>
        </DialogHeader>

        {brandonSentAt && (
          <div className="rounded-md bg-warning/10 border border-warning/30 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
            <p className="text-sm text-warning">
              <strong>Already sent to Brandon</strong> on {fmtDate(brandonSentAt)}. Sending again
              will email him a duplicate copy.
            </p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : submission ? (
          <SubmissionDetailTabs submission={submission} />
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No Bonzah form submission found for this tenant.
          </p>
        )}

        <DialogFooter className="flex-wrap gap-2 border-t pt-4 mt-2">
          <Button
            variant="outline"
            onClick={handleDownloadPdf}
            disabled={!submission || !!downloading || sending}
          >
            {downloading === 'pdf' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            Download PDF
          </Button>
          <Button
            variant="outline"
            onClick={handleDownloadZip}
            disabled={!submission || !!downloading || sending}
          >
            {downloading === 'zip' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageDown className="h-4 w-4" />
            )}
            Download Images
          </Button>
          <Button onClick={handleSend} disabled={!submission || sending || !!downloading}>
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {brandonSentAt ? 'Resend to Brandon' : 'Send to Brandon'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
