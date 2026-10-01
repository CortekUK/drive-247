"use client";

/**
 * Agreements v2: the templates, on the Agreements tab rather than in Settings
 * (D1, D5; transcript 00:21–01:12, 06:46–07:13, 19:43–20:17).
 *
 * ONE LIST. Every `agreement_templates` row of the tenant, in every category,
 * in one grid, searchable by name. There is no "Shared with me / Created by
 * me": every template is the operator's own. "Create your template" is the
 * first card; a small category label appears only on the templates a rental
 * uses for something other than a standard agreement (extension, Pay As You
 * Go, installment).
 *
 * DEFAULT IS `is_active`, and the section says what that means in one line:
 * the default template is the one sent from rentals. That is true by
 * construction, because /api/esign picks exactly that row (D5). "Set as
 * default" asks first, then switches the default of that template's own
 * category through the hook's two-step `setDefault`. A template with no
 * wording can never become the default, as in v1 (a rental would send an
 * empty contract).
 *
 * CREATE makes a new standard template named "Untitled agreement" (the hook
 * makes the name unique), starting from the tenant's current default wording,
 * else the built-in standard agreement, ending with the two-block signatures
 * section (`withSignaturesSectionV2`), and opens the editor on it. EDIT opens
 * the same editor on the saved row. Both save through `update`. The row is
 * created first, so an editor on a NEW template that closes without ever
 * saving (Cancel, Escape, Don't Save, or leaving the page) deletes it again
 * through `remove`, rather than leaving "Untitled agreement" rows behind. A
 * new row is never the default, so `remove` never refuses it for that; if the
 * clean-up fails anyway it is only logged: the operator asked for nothing.
 *
 * THE PREVIEW'S DATA. A template has no customer yet, so the editor previews
 * it with the catalogue's sample values (getSampleData), EXCEPT the company
 * variables, which are the tenant's real details: company_name / tenant_name,
 * company_email, company_phone and company_address. They are read from the
 * same `tenants` columns /api/esign reads for those variables (company_name,
 * contact_email, contact_phone falling back to phone, address), so the preview
 * shows what a rental would print, not "Acme Car Rentals" (D11). Until that
 * read answers, TenantContext's company name, email and phone stand in.
 *
 * URL. `?view=templates` brings the section into view once it has loaded
 * (Settings' old route redirects here with it), and `?new=1` starts a create
 * (the hero card sets it), then is taken off the URL so a reload does not
 * create a second template.
 *
 * WHO. Editing keeps its existing grant, `canEditSettings('templates')`, the
 * one the Settings screens used (D19). Everyone else sees the list, read only.
 *
 * TENANT ISOLATION: every read and write goes through hooks that filter by
 * tenant_id; the company read filters `tenants` by the tenant's own id.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Archive, Check, CircleCheck, CircleDashed, Eye, FileText, Loader2, MoreVertical, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { Switch } from "@/components/ui-v2/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { AgreementPreviewV2 } from "@/components/agreements-v2/agreement-preview-v2";
import { AGREEMENT_PAGE_BACKDROP_V2 } from "@/components/agreements-v2/agreement-pdf-pages-v2";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
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
import {
  SettingsEmptyState,
  SettingsLoadError,
  SettingsNoMatch,
  SettingsReadOnlyNotice,
  SettingsSectionSkeleton,
  describeLoadError,
} from "@/components/settings-v2/section-states";
import { AGREEMENT_CATEGORY_LABEL, agreementPreviewSnippet, isBlankHtml } from "@/components/settings-v2/message-rules";
import { EditorChip } from "@/components/settings-v2/template-editor-shell-v2";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import {
  defaultTemplateFor,
  useAgreementTemplateMutationsV2,
  useAgreementTemplatesV2,
} from "@/hooks/use-agreement-templates-v2";
import { getDefaultTemplateForCategory } from "@/lib/default-agreement-template";
import { getSampleData } from "@/lib/template-variables";
import { buildIndividualData, renderAgreementHtml } from "@/lib/agreements-v2/render";
import type { AgreementTemplateCategoryV2, AgreementTemplateStatusV2, AgreementTemplateV2 } from "@/lib/agreements-v2/types";
import { cn } from "@/lib/utils";
import { AgreementEditorV2 } from "@/components/agreements-v2/editor/agreement-editor-v2";
import { withSignaturesSectionV2 } from "@/components/agreements-v2/editor/starter-content";
import { UNNAMED_TEMPLATE, matchTemplatesByNameV2 } from "@/components/agreements-v2/template-picker-v2";

/** The page's white surfaces carry the ui-v2 Card's hairline ring (not `border-border/*`, invalid in v2 dark). */
const SURFACE = "rounded-2xl bg-card ring-1 ring-foreground/5 dark:ring-foreground/10";

