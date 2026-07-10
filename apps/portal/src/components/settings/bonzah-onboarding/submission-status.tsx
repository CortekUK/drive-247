'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, CheckCircle2, XCircle, FileText, Mail, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface Submission {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_at: string | null;
  admin_note: string | null;
  business_trade_name: string;
  primary_contact_email: string;
  partner_message?: string | null;
  reject_reason?: string | null;
}

interface SubmissionEvent {
  id: string;
  actor_type: 'customer' | 'partner' | 'system';
  event_type: string;
  note: string | null;
  created_at: string;
}

interface SubmissionStatusProps {
  submission: Submission;
  onResubmit?: () => void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export function SubmissionStatus({ submission, onResubmit }: SubmissionStatusProps) {
  const statusConfig = {
    pending: {
      icon: Clock,
      label: 'Awaiting Review',
      ringClass: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
      iconBg: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
      titleClass: 'text-amber-900 dark:text-amber-200',
      bodyClass: 'text-amber-800/90 dark:text-amber-300/90',
      badgeClass: 'bg-amber-600 hover:bg-amber-700',
      message:
        "Your submission has been received. The Drive247 team will review your application and get back to you with your Bonzah credentials.",
    },
    approved: {
      icon: CheckCircle2,
      label: 'Approved',
      ringClass: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800',
      iconBg: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
      titleClass: 'text-emerald-900 dark:text-emerald-200',
      bodyClass: 'text-emerald-800/90 dark:text-emerald-300/90',
      badgeClass: 'bg-emerald-600 hover:bg-emerald-700',
      message:
        'Your application has been approved. Check your email for Bonzah portal credentials, then enter them below to connect your account.',
    },
    rejected: {
      icon: XCircle,
      label: 'Needs Attention',
      ringClass: 'bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-800',
      iconBg: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400',
      titleClass: 'text-rose-900 dark:text-rose-200',
      bodyClass: 'text-rose-800/90 dark:text-rose-300/90',
      badgeClass: 'bg-rose-600 hover:bg-rose-700',
      message:
        'Your application requires changes. Please review the note below from our team and resubmit.',
    },
  } as const;

  const cfg = statusConfig[submission.status];
  const Icon = cfg.icon;

  const [events, setEvents] = useState<SubmissionEvent[]>([]);
  useEffect(() => {
    if (!submission.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('bonzah_submission_events')
        .select('id, actor_type, event_type, note, created_at')
        .eq('submission_id', submission.id)
        .order('created_at', { ascending: true });
      if (!cancelled) setEvents((data as unknown as SubmissionEvent[]) || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [submission.id]);

  // Prefer the partner's message / reason over the legacy admin_note.
  const decisionNote =
    (submission.status === 'approved' && submission.partner_message) ||
    (submission.status === 'rejected' && submission.reject_reason) ||
    submission.admin_note ||
    null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Bonzah Onboarding
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Submission for <span className="font-medium">{submission.business_trade_name}</span>
            </p>
          </div>
          <Badge className={cfg.badgeClass}>{cfg.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={cn('p-4 rounded-lg border', cfg.ringClass)}>
          <div className="flex items-start gap-3">
            <div className={cn('h-10 w-10 rounded-full flex items-center justify-center shrink-0', cfg.iconBg)}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="space-y-2 min-w-0 flex-1">
              <h4 className={cn('font-semibold text-sm', cfg.titleClass)}>{cfg.label}</h4>
              <p className={cn('text-sm leading-relaxed', cfg.bodyClass)}>{cfg.message}</p>
              {decisionNote && submission.status !== 'pending' && (
                <div className="mt-3 p-3 rounded-md bg-background/60 dark:bg-gray-950/40 border border-border/60">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    {submission.status === 'approved'
                      ? 'Message from Bonzah'
                      : 'What to update'}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{decisionNote}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <div className="p-3 rounded-md border bg-muted/30 dark:bg-gray-900/40">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Submitted</p>
            <p className="font-medium mt-1">{formatDate(submission.submitted_at)}</p>
          </div>
          {submission.reviewed_at && (
            <div className="p-3 rounded-md border bg-muted/30 dark:bg-gray-900/40">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Reviewed</p>
              <p className="font-medium mt-1">{formatDate(submission.reviewed_at)}</p>
            </div>
          )}
          <div className="p-3 rounded-md border bg-muted/30 dark:bg-gray-900/40">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Mail className="h-3 w-3" />
              Contact
            </p>
            <p className="font-medium mt-1 truncate">{submission.primary_contact_email}</p>
          </div>
        </div>

        {events.length > 0 && (
          <div className="pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />
              Activity
            </p>
            <ol className="space-y-3">
              {events.map((ev) => (
                <li key={ev.id} className="flex gap-3">
                  <div className="mt-1 h-2 w-2 rounded-full bg-primary/60 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium capitalize">
                      {ev.event_type.replace(/_/g, ' ')}
                    </p>
                    {ev.note && <p className="text-xs text-muted-foreground">{ev.note}</p>}
                    <p className="text-[11px] text-muted-foreground">{formatDate(ev.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {submission.status === 'rejected' && onResubmit && (
          <div className="flex justify-end">
            <Button onClick={onResubmit}>Start a New Submission</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
