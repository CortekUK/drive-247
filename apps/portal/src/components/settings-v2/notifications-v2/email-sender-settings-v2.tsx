"use client";

/**
 * Notifications v2: the "Email" setup card (build-spec D13; transcript §3.13,
 * 19:35–20:18: "email has an overall setting — which address we send from;
 * leave CC as it is; they can change it later").
 *
 * Rows, top to bottom:
 *   Sender name     the display name; empty = the company name (the placeholder)
 *   Send from       [local part]@drive-247.com; must be the slug or start with it
 *   Replies go to   optional reply-to
 *   Customers see:  a live preview of the From line (settings-model senderAddress,
 *                   the same function the test send uses)
 *   Team alert emails / Team alerts go to
 *                   the EXISTING master switch and recipient, reused through
 *                   `use-email-notification-prefs` (tenants.email_notifications_enabled
 *                   and tenants.notification_recipient_email). These already gate
 *                   today's live operator emails.
 * CC is not built: the lead said to leave it alone.
 *
 * SAVING. Every field is page-draft state saved by the page's sticky save bar
 * (build-spec D11: "the same save thing we already have"), registered as
 * `registerSave("email-sender", save, discard)` through `useRegisterLeaveSave`,
 * so leaving with unsaved edits warns. The team switch and recipient used to
 * save the moment they changed (EmailNotificationSettingsV2); here they wait for
 * Save changes like every other control on this page, so one page never mixes
 * "saved already" and "not saved yet". The same two hook mutations write them.
 * `save` REJECTS whenever something was not saved (an invalid field, or a write
 * that failed), so the page stays put and the edits stay in the fields.
 *
 * STORAGE OFF. Until ops/notifications_v2.sql is applied the sender table does
 * not exist (`tableMissing`): the three sender fields show today's default and
 * are read-only, with one line saying why. The team rows still work: their
 * columns exist today.
 *
 * v2 only: rendered by the v2 Notifications page (northwind canary).
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Input } from "@/components/ui-v2/input";
import { Switch } from "@/components/ui-v2/switch";
import { useTenant } from "@/contexts/TenantContext";
import { useEmailNotificationPrefs } from "@/hooks/use-email-notification-prefs";
import { EMAIL_SENDER_NAME_MAX, useEmailSenderV2 } from "@/hooks/use-email-sender-v2";
import { EMAIL_SENDER_DOMAIN, type EmailSenderSettings } from "@/lib/notifications-v2/types";
import { isValidEmail, isValidLocalPart, senderAddress } from "@/lib/notifications-v2/settings-model";
import { cn } from "@/lib/utils";
import { recipientProblem } from "../message-rules";
import { useRegisterLeaveSave } from "../business-section-save";
import type { RegisterSectionSave } from "../pricing-money-parts";
import {
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  SettingsSaveState,
  SettingsSectionSkeleton,
} from "../section-states";
import { SettingsPanel, SettingsRow, Unit, UnitGroup } from "../settings-kit";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/** The key this card registers with the page's save bar. */
export const EMAIL_SENDER_SAVE_KEY = "email-sender";

export const EMAIL_SENDER_TITLE = "Email";

/** Shown while the new sender table is not there yet (ops SQL not applied). */
export const EMAIL_SENDER_STORAGE_OFF_COPY = "Saving the sender turns on once notifications storage is switched on.";

/* -------------------------------------------------------------------------- */
/* Pure rules (exported for tests)                                             */
/* -------------------------------------------------------------------------- */

/** What the three sender fields hold while being edited. */
export interface SenderDraft {
  name: string;
  local: string;
  replyTo: string;
}

/** What the team rows hold while being edited. */
export interface TeamDraft {
  masterEnabled: boolean;
  recipient: string;
}

export interface SenderFieldProblems {
  name: string | null;
  local: string | null;
  replyTo: string | null;
}