export const TEMPLATES_SECTION_DESCRIPTION = "Your default template is the one sent from rentals.";

/** What "Create your template" names the new row (the hook suffixes " (2)"… when taken). */
export const NEW_TEMPLATE_NAME = "Untitled agreement";

/** Where a category's default template goes out, as /api/esign picks it. */
export const DEFAULT_SENT_FOR: Record<AgreementTemplateCategoryV2, string> = {
  standard: "sent from rentals",
  extension: "sent when a rental is extended",
  payg: "sent for Pay As You Go rentals",
  installment: "sent for rentals on an installment plan",
};

/* -------------------------------------------------------------------------- */
/* The editor's preview data                                                   */
/* -------------------------------------------------------------------------- */

/** The same `tenants` columns /api/esign reads for the company variables. */
export const TEMPLATE_PREVIEW_COMPANY_COLUMNS = "company_name, contact_email, contact_phone, phone, address";

export interface TemplateCompanyRowV2 {
  company_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  phone?: string | null;
  address?: string | null;
}

/**
 * Sample values for everything a template cannot know yet (the customer, the
 * vehicle, the rental, the payments), and the tenant's REAL company details
 * for the company variables. The company values go through
 * `buildIndividualData`, the same builder the individual send uses, so they are
 * escaped and mapped exactly as a sent agreement maps them (the phone is
 * contact_phone, else phone, as in /api/esign). A detail the tenant has not
 * filled in previews blank, as it prints blank.
 */
export function templatePreviewDataV2(
  company: TemplateCompanyRowV2 | null | undefined,
  today: Date = new Date(),
): Record<string, string> {
  const sample = getSampleData();
  return {
    ...sample,
    ...buildIndividualData({
      companyName: company?.company_name ?? "",
      companyEmail: company?.contact_email ?? "",
      companyPhone: company?.contact_phone || company?.phone || "",
      companyAddress: company?.address ?? "",
      // No customer yet: the catalogue's own sample recipient.
      recipientName: sample.customer_name ?? "",
      recipientEmail: sample.customer_email ?? "",
      date: today,
    }),
  };
}

export const templateCompanyV2QueryKey = (tenantId: string | undefined) => ["agreement-template-company-v2", tenantId] as const;

