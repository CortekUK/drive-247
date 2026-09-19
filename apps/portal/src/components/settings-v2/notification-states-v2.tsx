"use client";

/**
 * v2 Settings › Notifications: the email alerts card and the reminder timing
 * rules, rebuilt on the state kit. v2 ONLY: the v1 components
 * (`settings/email-notification-settings.tsx`, `settings/reminder-rules-config.tsx`)
 * render these behind `useV2('chrome')` and are otherwise unchanged.
 *
 * What v1 got wrong, and this fixes:
 *  - a failed preferences read painted every switch OFF, telling the operator
 *    alerts were disabled when the real state was unknown;
 *  - the recipient saved any string ("abc") and toasted success;
 *  - with no recipient and no contact email, alerts went nowhere silently;
 *  - one pending toggle froze every row, with no sign of which one was saving;
 *  - after "Reset all" the day inputs kept their old numbers (seeded once);
 *  - -5 / 9999 / blank days showed Save and then did nothing or saved 9999;
 *  - an empty rule set was a bare sentence, and a failed read had no retry.
 */

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Car, DollarSign, FileText, KeyRound, Loader2, RotateCcw, Settings2, Shield } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Switch } from "@/components/ui-v2/switch";
import { Badge } from "@/components/ui-v2/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-v2/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui-v2/tooltip";
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
import { toast } from "@/hooks/use-toast";
import {
  useEmailNotificationPrefs,
  EMAIL_NOTIFICATION_CATEGORIES,
  type EmailNotificationCategory,
} from "@/hooks/use-email-notification-prefs";
import { useReminderRulesByCategory, useReminderRuleActions, type ReminderRule } from "@/hooks/use-reminder-rules";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { cn } from "@/lib/utils";
import {
  SettingsEmptyState,
  SettingsLoadError,
  SettingsReadOnlyFieldset,
  SettingsSectionSkeleton,
  describeSaveError,
} from "./section-states";
import { isValidEmail, parseLeadDays, recipientProblem, ruleSummary, severityLabel } from "./message-rules";
import { SETTINGS_SECTION_TITLE } from "./settings-kit";

/* -------------------------------------------------------------------------- */
/* Email notifications                                                         */
/* -------------------------------------------------------------------------- */

const CATEGORY_META: Record<EmailNotificationCategory, { label: string; description: string }> = {
  bookings: { label: "Bookings", description: "New bookings, approvals, cancellations and pending requests" },
  payments: { label: "Payments", description: "Failed payments and payment issues" },
  insurance: { label: "Insurance", description: "Insurance policy and coverage updates" },
  returns: { label: "Returns & late", description: "Return-due reminders, late returns and completions" },
  verification: { label: "Verification", description: "Identity and document verification results" },
  fines: { label: "Fines", description: "Fines and penalty charges recorded" },
};

type EmailSaveTarget = "master" | "recipient" | EmailNotificationCategory;

/** The reason under a control whose save failed. The toast says it too, but a
 *  toast is gone in five seconds and does not point at the row. A switch goes
 *  back to its stored state, so the kit's "your changes are still here" is not
 *  true for one; that sentence is dropped. */
function InlineSaveError({ error, lead, after }: { error: unknown; lead: string; after?: string }) {
  const reason = describeSaveError(error)
    .replace(/\s*Your changes are still here\.?/i, "")
    .replace(/\s*Try again\.?$/i, "")
    .trim();
  return (
    <p role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">
      {lead}
      {reason ? ` ${reason}` : ""}
      {after ? ` ${after}` : ""}
    </p>
  );
}

