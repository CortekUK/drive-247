"use client";

/**
 * v2 Settings › Key handover › Lockbox messages. v2 ONLY: the v1
 * `LockboxTemplatesSection` hands off here behind `useV2('chrome')`.
 *
 * These messages carry the code to the box holding the car keys, so the
 * states matter more than usual. v1 saved an empty subject, an empty body, or
 * a body without {{lockbox_code}} and toasted success; flashed "Enable
 * lockbox" while settings loaded; filled the editors with defaults when the
 * template read failed (one Save then overwrote the real template); kept Save
 * enabled with no changes and lost edits without warning; and a partial
 * "Reset all" said only "Failed to reset".
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Textarea } from "@/components/ui-v2/textarea";
import { TooltipProvider } from "@/components/ui-v2/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-v2/alert-dialog";
import { useTenant } from "@/contexts/TenantContext";
import { useLockboxTemplates } from "@/hooks/use-lockbox-templates";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  SettingsDependencyNotice,
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  SettingsReadOnlyNotice,
  SettingsSaveState,
  SettingsSectionSkeleton,
  describeSaveError,
  useWarnOnUnsavedChanges,
  type SettingsSaveStatus,
} from "./section-states";
import { LOCKBOX_CODE_VARIABLE, SMS_SINGLE_LIMIT, lockboxTemplateIssues, smsSegments } from "./message-rules";
import { IconActionButton } from "./template-editor-shell-v2";

export interface LockboxDefaults {
  instructions: string;
  email: { subject: string; body: string };
  sms: { body: string };
}

type Phase = { phase: "idle" | "saving" | "saved" | "error"; error?: unknown };

/** One block's save lifecycle: saving → saved (briefly) or error, kept until the next try. */
function useBlockSave() {
  const [state, setState] = useState<Phase>({ phase: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = async (fn: () => Promise<unknown>) => {
    clearTimeout(timer.current);
    setState({ phase: "saving" });
    try {
      await fn();
      setState({ phase: "saved" });
      timer.current = setTimeout(() => setState({ phase: "idle" }), 2500);
      return true;
    } catch (error) {
      setState({ phase: "error", error });
      return false;
    }
  };

  const status = (dirty: boolean): SettingsSaveStatus =>
    state.phase === "saving" ? "saving" : state.phase === "error" ? "error" : dirty ? "dirty" : state.phase === "saved" ? "saved" : "idle";

  return { run, status, error: state.error, saving: state.phase === "saving" };
}

/**
 * Keep a draft in step with the stored value, unless the operator has typed
 * something different from what was stored (then their edit wins).
 */
function useFollowStored<T>(stored: T | null, equals: (a: T, b: T) => boolean) {
  const [draft, setDraft] = useState<T | null>(null);
  const previous = useRef<T | null>(null);
  const key = stored === null ? null : JSON.stringify(stored);
  useEffect(() => {
    if (stored === null) return;
    const before = previous.current;
    previous.current = stored;
    setDraft((cur) => (cur === null || (before !== null && equals(cur, before)) ? stored : cur));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [draft, setDraft] as const;
}

function Block({ title, description, aside, children }: { title: string; description?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function LockboxTemplatesSectionV2({
  defaults,
  variables,
}: {
  defaults: LockboxDefaults;
  variables: { key: string; desc: string }[];
}) {
  const { tenant } = useTenant();
  const { settings: rentalSettings, isLoading: rentalLoading, error: rentalError, refetch: refetchRental, updateSettings } =
    useRentalSettings();
  const { templates, error: templatesError, refetch: refetchTemplates, isFetching, getEmailTemplate, getSmsTemplate, saveTemplate } =
    useLockboxTemplates();
  const { canEditSettings } = useManagerPermissions();
  const canEdit = canEditSettings("lockbox");

  const settingsReady = !!tenant && !rentalLoading && !rentalError;
  const storedInstructions = settingsReady ? rentalSettings?.lockbox_default_instructions || defaults.instructions : null;
  const storedEmail = templates ? getEmailTemplate() : null;
  const storedSms = templates ? getSmsTemplate().body : null;

  const [instructions, setInstructions] = useFollowStored<string>(storedInstructions, (a, b) => a === b);
  const [email, setEmail] = useFollowStored<{ subject: string; body: string }>(
    storedEmail ? { subject: storedEmail.subject, body: storedEmail.body } : null,
    (a, b) => a.subject === b.subject && a.body === b.body,
  );
  const [sms, setSms] = useFollowStored<string>(storedSms, (a, b) => a === b);

  const [emailArmed, setEmailArmed] = useState(false);
  const [smsArmed, setSmsArmed] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const instructionsSave = useBlockSave();
  const emailSave = useBlockSave();
  const smsSave = useBlockSave();

  const instructionsDirty = instructions !== null && storedInstructions !== null && instructions !== storedInstructions;
  const emailDirty =
    email !== null && storedEmail !== null && (email.subject !== storedEmail.subject || email.body !== storedEmail.body);
  const smsDirty = sms !== null && storedSms !== null && sms !== storedSms;
  useWarnOnUnsavedChanges(canEdit && (instructionsDirty || emailDirty || smsDirty));

  const failToast = (what: string, err: unknown) =>
    toast({ title: `Couldn't save the ${what}`, description: describeSaveError(err), variant: "destructive" });

  const heading = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 className="font-heading text-base font-semibold tracking-tight text-foreground">Lockbox messages</h2>
        <p className="text-sm text-muted-foreground">What customers receive with their lockbox code.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!canEdit && <SettingsReadOnlyNotice />}
        {canEdit && templates && rentalSettings?.lockbox_enabled && (
          <IconActionButton
            action={{ label: "Reset all messages to default", icon: RotateCcw, onClick: () => setResetOpen(true), busy: resetting, tone: "destructive" }}
          />
        )}
      </div>
    </div>
  );

  const wrap = (body: ReactNode) => (
    <TooltipProvider>
      <section className="space-y-4" data-settings-section="lockbox-messages">
        {heading}
        {body}
      </section>
    </TooltipProvider>
  );

  if (!tenant || rentalLoading || (!rentalError && !templates && !templatesError)) {
    return wrap(<SettingsSectionSkeleton variant="form" rows={3} label="Loading lockbox messages" />);
  }
  if (rentalError) {
    return wrap(<SettingsLoadError thing="lockbox settings" error={rentalError} onRetry={() => refetchRental()} />);
  }
  if (!rentalSettings?.lockbox_enabled) {
    return wrap(
      <SettingsDependencyNotice
        title="Lockbox handover is off"
        body="Turn on lockbox handover above and save. Then you can edit the email and text message that send the code."
      />,
    );
  }
  if (!templates) {
    return wrap(
      <SettingsLoadError thing="lockbox message templates" error={templatesError} onRetry={() => refetchTemplates()} retrying={isFetching} />,
    );
  }
  if (instructions === null || email === null || sms === null) {
    return wrap(<SettingsSectionSkeleton variant="form" rows={3} label="Loading lockbox messages" />);
  }

  const emailIssues = lockboxTemplateIssues({ channel: "email", subject: email.subject, body: email.body });
  const smsIssues = lockboxTemplateIssues({ channel: "sms", body: sms });
  const smsLength = sms.length;
  const segments = smsSegments(smsLength);

  const saveInstructions = () =>
    instructionsSave.run(async () => {
      try {
        await updateSettings({ lockbox_default_instructions: instructions });
        // Blank means "use the default": show what will actually be sent.
        if (!instructions.trim()) setInstructions(defaults.instructions);
      } catch (err) {
        failToast("instructions", err);
        throw err;
      }
    });

  const saveEmail = () => {
    if (emailIssues.subjectError || emailIssues.bodyError) return;
    if (emailIssues.missingCode && !emailArmed) {
      setEmailArmed(true);
      return;
    }
    void emailSave.run(async () => {
      try {
        await saveTemplate.mutateAsync({ channel: "email", subject: email.subject, body: email.body });
        setEmailArmed(false);
        toast({ title: "Lockbox email saved" });
      } catch (err) {
        failToast("email", err);
        throw err;
      }
    });
  };

  const saveSms = () => {
    if (smsIssues.bodyError) return;
    if (smsIssues.missingCode && !smsArmed) {
      setSmsArmed(true);
      return;
    }
    void smsSave.run(async () => {
      try {
        await saveTemplate.mutateAsync({ channel: "sms", body: sms });
        setSmsArmed(false);
        toast({ title: "Lockbox text message saved" });
      } catch (err) {
        failToast("text message", err);
        throw err;
      }
    });
  };

  const handleResetAll = async () => {
    setResetting(true);
    const done: string[] = [];
    try {
      await updateSettings({ lockbox_default_instructions: defaults.instructions });
      setInstructions(defaults.instructions);
      done.push("instructions");
      await saveTemplate.mutateAsync({ channel: "email", subject: defaults.email.subject, body: defaults.email.body });
      setEmail({ ...defaults.email });
      done.push("email");
      await saveTemplate.mutateAsync({ channel: "sms", body: defaults.sms.body });
      setSms(defaults.sms.body);
      done.push("text message");
      toast({ title: "Lockbox messages reset", description: "The instructions, email and text message use the default wording again." });
      setResetOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't reset everything",
        description: `${done.length ? `Reset: ${done.join(", ")}. ` : "Nothing was reset. "}${describeSaveError(err)}`,
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  };

  const missingCodeCopy = (armed: boolean) => (
    <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">
      This message doesn&apos;t include <code className="font-mono">{LOCKBOX_CODE_VARIABLE}</code>, so the customer won&apos;t get
      the code to open the box.{armed ? " Press Save again to keep it anyway." : ""}
    </p>
  );

  return wrap(
    <>
      <div className="rounded-2xl bg-muted/40 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Variables you can use</p>
        <div className="flex flex-wrap gap-1.5">
          {variables.map((v) => (
            <span key={v.key} title={v.desc} className="rounded-full bg-background px-2 py-0.5 font-mono text-xs text-foreground">
              {v.key}
            </span>
          ))}
        </div>
      </div>

      <SettingsReadOnlyFieldset readOnly={!canEdit} className="space-y-4">
        <Block
          title="Default instructions"
          description="Included in every lockbox email and text message."
          aside={canEdit ? <SettingsSaveState status={instructionsSave.status(instructionsDirty)} error={instructionsSave.error} onRetry={saveInstructions} /> : undefined}
        >
          <label htmlFor="v2-lockbox-instructions" className="sr-only">
            Default instructions
          </label>
          <Textarea
            id="v2-lockbox-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={7}
            className="text-sm"
            placeholder="Enter default lockbox instructions..."
          />
          {!instructions.trim() && <p className="text-xs text-muted-foreground">Leave empty to use the default instructions.</p>}
          <Button type="button" size="sm" onClick={() => void saveInstructions()} disabled={!instructionsDirty || instructionsSave.saving}>
            {instructionsSave.saving ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            Save instructions
          </Button>
        </Block>

        <Block
          title="Email"
          aside={canEdit ? <SettingsSaveState status={emailSave.status(emailDirty)} error={emailSave.error} onRetry={saveEmail} /> : undefined}
        >
          <div className="space-y-1.5">
            <label htmlFor="v2-lockbox-email-subject" className="text-xs text-muted-foreground">
              Subject
            </label>
            <Input
              id="v2-lockbox-email-subject"
              value={email.subject}
              onChange={(e) => {
                setEmail({ ...email, subject: e.target.value });
                setEmailArmed(false);
              }}
              placeholder="Your vehicle keys - lockbox code"
              aria-invalid={!!emailIssues.subjectError || undefined}
            />
            {emailIssues.subjectError && <p className="text-xs text-destructive">{emailIssues.subjectError}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="v2-lockbox-email-body" className="text-xs text-muted-foreground">
              Message
            </label>
            <Textarea
              id="v2-lockbox-email-body"
              value={email.body}
              onChange={(e) => {
                setEmail({ ...email, body: e.target.value });
                setEmailArmed(false);
              }}
              rows={9}
              className="font-mono text-sm"
              placeholder="Email body with {{variable}} placeholders..."
              aria-invalid={!!emailIssues.bodyError || undefined}
            />
            {emailIssues.bodyError && <p className="text-xs text-destructive">{emailIssues.bodyError}</p>}
            {emailIssues.missingCode && missingCodeCopy(emailArmed)}
          </div>
          <Button
            type="button"
            size="sm"
            variant={emailArmed ? "destructive" : "default"}
            onClick={saveEmail}
            disabled={!emailDirty || emailSave.saving || !!emailIssues.subjectError || !!emailIssues.bodyError}
          >
            {emailSave.saving ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {emailArmed ? "Save without the code" : "Save email"}
          </Button>
        </Block>

        <Block
          title="Text message"
          aside={
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && <SettingsSaveState status={smsSave.status(smsDirty)} error={smsSave.error} onRetry={saveSms} />}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs tabular-nums",
                  smsLength > SMS_SINGLE_LIMIT ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground",
                )}
              >
                {smsLength} / {SMS_SINGLE_LIMIT}
                {segments > 1 ? ` · ${segments} SMS parts` : ""}
              </span>
            </div>
          }
        >
          <label htmlFor="v2-lockbox-sms" className="sr-only">
            Text message
          </label>
          <Textarea
            id="v2-lockbox-sms"
            value={sms}
            onChange={(e) => {
              setSms(e.target.value);
              setSmsArmed(false);
            }}
            rows={3}
            className="font-mono text-sm"
            placeholder="SMS message with {{variable}} placeholders..."
            aria-invalid={!!smsIssues.bodyError || undefined}
          />
          {smsIssues.bodyError && <p className="text-xs text-destructive">{smsIssues.bodyError}</p>}
          {smsIssues.missingCode && missingCodeCopy(smsArmed)}
          <p className="text-xs text-muted-foreground">
            Over {SMS_SINGLE_LIMIT} characters sends as several parts. Variables are filled in when it sends, so the real
            message can be longer than this count.
          </p>
          <Button
            type="button"
            size="sm"
            variant={smsArmed ? "destructive" : "default"}
            onClick={saveSms}
            disabled={!smsDirty || smsSave.saving || !!smsIssues.bodyError}
          >
            {smsSave.saving ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            {smsArmed ? "Save without the code" : "Save text message"}
          </Button>
        </Block>
      </SettingsReadOnlyFieldset>

      <AlertDialog open={resetOpen} onOpenChange={(open) => !resetting && setResetOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all lockbox messages?</AlertDialogTitle>
            <AlertDialogDescription>
              The default instructions, the email (subject and message) and the text message all go back to the default wording.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleResetAll();
              }}
              disabled={resetting}
            >
              {resetting ? "Resetting…" : "Reset all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>,
  );
}