/** The editor's `previewData` for a template of this tenant. */
export function useTemplatePreviewDataV2(): Record<string, string> {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const query = useQuery({
    queryKey: templateCompanyV2QueryKey(tenantId),
    queryFn: async (): Promise<TemplateCompanyRowV2 | null> => {
      const { data, error } = await supabase
        .from("tenants")
        .select(TEMPLATE_PREVIEW_COMPANY_COLUMNS)
        .eq("id", tenantId as string)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as TemplateCompanyRowV2 | null;
    },
    enabled: !!tenantId,
    staleTime: 60_000,
    retry: 1,
  });

  // While the read runs (or if it fails), what TenantContext already holds, so
  // the preview never shows the catalogue's sample company.
  const row: TemplateCompanyRowV2 | null =
    query.data ??
    (tenant ? { company_name: tenant.company_name, contact_email: tenant.contact_email, phone: tenant.phone } : null);

  return useMemo(
    () => templatePreviewDataV2(row),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [row?.company_name, row?.contact_email, row?.contact_phone, row?.phone, row?.address],
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/*
 * The signatures section and `withSignaturesSectionV2` live in
 * editor/starter-content.ts, the one definition the editor, this section and
 * the send dialog all share. Re-exported here for existing importers.
 */
export { SIGNATURES_SECTION_V2, withSignaturesSectionV2 } from "@/components/agreements-v2/editor/starter-content";

/**
 * What a new template starts from: the tenant's current standard default, when
 * it has wording, else the built-in standard agreement; either way ending with
 * the signatures section.
 */
export function starterContentV2(templates: AgreementTemplateV2[]): string {
  const current = defaultTemplateFor(templates, "standard");
  const base = current && !isBlankHtml(current.content) ? current.content : getDefaultTemplateForCategory("standard");
  return withSignaturesSectionV2(base);
}

function formatUpdated(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * A message fit for a toast. The hook's own errors are sentences ("A template
 * named … already exists."); a database error is not, so it gets the settings
 * kit's operator-safe reason instead.
 */
function friendlyError(error: unknown): string {
  if (error instanceof Error && !("code" in error)) return error.message;
  return describeLoadError(error);
}

const displayName = (t: Pick<AgreementTemplateV2, "name">) => t.name.trim() || UNNAMED_TEMPLATE;

interface EditingTemplate {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  /** Made by "Create your template" for this editor: deleted again if it closes unsaved. */
  isNew?: boolean;
}

/* -------------------------------------------------------------------------- */
/* One template                                                                */
/* -------------------------------------------------------------------------- */

function TemplateCardV2({
  template,
  canEdit,
  settingDefault,
  defaultBusy,
  onEdit,
  onSetDefault,
  deleting,
  deleteBusy,
  onDelete,
}: {
  template: AgreementTemplateV2;
  canEdit: boolean;
  settingDefault: boolean;
  defaultBusy: boolean;
  onEdit: () => void;
  onSetDefault: () => void;
  deleting: boolean;
  deleteBusy: boolean;
  onDelete: () => void;
}) {
  const name = displayName(template);
  const snippet = agreementPreviewSnippet(template.content);
  const blank = isBlankHtml(template.content);
  const updated = formatUpdated(template.updatedAt);

  return (
    <li data-template-id={template.id} className={cn(SURFACE, "flex min-w-0 flex-col gap-3 p-4")}>
      <div className="flex min-w-0 items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
          aria-hidden="true"
        >
          <FileText className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h3 className="min-w-0 truncate text-sm font-semibold text-foreground" title={name}>
              {name}
            </h3>
            {template.isDefault && (
              <EditorChip tone="primary">
                <Check className="size-3" aria-hidden="true" />
                Default
              </EditorChip>
            )}
            {template.category !== "standard" && <EditorChip>{AGREEMENT_CATEGORY_LABEL[template.category]}</EditorChip>}
          </div>
          {updated && <p className="text-xs text-muted-foreground">Updated {updated}</p>}
        </div>
      </div>

      {/* Padding on a wrapper, not on the clamped <p> (a third line showed
          through the padding otherwise; see agreement-templates-v2.tsx). */}
      <div className="rounded-xl bg-muted/40 p-3">
        <p className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {snippet ?? <span className="italic">No wording yet</span>}
        </p>
      </div>

      {canEdit && (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${name}`}>
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
          {!template.isDefault && !blank && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSetDefault}
              disabled={defaultBusy}
              aria-label={`Set ${name} as default`}
            >
              {settingDefault ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Star data-icon="inline-start" />
              )}
              Set as default
            </Button>
          )}
          {/* Delete, on the far side. The default cannot go: it is what a
              rental sends, so the button says why instead of vanishing. */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
            disabled={template.isDefault || deleteBusy}
            aria-label={`Delete ${name}`}
            title={template.isDefault ? "Your default template can’t be deleted. Set another one as default first." : `Delete ${name}`}
          >
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
          </Button>
        </div>
      )}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* The table (Oct 1 2026: templates as a table, not cards)                     */
/* -------------------------------------------------------------------------- */

const HEAD = "px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** Text-only status (the design system's table rule): Active green, Draft amber, Archived muted. */
export const TEMPLATE_STATUS_V2: Record<AgreementTemplateStatusV2, { label: string; tone: string; icon: typeof Check; hint: string }> = {
  active: { label: "Active", tone: "text-green-600 dark:text-green-400", icon: CircleCheck, hint: "Can be sent and picked for rentals" },
  draft: { label: "Draft", tone: "text-amber-700 dark:text-amber-400", icon: CircleDashed, hint: "Still being written; never sent" },
  archived: { label: "Archived", tone: "text-muted-foreground", icon: Archive, hint: "Put away; never sent" },
};
const STATUS_ORDER: AgreementTemplateStatusV2[] = ["active", "draft", "archived"];

/**
 * One row per template: Name (its type under it when it is not Standard, and
 * a warning when it has no wording), Status, Last updated, Default (the tick,
 * or "Make default"), then the ⋮ menu: Preview, Edit, the status, Delete.
 *
 * The rules: only an ACTIVE template with wording can become the default; the
 * default stays active (its menu says why the other statuses are shut) and
 * cannot be deleted.
 */
function TemplatesTableV2({
  templates,
  canEdit,
  settingDefaultId,
  deletingId,
  statusId,
  onPreview,
  onEdit,
  onSetDefault,
  onDelete,
  onSetStatus,
}: {
  templates: AgreementTemplateV2[];
  canEdit: boolean;
  settingDefaultId: string | null;
  deletingId: string | null;
  statusId: string | null;
  onPreview: (t: AgreementTemplateV2) => void;
  onEdit: (t: AgreementTemplateV2) => void;
  onSetDefault: (t: AgreementTemplateV2) => void;
  onDelete: (t: AgreementTemplateV2) => void;
  onSetStatus: (t: AgreementTemplateV2, status: AgreementTemplateStatusV2) => void;
}) {
  return (
    <div className={cn(SURFACE, "overflow-x-auto")}>
      <table className="w-full min-w-[680px] table-fixed text-sm" aria-label="Agreement templates">
        <thead>
          <tr className="border-b border-border">
            <th className={cn(HEAD, "w-[33%]")}>Name</th>
            <th className={cn(HEAD, "w-[13%]")}>Status</th>
            <th className={cn(HEAD, "w-[17%]")}>Last updated</th>
            <th className={cn(HEAD, "w-[18%]")}>Default</th>
            <th className={cn(HEAD, "w-[19%] text-right")}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => {
            const name = displayName(template);
            const blank = isBlankHtml(template.content);
            const updated = formatUpdated(template.updatedAt);
            const status = template.status ?? "active";
            const look = TEMPLATE_STATUS_V2[status];
            const busy = statusId === template.id || deletingId === template.id;
            return (
              <tr
                key={template.id}
                data-template-id={template.id}
                data-template-status={status}
                className="border-b border-border last:border-0"
              >
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]",
                        status === "archived" && "opacity-50",
                      )}
                      aria-hidden="true"
                    >
                      <FileText className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className={cn("truncate font-medium", status === "archived" ? "text-muted-foreground" : "text-foreground")} title={name}>
                        {name}
                      </p>
                      {blank ? (
                        <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="size-3" aria-hidden="true" />
                          No wording yet
                        </p>
                      ) : template.category !== "standard" ? (
                        <p className="text-xs text-muted-foreground">{AGREEMENT_CATEGORY_LABEL[template.category]}</p>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("font-medium", look.tone)} title={look.hint}>
                    {look.label}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums text-foreground">{updated ?? "—"}</td>
                <td className="px-4 py-3">
                  {template.isDefault ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                      <Check className="size-4" aria-hidden="true" />
                      Default
                    </span>
                  ) : canEdit && !blank && status === "active" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-ml-2"
                      onClick={() => onSetDefault(template)}
                      disabled={settingDefaultId !== null}
                      aria-label={`Make ${name} the default`}
                    >
                      {settingDefaultId === template.id ? (
                        <Loader2 className="animate-spin" data-icon="inline-start" />
                      ) : (
                        <Star data-icon="inline-start" />
                      )}
                      Make default
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-2 py-3">
                  <div className="flex items-center justify-end gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => onPreview(template)}
                      aria-label={`Preview ${name}`}
                      title="Preview"
                    >
                      <Eye />
                    </Button>
                    {canEdit && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => onEdit(template)}
                          aria-label={`Edit ${name}`}
                          title="Edit"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => onDelete(template)}
                          disabled={template.isDefault || deletingId !== null}
                          aria-label={`Delete ${name}`}
                          title={
                            template.isDefault
                              ? "Your default template can’t be deleted. Make another one the default first."
                              : "Delete"
                          }
                        >
                          {deletingId === template.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                        </Button>
                        {/* Status only: a short menu that opens below the dots, lined up with their right edge. */}
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={`Change the status of ${name}`}
                              aria-busy={statusId === template.id || undefined}
                              title="Status"
                            >
                              {statusId === template.id ? <Loader2 className="animate-spin" /> : <MoreVertical />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="bottom" align="end" sideOffset={6} collisionPadding={12} className="w-48">
                            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Status</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={status}
                              onValueChange={(next) => {
                                if (next !== status) onSetStatus(template, next as AgreementTemplateStatusV2);
                              }}
                            >
                              {STATUS_ORDER.map((key) => {
                                const option = TEMPLATE_STATUS_V2[key];
                                return (
                                  <DropdownMenuRadioItem
                                    key={key}
                                    value={key}
                                    disabled={(template.isDefault && key !== "active") || statusId !== null}
                                    title={option.hint}
                                  >
                                    <span className={option.tone}>{option.label}</span>
                                  </DropdownMenuRadioItem>
                                );
                              })}
                            </DropdownMenuRadioGroup>
                            {template.isDefault && (
                              <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">Your default stays active.</p>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Preview: the template as a signer would get it, filled with your company and a sample customer. */
function TemplatePreviewDialogV2({
  template,
  previewData,
  onOpenChange,
  onEdit,
}: {
  template: AgreementTemplateV2 | null;
  previewData: Record<string, string>;
  onOpenChange: (open: boolean) => void;
  onEdit?: (t: AgreementTemplateV2) => void;
}) {
  const html = useMemo(
    () => (template ? renderAgreementHtml(template.content, previewData, { mode: "preview" }) : ""),
    [template, previewData],
  );
  return (
    <Dialog open={!!template} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className={cn("shrink-0 border-b px-6 py-4 text-left", onEdit ? "pr-28" : "pr-16")}>
          <DialogTitle className="truncate text-lg">{template ? displayName(template) : ""}</DialogTitle>
          <DialogDescription>Your company details, sample customer.</DialogDescription>
        </DialogHeader>
        {/* Edit, as the ✕'s twin: same size, same round grey ground, just left of it. */}
        {template && onEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-4 right-14 bg-secondary"
            onClick={() => onEdit(template)}
            aria-label={`Edit ${displayName(template)}`}
            title="Edit"
          >
            <Pencil />
          </Button>
        )}
        <div className={cn("min-h-0 flex-1 overflow-y-auto p-6", AGREEMENT_PAGE_BACKDROP_V2)}>
          <AgreementPreviewV2 html={html} className="mx-auto max-w-3xl bg-transparent" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* The section                                                                 */
/* -------------------------------------------------------------------------- */

export function AgreementTemplatesSectionV2({
  id,
  inDialog = false,
}: {
  id?: string;
  /**
   * Rendered inside "Manage agreement templates" (./templates-dialog-v2): the
   * dialog carries the title, and the header offers "New template", since
   * there is no longer a create card beside it.
   */
  inDialog?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const { canEditSettings, isLoading: permissionsLoading } = useManagerPermissions();
  const canEdit = canEditSettings("templates");

  const { templates, isLoading: templatesLoading, error, refetch } = useAgreementTemplatesV2();
  const { create, update, setDefault, remove, setStatus } = useAgreementTemplateMutationsV2();
  const previewData = useTemplatePreviewDataV2();

  // The query waits for the tenant, and a waiting query is not "loading" to
  // React Query: without a tenant there is no answer yet.
  const loading = templatesLoading || !tenant?.id;

  const headingId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const [editing, setEditing] = useState<EditingTemplate | null>(null);
  const [previewing, setPreviewing] = useState<AgreementTemplateV2 | null>(null);
  const [confirmDefault, setConfirmDefault] = useState<AgreementTemplateV2 | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AgreementTemplateV2 | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [showArchived, setShowArchived] = useState(false);
  const [statusId, setStatusId] = useState<string | null>(null);
  const archivedCount = useMemo(() => templates.filter((t) => t.status === "archived").length, [templates]);
  // Archived templates are put away: listed only when asked for.
  const visible = useMemo(
    () => matchTemplatesByNameV2(showArchived ? templates : templates.filter((t) => t.status !== "archived"), query),
    [templates, query, showArchived],
  );

  // A template "Create your template" made that has not been saved yet. Held
  // in a ref so the editor's close (which runs after its save resolves, from
  // the closure of the render before) and an unmount both see the latest.
  const unsavedNewId = useRef<string | null>(null);
  const discardUnsavedNew = useCallback(() => {
    const id = unsavedNewId.current;
    if (!id) return;
    unsavedNewId.current = null;
    // Quietly: the operator did not ask for a delete, and a leftover row is
    // theirs to remove by hand; a scary toast would only confuse.
    void (async () => {
      try {
        await remove(id);
      } catch (e) {
        console.warn("Agreements v2: could not remove an unsaved new template", e);
      }
    })();
  }, [remove]);
  const discardRef = useRef(discardUnsavedNew);
  discardRef.current = discardUnsavedNew;
  // Leaving the page with the editor still on a never-saved new template.
  useEffect(() => () => discardRef.current(), []);

  /* ── create, edit, save, set default ───────────────────────────────── */

  const startCreate = useCallback(async () => {
    if (!canEdit || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    try {
      const created = await create({ name: NEW_TEMPLATE_NAME, content: starterContentV2(templates) });
      // The new card must be on screen when the editor closes.
      setQuery("");
      unsavedNewId.current = created.id;
      setEditing({ id: created.id, name: created.name, content: created.content, isDefault: created.isDefault, isNew: true });
    } catch (e) {
      toast({ title: "Could not create the template", description: friendlyError(e), variant: "destructive" });
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [canEdit, create, templates]);

  const openEditor = (template: AgreementTemplateV2) =>
    setEditing({ id: template.id, name: template.name, content: template.content, isDefault: template.isDefault });

  /**
   * The editor's Save. Throws on failure (after saying why), so the editor
   * keeps its unsaved edits open rather than treating them as saved.
   */
  const saveTemplate = async (content: string, name: string) => {
    const target = editing;
    if (!target) return;
    if (isBlankHtml(content)) {
      const message = "A template needs some wording before it can be saved.";
      toast({ title: "Nothing to save yet", description: message, variant: "destructive" });
      throw new Error(message);
    }
    try {
      await update(target.id, { content, name });
    } catch (e) {
      toast({ title: "Could not save the template", description: friendlyError(e), variant: "destructive" });
      throw e;
    }
    // Saved once: it is a real template now, kept whatever happens next.
    if (unsavedNewId.current === target.id) unsavedNewId.current = null;
    toast({
      title: "Template saved",
      description: target.isDefault ? "Rentals send this wording from now on." : undefined,
    });
    setEditing(null);
  };

  const makeDefault = async (template: AgreementTemplateV2) => {
    setSettingDefaultId(template.id);
    try {
      await setDefault(template.id);
      toast({
        title: "Default template changed",
        description: `“${displayName(template)}” is now the agreement ${DEFAULT_SENT_FOR[template.category]}.`,
      });
    } catch (e) {
      toast({ title: "Could not change the default", description: friendlyError(e), variant: "destructive" });
    } finally {
      setSettingDefaultId(null);
    }
  };

  const changeStatus = async (template: AgreementTemplateV2, status: AgreementTemplateStatusV2) => {
    setStatusId(template.id);
    try {
      await setStatus(template.id, status);
      const said: Record<AgreementTemplateStatusV2, string> = {
        active: "can now be sent and picked for rentals.",
        draft: "is a draft again. It won't be sent until it's active.",
        archived: "is archived. Turn on Show archived to see it.",
      };
      toast({ title: `Marked ${TEMPLATE_STATUS_V2[status].label.toLowerCase()}`, description: `“${displayName(template)}” ${said[status]}` });
    } catch (e) {
      toast({ title: "Could not change the status", description: friendlyError(e), variant: "destructive" });
    } finally {
      setStatusId(null);
    }
  };

  const deleteTemplate = async (template: AgreementTemplateV2) => {
    setDeletingId(template.id);
    try {
      await remove(template.id);
      toast({ title: "Template deleted", description: `“${displayName(template)}” was removed. Agreements already sent do not change.` });
    } catch (e) {
      toast({ title: "Could not delete the template", description: friendlyError(e), variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  /* ── the URL: ?view=templates and ?new=1 ───────────────────────────── */

  const view = searchParams.get("view");
  const wantsNew = searchParams.get("new") === "1";
  const paramsString = searchParams.toString();
  // Taking `new` off the URL is not a new visit, so it must not scroll again.
  const scrollKey = useMemo(() => {
    const params = new URLSearchParams(paramsString);
    params.delete("new");
    return params.toString();
  }, [paramsString]);

  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    // In the dialog the section is already what is on screen; nothing to scroll to.
    if (view !== "templates" || inDialog) {
      scrolledFor.current = null;
      return;
    }
    // Once the cards are in, so the section does not move after the scroll.
    if (loading || scrolledFor.current === scrollKey) return;
    scrolledFor.current = scrollKey;
    rootRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [view, loading, scrollKey, inDialog]);

  const newHandled = useRef(false);
  useEffect(() => {
    if (!wantsNew) {
      newHandled.current = false;
      return;
    }
    // The starter wording is the current default, and the grant decides
    // whether a create happens at all, so both must have answered.
    if (newHandled.current || loading || permissionsLoading) return;
    newHandled.current = true;

    const params = new URLSearchParams(paramsString);
    params.delete("new");
    const rest = params.toString();
    const base = pathname || "/agreements";
    router.replace(rest ? `${base}?${rest}` : base, { scroll: false });

    if (canEdit && !editing) void startCreate();
  }, [wantsNew, loading, permissionsLoading, canEdit, editing, paramsString, pathname, router, startCreate]);

  /* ── the section ───────────────────────────────────────────────────── */

  const confirmTarget = confirmDefault;
  const currentDefault = confirmTarget
    ? templates.find((t) => t.isDefault && t.category === confirmTarget.category && t.id !== confirmTarget.id) ?? null
    : null;

  let body: ReactNode;
  if (loading) {
    body = <SettingsSectionSkeleton variant="cards" rows={3} label="Loading templates" />;
  } else if (error && templates.length === 0) {
    body = <SettingsLoadError thing="your templates" error={error} onRetry={() => refetch()} />;
  } else if (templates.length === 0) {
    body = (
      <SettingsEmptyState
        icon={FileText}
        headline="No templates yet"
        body={
          canEdit
            ? "Write your agreement once and send it from any rental or from this tab. Until you create one, rentals send the built-in agreement."
            : "Rentals send the built-in agreement. An admin can create your own template."
        }
        points={
          canEdit
            ? ["Your own wording, with your company details filled in", "Signature, initials and date fields where you want them", "Choose which one rentals send"]
            : undefined
        }
        primaryAction={
          canEdit ? { label: "Create your template", onClick: () => void startCreate(), disabled: creating } : undefined
        }
        className={SURFACE}
      />
    );
  } else if (visible.length === 0) {
    body = (
      <div className={SURFACE}>
        <SettingsNoMatch query={query} noun="templates" onClear={() => setQuery("")} />
      </div>
    );
  } else {
    body = (
      /* No "Create your template" card in this grid: it already sits beside
         the graph at the top of the tab (the lead's one-graph-one-card row,
         15:18), and showing it twice read as a mistake. That card starts a
         create here through `?new=1`; with no templates yet, the empty state
         offers the same action. */
      <TemplatesTableV2
        templates={visible}
        canEdit={canEdit}
        settingDefaultId={settingDefaultId}
        deletingId={deletingId}
        onPreview={setPreviewing}
        onEdit={openEditor}
        onSetDefault={setConfirmDefault}
        onDelete={setConfirmDelete}
        statusId={statusId}
        onSetStatus={(t, next) => void changeStatus(t, next)}
      />
    );
  }

  return (
    <section
      ref={rootRef}
      id={id}
      aria-labelledby={headingId}
      data-agreement-templates=""
      className="scroll-mt-24 space-y-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className={cn("min-w-0", inDialog && "sr-only")}>
          <h2 id={headingId} className="font-heading text-lg font-semibold tracking-tight text-foreground">
            Templates
          </h2>
          <p className="text-sm text-muted-foreground">{TEMPLATES_SECTION_DESCRIPTION}</p>
        </div>
        <div className={cn("flex flex-wrap items-center gap-2 sm:justify-end", inDialog && "w-full sm:justify-between")}>
          {!canEdit && !permissionsLoading && <SettingsReadOnlyNotice />}
          {archivedCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived templates" />
              Show archived ({archivedCount})
            </label>
          )}
          {inDialog && canEdit && !loading && templates.length > 0 && (
            <Button type="button" onClick={() => void startCreate()} disabled={creating} className="sm:order-last">
              {creating ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Plus data-icon="inline-start" />}
              {creating ? "Creating…" : "New template"}
            </Button>
          )}
          {!loading && templates.length > 0 && (
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="Search templates by name"
                placeholder="Search templates"
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
          )}
        </div>
      </div>

      {body}

      <AlertDialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmDefault(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make “{confirmTarget ? displayName(confirmTarget) : ""}” the default?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget
                ? `It becomes the agreement ${DEFAULT_SENT_FOR[confirmTarget.category]}.${
                    currentDefault ? ` “${displayName(currentDefault)}” stays in your templates, no longer the default.` : ""
                  } Agreements already sent do not change.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = confirmTarget;
                setConfirmDefault(null);
                if (target) void makeDefault(target);
              }}
            >
              Set as default
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirmDelete ? displayName(confirmDelete) : ""}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The template is removed for good. Agreements already sent with it do not change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = confirmDelete;
                setConfirmDelete(null);
                if (target) void deleteTemplate(target);
              }}
            >
              Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TemplatePreviewDialogV2
        template={previewing}
        previewData={previewData}
        onOpenChange={(open) => !open && setPreviewing(null)}
        onEdit={
          canEdit
            ? (t) => {
                setPreviewing(null);
                openEditor(t);
              }
            : undefined
        }
      />

      {editing && (
        <AgreementEditorV2
          key={editing.id}
          open
          onClose={() => {
            discardUnsavedNew();
            setEditing(null);
          }}
          mode="template"
          trax
          isDefaultTemplate={editing.isDefault}
          nameEditable
          initialName={editing.name}
          initialContent={editing.content}
          previewData={previewData}
          saveLabel="Save template"
          onSave={saveTemplate}
        />
      )}
    </section>
  );
}
