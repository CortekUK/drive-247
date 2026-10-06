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
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Loader2, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/sonner';

import { automationMeta, CUSTOMER_MANAGEMENT_VARIABLES } from '@/lib/customer-management/catalog';
import { compressOffsets, formatSeconds, renewalTestSeconds } from '@/lib/customer-management/schedule';
import { runNow, saveStep, saveSettings } from '@/lib/customer-management/api';
import type {
  AutomationId,
  CustomerManagementSettings,
  CustomerManagementStep,
  RunSummary,
  StepSendIf,
} from '@/lib/customer-management/types';
import { isEventStep } from '@/lib/customer-management/types';

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
  const compressed = useMemo(() => {
    if (!settings.test_mode) return null;
    const offsets = mine.map((s) => s.offset_days);
    // Renewal counts down (3 days left first), so it has its own countdown.
    return automation === 'renewal' ? renewalTestSeconds(offsets) : compressOffsets(offsets);
  }, [settings.test_mode, mine, automation]);

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

  /* Read-only: sending is the cron job's, never this page's. */
  const preview = async () => {
    setBusy(true);
    setSummary(null);
    try {
      const result = await runNow({ dryRun: true, automation });
      setSummary(result);
      if (result.halted) toast.error(`Nothing ran: ${result.halted}`);
      else toast.success(`${result.sent} due now, ${result.skipped} would be skipped.`);
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

          {/* No "Run now": the cron job runs this every 30 seconds, so an
              email goes out as soon as it is due without anyone pressing
              anything. */}
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap className="h-4 w-4" />
            {isOn
              ? 'Automatic — each email sends itself when it is due. Nothing to press.'
              : 'Off — nothing in this automation sends until it is switched on.'}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={preview}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Preview what is due now
            </Button>
            {settings.test_mode && (
              <Badge variant="secondary">Test mode — {settings.scope_tenant_slug} only</Badge>
            )}
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
      {/* The repeat box sits beside the toggle, not inside it: an input
          nested in a <button> is invalid and would open the step on every
          click into it. */}
      <div className="flex w-full items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
        </button>
        {step.send_if && !isEventStep(step) && <RepeatEvery step={step} canEdit={canEdit} onSaved={onSaved} />}
        {compressedSeconds !== undefined && !isEventStep(step) && (
          <Badge variant="outline" className="shrink-0">
            {formatSeconds(compressedSeconds)}
          </Badge>
        )}
        {step.send_if && (
          <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
            {isEventStep(step) ? 'When it happens' : 'Conditional'}
          </Badge>
        )}
        {!step.enabled && (
          <Badge variant="secondary" className="shrink-0">
            Off
          </Badge>
        )}
      </div>

      {open && (
        <CardContent className="space-y-4 border-t pt-4">
          {step.send_if && (
            <p className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
              {SEND_IF_TEXT[step.send_if]}
            </p>
          )}

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
              {isEventStep(step) ? (
                <p id={`of-${step.id}`} className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                  Sent as soon as it happens
                </p>
              ) : (
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
              )}
              {compressedSeconds !== undefined && !isEventStep(step) && (
                <p className="text-xs text-muted-foreground">
                  In test mode this sends {formatSeconds(compressedSeconds)} after test mode is
                  switched on.
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
            <Label htmlFor={`bd-${step.id}`}>Email text</Label>
            <Textarea
              id={`bd-${step.id}`}
              rows={14}
              className="text-sm leading-relaxed"
              value={body}
              disabled={!canEdit}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Plain text. Leave an empty line between paragraphs, start a line with{' '}
              <code>- </code> for a bullet point, and web addresses become links on their own.
              Drive247&apos;s header and footer are added when it is sent.
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
 * "Repeat every [3] days" on a conditional step's row. Saved on its own, the
 * moment the box loses focus or Enter is pressed, so it never mixes with the
 * step's unsaved text edits. Empty means send once.
 */
function RepeatEvery({
  step,
  canEdit,
  onSaved,
}: {
  step: CustomerManagementStep;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const current = step.repeat_every_days ? String(step.repeat_every_days) : '';
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(current), [current]);

  const commit = async () => {
    if (value.trim() === current) return;
    const days = value.trim() === '' ? null : Number.parseInt(value, 10);
    if (days !== null && (!Number.isFinite(days) || days < 1 || days > 365)) {
      toast.error('Repeat every must be a whole number of days between 1 and 365, or empty to send once.');
      setValue(current);
      return;
    }
    setSaving(true);
    try {
      await saveStep(step.id, { repeat_every_days: days });
      toast.success(days ? `Repeats every ${days} ${days === 1 ? 'day' : 'days'} until done.` : 'Sends once.');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
      setValue(current);
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="hidden sm:inline">Repeat every</span>
      <Input
        type="number"
        min={1}
        max={365}
        inputMode="numeric"
        aria-label="Repeat every how many days"
        placeholder="—"
        className="h-7 w-14 px-2 text-xs"
        value={value}
        disabled={!canEdit || saving}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <span>days</span>
    </label>
  );
}

/** What a conditional step checks, in the words the admin page shows. */
const SEND_IF_TEXT: Record<StepSendIf, string> = {
  stripe_not_connected:
    'Only sent while the company has not connected Stripe. First on the day set below, then again every "Repeat every" days, until Stripe is connected. Only for companies that sign up from now on.',
  bonzah_form_not_submitted:
    'Only sent while the company has not submitted the Bonzah form (a rejected form counts as not submitted). First on the day set below, then again every "Repeat every" days, until the form is sent. This checks the form only, not whether Bonzah is connected. Only for companies that sign up from now on.',
  stripe_connected:
    'Sent once, within about 30 seconds of the company connecting Stripe — new and existing companies alike. Companies that had already connected Stripe when this email was added are not sent it.',
  bonzah_active:
    'Sent once, within about 30 seconds of Bonzah going live for the company (switched on, credentials saved, live mode) — new and existing companies alike. Submitting the form is earlier and does not trigger it. Companies already live on Bonzah when this email was added are not sent it.',
};

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
