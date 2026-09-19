"use client";

/**
 * v2 Settings › Customer messages › Rental agreement: the chooser and the
 * editor. v2 ONLY: `/settings/agreement-templates` and `/edit` hand off here
 * behind `useV2('chrome')`; v1 renders exactly as before.
 *
 * States v1 lacked: a failed read or a failed first-time setup shows a retry
 * (v1 logged it and showed a "Not configured" card); `?category=` is checked
 * (v1 showed an empty body for `payg` while Pay As You Go was off, or `foo`);
 * `?type=` is checked (v1 saved an unknown type as custom); viewers can read
 * but not switch, reset, clear or save the contract customers sign; and the
 * editor never seeds default wording from a read that failed.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarPlus, Check, ChevronDown, Clock, CreditCard, Eye, FilePlus, FileText, Loader2, Lock, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui-v2/radio-group";
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
import { SettingsPageHeader } from "@/components/settings-v2/settings-kit";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLogOnOpen } from "@/hooks/use-audit-log-on-open";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import {
  CUSTOM_TEMPLATE_NAME,
  DEFAULT_TEMPLATE_NAME,
  useTemplateSelection,
  type TemplateCategory,
  type TemplateType,
} from "@/hooks/use-agreement-templates";
import { getDefaultTemplateForCategory } from "@/lib/default-agreement-template";
import { getSampleData, replaceVariables } from "@/lib/template-variables";
import { injectAgreementClauses } from "@/lib/agreement-injection";
import { BONZAH_INSURANCE_ADDENDUM_HTML } from "@/lib/bonzah-addendum";
import { cn } from "@/lib/utils";
import {
  SettingsDependencyNotice,
  SettingsEmptyState,
  SettingsLoadError,
  SettingsReadOnlyNotice,
  SettingsSaveState,
  SettingsSectionSkeleton,
  useSettingsSaveStatus,
} from "./section-states";
import {
  AGREEMENT_CATEGORY_LABEL,
  agreementPreviewSnippet,
  isBlankHtml,
  resolveAgreementCategory,
  resolveAgreementEditorParams,
} from "./message-rules";
import { EditorChip, IconActionButton, TemplateEditorShellV2 } from "./template-editor-shell-v2";

function listHref(category: TemplateCategory) {
  return `/settings/agreement-templates${category !== "standard" ? `?category=${category}` : ""}`;
}

function editHref(type: TemplateType, category: TemplateCategory) {
  return `/settings/agreement-templates/edit?type=${type}&category=${category}`;
}

function formatUpdated(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* -------------------------------------------------------------------------- */
/* Chooser                                                                     */
/* -------------------------------------------------------------------------- */

const CATEGORY_ICON: Record<TemplateCategory, LucideIcon> = {
  standard: FileText,
  extension: CalendarPlus,
  payg: Clock,
  installment: CreditCard,
};

function Snippet({ html, updatedAt }: { html: string | null | undefined; updatedAt?: string | null }) {
  const text = agreementPreviewSnippet(html);
  const updated = formatUpdated(updatedAt);
  return (
    <div className="space-y-1.5">
      {/* Padding on a wrapper, not on the clamped <p>: line-clamp hides lines
          past the second only inside the content box, so a third line used to
          show through the bottom padding. */}
      <div className="rounded-xl bg-muted/40 p-3">
        <p className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {text ?? <span className="italic">No text content</span>}
        </p>
      </div>
      {updated && <p className="text-xs text-muted-foreground">Last updated {updated}</p>}
    </div>
  );
}

