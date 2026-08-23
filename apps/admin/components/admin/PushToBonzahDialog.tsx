'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';

/**
 * Push an onboarding submission to Bonzah's External API.
 *
 * WHY THIS SITS BESIDE "SEND TO BRANDON" RATHER THAN REPLACING IT
 *
 * Bonzah's API is write-only. It can accept the form, but it cannot tell us the
 * submission was accepted for underwriting, and it cannot send back the API
 * credentials Brandon emails by hand. So this shortens the send; it does not
 * close the loop, and the email stays authoritative until a live push has been
 * proven against a real key. The copy below says so rather than implying the
 * manual step is gone.
 *
 * THE DIALOG IS A GAP REPORT FIRST AND A SEND BUTTON SECOND
 *
 * A dry run costs nothing and creates nothing at Bonzah, so it runs on open.
 * What it returns — which required fields are unfilled, which enum values will
 * not match, which documents exist — is the actual product here. An incomplete
 * insurance declaration does not bounce at their end; it stalls in underwriting
 * with the operator's name on it, so the gaps have to be visible BEFORE anyone
 * can press send.
 */

interface DryRunResult {
  mode: 'dry_run';
  pushId: string | null;
  endpoint: string;
  partnerIdConfigured: boolean;
  apiKeyConfigured: boolean;
  payloadSha256: string;
  fieldCount: number;
  missingRequired: string[];
  missingRequiredIgnoringDocuments?: string[];
  gapReasons?: { field: string; reason: string; resolvedBy: 'product' | 'bonzah' }[];
  warnings: { field: string; reason: string }[];
  documents?: { category: string; fileName: string; field?: string; requiredByBonzah: boolean }[];
  documentsWouldFill?: string[];
}

interface PushToBonzahDialogProps {
  submissionId: string | null;
  tenantName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function PushToBonzahDialog({
  submissionId,
  tenantName,
  open,
  onOpenChange,
}: PushToBonzahDialogProps) {
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);

