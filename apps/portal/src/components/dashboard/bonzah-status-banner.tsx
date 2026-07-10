'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldCheck, AlertCircle, X, ArrowRight } from 'lucide-react';
import { useTenant } from '@/contexts/TenantContext';
import { useBonzahOnboarding } from '@/hooks/use-bonzah-onboarding';

/**
 * Sticky dashboard banner reflecting the tenant's latest Bonzah decision.
 * - Approved: green "Bonzah is active" banner, dismissible (localStorage, per
 *   submission so a fresh activation shows again).
 * - Rejected: blue "action needed" banner with the reason. Not dismissible — it
 *   persists until the operator re-submits (the latest submission changes).
 */
export function BonzahStatusBanner() {
  const { tenant } = useTenant();
  const { lastSubmission } = useBonzahOnboarding();
  const [dismissed, setDismissed] = useState(true); // default true to avoid flash

  const submissionId = lastSubmission?.id ?? null;
  const status = lastSubmission?.status ?? null;
  const storageKey =
    tenant?.id && submissionId ? `bonzah-active-dismissed-${tenant.id}-${submissionId}` : null;

  useEffect(() => {
    if (status !== 'approved' || !storageKey) {
      setDismissed(false);
      return;
    }
    setDismissed(localStorage.getItem(storageKey) === 'true');
  }, [status, storageKey]);

  if (!lastSubmission) return null;

  if (status === 'approved') {
    if (dismissed) return null;
    const message =
      (lastSubmission as any).partner_message ||
      'Your Bonzah insurance integration is now live. Renters can add coverage at checkout.';
    return (
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="h-1.5 bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500" />
        <CardContent className="py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 shrink-0">
                <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-base">
                  Bonzah is active <span aria-hidden>🎉</span>
                </p>
                <p className="text-sm text-muted-foreground line-clamp-2">{message}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (storageKey) localStorage.setItem(storageKey, 'true');
                setDismissed(true);
              }}
              className="shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === 'rejected') {
    const reason =
      (lastSubmission as any).reject_reason ||
      (lastSubmission as any).admin_note ||
      'A small update is needed before we can activate your Bonzah coverage.';
    return (
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="h-1.5 bg-gradient-to-r from-blue-400 via-blue-500 to-indigo-500" />
        <CardContent className="py-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center justify-center h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/30 shrink-0">
                <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-base">Almost there — a quick Bonzah update</p>
                <p className="text-sm text-muted-foreground line-clamp-2">{reason}</p>
              </div>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <Link href="/settings?tab=insurance">
                Update &amp; resubmit
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