function SectionHeading({ title, description, aside }: { title: string; description: string; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 className={SETTINGS_SECTION_TITLE}>{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {aside && <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}

/**
 * `parts="categories"` (the Notifications page's "What's sent today"): only the
 * six category switches, under their own heading. The master switch and the
 * recipient are edited in that page's Email card (EmailSenderSettingsV2), so
 * they are not repeated here. The default (`"all"`) is unchanged.
 */
export const EMAIL_CATEGORIES_ONLY_COPY = {
  title: "Team alert emails by category",
  description: "Which kinds of alerts your team also gets by email. Each switch saves as soon as you flip it.",
  masterOff: "Team alert emails are off, under Email above. Turn them on to choose categories.",
} as const;

export function EmailNotificationSettingsV2({
  canEdit = true,
  parts = "all",
}: {
  canEdit?: boolean;
  parts?: "all" | "categories";
}) {
  const categoriesOnly = parts === "categories";
  const {
    prefs,
    error,
    refetch,
    isFetching,
    setMasterEnabled,
    setRecipientEmail,
    setCategoryEnabled,
  } = useEmailNotificationPrefs();

  const [recipientDraft, setRecipientDraft] = useState("");
  const [recipientTouched, setRecipientTouched] = useState(false);
  const [saveError, setSaveError] = useState<{ target: EmailSaveTarget; error: unknown } | null>(null);

  useEffect(() => {
    if (prefs) {
      setRecipientDraft(prefs.recipientEmail ?? "");
      setRecipientTouched(false);
    }
  }, [prefs?.recipientEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  // No read-only chip here: the settings page that mounts this section already
  // shows one above it, and a second identical chip a few pixels lower is noise.
  const heading = categoriesOnly ? (
    <SectionHeading title={EMAIL_CATEGORIES_ONLY_COPY.title} description={EMAIL_CATEGORIES_ONLY_COPY.description} />
  ) : (
    <SectionHeading
      title="Email notifications"
      description="Choose which alerts your team also gets by email, and where they go. The in-app bell stays on for every category."
    />
  );

  // Before the tenant resolves the query is disabled, so "no prefs and no
  // error" is still loading, never "all switches off".
  if (!prefs && !error) {
    return (
      <section className="space-y-4" data-settings-section="email-notifications">
        {heading}
        {/* Eight rows, like the loaded section: the master switch, the
            recipient and the six categories (six for the categories alone). */}
        <SettingsSectionSkeleton variant="rows" rows={categoriesOnly ? 6 : 8} label="Loading email preferences" />
      </section>
    );
  }

  if (!prefs) {
    return (
      <section className="space-y-4" data-settings-section="email-notifications">
        {heading}
        <SettingsLoadError thing="email preferences" error={error} onRetry={() => refetch()} retrying={isFetching} />
      </section>
    );
  }

  const masterEnabled = prefs.masterEnabled;
  const contactEmail = prefs.contactEmail ?? "";
  const problem = recipientProblem({ draft: recipientDraft, contactEmail, masterEnabled });
  const showInvalid = problem === "invalid" && recipientTouched;
  const pendingCategory = setCategoryEnabled.isPending ? setCategoryEnabled.variables?.category : undefined;

  const failToast = (err: unknown) =>
    toast({ title: "Couldn't save", description: describeSaveError(err), variant: "destructive" });
  const failFor = (target: EmailSaveTarget) => (err: unknown) => {
    setSaveError({ target, error: err });
    failToast(err);
  };
  const clearFor = (target: EmailSaveTarget) => setSaveError((current) => (current?.target === target ? null : current));
  const errorFor = (target: EmailSaveTarget) => (saveError?.target === target ? saveError.error : undefined);

  const handleRecipientBlur = () => {
    setRecipientTouched(true);
    const trimmed = recipientDraft.trim();
    if (trimmed === (prefs.recipientEmail ?? "").trim()) return;
    // The helper under the field says what is wrong; nothing is written.
    if (trimmed && !isValidEmail(trimmed)) return;
    clearFor("recipient");
    setRecipientEmail.mutate(trimmed, {
      onSuccess: () =>
        toast({
          title: "Recipient updated",
          description: trimmed
            ? `Alert emails will go to ${trimmed}.`
            : contactEmail
              ? `Alert emails will go to your contact email, ${contactEmail}.`
              : "Recipient cleared.",
        }),
      // The typed address stays in the field (the form stays dirty), with the
      // reason under it; leaving the field again retries.
      onError: failFor("recipient"),
    });
  };

  const helper = showInvalid
    ? { tone: "text-destructive", text: "Enter a valid email address, like name@company.com. Nothing was saved." }
    : problem === "no-address"
      ? {
          tone: "text-amber-600 dark:text-amber-400",
          text: "No address to send to. Add one here, or alert emails won't reach anyone.",
        }
      : {
          tone: "text-muted-foreground",
          text: contactEmail ? `Leave empty to use your contact email, ${contactEmail}.` : "Every alert email goes to this address.",
        };

  return (
    <section className="space-y-4" data-settings-section="email-notifications">
      {heading}
      {error && (
        <SettingsLoadError variant="inline" thing="email preferences" error={error} onRetry={() => refetch()} retrying={isFetching} />
      )}

      <SettingsReadOnlyFieldset readOnly={!canEdit} className="space-y-3">
        {!categoriesOnly && (
          <>
            <div className="flex flex-col gap-3 rounded-2xl bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-foreground">Send alerts by email</p>
                <p className="text-sm text-muted-foreground">
                  {masterEnabled ? "On. Pick the categories below." : "Off. No alert emails are sent until you turn this on."}
                </p>
                {saveError?.target === "master" && (
                  <InlineSaveError lead="Couldn't save, so this is unchanged." error={errorFor("master")} />
                )}
              </div>
              <div className="flex items-center gap-2">
                {setMasterEnabled.isPending && (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />
                )}
                <Switch
                  checked={masterEnabled}
                  onCheckedChange={(checked) => {
                    clearFor("master");
                    setMasterEnabled.mutate(checked, { onError: failFor("master") });
                  }}
                  disabled={setMasterEnabled.isPending}
                  aria-label="Send alerts by email"
                />
              </div>
            </div>

            <div className="space-y-2 rounded-2xl bg-muted/40 p-4">
              <label htmlFor="v2-notification-recipient" className="text-sm font-medium text-foreground">
                Send alerts to
              </label>
              <div className="relative max-w-md">
                <Input
                  id="v2-notification-recipient"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={recipientDraft}
                  placeholder={contactEmail || "name@company.com"}
                  onChange={(e) => setRecipientDraft(e.target.value)}
                  onBlur={handleRecipientBlur}
                  disabled={setRecipientEmail.isPending}
                  aria-invalid={showInvalid || undefined}
                  aria-describedby="v2-notification-recipient-help"
                  className={cn(setRecipientEmail.isPending && "pr-9")}
                />
                {setRecipientEmail.isPending && (
                  <Loader2
                    className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                    aria-label="Saving"
                  />
                )}
              </div>
              <p
                id="v2-notification-recipient-help"
                role={problem ? "alert" : undefined}
                className={cn("text-xs [overflow-wrap:anywhere]", helper.tone)}
              >
                {helper.text}
              </p>
              {saveError?.target === "recipient" && (
                <InlineSaveError
                  lead="Couldn't save this address."
                  after="It's still in the field; move out of the field to try again."
                  error={errorFor("recipient")}
                />
              )}
            </div>
          </>
        )}

        <div className="space-y-2">
          {!masterEnabled && (
            <p className="px-1 text-sm text-muted-foreground">
              {categoriesOnly ? EMAIL_CATEGORIES_ONLY_COPY.masterOff : "Turn on email alerts above to choose categories."}
            </p>
          )}
          {EMAIL_NOTIFICATION_CATEGORIES.map((category) => {
            const meta = CATEGORY_META[category];
            const pending = pendingCategory === category;
            return (
              <div
                key={category}
                data-category={category}
                className={cn(
                  "flex flex-col gap-3 rounded-2xl bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between",
                  !masterEnabled && "opacity-60",
                )}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{meta.label}</p>
                    <Badge variant="secondary" className="whitespace-nowrap text-xs font-normal">
                      In-app: always on
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{meta.description}</p>
                  {saveError?.target === category && (
                    <InlineSaveError lead="Couldn't save, so this is unchanged." error={errorFor(category)} />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />}
                  <Switch
                    checked={prefs.categories[category] ?? false}
                    onCheckedChange={(checked) => {
                      clearFor(category);
                      setCategoryEnabled.mutate({ category, enabled: checked }, { onError: failFor(category) });
                    }}
                    disabled={!masterEnabled || pending}
                    aria-label={`${meta.label} emails`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SettingsReadOnlyFieldset>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Reminder timing rules                                                       */
/* -------------------------------------------------------------------------- */

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Vehicle: Car,
  Insurance: Shield,
  Financial: DollarSign,
  Document: FileText,
  Immobiliser: KeyRound,
};

const SEVERITY_TONE: Record<string, string> = {
  info: "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  critical: "bg-destructive/10 text-destructive",
};

/** Past this many rules a group scrolls inside its box. */
const LONG_RULE_GROUP = 12;

type RuleUpdate = { id: string; lead_days?: number; severity?: "info" | "warning" | "critical"; is_enabled?: boolean };

function intervalWord(rule: ReminderRule): string {
  if (!rule.is_recurring) return "days before due";
  if (rule.interval_type === "weekly") return "days (weekly)";
  if (rule.interval_type === "bi-weekly") return "days (bi-weekly)";
  if (rule.interval_type === "monthly") return "days (monthly)";
  return "days (recurring)";
}

export function ReminderRuleCardV2({
  rule,
  onUpdate,
  saving,
  readOnly,
}: {
  rule: ReminderRule;
  onUpdate: (update: RuleUpdate) => void;
  saving: boolean;
  readOnly: boolean;
}) {
  const [leadDays, setLeadDays] = useState(String(rule.lead_days));

  // Follow the stored value (after "Reset all", a save, or a refetch) unless
  // the operator has typed something different from what was stored.
  const storedRef = useRef(rule.lead_days);
  useEffect(() => {
    const previous = storedRef.current;
    storedRef.current = rule.lead_days;
    setLeadDays((current) => (current.trim() === String(previous) ? String(rule.lead_days) : current));
  }, [rule.lead_days]);

  const check = parseLeadDays(leadDays);
  const dirty = leadDays.trim() !== String(rule.lead_days);
  const locked = readOnly || saving;
  const errorId = `v2-rule-days-error-${rule.id}`;

  const save = () => {
    if (check.ok && check.value !== rule.lead_days) onUpdate({ id: rule.id, lead_days: check.value });
  };

  return (
    <div className="space-y-3 rounded-2xl bg-muted/40 p-4" data-rule-id={rule.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{rule.rule_type}</p>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", SEVERITY_TONE[rule.severity] ?? SEVERITY_TONE.info)}>
              {severityLabel(rule.severity)}
            </span>
            {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
          </div>
          {rule.description && (
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{rule.description}</p>
          )}
        </div>
        <Switch
          checked={rule.is_enabled}
          onCheckedChange={(enabled) => onUpdate({ id: rule.id, is_enabled: enabled })}
          disabled={locked}
          aria-label={`${rule.rule_type} reminder`}
        />
      </div>

      {rule.is_enabled ? (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`v2-rule-days-${rule.id}`} className="text-xs text-muted-foreground">
              {rule.is_recurring ? "Every" : "Remind"}
            </label>
            <Input
              id={`v2-rule-days-${rule.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              step={1}
              value={leadDays}
              onChange={(e) => setLeadDays(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
              disabled={locked}
              aria-invalid={!check.ok || undefined}
              aria-describedby={!check.ok ? errorId : undefined}
              className={cn("h-8 w-20 text-xs", !check.ok && "border-destructive ring-3 ring-destructive/20")}
            />
            <span className="text-xs text-muted-foreground">{intervalWord(rule)}</span>
          </div>
          {!check.ok && (
            <p id={errorId} className="text-xs text-destructive">
              {"message" in check ? check.message : null}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Severity</span>
            <Select
              value={rule.severity}
              onValueChange={(severity) => onUpdate({ id: rule.id, severity: severity as RuleUpdate["severity"] })}
              disabled={locked}
            >
              <SelectTrigger className="h-8 w-28 text-xs" aria-label={`${rule.rule_type} severity`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {dirty && !readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="xs" onClick={save} disabled={!check.ok || saving}>
                Save
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setLeadDays(String(rule.lead_days))} disabled={saving}>
                Undo
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{ruleSummary(rule)}</p>
      )}
    </div>
  );
}

function groupTitle(ruleType: string) {
  if (ruleType === "Expiry") return "Policy expiry reminders";
  if (ruleType === "Verification") return "Insurance verification reminders";
  return `${ruleType} reminders`;
}

function groupDescription(ruleType: string) {
  if (ruleType === "Expiry") return "Sent before insurance policies expire.";
  if (ruleType === "Verification") return "Recurring checks that insurance is still active during rentals.";
  if (ruleType === "Immobiliser") return "Reminders to fit immobilisers on vehicles that don't have them.";
  return `When ${ruleType.toLowerCase()} reminders are created.`;
}

export function ReminderRulesConfigV2() {
  const { data: groupedRules, error, refetch, isFetching } = useReminderRulesByCategory();
  const { updateRule, resetToDefaults } = useReminderRuleActions();
  const { canEditSettings } = useManagerPermissions();
  const canEdit = canEditSettings("reminders");
  const [picked, setPicked] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const categories = groupedRules ? Object.keys(groupedRules) : [];
  const active = picked && categories.includes(picked) ? picked : categories[0] ?? null;
  const savingId = updateRule.isPending ? updateRule.variables?.id : undefined;

  const resetButton =
    canEdit && categories.length > 0 ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setResetOpen(true)}
            disabled={resetToDefaults.isPending}
            aria-label="Reset all rules to defaults"
          >
            {resetToDefaults.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reset all rules to defaults</TooltipContent>
      </Tooltip>
    ) : null;

  // The page above already shows the read-only chip; viewers simply get no Reset.
  const heading = (
    <SectionHeading
      title="Reminder timing"
      description="When reminders are created for each kind of event."
      aside={resetButton}
    />
  );

  let body: React.ReactNode;
  if (!groupedRules && !error) {
    body = <SettingsSectionSkeleton variant="cards" rows={3} label="Loading reminder rules" />;
  } else if (!groupedRules) {
    body = <SettingsLoadError thing="reminder rules" error={error} onRetry={() => refetch()} retrying={isFetching} />;
  } else if (categories.length === 0) {
    // "Reset all" only UPDATES existing rows, so offering it here would toast
    // success and change nothing. Say what is actually true instead.
    body = (
      <SettingsEmptyState
        icon={Settings2}
        headline="No reminder timing rules yet"
        body="Accounts start with a default set of timing rules, and none were found for yours, so no timed reminders are being created."
        secondaryAction={{ label: "Contact support", href: "mailto:support@drive-247.com" }}
        footnote="Support can restore the default rules for you."
      />
    );
  } else {
    const groups = active ? Object.entries(groupedRules[active]) : [];
    body = (
      <div className="space-y-4">
        {error && (
          <SettingsLoadError variant="inline" thing="reminder rules" error={error} onRetry={() => refetch()} retrying={isFetching} />
        )}
        <div role="tablist" aria-label="Reminder categories" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {categories.map((category) => {
            const Icon = CATEGORY_ICONS[category] ?? Settings2;
            const selected = category === active;
            return (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setPicked(category)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
                  selected ? "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-muted-foreground hover:bg-primary/10 hover:text-foreground dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {category}
              </button>
            );
          })}
        </div>

        {groups.map(([ruleType, rules]) => (
          <div key={ruleType} className="space-y-3">
            <div className="space-y-0.5">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                {groupTitle(ruleType)}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                  {rules.filter((r) => r.is_enabled).length} of {rules.length} on
                </span>
              </p>
              <p className="text-xs text-muted-foreground">{groupDescription(ruleType)}</p>
            </div>
            {/* A long group scrolls inside its own box instead of stretching the
                page (150 rules ran to 38,000px on a phone). */}
            <div
              className={cn(
                "grid gap-3 md:grid-cols-2 lg:grid-cols-3",
                rules.length > LONG_RULE_GROUP && "max-h-[70vh] overflow-y-auto overscroll-contain rounded-2xl pr-1",
              )}
              {...(rules.length > LONG_RULE_GROUP
                ? { role: "region", tabIndex: 0, "aria-label": `${groupTitle(ruleType)}, ${rules.length} rules` }
                : {})}
            >
              {rules.map((rule) => (
                <ReminderRuleCardV2
                  key={rule.id}
                  rule={rule}
                  onUpdate={(update) => updateRule.mutate(update)}
                  saving={savingId === rule.id}
                  readOnly={!canEdit}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
          <p className="mb-1.5 font-medium text-foreground">How timing rules work</p>
          <ul className="space-y-1">
            <li>Days: how long before the due date the reminder is created.</li>
            <li>Severity: how urgent it looks, and where it sorts in the list.</li>
            <li>Changes apply to reminders created from now on.</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <section className="space-y-4" data-settings-section="reminder-rules">
        {heading}
        {body}
      </section>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all timing rules?</AlertDialogTitle>
            <AlertDialogDescription>
              Every rule goes back to its default days, severity and on/off state. Your custom timings are lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => resetToDefaults.mutate()}>Reset all rules</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
