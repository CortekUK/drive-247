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
import { Check, FileText, Loader2, Pencil, Search, Star, Trash2, X } from "lucide-react";
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
import { buildIndividualData } from "@/lib/agreements-v2/render";
import type { AgreementTemplateCategoryV2, AgreementTemplateV2 } from "@/lib/agreements-v2/types";
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
/* The section                                                                 */
/* -------------------------------------------------------------------------- */

export function AgreementTemplatesSectionV2({ id }: { id?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const { canEditSettings, isLoading: permissionsLoading } = useManagerPermissions();
  const canEdit = canEditSettings("templates");

  const { templates, isLoading: templatesLoading, error, refetch } = useAgreementTemplatesV2();
  const { create, update, setDefault, remove } = useAgreementTemplateMutationsV2();
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
  const [confirmDefault, setConfirmDefault] = useState<AgreementTemplateV2 | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AgreementTemplateV2 | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const visible = useMemo(() => matchTemplatesByNameV2(templates, query), [templates, query]);

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
    if (view !== "templates") {
      scrolledFor.current = null;
      return;
    }
    // Once the cards are in, so the section does not move after the scroll.
    if (loading || scrolledFor.current === scrollKey) return;
    scrolledFor.current = scrollKey;
    rootRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [view, loading, scrollKey]);

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
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Agreement templates">
        {visible.map((template) => (
          <TemplateCardV2
            key={template.id}
            template={template}
            canEdit={canEdit}
            settingDefault={settingDefaultId === template.id}
            defaultBusy={settingDefaultId !== null}
            onEdit={() => openEditor(template)}
            onSetDefault={() => setConfirmDefault(template)}
            deleting={deletingId === template.id}
            deleteBusy={deletingId !== null}
            onDelete={() => setConfirmDelete(template)}
          />
        ))}
      </ul>
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
        <div className="min-w-0">
          <h2 id={headingId} className="font-heading text-lg font-semibold tracking-tight text-foreground">
            Templates
          </h2>
          <p className="text-sm text-muted-foreground">{TEMPLATES_SECTION_DESCRIPTION}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {!canEdit && !permissionsLoading && <SettingsReadOnlyNotice />}
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

      {editing && (
        <AgreementEditorV2
          key={editing.id}
          open
          onClose={() => {
            discardUnsavedNew();
            setEditing(null);
          }}
          mode="template"
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
