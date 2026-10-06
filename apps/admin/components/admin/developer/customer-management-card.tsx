'use client';

/**
 * Customer Management rehearsal — the compressed run, driven from here.
 *
 * The timelines and the copy are edited on /admin/customer-management. This is
 * the other half of that job: switching the clock to rehearsal speed, seeing
 * exactly when each email will land, and firing the sequence at yourself. It
 * belongs on this page because that is where every other rehearsal already is,
 * and because somebody driving the canary should not have to go and find a
 * settings screen to do it.
 *
 * ── THIS CARD CANNOT EMAIL A REAL OPERATOR ──────────────────────────────────
 *
 * The page header promises "nothing here affects any other tenant", and a
 * button that sends live mail would quietly break that promise — the audience
 * is governed by `scope_all_tenants`, which lives on the other page and may
 * well be on by the time somebody reads this.
 *
 * So the promise is kept structurally rather than by wording: **Run rehearsal
 * is enabled only while test mode is on**, and test mode redirects every
 * recipient to the rehearsal address. With it off, the only button that works
 * is the dry run, which sends nothing at all. Firing the real thing is done on
 * the Customer Management page, deliberately, where the audience is stated.
 */

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, FlaskConical, Loader2, Send, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';

import { TestModePanel } from '@/components/admin/customer-management/test-mode-panel';
import { AUTOMATIONS } from '@/lib/customer-management/catalog';
import { compressOffsets, formatSeconds } from '@/lib/customer-management/schedule';
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

  const run = async (automation: AutomationId, send: boolean) => {
    setBusy(automation);
    setSummary(null);
    try {
      const result = await runNow({ dryRun: !send, automation });
      setSummary(result);
      if (result.halted) toast.error(`Nothing ran: ${result.halted}`);
      else if (send) toast.success(`${result.sent} sent to the rehearsal address.`);
      else toast.success(`${result.sent} would send, ${result.skipped} would be skipped.`);
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
              Play the signup sequence and the renewal reminders at compressed speed, addressed to
              you.
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
          const compressed = compressOffsets(mine.map((s) => s.offset_days));

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
                    onClick={() => run(meta.id, false)}
                  >
                    {busy === meta.id ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    Preview
                  </Button>
                  {/* Enabled ONLY in test mode — see the note at the top of this
                      file. Off, this would mail whoever `scope_all_tenants`
                      currently covers, which is not this page's to do. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null || !testing || mine.length === 0}
                    title={
                      testing
                        ? `Sends to ${settings.test_recipient_email}`
                        : 'Switch test mode on first — otherwise this would email real operators.'
                    }
                    onClick={() => run(meta.id, true)}
                  >
                    <Send className="mr-2 size-4" />
                    Run rehearsal
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
                          : `${step.offset_days}d`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {summary && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">
              {summary.dry_run ? 'Preview' : 'Rehearsal'} — {summary.considered} considered,{' '}
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

        {!testing && (
          <p className="text-xs text-muted-foreground">
            Preview sends nothing. <strong>Run rehearsal</strong> needs test mode on, which
            redirects every email to the address above — that is what keeps this page unable to
            reach a real operator.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