/** The fields as the stored sender fills them: an unset part before the @ shows the slug. */
export function senderDraftFromSettings(
  settings: Partial<EmailSenderSettings> | null | undefined,
  slug: string | null | undefined,
): SenderDraft {
  return {
    name: settings?.from_name ?? "",
    local: settings?.from_local_part || String(slug ?? "").trim().toLowerCase(),
    replyTo: settings?.reply_to ?? "",
  };
}

/**
 * What Save stores for the fields: trimmed, and NULL (= today's default)
 * wherever a field is empty or, for the part before the @, is just the slug.
 */
export function senderSettingsFromDraft(draft: SenderDraft, slug: string | null | undefined): EmailSenderSettings {
  const s = String(slug ?? "").trim().toLowerCase();
  const name = draft.name.trim();
  const local = draft.local.trim();
  const replyTo = draft.replyTo.trim();
  return {
    from_name: name || null,
    from_local_part: local && local !== s ? local : null,
    reply_to: replyTo || null,
  };
}

function sameSender(a: SenderDraft, b: SenderDraft, slug: string | null | undefined): boolean {
  const x = senderSettingsFromDraft(a, slug);
  const y = senderSettingsFromDraft(b, slug);
  return x.from_name === y.from_name && x.from_local_part === y.from_local_part && x.reply_to === y.reply_to;
}

function sameTeam(a: TeamDraft, b: TeamDraft): boolean {
  return a.masterEnabled === b.masterEnabled && a.recipient.trim() === b.recipient.trim();
}

