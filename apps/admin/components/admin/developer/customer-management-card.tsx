'use client';

/**
 * Customer Management rehearsal — the compressed run, driven from here.
 *
 * The timelines and the copy are edited on /admin/customer-management. This is
 * the other half of that job: switching the clock to rehearsal speed and
 * seeing exactly when each email will land. It belongs on this page because
 * that is where every other rehearsal already is.
 *
 * ── NOTHING TO PRESS ────────────────────────────────────────────────────────
 *
 * There is no send button. Switching test mode on starts the rehearsal and the
 * cron job delivers each step when it falls due, to Northwind's own email.
 * The only other button is Preview, which sends nothing — so the page header's
 * promise that "nothing here affects any other tenant" holds: test mode is
 * confined to Northwind by the runner itself.
 */

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FlaskConical, Loader2, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';

import { TestModePanel } from '@/components/admin/customer-management/test-mode-panel';
import { RenewalSimulator } from '@/components/admin/developer/renewal-simulator';
import { ReceiptSimulator } from '@/components/admin/developer/receipt-simulator';
import { AUTOMATIONS } from '@/lib/customer-management/catalog';
import { compressOffsets, formatSeconds, renewalTestSeconds } from '@/lib/customer-management/schedule';
import { loadSettings, loadSteps, NotInstalledError, runNow } from '@/lib/customer-management/api';
import type {
  AutomationId,
  CustomerManagementSettings,
  CustomerManagementStep,
  RunSummary,
} from '@/lib/customer-management/types';

export function CustomerManagementCard() {
  const [settings, setSettings] = useState<CustomerManagementSettings | null>(null);
  const [steps, setSteps] = useState<CustomerManagementStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [notInstalled, setNotInstalled] = useState(false);
  const [busy, setBusy] = useState<AutomationId | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, st] = await Promise.all([loadSettings(), loadSteps()]);
      setSettings(s);
      setSteps(st);
      setNotInstalled(false);
    } catch (e) {
      if (e instanceof NotInstalledError) setNotInstalled(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = async (automation: AutomationId) => {
    setBusy(automation);
    setSummary(null);
    try {
      const result = await runNow({ dryRun: true, automation });
      setSummary(result);
      if (result.halted) toast.error(`Nothing ran: ${result.halted}`);
      else toast.success(`${result.sent} due now, ${result.skipped} would be skipped.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (notInstalled || !settings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="size-4" />
            Customer Management rehearsal
          </CardTitle>
          <CardDescription>
            Not installed yet — the module&apos;s tables are missing, so there is nothing to
            rehearse.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/customer-management">
              Open Customer Management
              <ExternalLink className="ml-2 size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const testing = settings.test_mode;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="size-4" />
              Customer Management rehearsal
            </CardTitle>
            <CardDescription>
              Play the signup sequence and the renewal reminders at test speed, sent to
              Northwind&apos;s email. Switch test mode on and the emails send themselves.
            </CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/customer-management">
              <SlidersHorizontal className="mr-2 size-4" />
              Edit timelines
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <TestModePanel
          settings={settings}
          canEdit
          onChange={setSettings}
          /* Two instances never share a page, but the ids are scoped anyway —
             this one is mounted beside the other developer cards. */
          idPrefix="dev-cms"
        />

        {AUTOMATIONS.map((meta) => {
          const mine = steps
            .filter((s) => s.automation === meta.id && s.enabled)
            .sort((a, b) => a.sort_order - b.sort_order);
          const offsets = mine.map((s) => s.offset_days);
          // Renewal counts down — "3 days left" first — so it has its own countdown.
          const compressed =
            meta.id === 'renewal' ? renewalTestSeconds(offsets) : compressOffsets(offsets);

          return (
            <div key={meta.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{meta.label}</p>
                  {mine.length === 0 && <Badge variant="secondary">Off</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy !== null || mine.length === 0}
                    onClick={() => preview(meta.id)}
                  >
                    {busy === meta.id ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    Preview
                  </Button>
                </div>
              </div>

              {mine.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No steps switched on. Turn them on under Edit timelines.
                </p>
              ) : (
                <ul className="space-y-1">
                  {mine.map((step) => (
                    <li
                      key={step.id}
                      className="flex items-center justify-between gap-4 text-xs text-muted-foreground"
                    >
                      <span className="truncate">{step.label}</span>
                      <span className="shrink-0 font-mono">
                        {testing
                          ? formatSeconds(compressed.get(step.offset_days) ?? 0)
                          : `${step.offset_days}d${meta.id === 'renewal' ? ' before' : ''}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        <RenewalSimulator settings={settings} steps={steps} onChange={setSettings} />

        <ReceiptSimulator settings={settings} onChange={setSettings} />

        {summary && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">
              Preview — {summary.considered} considered,{' '}
              {summary.sent} {summary.dry_run ? 'would send' : 'sent'}, {summary.skipped} skipped,{' '}
              {summary.failed} failed
            </p>
            {summary.results && summary.results.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {summary.results.slice(0, 10).map((r, i) => (
                  <li key={i}>
                    <span className="font-mono">{r.tenant_slug}</span> · {r.step_key} · {r.status}
                    {r.to_email ? ` → ${r.to_email}` : ''}
                    {r.detail ? ` · ${r.detail}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Preview sends nothing. With test mode on, each email sends itself at the time shown
          beside it.
        </p>
      </CardContent>
    </Card>
  );
}