  const runDryRun = useCallback(async () => {
    if (!submissionId) return;
    setLoading(true);
    setError(null);
    setConfirmLive(false);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('push-bonzah-submission', {
        body: { submissionId },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);
      setDryRun(data as DryRunResult);
    } catch (e: any) {
      setError(e?.message ?? 'Could not run the dry run');
      setDryRun(null);
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => {
    if (open && submissionId) {
      setDryRun(null);
      void runDryRun();
    }
  }, [open, submissionId, runDryRun]);

  const blockers: string[] = [];
  if (dryRun && !dryRun.apiKeyConfigured) blockers.push('BONZAH_EXTERNAL_API_KEY is not set');
  if (dryRun && !dryRun.partnerIdConfigured) blockers.push('This tenant has no Bonzah partner id');

  const gapCount = dryRun?.missingRequired.length ?? 0;
  const canPushLive = !!dryRun && blockers.length === 0 && gapCount === 0;

  const pushLive = async (force: boolean) => {
    if (!submissionId) return;
    setPushing(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('push-bonzah-submission', {
        body: { submissionId, live: true, force },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      toast.success(
        `Delivered to Bonzah${
          data?.documentsUploaded ? ` with ${data.documentsUploaded} document(s)` : ''
        }. Activation still comes back by email.`,
      );
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message ?? 'The push failed');
    } finally {
      setPushing(false);
      setConfirmLive(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Push to Bonzah API — {tenantName}</DialogTitle>
          <DialogDescription>
            Sends the submission straight to Bonzah instead of emailing it. Their API is
            write-only, so Brandon still activates by hand and still emails the credentials
            back — this removes the send, not the wait.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Running a dry run — nothing is sent to Bonzah.
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {dryRun && !loading && (
          <div className="space-y-4">
            {/* External blockers — neither is fixable from this screen, and saying
                so is more useful than a disabled button with no explanation. */}
            {blockers.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                <div className="flex items-start gap-2">
                  <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-900 dark:text-amber-300">
                      Blocked — waiting on Bonzah
                    </p>
                    <ul className="mt-1 list-disc pl-4 text-amber-800 dark:text-amber-400">
                      {blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-500">
                      Their API has no endpoint to create or look up a partner id — Bonzah
                      issues them out of band.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 text-sm">
              <Stat label="Fields mapped" value={String(dryRun.fieldCount)} />
              <Stat
                label="Required gaps"
                value={String(gapCount)}
                tone={gapCount === 0 ? 'good' : 'bad'}
              />
              <Stat
                label="Warnings"
                value={String(dryRun.warnings.length)}
                tone={dryRun.warnings.length === 0 ? 'good' : 'warn'}
              />
            </div>

            {dryRun.documents && dryRun.documents.length > 0 && (
              <Section title="Documents found" icon={<FileText className="h-4 w-4" />}>
                <ul className="space-y-1 text-sm">
                  {dryRun.documents.map((d) => (
                    <li key={d.category} className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      <span className="font-mono text-xs">{d.field ?? d.category}</span>
                      {d.requiredByBonzah && (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                          required
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {gapCount > 0 && (
              <Section
                title={`${gapCount} required field(s) Bonzah expects, not filled`}
                icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
              >
                <ul className="space-y-1.5 text-xs">
                  {dryRun.missingRequired.map((f) => {
                    const g = dryRun.gapReasons?.find((x) => x.field === f);
                    return (
                      <li key={f}>
                        <span className="font-mono">{f}</span>
                        {g && (
                          <>
                            <Badge
                              variant="outline"
                              className="ml-1.5 h-4 px-1 text-[9px] uppercase"
                            >
                              {g.resolvedBy === 'bonzah' ? 'ask Bonzah' : 'our form'}
                            </Badge>
                            <p className="mt-0.5 text-muted-foreground">{g.reason}</p>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  A wrong value is worse than a missing one on an insurance declaration, so
                  the mapper leaves a field out rather than answering a different question
                  with it.
                </p>
              </Section>
            )}

            {dryRun.warnings.length > 0 && (
              <Section
                title={`${dryRun.warnings.length} value(s) Bonzah may reject`}
                icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
              >
                <ul className="space-y-0.5 text-xs">
                  {dryRun.warnings.map((w, i) => (
                    <li key={i}>
                      <span className="font-mono">{w.field}</span>
                      <span className="text-muted-foreground"> — {w.reason}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <p className="text-[11px] text-muted-foreground">
              Payload SHA-256 <span className="font-mono">{dryRun.payloadSha256.slice(0, 16)}…</span>{' '}
              — only this hash is audited, never the payload. It carries bank and routing
              numbers, EIN and a date of birth.
            </p>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button variant="ghost" size="sm" onClick={runDryRun} disabled={loading || pushing}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Re-run dry run
          </Button>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pushing}>
              Close
            </Button>

            {/* Two-step on purpose. There is no idempotency key at their end and no
                way to withdraw a submission, so the second click is the last
                reversible moment. */}
            {!confirmLive ? (
              <Button
                onClick={() => setConfirmLive(true)}
                disabled={!canPushLive || pushing}
                title={
                  blockers.length > 0
                    ? 'Blocked on Bonzah — see above'
                    : gapCount > 0
                      ? 'Resolve the required gaps first'
                      : undefined
                }
              >
                <Send className="mr-2 h-4 w-4" />
                Push live
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => pushLive(false)} disabled={pushing}>
                {pushing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Confirm — send to Bonzah
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="rounded-md border border-[#f1f5f9] p-2.5 dark:border-gray-800">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-lg font-semibold tabular-nums',
          tone === 'good' && 'text-green-600',
          tone === 'bad' && 'text-red-600',
          tone === 'warn' && 'text-amber-600',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-[#f1f5f9] p-3 dark:border-gray-800">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}