function AgreementCategorySectionV2({ category, canEdit }: { category: TemplateCategory; canEdit: boolean }) {
  const { tenant } = useTenant();
  const {
    defaultTemplate,
    customTemplate,
    activeType,
    isLoading,
    error,
    refetch,
    initializeDefault,
    initializeCustom,
    setActiveByType,
    isSettingActive,
    resetDefault,
    isResetting,
    clearCustom,
    isClearing,
  } = useTemplateSelection(category);

  const [initPhase, setInitPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [initError, setInitError] = useState<unknown>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const initStarted = useRef(false);

  useAuditLogOnOpen({
    open: clearOpen,
    action: "agreement_template_clear_warning_shown",
    entityType: "settings",
    entityId: tenant?.id,
  });

  const readOk = !!tenant && !isLoading && !error;

  // First-time setup creates the two rows. Only after a SUCCESSFUL read (a
  // failed read looks like "no rows" and would create duplicates), only for
  // someone allowed to write, and only once per mount.
  useEffect(() => {
    if (!readOk || !canEdit || initStarted.current) return;
    if (defaultTemplate && customTemplate) return;
    initStarted.current = true;
    setInitPhase("running");
    void (async () => {
      try {
        if (!defaultTemplate) await initializeDefault();
        if (!customTemplate) await initializeCustom();
        setInitPhase("done");
      } catch (err) {
        setInitError(err);
        setInitPhase("failed");
      }
    })();
  }, [readOk, canEdit, defaultTemplate, customTemplate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tenant || isLoading || initPhase === "running") {
    return (
      <SettingsSectionSkeleton
        variant="stack"
        rows={2}
        label={initPhase === "running" ? "Setting up agreements" : "Loading agreements"}
      />
    );
  }

  if (error) {
    return <SettingsLoadError thing="agreement templates" error={error} onRetry={() => refetch()} />;
  }

  if (initPhase === "failed") {
    return (
      <SettingsLoadError
        thing="agreement templates"
        error={initError}
        reason="We couldn't set up the agreements for this rental type. Nothing was changed."
        onRetry={() => {
          initStarted.current = false;
          setInitError(null);
          setInitPhase("idle");
          void refetch();
        }}
      />
    );
  }

  const customEmpty = !customTemplate?.template_content || isBlankHtml(customTemplate.template_content);
  const current: TemplateType = activeType === "custom" && !customEmpty ? "custom" : "default";

  const optionClass = (selected: boolean) =>
    cn("space-y-3 rounded-2xl bg-card p-4 sm:p-5", selected && "ring-2 ring-primary");

  return (
    <div className="space-y-4">
      <RadioGroup
        value={current}
        onValueChange={(value) => {
          if (value === "custom" && customEmpty) return;
          setActiveByType(value as TemplateType);
        }}
        disabled={!canEdit || isSettingActive}
        className="space-y-3"
        aria-label="Agreement customers sign"
      >
        <div className={optionClass(current === "default")} data-option="default">
          <div className="flex flex-wrap items-start gap-3">
            <RadioGroupItem value="default" id={`v2-${category}-default`} className="mt-0.5" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`v2-${category}-default`} className="text-sm font-medium text-foreground">
                  {DEFAULT_TEMPLATE_NAME}
                </label>
                {current === "default" && (
                  <EditorChip tone="primary">
                    <Check className="size-3" aria-hidden="true" />
                    Active
                  </EditorChip>
                )}
              </div>
              <p className="text-sm text-muted-foreground">Standard terms covering liability, insurance and vehicle use.</p>
            </div>
            <div className="flex w-full items-center gap-1 sm:w-auto">
              {canEdit && (
                <IconActionButton
                  action={{ label: "Reset to original wording", icon: RotateCcw, onClick: () => setResetOpen(true), busy: isResetting }}
                />
              )}
              <Button asChild variant="outline" size="sm">
                <Link href={editHref("default", category)}>
                  {canEdit ? <Pencil data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                  {canEdit ? "Edit" : "View"}
                </Link>
              </Button>
            </div>
          </div>
          <Snippet
            html={defaultTemplate?.template_content || getDefaultTemplateForCategory(category)}
            updatedAt={defaultTemplate?.updated_at}
          />
        </div>

        <div className={optionClass(current === "custom")} data-option="custom">
          <div className="flex flex-wrap items-start gap-3">
            <RadioGroupItem value="custom" id={`v2-${category}-custom`} className="mt-0.5" disabled={customEmpty} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`v2-${category}-custom`} className="text-sm font-medium text-foreground">
                  {CUSTOM_TEMPLATE_NAME}
                </label>
                {current === "custom" && (
                  <EditorChip tone="primary">
                    <Check className="size-3" aria-hidden="true" />
                    Active
                  </EditorChip>
                )}
                {customEmpty && <EditorChip>Not set up</EditorChip>}
              </div>
              <p className="text-sm text-muted-foreground">Your own terms and branding.</p>
            </div>
            {!customEmpty && (
              <div className="flex w-full items-center gap-1 sm:w-auto">
                {canEdit && (
                  <IconActionButton
                    action={{
                      label: "Clear custom agreement",
                      icon: Trash2,
                      onClick: () => setClearOpen(true),
                      busy: isClearing,
                      tone: "destructive",
                    }}
                  />
                )}
                <Button asChild variant="outline" size="sm">
                  <Link href={editHref("custom", category)}>
                    {canEdit ? <Pencil data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                    {canEdit ? "Edit" : "View"}
                  </Link>
                </Button>
              </div>
            )}
          </div>
          {customEmpty ? (
            <SettingsEmptyState
              variant="compact"
              icon={FilePlus}
              headline="No custom agreement yet"
              body={
                canEdit
                  ? "Write your own terms. Until you do, customers sign the default agreement."
                  : "Customers sign the default agreement. An admin can create a custom one."
              }
              primaryAction={canEdit ? { label: "Create", href: editHref("custom", category), icon: Plus } : undefined}
            />
          ) : (
            <Snippet html={customTemplate?.template_content} updatedAt={customTemplate?.updated_at} />
          )}
        </div>
      </RadioGroup>

      {isSettingActive && (
        <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Switching agreement…
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        The active agreement is sent for signing on{" "}
        {category === "standard" ? "standard" : AGREEMENT_CATEGORY_LABEL[category].toLowerCase()} rentals.
      </p>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the default agreement?</AlertDialogTitle>
            <AlertDialogDescription>Its wording goes back to the original. Any edits you made to it are lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => resetDefault()}>Reset agreement</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the custom agreement?</AlertDialogTitle>
            <AlertDialogDescription>
              All of its content is removed and customers sign the default agreement. You can write a new one at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => clearCustom()}>
              Clear agreement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function AgreementTemplatesPageV2() {
  const searchParams = useSearchParams();
  const { settings: rentalSettings, isLoading: rentalLoading } = useRentalSettings();
  const { canEditSettings, canViewSettings } = useManagerPermissions();
  const canEdit = canEditSettings("templates");
  // Only offered to someone who may open the Pay as you go page.
  const canOpenPayg = canViewSettings("payg");
  const paygEnabled = rentalSettings?.pay_as_you_go_enabled === true;
  const param = searchParams.get("category");
  const resolved = resolveAgreementCategory(param, paygEnabled);
  const [picked, setPicked] = useState<TemplateCategory | null>(null);

  const categories: TemplateCategory[] = ["standard", "extension", ...(paygEnabled ? (["payg"] as const) : []), "installment"];
  const active: TemplateCategory = picked && categories.includes(picked) ? picked : resolved.category;
  const waitingForPayg = rentalLoading && param === "payg";

  return (
    <TooltipProvider>
      {/* md:pt-[26px]: the header's first line is the 32px title, so it centres
          at 50 + 26 + 16 = 92, the sidebar switch's row (as on the Settings index). */}
      <div className="w-full max-w-[1160px] space-y-8 pb-16 md:pt-[26px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SettingsPageHeader
            title="Rental agreement"
            description="Choose the agreement customers sign for each kind of rental."
          />
          {!canEdit && <SettingsReadOnlyNotice />}
        </div>

        {!picked && !waitingForPayg && resolved.notice === "payg-off" && (
          // The way to turn it on: the Pay as you go settings page (a link,
          // so it works for a viewer too; that page is read-only for them).
          <SettingsDependencyNotice
            title="Pay As You Go is off"
            body="Its agreement is only used once Pay As You Go is on. Showing the standard agreement instead."
            action={canOpenPayg ? { label: "Open Pay As You Go", href: "/settings?tab=payg" } : undefined}
          />
        )}
        {!picked && resolved.notice === "unknown" && (
          <SettingsDependencyNotice title="That agreement type doesn't exist" body="Showing the standard agreement instead." />
        )}

        <div role="tablist" aria-label="Rental type" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {categories.map((category) => {
            const Icon = CATEGORY_ICON[category];
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
                {AGREEMENT_CATEGORY_LABEL[category]}
              </button>
            );
          })}
        </div>

        {waitingForPayg ? (
          <SettingsSectionSkeleton variant="stack" rows={2} label="Loading agreements" />
        ) : (
          <AgreementCategorySectionV2 key={active} category={active} canEdit={canEdit} />
        )}
      </div>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                      */
/* -------------------------------------------------------------------------- */

const SIG = '<span style="display:inline-block;border:2px dashed #6366f1;border-radius:6px;padding:8px 24px;color:#6366f1;font-size:12px;font-weight:600;background:#eef2ff;">Signature</span>';
const DATE = '<span style="display:inline-block;border:2px dashed #2563eb;border-radius:6px;padding:4px 16px;color:#2563eb;font-size:12px;font-weight:600;background:#eff6ff;">Date Signed</span>';
const INITIALS = '<span style="display:inline-block;border:2px dashed #d97706;border-radius:6px;padding:4px 16px;color:#d97706;font-size:12px;font-weight:600;background:#fffbeb;">Initials</span>';

export function AgreementTemplateEditorV2({
  disclaimerHtml,
  depositClauseSample,
}: {
  /** The fixed platform disclaimer, passed from the page that owns it. */
  disclaimerHtml: string;
  depositClauseSample: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = resolveAgreementEditorParams(searchParams.get("type"), searchParams.get("category"));
  const templateType: TemplateType = params?.type ?? "default";
  const category: TemplateCategory = params?.category ?? "standard";
  const { tenant } = useTenant();
  const { defaultTemplate, customTemplate, isLoading, error, refetch, updateContentAsync, isUpdating, resetDefaultAsync, isResetting } =
    useTemplateSelection(category);
  const { canEditSettings } = useManagerPermissions();
  const canEdit = canEditSettings("templates");

  const isDefault = templateType === "default";
  const current = isDefault ? defaultTemplate : customTemplate;
  const defaultContent = getDefaultTemplateForCategory(category);

  const [content, setContent] = useState("");
  const [original, setOriginal] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  const readOk = !!params && !!tenant && !isLoading && !error;
  useEffect(() => {
    if (original !== null || !readOk) return;
    const seed = current?.template_content || (isDefault ? defaultContent : "");
    setContent(seed);
    setOriginal(seed);
  }, [readOk, original, current, isDefault, defaultContent]);

  const hasChanges = original !== null && content !== original;
  const contentBlank = original !== null && isBlankHtml(content);

  const saveContent = async (): Promise<boolean> => {
    if (!canEdit || isBlankHtml(content)) return false;
    setSaveError(null);
    try {
      await updateContentAsync({ type: templateType, content });
      setOriginal(content);
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
  const saveStatus = useSettingsSaveStatus({ isDirty: hasChanges, isPending: isUpdating, error: saveError });

  const handleReset = async () => {
    try {
      await resetDefaultAsync();
      setContent(defaultContent);
      setOriginal(defaultContent);
      setSaveError(null);
      setResetOpen(false);
    } catch {
      // The hook toasts the reason; the dialog stays open to retry.
    }
  };

  const isBonzahTenant = tenant?.integration_bonzah === true;
  const isChargedDepositTenant = (tenant as { deposit_charge_enabled?: boolean } | null)?.deposit_charge_enabled === true;
  const previewContent = replaceVariables(
    injectAgreementClauses(content, {
      hasMileage: false,
      hasTerms: false,
      hasBonzahAddendum: isBonzahTenant,
      hasDepositClause: isChargedDepositTenant,
      hasHandoverTimes: true,
    }),
    {
      ...getSampleData(),
      bonzah_insurance_addendum: isBonzahTenant ? BONZAH_INSURANCE_ADDENDUM_HTML : "",
      deposit_terms_clause: isChargedDepositTenant ? depositClauseSample : "",
    },
  )
    .replace(/\{\{@sig1\}\}/g, SIG)
    .replace(/\{\{@date1\}\}/g, DATE)
    .replace(/\{\{@init1\}\}/g, INITIALS);

  const label = AGREEMENT_CATEGORY_LABEL[category];
  const state = !params
    ? ({
        kind: "not-found",
        headline: "This agreement doesn't exist",
        body: "The link may be out of date. Pick an agreement from the list.",
      } as const)
    : original === null && error
      ? ({ kind: "error", thing: "this agreement", error, onRetry: () => refetch() } as const)
      : original === null
        ? ({ kind: "loading" } as const)
        : ({ kind: "ready" } as const);

  return (
    <TemplateEditorShellV2
      title={params ? `${label} · ${isDefault ? DEFAULT_TEMPLATE_NAME : CUSTOM_TEMPLATE_NAME}` : "Rental agreement"}
      badges={state.kind === "ready" && hasChanges && canEdit ? <EditorChip tone="amber">Unsaved changes</EditorChip> : undefined}
      description={
        params
          ? isDefault
            ? `The ${label.toLowerCase()} agreement customers sign.`
            : `Your own ${label.toLowerCase()} agreement.`
          : undefined
      }
      backLabel="Back to agreements"
      onBack={() => router.push(listHref(category))}
      state={state}
      readOnly={!canEdit}
      actions={
        canEdit && isDefault
          ? [{ label: "Reset to original wording", icon: RotateCcw, onClick: () => setResetOpen(true), busy: isResetting, tone: "destructive" }]
          : []
      }
      onSave={() => void saveContent()}
      saveDisabled={!hasChanges || contentBlank}
      saving={isUpdating}
      previewKind="agreement"
      aboveEditor={
        canEdit && (hasChanges || saveStatus !== "idle" || contentBlank) ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <SettingsSaveState status={saveStatus} error={saveError} onRetry={() => void saveContent()} />
            {contentBlank && (
              <p className="text-xs text-destructive" role="alert">
                The agreement is empty. Customers can&apos;t be sent a blank agreement, so add content before saving.
              </p>
            )}
          </div>
        ) : undefined
      }
      editor={
        state.kind === "ready" ? (
          <>
            <div className="min-h-[18rem] flex-1">
              <TipTapEditor content={content} onChange={setContent} placeholder="Start typing your agreement template..." />
            </div>
            {/* Phone, editing: folded, so the agreement itself gets the pane.
                Otherwise the fixed disclaimer filled it and left ~100px to write
                in. Not for view-only users: this pane is `inert` for them, so a
                folded disclaimer could never be opened. */}
            {canEdit && (
            <details className="group m-3 rounded-xl bg-muted/40 p-3 md:hidden">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
                <Lock className="size-3.5" aria-hidden="true" />
                <span className="min-w-0 flex-1">Platform disclaimer · fixed</span>
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div
                className="mt-2 select-none space-y-1.5 text-xs text-muted-foreground [&>hr]:hidden [&>p:first-of-type]:hidden"
                dangerouslySetInnerHTML={{ __html: disclaimerHtml }}
              />
            </details>
            )}
            <div className={cn("m-3 rounded-xl bg-muted/40 p-3", canEdit && "hidden md:block")}>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Lock className="size-3.5" aria-hidden="true" />
                Platform disclaimer · fixed
              </p>
              <div
                className="select-none space-y-1.5 text-xs text-muted-foreground [&>hr]:hidden [&>p:first-of-type]:hidden"
                dangerouslySetInnerHTML={{ __html: disclaimerHtml }}
              />
            </div>
          </>
        ) : null
      }
      preview={
        <>
          {isBlankHtml(content) ? (
            <p className="italic text-muted-foreground">
              {canEdit ? "Start typing to see a preview." : "This agreement has no content yet."}
            </p>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: previewContent }} />
          )}
          <div className="prose prose-sm mt-0 max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: disclaimerHtml }} />
        </>
      }
    >
      <AlertDialog open={resetOpen} onOpenChange={(open) => !isResetting && setResetOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to the original wording?</AlertDialogTitle>
            <AlertDialogDescription>Your edits to the default agreement are replaced. This can&apos;t be undone.</AlertDialogDescription>
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
              {isResetting ? "Resetting…" : "Reset agreement"}
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
