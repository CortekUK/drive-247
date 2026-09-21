"use client";

/**
 * v2 Settings › Customer messages › Lockbox messages. v2 ONLY: the v1
 * `LockboxTemplatesSection` hands off here behind `useV2('chrome')`.
 *
 * `channels` picks the message blocks. The v2 Customer messages page passes
 * `["email"]`: the code goes by email only, so the text-message block, its
 * save and its reset are left out (the stored SMS template is not touched).
 *
 * These messages carry the code to the box holding the car keys, so the
 * states matter more than usual. v1 saved an empty subject, an empty body, or
 * a body without {{lockbox_code}} and toasted success; flashed "Enable
 * lockbox" while settings loaded; filled the editors with defaults when the
 * template read failed (one Save then overwrote the real template); kept Save
 * enabled with no changes and lost edits without warning; and a partial
 * "Reset all" said only "Failed to reset".
 *
 * Also here: the skeleton waits for the REAL rental settings (`hasLoaded`; the
 * hook's placeholder says lockbox is off, which flashed the "off" notice), the
 * text-message count is estimated with the variables filled in, a missing
 * Twilio connection is said out loud, and unsaved messages register with the
 * page so leaving from the sidebar warns and "Save" in that dialog saves them.
 *
 * Inside a page save bar (`useSettingsPageSave`) the blocks have no Save
 * buttons: the page's Save changes saves every dirty block and its Reset puts
 * them back. A message without {{lockbox_code}} is refused once with a warning,
 * and saved on the next Save changes, like the block's own "Save without the code".
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
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
import { renderLockboxSmsExample } from "./business-rules-logic";
import { useRegisterLeaveSave } from "./business-section-save";
import type { RegisterSectionSave } from "./pricing-money-parts";
import { SETTINGS_SECTION_TITLE, settingsSaveIssue, useSettingsPageSave } from "./settings-kit";

export type LockboxChannel = "email" | "sms";

export interface LockboxDefaults {
  instructions: string;
  email: { subject: string; body: string };
  sms: { body: string };
}

type Phase = { phase: "idle" | "saving" | "saved" | "error"; error?: unknown };

/**
 * ui-v2 fields fill with `bg-input/50`. Under `.dark .v2-theme` --input carries
 * its own alpha (`0 0% 100% / 15%`), so that colour is invalid and the fields
 * rendered with no fill and no border: text floating on the card. A solid
 * muted fill in dark mode puts the field back.
 */
const FIELD = "dark:bg-muted";

