"use client";

/**
 * v2 Settings › Customer messages › Email templates: the list and the editor.
 * v2 ONLY: `/settings/email-templates` and `/settings/email-templates/[key]`
 * hand off here behind `useV2('chrome')`; v1 renders exactly as before.
 *
 * Reads go through `useEmailTemplatesStrict` / `useEmailTemplateStrict`, which
 * surface a failed read instead of reporting "no customisations". Viewers (and
 * managers with a view-only Templates grant) can open every template but get
 * no Save, Reset or Reset all.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, FileText, Loader2, Pencil, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
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
import { TipTapEditor } from "@/components/settings/tiptap-editor";
import { SETTINGS_COLUMN_BESIDE_TRAX, SettingsPageHeader } from "@/components/settings-v2/settings-kit";
import { useEmailTemplates } from "@/hooks/use-email-templates";
import { useEmailTemplateStrict, useEmailTemplatesStrict } from "@/hooks/use-template-reads-v2";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import { getDefaultEmailTemplate } from "@/lib/default-email-templates";
import {
  EMAIL_TEMPLATE_TYPES,
  getEmailSampleData,
  getEmailTemplateType,
  replaceEmailVariables,
} from "@/lib/email-template-variables";
import { getSampleData as getAgreementSampleData } from "@/lib/template-variables";
import { cn } from "@/lib/utils";
import {
  SettingsLoadError,
  SettingsNoMatch,
  SettingsReadOnlyNotice,
  SettingsSaveState,
  SettingsSectionSkeleton,
  TruncatedText,
  describeSaveError,
  useSettingsSaveStatus,
} from "./section-states";
import { filterEmailTemplateTypes, isBlankHtml } from "./message-rules";
import { EditorChip, TemplateEditorShellV2 } from "./template-editor-shell-v2";

const LIST_HREF = "/settings/email-templates";

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

export function EmailTemplatesListV2() {
  const { resetTemplateAsync } = useEmailTemplates();
  const strict = useEmailTemplatesStrict();
  const { canEditSettings } = useManagerPermissions();
  const canEdit = canEditSettings("templates");

  const [query, setQuery] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const custom = strict.data;
  const customByKey = useMemo(() => new Map((custom ?? []).map((t) => [t.template_key, t])), [custom]);
  const customizedTypes = EMAIL_TEMPLATE_TYPES.filter((t) => customByKey.has(t.key));
  const filtered = useMemo(() => filterEmailTemplateTypes(EMAIL_TEMPLATE_TYPES, query), [query]);

  const handleResetAll = async () => {
    setResetting(true);
    let done = 0;
    try {
      for (const t of customizedTypes) {
        await resetTemplateAsync(t.key);
        done += 1;
      }
      toast({ title: "Emails reset", description: `${done} email template${done === 1 ? "" : "s"} now use the default wording.` });
      setResetOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't reset every email",
        description: `${done} of ${customizedTypes.length} reset. ${describeSaveError(err)}`,
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  };

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <SettingsPageHeader
        title="Email templates"
        description="The emails customers receive. Any email you haven't customized uses the default wording."
      />
      <div className="flex flex-wrap items-center gap-2">
        {!canEdit && <SettingsReadOnlyNotice />}
        {/* Labelled, not a bare icon: on a phone this wraps under the page
            description, where a lone red arrow read as a stray glyph. */}
        {canEdit && custom && customizedTypes.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setResetOpen(true)}
            disabled={resetting}
            aria-label="Reset all emails to default"
            className="text-destructive hover:text-destructive"
          >
            {resetting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
            Reset all
          </Button>
        )}
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (!custom && !strict.isError) {
    // Shaped like the list it becomes: icon rows, not a table.
    body = <SettingsSectionSkeleton variant="rows" thumbnail rows={6} label="Loading email templates" />;
  } else if (!custom) {
    body = (
      <SettingsLoadError
        thing="your email templates"
        error={strict.error}
        onRetry={() => strict.refetch()}
        retrying={strict.isFetching}
      />
    );
  } else {
    body = (
      <div className="space-y-4">
        {strict.isError && (
          <SettingsLoadError
            variant="inline"
            thing="your email templates"
            error={strict.error}
            onRetry={() => strict.refetch()}
            retrying={strict.isFetching}
          />
        )}
        <p className="text-sm text-muted-foreground">
          {customizedTypes.length === 0
            ? "Every email uses the default wording."
            : `${customizedTypes.length} of ${EMAIL_TEMPLATE_TYPES.length} emails customized.`}{" "}
          Variables like <code className="rounded bg-muted px-1 py-0.5 text-xs">{"{{customer_name}}"}</code> fill in each
          customer&apos;s details.
        </p>
        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search email templates"
            placeholder="Search emails"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setQuery("")}
            >
              <X />
            </Button>
          )}
        </div>

        {filtered.length === 0 ? (
          <SettingsNoMatch query={query} noun="emails" onClear={() => setQuery("")} />
        ) : (
          <ul className="space-y-2" aria-label="Email templates">
            {filtered.map((type) => {
              const saved = customByKey.get(type.key);
              const customized = !!saved;
              const subject = saved?.subject || type.defaultSubject;
              return (
                <li
                  key={type.key}
                  data-template-key={type.key}
                  className="flex flex-col gap-3 rounded-2xl bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-xl",
                        customized ? "bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "bg-muted text-muted-foreground",
                      )}
                      aria-hidden="true"
                    >
                      <FileText className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{type.name}</p>
                        <EditorChip tone={customized ? "primary" : "muted"}>{customized ? "Customized" : "Default"}</EditorChip>
                      </div>
                      <p className="line-clamp-2 text-sm text-muted-foreground">{type.description}</p>
                      <p className="flex min-w-0 gap-1 text-xs text-muted-foreground">
                        <span className="shrink-0">Subject:</span>
                        <TruncatedText text={subject} className="font-medium text-foreground" />
                      </p>
                    </div>
                  </div>
                  <Button asChild variant={customized ? "secondary" : "outline"} size="sm" className="self-start sm:self-center">
                    <Link href={`${LIST_HREF}/${type.key}`}>
                      {canEdit ? <Pencil data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                      {canEdit ? (customized ? "Edit" : "Customize") : "View"}
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <TooltipProvider>
      {/* md:pt-[26px]: the header's first line is the 32px title, so it centres
          at 50 + 26 + 16 = 92, the sidebar switch's row (as on the Settings index).
          SETTINGS_COLUMN_BESIDE_TRAX: the same column the Settings page uses, so
          the open Trax panel never lands over the list. */}
      <div className={cn("w-full max-w-[1160px] space-y-8 pb-16 md:pt-[26px]", SETTINGS_COLUMN_BESIDE_TRAX)}>
        {header}
        {body}
      </div>
      <AlertDialog open={resetOpen} onOpenChange={(open) => !resetting && setResetOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset every customized email?</AlertDialogTitle>
            <AlertDialogDescription>
              {customizedTypes.length} email{customizedTypes.length === 1 ? "" : "s"} go back to the default wording. Your
              changes can&apos;t be recovered.
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
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                      */
/* -------------------------------------------------------------------------- */

export function EmailTemplateEditorV2({ templateKey }: { templateKey: string }) {
  const router = useRouter();
  const { tenant } = useTenant();
  const { saveTemplateAsync, isSaving, resetTemplateAsync, isResetting } = useEmailTemplates();
  const templateType = getEmailTemplateType(templateKey);
  const strict = useEmailTemplateStrict(templateKey, !!templateType);
  const { canEditSettings } = useManagerPermissions();
  const canEdit = canEditSettings("templates");
  const fallbackDefault = getDefaultEmailTemplate(templateKey);

  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState<{ subject: string; content: string } | null>(null);
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  const custom = strict.data?.customTemplate ?? null;
  const defaults = {
    subject: fallbackDefault?.subject ?? templateType?.defaultSubject ?? "",
    content: fallbackDefault?.content ?? "",
  };

  // Seed once, from a SUCCESSFUL read. A failed read never seeds the defaults.
  useEffect(() => {
    if (original || !strict.data) return;
    const seed = custom ? { subject: custom.subject, content: custom.template_content } : defaults;
    setSubject(seed.subject);
    setContent(seed.content);
    setOriginal(seed);
  }, [strict.data, original]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasChanges = !!original && (subject !== original.subject || content !== original.content);
  const subjectBlank = !!original && !subject.trim();
  const contentBlank = !!original && isBlankHtml(content);

  const saveContent = async (): Promise<boolean> => {
    if (!canEdit) return false;
    if (!subject.trim()) {
      setSubjectTouched(true);
      return false;
    }
    if (isBlankHtml(content)) return false;
    setSaveError(null);
    try {
      await saveTemplateAsync({
        template_key: templateKey,
        template_name: templateType?.name || templateKey,
        subject,
        template_content: content,
      });
      setOriginal({ subject, content });
      return true;
    } catch (err) {
      setSaveError(err);
      return false;
    }
  };

  const { isDialogOpen, confirmLeave, saveAndLeave, cancelLeave, isSaving: isSavingNav } = useUnsavedChangesWarning({
    hasChanges: hasChanges && canEdit,
    onSave: saveContent,
  });

  const saveStatus = useSettingsSaveStatus({ isDirty: hasChanges, isPending: isSaving, error: saveError });

  const handleReset = async () => {
    try {
      await resetTemplateAsync(templateKey);
      setSubject(defaults.subject);
      setContent(defaults.content);
      // The reset IS the saved state now, so it must not read as unsaved.
      setOriginal(defaults);
      setSaveError(null);
      setResetOpen(false);
    } catch {
      // The hook toasts the reason; the dialog stays open to retry.
    }
  };

  const sampleData = {
    ...getAgreementSampleData(),
    ...getEmailSampleData(),
    company_name: (tenant as { company_name?: string } | null)?.company_name || "Your Company Name",
    company_email: (tenant as { contact_email?: string } | null)?.contact_email || "contact@yourcompany.com",
    company_phone: (tenant as { phone?: string } | null)?.phone || "+1 800 000 0000",
  };
  const previewSubject = replaceEmailVariables(subject, sampleData);
  const previewContent = replaceEmailVariables(content, sampleData);

  const state = !templateType
    ? ({
        kind: "not-found",
        headline: "This email template doesn't exist",
        body: "The link may be out of date, or the email was renamed. Pick one from the list.",
      } as const)
    : !original && strict.isError
      ? ({
          kind: "error",
          thing: "this email template",
          error: strict.error,
          onRetry: () => strict.refetch(),
          retrying: strict.isFetching,
        } as const)
      : !original
        ? ({ kind: "loading" } as const)
        : ({ kind: "ready" } as const);

  return (
    <TemplateEditorShellV2
      title={templateType?.name ?? "Email template"}
      badges={
        state.kind === "ready" ? (
          <>
            {custom && <EditorChip tone="primary">Customized</EditorChip>}
            {hasChanges && canEdit && <EditorChip tone="amber">Unsaved changes</EditorChip>}
          </>
        ) : undefined
      }
      description={templateType?.description}
      backLabel="Back to email templates"
      onBack={() => router.push(LIST_HREF)}
      state={state}
      readOnly={!canEdit}
      actions={
        canEdit && custom
          ? [{ label: "Reset to default", icon: RotateCcw, onClick: () => setResetOpen(true), busy: isResetting, tone: "destructive" }]
          : []
      }
      onSave={() => void saveContent()}
      saveDisabled={!hasChanges || subjectBlank || contentBlank}
      saving={isSaving}
      previewKind="email"
      aboveEditor={
        <>
          {strict.isError && (
            <SettingsLoadError
              variant="inline"
              thing="this email template"
              error={strict.error}
              onRetry={() => strict.refetch()}
              retrying={strict.isFetching}
            />
          )}
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
            <label htmlFor="v2-email-subject" className="shrink-0 pt-2 text-sm font-medium text-foreground">
              Subject line
            </label>
            <div className="min-w-0 max-w-2xl flex-1">
              <Input
                id="v2-email-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onBlur={() => setSubjectTouched(true)}
                readOnly={!canEdit}
                placeholder="e.g. Booking confirmed - {{rental_number}}"
                aria-invalid={(subjectBlank && subjectTouched) || undefined}
                aria-describedby={subjectBlank ? "v2-email-subject-error" : undefined}
              />
              {subjectBlank && (subjectTouched || hasChanges) && (
                <p id="v2-email-subject-error" className="mt-1 text-xs text-destructive">
                  Add a subject line. The email can&apos;t be sent without one.
                </p>
              )}
            </div>
            {canEdit && <SettingsSaveState status={saveStatus} error={saveError} onRetry={() => void saveContent()} className="sm:pt-2" />}
          </div>
          {contentBlank && canEdit && (
            <p className="text-xs text-destructive" role="alert">
              The email body is empty. Add some content before saving.
            </p>
          )}
        </>
      }
      editor={
        state.kind === "ready" ? (
          <TipTapEditor content={content} onChange={setContent} placeholder="Start typing your email template..." />
        ) : null
      }
      preview={
        <>
          <div className="mb-4 space-y-0.5">
            <p className="text-xs text-muted-foreground">Subject</p>
            <p className="font-medium text-foreground">
              {previewSubject.trim() ? previewSubject : <span className="italic text-muted-foreground">No subject</span>}
            </p>
          </div>
          {isBlankHtml(content) ? (
            <p className="italic text-muted-foreground">
              {canEdit ? "Start typing to see a preview." : "This email has no content."}
            </p>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: previewContent }} />
          )}
        </>
      }
    >
      <AlertDialog open={resetOpen} onOpenChange={(open) => !isResetting && setResetOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this email to the default?</AlertDialogTitle>
            <AlertDialogDescription>
              Your subject line and wording are replaced with the default. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleReset();
              }}
              disabled={isResetting}
            >
              {isResetting ? "Resetting…" : "Reset to default"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UnsavedChangesDialog
        open={isDialogOpen}
        onCancel={cancelLeave}
        onDiscard={confirmLeave}
        onSave={saveAndLeave}
        isSaving={isSavingNav}
      />
    </TemplateEditorShellV2>
  );
}
