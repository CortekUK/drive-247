'use client';

/**
 * One automation: its switch, its timeline, its templates, and its log.
 *
 * The same component serves all three sub-tabs. They differ only in what the
 * offset means — days AFTER signup, days BEFORE renewal, or nothing at all for
 * a receipt, which fires on the payment — and that difference is content, so
 * it comes from the catalogue rather than from a branch in here.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Loader2, Send } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/sonner';

import { automationMeta, CUSTOMER_MANAGEMENT_VARIABLES } from '@/lib/customer-management/catalog';
import { compressOffsets, formatSeconds } from '@/lib/customer-management/schedule';
import { runNow, saveStep, saveSettings } from '@/lib/customer-management/api';
import type {
  AutomationId,
  CustomerManagementSettings,
  CustomerManagementStep,
  RunSummary,
} from '@/lib/customer-management/types';

import { SendLog } from './logs-table';

const ENABLED_FIELD: Record<AutomationId, keyof CustomerManagementSettings> = {
  signup: 'signup_enabled',
  renewal: 'renewal_enabled',
  receipt: 'receipt_enabled',
};

export function AutomationTab({
  automation,
  steps,
  settings,
  canEdit,
  onSettingsChange,
  onStepsChange,
}: {
  automation: AutomationId;
  steps: CustomerManagementStep[];
  settings: CustomerManagementSettings;
  canEdit: boolean;
  onSettingsChange: (next: CustomerManagementSettings) => void;
  onStepsChange: () => void;
}) {
  const meta = automationMeta(automation);
  const mine = useMemo(
    () => steps.filter((s) => s.automation === automation).sort((a, b) => a.sort_order - b.sort_order),
    [steps, automation],
  );

  const enabledField = ENABLED_FIELD[automation];
  const isOn = settings[enabledField] === true;

  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);

  /* In test mode the timeline is what it will actually do, so show the
     compressed delays beside the real ones rather than making somebody work
     the curve out from the anchors. */
  const compressed = useMemo(
    () => (settings.test_mode ? compressOffsets(mine.map((s) => s.offset_days)) : null),
    [settings.test_mode, mine],
  );

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      onSettingsChange(await saveSettings({ [enabledField]: on } as Partial<CustomerManagementSettings>));
      toast.success(on ? `${meta.label} on.` : `${meta.label} off.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const preview = async (send: boolean) => {
    setBusy(true);
    setSummary(null);
    try {
      const result = await runNow({ dryRun: !send, automation });
      setSummary(result);
      if (result.halted) toast.error(`Nothing ran: ${result.halted}`);
      else if (send) toast.success(`${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed.`);
      else toast.success(`${result.sent} would send, ${result.skipped} would be skipped.`);
      if (send) onStepsChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <CardTitle>{meta.label}</CardTitle>
              <CardDescription>{meta.description}</CardDescription>
            </div>
            <Switch checked={isOn} disabled={!canEdit || busy} onCheckedChange={toggle} />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            {meta.trigger}
          </p>

          {/* The one thing a reader needs before switching this on. The
              receipt automation's caution is that Stripe already sends one. */}
          {meta.caution && (
            <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-muted-foreground">{meta.caution}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => preview(false)}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Preview what would send
            </Button>
            {/* Sending for real is a separate, second press. Nobody should
                learn what an automation does by having it mail every
                operator. */}
            <Button
              variant="secondary"
              size="sm"
              disabled={!canEdit || busy || !isOn}
              onClick={() => preview(true)}
            >
              <Send className="mr-2 h-4 w-4" />
              Run now
            </Button>
            {settings.test_mode && <Badge variant="secondary">Test mode — redirected</Badge>}
          </div>

          {summary && <RunResult summary={summary} />}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Timeline</h3>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">No steps yet.</p>
        ) : (
          mine.map((step) => (
            <StepEditor
              key={step.id}
              step={step}
              offsetLabel={meta.offsetLabel}
              offsetEditable={automation !== 'receipt'}
              compressedSeconds={compressed?.get(step.offset_days)}
              canEdit={canEdit}
              onSaved={onStepsChange}
            />
          ))
        )}
      </div>

      <SendLog automation={automation} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function RunResult({ summary }: { summary: RunSummary }) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
      <p className="font-medium">
        {summary.dry_run ? 'Preview' : 'Run'} — {summary.considered} considered, {summary.sent}{' '}
        {summary.dry_run ? 'would send' : 'sent'}, {summary.skipped} skipped, {summary.failed} failed
        {summary.capped ? ' (stopped at the per-run cap)' : ''}
      </p>
      {summary.results && summary.results.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {summary.results.slice(0, 12).map((r, i) => (
            <li key={i}>
              <span className="font-mono">{r.tenant_slug}</span> · {r.step_key} · {r.status}
              {r.to_email ? ` → ${r.to_email}` : ''}
              {r.detail ? ` · ${r.detail}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function StepEditor({
  step,
  offsetLabel,
  offsetEditable,
  compressedSeconds,
  canEdit,
  onSaved,
}: {
  step: CustomerManagementStep;
  offsetLabel: string;
  offsetEditable: boolean;
  compressedSeconds?: number;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(step.label);
  const [offset, setOffset] = useState(String(step.offset_days));
  const [subject, setSubject] = useState(step.subject);
  const [body, setBody] = useState(step.body_html);
  const [enabled, setEnabled] = useState(step.enabled);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLabel(step.label);
    setOffset(String(step.offset_days));
    setSubject(step.subject);
    setBody(step.body_html);
    setEnabled(step.enabled);
  }, [step]);

  const dirty =
    label !== step.label ||
    offset !== String(step.offset_days) ||
    subject !== step.subject ||
    body !== step.body_html ||
    enabled !== step.enabled;

  const save = async () => {
    const days = Number.parseInt(offset, 10);
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      toast.error('The offset must be a whole number of days between 0 and 365.');
      return;
    }
    setSaving(true);
    try {
      await saveStep(step.id, {
        label: label.trim() || step.label,
        offset_days: days,
        subject: subject.trim(),
        body_html: body,
        enabled,
      });
      toast.success('Step saved.');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{step.label}</p>
          <p className="truncate text-xs text-muted-foreground">{step.subject}</p>
        </div>
        {compressedSeconds !== undefined && (
          <Badge variant="outline" className="shrink-0">
            {formatSeconds(compressedSeconds)}
          </Badge>
        )}
        {!step.enabled && (
          <Badge variant="secondary" className="shrink-0">
            Off
          </Badge>
        )}
      </button>

      {open && (
        <CardContent className="space-y-4 border-t pt-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={`en-${step.id}`}>This step is on</Label>
            <Switch
              id={`en-${step.id}`}
              checked={enabled}
              disabled={!canEdit}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`lb-${step.id}`}>Name</Label>
              <Input
                id={`lb-${step.id}`}
                value={label}
                disabled={!canEdit}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`of-${step.id}`}>{offsetLabel}</Label>
              <Input
                id={`of-${step.id}`}
                type="number"
                min={0}
                max={365}
                value={offset}
                /* A receipt fires on the payment, so there is no offset to
                   edit — the field stays visible and disabled rather than
                   vanishing, so the three tabs read the same way. */
                disabled={!canEdit || !offsetEditable}
                onChange={(e) => setOffset(e.target.value)}
              />
              {compressedSeconds !== undefined && (
                <p className="text-xs text-muted-foreground">
                  In test mode this fires {formatSeconds(compressedSeconds)} after the rehearsal
                  starts.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`su-${step.id}`}>Subject</Label>
            <Input
              id={`su-${step.id}`}
              value={subject}
              disabled={!canEdit}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`bd-${step.id}`}>Body</Label>
            <Textarea
              id={`bd-${step.id}`}
              rows={12}
              className="font-mono text-xs"
              value={body}
              disabled={!canEdit}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Simple HTML: <code>p</code>, <code>h3</code>, <code>ul</code>/<code>li</code>,{' '}
              <code>strong</code>, <code>a</code>, and{' '}
              <code>&lt;a data-email-button href=&quot;…&quot;&gt;</code> for a button. Drive247&apos;s
              header, footer and colours are added when it is sent.
            </p>
          </div>

          <VariableHints />

          {/* `step_key` is shown but has no field: it is half of the send log's
              idempotency key, so renaming it would re-send every email this
              step has ever sent. */}
          <p className="text-xs text-muted-foreground">
            Key <span className="font-mono">{step.step_key}</span> — fixed, because the send log
            uses it to know what has already gone out.
          </p>

          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!canEdit || !dirty || saving} onClick={save}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save step
            </Button>
            {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * The variables these templates may use.
 *
 * The first group already existed for the rest of the platform's mail
 * (lib/notifications-v2/variables.ts) and is listed by name so nobody invents
 * a second spelling of the same thing; the second group is what this module
 * added.
 */
function VariableHints() {
  const shared = [
    'tenant_name',
    'tenant_admin_name',
    'plan_name',
    'plan_amount',
    'plan_interval',
    'renewal_date',
    'portal_url',
    'booking_url',
    'sign_in_email',
  ];
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-medium">Variables</p>
      <div className="flex flex-wrap gap-1.5">
        {shared.map((key) => (
          <code key={key} className="rounded bg-background px-1.5 py-0.5 text-xs">
            {`{{${key}}}`}
          </code>
        ))}
        {CUSTOMER_MANAGEMENT_VARIABLES.map((v) => (
          <code key={v.key} className="rounded bg-background px-1.5 py-0.5 text-xs" title={v.label}>
            {`{{${v.key}}}`}
          </code>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        A name that is not on this list is left in the email exactly as typed, so a mistake is
        visible rather than silently blank.
      </p>
    </div>
  );
}