/** A failed reset: the reason, without describeSaveError's "Your changes are still here" (a reset has no edits to keep). */
const describeResetError = (err: unknown) =>
  describeSaveError(err).replace(/\s*Your changes are still here\.\s*/, " ").trim();

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
    <div className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
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
  registerSave,
  integrationsHref = "/integrations?open=Twilio%20Messages",
  readOnlyNotice = true,
  channels = ["email", "sms"],
  keyHandoverHref,
}: {
  defaults: LockboxDefaults;
  variables: { key: string; desc: string }[];
  /** The settings page's section-save registry, so leaving with unsaved messages warns. */
  registerSave?: RegisterSectionSave;
  integrationsHref?: string;
  /** False when the page above already shows the "View only" notice. */
  readOnlyNotice?: boolean;
  /** Which message blocks to show and save. */
  channels?: readonly LockboxChannel[];
  /** Where lockbox handover is switched on, when that is another page. */
  keyHandoverHref?: string;
}) {
  const withSms = channels.includes("sms");
  const { tenant } = useTenant();
  const {
    settings: rentalSettings,
    hasLoaded: rentalHasLoaded,
    error: rentalError,
    refetch: refetchRental,
    isFetching: rentalFetching,
    updateSettings,
  } = useRentalSettings();
  const { templates, error: templatesError, refetch: refetchTemplates, isFetching, getEmailTemplate, getSmsTemplate, saveTemplate } =
    useLockboxTemplates();
  const { canEditSettings } = useManagerPermissions();
  const canEdit = canEditSettings("lockbox");
  const pageSave = useSettingsPageSave();

  // Real settings only: the placeholder row says lockbox is off. A failed refresh
  // over a loaded row keeps the editor (the page shows the stale-data notice).
  const settingsReady = !!tenant && !!rentalHasLoaded;
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
  // Hidden channel: never dirty, never saved.
  const smsDirty = withSms && sms !== null && storedSms !== null && sms !== storedSms;
  useWarnOnUnsavedChanges(canEdit && (instructionsDirty || emailDirty || smsDirty));
  // Filled in below, once the drafts exist; only ever called while something is dirty.
  const saveDirtyForLeave = useRef<() => Promise<void>>(async () => undefined);
  useRegisterLeaveSave(
    canEdit ? registerSave : undefined,
    "lockbox-messages",
    instructionsDirty || emailDirty || smsDirty,
    () => saveDirtyForLeave.current(),
    () => {
      if (storedInstructions !== null) setInstructions(storedInstructions);
      if (storedEmail) setEmail({ subject: storedEmail.subject, body: storedEmail.body });
      if (withSms && storedSms !== null) setSms(storedSms);
      setEmailArmed(false);
      setSmsArmed(false);
    },
  );

  const failToast = (what: string, err: unknown) =>
    toast({ title: `Couldn't save the ${what}`, description: describeSaveError(err), variant: "destructive" });

  const heading = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className={SETTINGS_SECTION_TITLE}>Lockbox messages</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {withSms ? "What customers receive with their lockbox code." : "The email customers receive with their lockbox code."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!canEdit && readOnlyNotice && <SettingsReadOnlyNotice />}
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
      <section className="space-y-3" data-settings-section="lockbox-messages">
        {heading}
        {body}
      </section>
    </TooltipProvider>
  );

  if (!tenant || (!rentalHasLoaded && !rentalError)) {
    return wrap(<SettingsSectionSkeleton variant="form" rows={3} label="Loading lockbox messages" />);
  }
  if (!rentalHasLoaded) {
    return wrap(
      <SettingsLoadError thing="lockbox settings" error={rentalError} onRetry={() => refetchRental()} retrying={rentalFetching} />,
    );
  }
  if (!rentalSettings?.lockbox_enabled) {
    const messages = withSms ? "the email and text message that send the code" : "the email that sends the code";
    return wrap(
      <SettingsDependencyNotice
        title="Lockbox handover is off"
        body={
          keyHandoverHref
            ? `Turn on lockbox handover on the Lockbox page and save. Then you can edit ${messages}.`
            : `Turn on lockbox handover above and save. Then you can edit ${messages}.`
        }
        action={keyHandoverHref ? { label: "Open Lockbox", href: keyHandoverHref } : undefined}
      />,
    );
  }
  if (!templates && !templatesError) {
    return wrap(<SettingsSectionSkeleton variant="form" rows={3} label="Loading lockbox messages" />);
  }
  if (!templates) {
    return wrap(
      <SettingsLoadError thing="lockbox message templates" error={templatesError} onRetry={() => refetchTemplates()} retrying={isFetching} />,
    );
  }
  if (instructions === null || email === null || (withSms && sms === null)) {
    return wrap(<SettingsSectionSkeleton variant="form" rows={3} label="Loading lockbox messages" />);
  }

  const emailIssues = lockboxTemplateIssues({ channel: "email", subject: email.subject, body: email.body });
  const smsIssues = lockboxTemplateIssues({ channel: "sms", body: sms ?? "" });
  // Counted as it will be sent: every {{variable}} filled with a typical value
  // (the tenant's real code length and default instructions where it has them).
  const smsLength = renderLockboxSmsExample(sms ?? "", {
    codeLength: rentalSettings?.lockbox_code_length,
    defaultInstructions: instructions.trim() ? instructions : defaults.instructions,
  }).length;
  const segments = smsSegments(smsLength);
  const smsReady = !!tenant?.integration_twilio_sms;

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
        await saveTemplate.mutateAsync({ channel: "sms", body: sms ?? "" });
        setSmsArmed(false);
        toast({ title: "Lockbox text message saved" });
      } catch (err) {
        failToast("text message", err);
        throw err;
      }
    });
  };

  // The page's Save (its save bar, or "Save" when leaving): every dirty block,
  // and a rejection (so the page stays) when one is invalid, would go out
  // without the code, or fails. In a page save bar there is no block button to
  // confirm a message without the code, so the first Save arms it (the warning
  // shows under the message) and the next Save keeps it.
  const missingCodeRefusal = (what: string, armed: boolean, arm: () => void) => {
    if (!pageSave) return new Error(`The lockbox ${what} doesn't include {{lockbox_code}}. Save it on the page first.`);
    if (armed) return null;
    arm();
    return new Error(`The lockbox ${what} doesn't include {{lockbox_code}}. Press Save changes again to keep it anyway.`);
  };
  saveDirtyForLeave.current = async () => {
    if (instructionsDirty && !(await instructionsSave.run(() => updateSettings({ lockbox_default_instructions: instructions })))) {
      throw new Error("Couldn't save the lockbox instructions.");
    }
    if (emailDirty) {
      // Names the box, so the page's save bar takes the operator to it.
      if (emailIssues.subjectError) throw settingsSaveIssue(emailIssues.subjectError, "v2-lockbox-email-subject");
      if (emailIssues.bodyError) throw settingsSaveIssue(emailIssues.bodyError, "v2-lockbox-email-body");
      if (emailIssues.missingCode) {
        const refusal = missingCodeRefusal("email", emailArmed, () => setEmailArmed(true));
        if (refusal) throw refusal;
      }
      if (!(await emailSave.run(() => saveTemplate.mutateAsync({ channel: "email", subject: email.subject, body: email.body })))) {
        throw new Error("Couldn't save the lockbox email.");
      }
      setEmailArmed(false);
    }
    if (smsDirty) {
      if (smsIssues.bodyError) throw settingsSaveIssue(smsIssues.bodyError, "v2-lockbox-sms");
      if (smsIssues.missingCode) {
        const refusal = missingCodeRefusal("text message", smsArmed, () => setSmsArmed(true));
        if (refusal) throw refusal;
      }
      if (!(await smsSave.run(() => saveTemplate.mutateAsync({ channel: "sms", body: sms ?? "" })))) {
        throw new Error("Couldn't save the lockbox text message.");
      }
      setSmsArmed(false);
    }
  };

  const handleResetAll = async () => {
    setResetting(true);
    const done: string[] = [];
    try {
      await saveTemplate.mutateAsync({ channel: "email", subject: defaults.email.subject, body: defaults.email.body });
      setEmail({ ...defaults.email });
      done.push("email");
      if (withSms) {
        await saveTemplate.mutateAsync({ channel: "sms", body: defaults.sms.body });
        setSms(defaults.sms.body);
        done.push("text message");
      }
      // Last on purpose: the rental-settings hook shows its own generic "Settings
      // Updated" (or "Error") toast, which the toast below replaces in the same
      // tick instead of flashing it over the open dialog mid-reset.
      await updateSettings({ lockbox_default_instructions: defaults.instructions });
      setInstructions(defaults.instructions);
      done.push("instructions");
      toast({
        title: "Lockbox messages reset",
        description: withSms
          ? "The instructions, email and text message use the default wording again."
          : "The instructions and email use the default wording again.",
      });
      setResetOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't reset everything",
        description: `${done.length ? `Reset: ${done.join(", ")}. ` : "Nothing was reset. "}${describeResetError(err)}`,
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  };

  // A block's own status beside its title. In a page save bar the bar says
  // "Unsaved changes" and "Saving…"; a block says only that its save failed.
  const blockStatus = (status: SettingsSaveStatus, error: unknown, retry: () => unknown) =>
    pageSave ? (
      status === "error" ? <SettingsSaveState status="error" error={error} /> : undefined
    ) : (
      <SettingsSaveState status={status} error={error} onRetry={retry} />
    );

  const missingCodeCopy = (armed: boolean) => (
    <p className="text-xs panel-ink-warn" role="alert">
      This message doesn&apos;t include <code className="font-mono">{LOCKBOX_CODE_VARIABLE}</code>, so the customer won&apos;t get
      the code to open the box.{armed ? (pageSave ? " Press Save changes again to keep it anyway." : " Press Save again to keep it anyway.") : ""}
    </p>
  );

  return wrap(
    <>
      <div className="rounded-xl bg-muted/40 px-4 py-3 sm:px-5">
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
          description={withSms ? "Included in every lockbox email and text message." : "Included in every lockbox email."}
          aside={canEdit ? blockStatus(instructionsSave.status(instructionsDirty), instructionsSave.error, saveInstructions) : undefined}
        >
          <label htmlFor="v2-lockbox-instructions" className="sr-only">
            Default instructions
          </label>
          <Textarea
            id="v2-lockbox-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={7}
            className={cn("text-sm", FIELD)}
            placeholder="Enter default lockbox instructions..."
          />
          {!instructions.trim() && <p className="text-xs text-muted-foreground">Leave empty to use the default instructions.</p>}
          {!pageSave && (
            <Button type="button" size="sm" onClick={() => void saveInstructions()} disabled={!instructionsDirty || instructionsSave.saving}>
              {instructionsSave.saving ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
              Save instructions
            </Button>
          )}
        </Block>

        <Block
          title="Email"
          aside={canEdit ? blockStatus(emailSave.status(emailDirty), emailSave.error, saveEmail) : undefined}
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
              maxLength={200}
              className={FIELD}
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
              className={cn("font-mono text-sm", FIELD)}
              placeholder="Email body with {{variable}} placeholders..."
              aria-invalid={!!emailIssues.bodyError || undefined}
            />
            {emailIssues.bodyError && <p className="text-xs text-destructive">{emailIssues.bodyError}</p>}
            {emailIssues.missingCode && missingCodeCopy(emailArmed)}
          </div>
          {!pageSave && (
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
          )}
        </Block>

        {withSms && sms !== null && (
          <Block
            title="Text message"
            aside={
              <div className="flex flex-wrap items-center gap-2">
                {canEdit && blockStatus(smsSave.status(smsDirty), smsSave.error, saveSms)}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs tabular-nums",
                    smsLength > SMS_SINGLE_LIMIT ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground",
                  )}
                >
                  <span className="sr-only">About </span>
                  <span aria-hidden="true">~</span>
                  {smsLength} / {SMS_SINGLE_LIMIT}
                  {segments > 1 ? ` · ${segments} texts` : ""}
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
              className={cn("font-mono text-sm", FIELD)}
              placeholder="SMS message with {{variable}} placeholders..."
              aria-invalid={!!smsIssues.bodyError || undefined}
            />
            {smsIssues.bodyError && <p className="text-xs text-destructive">{smsIssues.bodyError}</p>}
            {smsIssues.missingCode && missingCodeCopy(smsArmed)}
            {!smsReady && (
              <p className="text-xs panel-ink-warn">
                Text messages aren&apos;t set up, so this message isn&apos;t sent yet.{" "}
                <Link href={integrationsHref} className="pointer-events-auto font-medium underline underline-offset-4">
                  Connect Twilio
                </Link>
              </p>
            )}
            {segments > 1 ? (
              <p className="text-xs panel-ink-warn">
                Likely sent as {segments} texts: with the details filled in it comes to about {smsLength} characters, and one
                text holds {SMS_SINGLE_LIMIT}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Counted with example details filled in (name, plate, code). Over {SMS_SINGLE_LIMIT} characters it goes out as
                more than one text.
              </p>
            )}
            {!pageSave && (
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
            )}
          </Block>
        )}
      </SettingsReadOnlyFieldset>

      <AlertDialog open={resetOpen} onOpenChange={(open) => !resetting && setResetOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all lockbox messages?</AlertDialogTitle>
            <AlertDialogDescription>
              {withSms
                ? "The default instructions, the email (subject and message) and the text message all go back to the default wording."
                : "The default instructions and the email (subject and message) go back to the default wording."}
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