/** Why the sender name can't be used, or null. Empty is fine: the company name is used. */
export function senderNameProblem(name: string): string | null {
  const v = name.trim();
  if (!v) return null;
  if (v.length > EMAIL_SENDER_NAME_MAX) return `Keep the name to ${EMAIL_SENDER_NAME_MAX} characters or fewer.`;
  if (/[<>"]/.test(v)) return 'Leave out <, > and " in the name.';
  return null;
}

/** Every sender field's problem, in the operator's words (null = fine). */
export function senderFieldProblems(draft: SenderDraft, slug: string | null | undefined): SenderFieldProblems {
  const local = draft.local.trim();
  const localCheck = isValidLocalPart(local, slug);
  const replyTo = draft.replyTo.trim();
  let replyProblem: string | null = null;
  if (replyTo) {
    if (!isValidEmail(replyTo)) replyProblem = "Enter a valid email address, like help@yourcompany.com.";
    else {
      // One of this company's own send-only addresses: replies to it are lost.
      const lower = replyTo.toLowerCase();
      const suffix = "@" + EMAIL_SENDER_DOMAIN;
      if (lower.endsWith(suffix) && isValidLocalPart(lower.slice(0, -suffix.length), slug).ok) {
        replyProblem = `Replies to ${lower} go nowhere. Use an inbox your team checks.`;
      }
    }
  }
  return {
    name: senderNameProblem(draft.name),
    local: localCheck.ok ? null : localCheck.reason,
    replyTo: replyProblem,
  };
}

/** What a pasted full address or capitals turn into in the "Send from" box. */
export function normaliseLocalInput(value: string): string {
  const v = value.toLowerCase().replace(/\s+/g, "");
  const suffix = "@" + EMAIL_SENDER_DOMAIN;
  return v.endsWith(suffix) ? v.slice(0, -suffix.length) : v;
}

/* -------------------------------------------------------------------------- */
/* Draft state                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * An edit over a stored value. Untouched, the fields follow what is stored (a
 * refetch, another tab). Once edited, the edit wins until Save or Reset. After a
 * save, the saved values stand in for the stored ones until the stored value
 * next changes, so the fields never flash back to the old values.
 */
function useDraft<T>(stored: T, same: (a: T, b: T) => boolean) {
  const [edit, setEdit] = useState<T | null>(null);
  const [savedAs, setSavedAs] = useState<T | null>(null);
  const storedKey = JSON.stringify(stored);
  const lastKey = useRef(storedKey);
  useEffect(() => {
    if (lastKey.current === storedKey) return;
    lastKey.current = storedKey;
    setSavedAs(null);
  }, [storedKey]);

  const base = savedAs ?? stored;
  const value = edit ?? base;
  return {
    value,
    base,
    dirty: edit !== null && !same(edit, base),
    set: (next: T) => setEdit(next),
    discard: () => setEdit(null),
    markSaved: (saved: T) => {
      setSavedAs(saved);
      setEdit(null);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export interface EmailSenderSettingsV2Props {
  /** False for a view-only user: every field is read-only and nothing registers a save. */
  canEdit?: boolean;
  /** The page's sticky save bar registry. */
  registerSave?: RegisterSectionSave;
  className?: string;
}

type Touched = Partial<Record<"name" | "local" | "replyTo" | "recipient", boolean>>;

export function EmailSenderSettingsV2({ canEdit = true, registerSave, className }: EmailSenderSettingsV2Props) {
  const { tenant } = useTenant();
  const slug = String(tenant?.slug ?? "").trim().toLowerCase();
  const companyName = tenant?.company_name ?? "";

  const senderQuery = useEmailSenderV2();
  const prefsQuery = useEmailNotificationPrefs();
  const { prefs } = prefsQuery;

  const storageOff = senderQuery.tableMissing === true;
  const senderReady = !!senderQuery.sender || storageOff;
  const senderFailed = !senderReady && !!senderQuery.error;
  const prefsFailed = !prefs && !!prefsQuery.error;

  const storedSender = senderDraftFromSettings(storageOff ? null : senderQuery.sender, slug);
  const storedTeam: TeamDraft = {
    masterEnabled: prefs?.masterEnabled === true,
    recipient: prefs?.recipientEmail ?? "",
  };

  const sender = useDraft<SenderDraft>(storedSender, (a, b) => sameSender(a, b, slug));
  const team = useDraft<TeamDraft>(storedTeam, sameTeam);

  const [touched, setTouched] = useState<Touched>({});
  const [attempted, setAttempted] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  const ids = useId();
  const fieldId = (name: string) => `${ids}-${name}`;

  const senderEditable = senderReady && !storageOff;
  const teamEditable = !!prefs;
  const senderDirty = senderEditable && sender.dirty;
  const teamDirty = teamEditable && team.dirty;
  const dirty = senderDirty || teamDirty;

  const problems = senderFieldProblems(sender.value, slug);
  const recipient = recipientProblem({
    draft: team.value.recipient,
    contactEmail: prefs?.contactEmail,
    masterEnabled: team.value.masterEnabled,
  });

  /** The first reason Save can't go ahead, in field order; only dirty parts count. */
  const blockingProblem = (): string | null => {
    if (senderDirty) {
      const first = problems.name ?? problems.local ?? problems.replyTo;
      if (first) return first;
    }
    if (teamDirty && recipient === "invalid") return "Enter a valid email address for team alerts, like name@company.com.";
    return null;
  };

  const save = async () => {
    const blocked = blockingProblem();
    if (blocked) {
      setAttempted(true);
      throw new Error(blocked);
    }
    setSaveError(null);
    const failures: unknown[] = [];

    if (senderDirty) {
      const next = senderSettingsFromDraft(sender.value, slug);
      try {
        await senderQuery.save(next);
        sender.markSaved(senderDraftFromSettings(next, slug));
      } catch (err) {
        failures.push(err);
      }
    }

    if (teamDirty && prefs) {
      const want = team.value;
      const base = team.base;
      try {
        if (want.masterEnabled !== base.masterEnabled) await prefsQuery.setMasterEnabled.mutateAsync(want.masterEnabled);
        if (want.recipient.trim() !== base.recipient.trim()) await prefsQuery.setRecipientEmail.mutateAsync(want.recipient.trim());
        team.markSaved({ masterEnabled: want.masterEnabled, recipient: want.recipient.trim() });
      } catch (err) {
        failures.push(err);
      }
    }

    if (failures.length > 0) {
      const first = failures[0] ?? new Error("Couldn't save the email settings.");
      setSaveError(first);
      throw first;
    }
    setAttempted(false);
    setTouched({});
  };

  const discard = () => {
    sender.discard();
    team.discard();
    setTouched({});
    setAttempted(false);
    setSaveError(null);
  };

  useRegisterLeaveSave(canEdit ? registerSave : undefined, EMAIL_SENDER_SAVE_KEY, dirty && canEdit, save, discard);

  const editSender = (patch: Partial<SenderDraft>) => {
    setSaveError(null);
    sender.set({ ...sender.value, ...patch });
  };
  const editTeam = (patch: Partial<TeamDraft>) => {
    setSaveError(null);
    team.set({ ...team.value, ...patch });
  };
  const touch = (name: keyof Touched) => setTouched((t) => (t[name] ? t : { ...t, [name]: true }));
  const shown = (name: keyof Touched, problem: string | null) => (problem && (touched[name] || attempted) ? problem : null);

  const retrySender = () => senderQuery.refetch();

  const panel = (children: ReactNode, footer?: ReactNode) => (
    <div data-settings-section="email-sender" className={className}>
      <SettingsPanel
        title={EMAIL_SENDER_TITLE}
        description="Who your emails come from, and where your team's alert emails go."
        footer={footer}
      >
        {children}
      </SettingsPanel>
    </div>
  );

  // Nothing in yet (or the tenant is still resolving and both reads are
  // disabled): never paint default values that look like real settings.
  if ((!senderReady && !senderFailed) || (!prefs && !prefsFailed)) {
    return panel(<SettingsSectionSkeleton variant="form" rows={5} label="Loading email settings" />);
  }

  const preview = senderAddress(senderSettingsFromDraft(sender.value, slug), { company_name: companyName, slug });
  const nameError = shown("name", problems.name);
  const localError = shown("local", problems.local);
  const replyError = shown("replyTo", problems.replyTo);
  const recipientInvalid = recipient === "invalid" && (touched.recipient || attempted);

  const describedBy = (...list: (string | false | null | undefined)[]) => list.filter(Boolean).join(" ") || undefined;

  const senderRows = senderFailed ? (
    <SettingsLoadError thing="the email sender" error={senderQuery.error} onRetry={retrySender} />
  ) : (
    <SettingsReadOnlyFieldset readOnly={storageOff} className="divide-y">
      {storageOff && (
        <p
          data-sender-storage="off"
          className="flex items-start gap-2 px-5 py-3 text-[13px] text-muted-foreground"
        >
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{EMAIL_SENDER_STORAGE_OFF_COPY}</span>
        </p>
      )}
      {senderQuery.error && !storageOff && (
        <div className="px-5 py-3">
          <SettingsLoadError variant="inline" thing="the email sender" error={senderQuery.error} onRetry={retrySender} />
        </div>
      )}

      <SettingsRow
        label="Sender name"
        htmlFor={fieldId("name")}
        description={companyName ? `The name in your customer's inbox. Leave empty to use ${companyName}.` : "The name in your customer's inbox."}
        note={nameError && <FieldError id={fieldId("name-error")}>{nameError}</FieldError>}
      >
        <Input
          id={fieldId("name")}
          value={sender.value.name}
          placeholder={companyName || "Your company name"}
          autoComplete="organization"
          onChange={(e) => editSender({ name: e.target.value })}
          onBlur={() => touch("name")}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={describedBy(nameError && fieldId("name-error"))}
          className="max-w-sm"
        />
      </SettingsRow>

      <SettingsRow
        label="Send from"
        htmlFor={fieldId("local")}
        description={
          slug
            ? `Must start with ${slug}, on its own or followed by a dot or an underscore, for example ${slug} or ${slug}.bookings.`
            : "Must start with your account name, on its own or followed by a dot or an underscore."
        }
        note={localError && <FieldError id={fieldId("local-error")}>{localError}</FieldError>}
      >
        <UnitGroup className="min-w-0 max-w-full">
          <Input
            id={fieldId("local")}
            value={sender.value.local}
            placeholder={slug}
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => editSender({ local: normaliseLocalInput(e.target.value) })}
            onBlur={() => touch("local")}
            aria-invalid={localError ? true : undefined}
            aria-describedby={describedBy(localError && fieldId("local-error"))}
            className="w-48 min-w-0"
          />
          <Unit>@{EMAIL_SENDER_DOMAIN}</Unit>
        </UnitGroup>
      </SettingsRow>

      <SettingsRow
        label="Replies go to"
        htmlFor={fieldId("reply")}
        description="Optional. If empty, replies go nowhere: customers can't reply to a no-reply address."
        note={replyError && <FieldError id={fieldId("reply-error")}>{replyError}</FieldError>}
      >
        <Input
          id={fieldId("reply")}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={sender.value.replyTo}
          placeholder="help@yourcompany.com"
          onChange={(e) => editSender({ replyTo: e.target.value })}
          onBlur={() => touch("replyTo")}
          aria-invalid={replyError ? true : undefined}
          aria-describedby={describedBy(replyError && fieldId("reply-error"))}
          className="max-w-sm"
        />
      </SettingsRow>

      <div data-sender-preview="" className="space-y-0.5 px-5 py-3 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
        <p>
          Customers see: <span className="font-medium text-foreground">{preview.display}</span>
        </p>
        {preview.replyTo && (
          <p>
            Replies go to <span className="font-medium text-foreground">{preview.replyTo}</span>
          </p>
        )}
      </div>
    </SettingsReadOnlyFieldset>
  );

  const recipientHelper = recipientInvalid
    ? { tone: "text-destructive", text: "Enter a valid email address, like name@company.com." }
    : recipient === "no-address"
      ? {
          tone: "text-amber-600 dark:text-amber-400",
          text: "No address to send to. Add one here, or alert emails won't reach anyone.",
        }
      : {
          tone: "text-muted-foreground",
          text: prefs?.contactEmail
            ? `Leave empty to use your contact email, ${prefs.contactEmail}.`
            : "Every alert email to your team goes to this address.",
        };

  const teamRows = prefsFailed ? (
    <SettingsLoadError
      thing="team email settings"
      error={prefsQuery.error}
      onRetry={() => prefsQuery.refetch()}
      retrying={prefsQuery.isFetching}
    />
  ) : (
    <div className="divide-y">
      {prefsQuery.error && (
        <div className="px-5 py-3">
          <SettingsLoadError
            variant="inline"
            thing="team email settings"
            error={prefsQuery.error}
            onRetry={() => prefsQuery.refetch()}
            retrying={prefsQuery.isFetching}
          />
        </div>
      )}
      <SettingsRow
        label="Team alert emails"
        description={
          team.value.masterEnabled
            ? "On. Your team gets alert emails at the address below."
            : "Off. Your team gets no alert emails."
        }
      >
        <Switch
          checked={team.value.masterEnabled}
          onCheckedChange={(checked) => editTeam({ masterEnabled: checked })}
          aria-label="Team alert emails"
        />
      </SettingsRow>
      <SettingsRow
        label="Team alerts go to"
        htmlFor={fieldId("recipient")}
        description={
          <span
            id={fieldId("recipient-help")}
            role={recipientInvalid || recipient === "no-address" ? "alert" : undefined}
            className={cn("[overflow-wrap:anywhere]", recipientHelper.tone)}
          >
            {recipientHelper.text}
          </span>
        }
      >
        <Input
          id={fieldId("recipient")}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={team.value.recipient}
          placeholder={prefs?.contactEmail || "name@company.com"}
          onChange={(e) => editTeam({ recipient: e.target.value })}
          onBlur={() => touch("recipient")}
          aria-invalid={recipientInvalid || undefined}
          aria-describedby={fieldId("recipient-help")}
          className="max-w-sm"
        />
      </SettingsRow>
    </div>
  );

  return panel(
    <SettingsReadOnlyFieldset readOnly={!canEdit} className="divide-y">
      {senderRows}
      {teamRows}
    </SettingsReadOnlyFieldset>,
    saveError ? <SettingsSaveState status="error" error={saveError} /> : undefined,
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-destructive [overflow-wrap:anywhere]">
      {children}
    </p>
  );
}
