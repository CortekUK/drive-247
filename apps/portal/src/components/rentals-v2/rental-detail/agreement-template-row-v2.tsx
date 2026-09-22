"use client";

/**
 * Agreements v2 in the rental flow (build-spec D14; transcript 20:37–21:54):
 * the Agreement stage's "Selected template" row.
 *
 * ── what is pre-selected, and why it has to be exact ─────────────────────────
 *
 * `/api/esign` picks the template on the server: the tenant's ACTIVE row for
 * the rental's category, falling back to the active standard one, falling back
 * to its built-in text. The row pre-selects exactly that template, derived the
 * way the route derives it (`rentalTemplateCategoryV2`, then
 * `defaultTemplateFor`). If the two ever disagreed, the row would name one
 * contract and the customer would be sent another.
 *
 * ── what travels with a send ─────────────────────────────────────────────────
 *
 * The route learnt ONE optional field, `templateId`. It is sent only when the
 * operator picked a template other than the one the route would pick by
 * itself (`templateIdToSendV2`), so a send with the default selected is the
 * very request the stage made before this row existed.
 *
 * ── Preview and Edit ─────────────────────────────────────────────────────────
 *
 * Preview is filled with THIS rental's details through the pipeline the portal
 * already previews a rental's agreement with (occurrence-config-dialog.tsx:
 * `buildTemplateData` + `injectAgreementClauses` + `replaceVariables`, the last
 * through `renderAgreementHtml`), plus the mileage the send path resolves.
 * Edit opens the half-and-half editor, and "Save to template" updates that
 * template for this tenant (Ghulam, 21:44): every later agreement that uses it
 * changes too, which the editor says in its own header. The editor's preview
 * pane is handed the Preview dialog's own step (`rentalPreviewTransformV2`)
 * and banner, so Edit and Preview show the same document.
 *
 * ── blank templates ──────────────────────────────────────────────────────────
 *
 * A template with no wording ("No wording yet") is never offered by Change and
 * never named in a send (`pickableTemplatesV2`): /api/esign refuses one with a
 * 400, and before it did, the customer was sent the built-in text instead.
 */

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, FileText, Loader2, PencilLine, Repeat } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { TemplatePickerV2 } from "@/components/agreements-v2/template-picker-v2";
import { AgreementPreviewV2 } from "@/components/agreements-v2/agreement-preview-v2";
import { AgreementEditorV2 } from "@/components/agreements-v2/editor/agreement-editor-v2";
import {
  defaultTemplateFor,
  useAgreementTemplateMutationsV2,
  useAgreementTemplatesV2,
} from "@/hooks/use-agreement-templates-v2";
import { buildTemplateData } from "@/lib/template-variables";
import { injectAgreementClauses, type InjectionOptions } from "@/lib/agreement-injection";
import { BONZAH_INSURANCE_ADDENDUM_HTML } from "@/lib/bonzah-addendum";
import { buildRentalTimeFacts } from "@/lib/agreement-datetime";
import { ensureSignatureTag, escapeHtml, renderAgreementHtml } from "@/lib/agreements-v2/render";
import { isBlankHtml } from "@/components/settings-v2/message-rules";
import type { AgreementTemplateCategoryV2 } from "@/lib/agreements-v2/types";
import type { RentalRow } from "./use-rental-detail-v2";
import { listCls, Pill, Section } from "./_kit";

/* ══════════════════════════════════════════════════════════════════════════
   The route's own choice, mirrored
   ══════════════════════════════════════════════════════════════════════════ */

export type RentalAgreementTypeV2 = "original" | "extension" | "payg" | "installment";

/**
 * The template category `/api/esign` sends for (route.ts `templateCategory`):
 * an explicit extension / installment / payg type wins; otherwise installment
 * when the rental is flagged for a plan AND an active or pending plan exists,
 * pay-as-you-go when the rental is PAYG, else standard.
 */
export function rentalTemplateCategoryV2(input: {
  agreementType?: RentalAgreementTypeV2;
  hasInstallmentPlan: boolean;
  hasLiveInstallmentPlan: boolean;
  isPayAsYouGo: boolean;
}): AgreementTemplateCategoryV2 {
  if (input.agreementType === "extension") return "extension";
  if (input.agreementType === "installment") return "installment";
  if (input.agreementType === "payg") return "payg";
  if (input.hasInstallmentPlan && input.hasLiveInstallmentPlan) return "installment";
  return input.isPayAsYouGo ? "payg" : "standard";
}

/** The banner `/api/esign` draws across the top of the PDF, word for word. */
export function agreementBannerV2(agreementType?: RentalAgreementTypeV2, extensionNumber?: number): string {
  if (agreementType === "extension" && extensionNumber) return `EXTENSION AGREEMENT #${extensionNumber}`;
  if (agreementType === "payg") return "PAYG RENTAL AGREEMENT";
  if (agreementType === "installment") return "INSTALLMENT RENTAL AGREEMENT";
  return "ORIGINAL RENTAL AGREEMENT";
}

/**
 * The `templateId` a send carries: the selected template's id when it is NOT
 * the one the route would pick by itself, otherwise nothing at all.
 */
export function templateIdToSendV2(selectedId: string | null, routeChoiceId: string | null): string | undefined {
  return selectedId && selectedId !== routeChoiceId ? selectedId : undefined;
}

/**
 * The templates Change offers: every one that has wording. A blank one (the
 * rule templates-section-v2.tsx marks "No wording yet" with) is left out,
 * because /api/esign refuses to send it.
 */
export function pickableTemplatesV2<T extends { content: string | null }>(templates: readonly T[]): T[] {
  return templates.filter((t) => !isBlankHtml(t.content));
}

/**
 * Which template the stage will send, and whether the send has to name it.
 *
 * `enabled` is `useV2("agreements")`. Off, nothing is ever named and the stage
 * sends exactly what it did before.
 */
export function useRentalTemplateChoiceV2(rental: RentalRow, enabled: boolean) {
  const { tenant } = useTenant();
  const { templates, isLoading: templatesLoading, error } = useAgreementTemplatesV2();

  // The route reads the plan only when the rental is flagged for one, and only
  // an active or pending plan counts.
  const planQuery = useQuery({
    queryKey: ["rental-live-installment-plan-v2", rental.id, tenant?.id],
    queryFn: async () => {
      const { data, error: planError } = await supabase
        .from("installment_plans")
        .select("id")
        .eq("rental_id", rental.id)
        .eq("tenant_id", tenant!.id)
        .in("status", ["active", "pending"])
        .limit(1);
      if (planError) throw planError;
      return (data ?? []).length > 0;
    },
    enabled: enabled && !!tenant?.id && !!rental.has_installment_plan,
  });

  const category = rentalTemplateCategoryV2({
    agreementType: "original",
    hasInstallmentPlan: !!rental.has_installment_plan,
    hasLiveInstallmentPlan: planQuery.data === true,
    isPayAsYouGo: !!rental.is_pay_as_you_go,
  });

  const routeChoice = useMemo(() => defaultTemplateFor(templates, category), [templates, category]);

  const pickable = useMemo(() => pickableTemplatesV2(templates), [templates]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  // Only a template with wording can be picked; one emptied since falls back
  // to the route's choice, which is then sent without a templateId.
  const picked = pickedId ? (pickable.find((t) => t.id === pickedId) ?? null) : null;
  const selected = picked ?? routeChoice;
  const reset = useCallback(() => setPickedId(null), []);
  const ready = !templatesLoading && !planQuery.isLoading && !error && !planQuery.error;

  return {
    templates,
    /** `templates` without the blank ones: what Change offers. */
    pickable,
    category,
    routeChoice,
    selected,
    /**
     * Until both reads settle, the route's choice is not known, so nothing can
     * be picked: a pick compared against the wrong default would be sent as
     * "no change" and the route would send its own.
     */
    ready,
    error: error ?? planQuery.error ?? null,
    pick: setPickedId,
    reset,
    templateIdToSend:
      enabled && ready && picked ? templateIdToSendV2(picked.id, routeChoice?.id ?? null) : undefined,
    banner: agreementBannerV2("original"),
  };
}

export type RentalTemplateChoiceV2 = ReturnType<typeof useRentalTemplateChoiceV2>;

/* ══════════════════════════════════════════════════════════════════════════
   The rental's real data, for Preview and Edit
   ══════════════════════════════════════════════════════════════════════════ */

/** The customer columns occurrence-config-dialog.tsx fills the same preview from. */
const PREVIEW_CUSTOMER_COLUMNS =
  "id, name, email, phone, customer_type, date_of_birth, address, address_street, address_city, address_state, address_zip, license_number, license_state, id_number, nok_full_name, nok_phone, is_gig_driver";
/** The vehicle columns `buildTemplateData` reads. */
const PREVIEW_VEHICLE_COLUMNS = "id, reg, make, model, year, color, vin, fuel_type, daily_rent, weekly_rent, monthly_rent";
/** The company columns /api/esign reads for the company variables. */
const PREVIEW_COMPANY_COLUMNS = "company_name, contact_email, contact_phone, phone, address";

type Row = Record<string, any>;

function useRentalPreviewSourcesV2(rental: RentalRow, enabled: boolean) {
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  return useQuery({
    queryKey: ["rental-agreement-preview-sources-v2", rental.id, tenantId],
    queryFn: async () => {
      const none = Promise.resolve({ data: null, error: null });
      const [customer, vehicle, company] = await Promise.all([
        rental.customer_id
          ? supabase
              .from("customers")
              .select(PREVIEW_CUSTOMER_COLUMNS)
              .eq("id", rental.customer_id)
              .eq("tenant_id", tenantId!)
              .maybeSingle()
          : none,
        rental.vehicle_id
          ? supabase
              .from("vehicles")
              .select(PREVIEW_VEHICLE_COLUMNS)
              .eq("id", rental.vehicle_id)
              .eq("tenant_id", tenantId!)
              .maybeSingle()
          : none,
        supabase.from("tenants").select(PREVIEW_COMPANY_COLUMNS).eq("id", tenantId!).maybeSingle(),
      ]);
      for (const result of [customer, vehicle, company]) if (result.error) throw result.error;
      return {
        customer: (customer.data ?? null) as Row | null,
        vehicle: (vehicle.data ?? null) as Row | null,
        company: (company.data ?? null) as Row | null,
      };
    },
    enabled: enabled && !!tenantId,
    staleTime: 60_000,
  });
}

/**
 * `buildTemplateData` over the rental, with what the send path adds on top:
 * the mileage it resolves, the company phone it falls back to, and the Bonzah
 * addendum for a Bonzah tenant. Plain-text values are escaped, because they
 * are inserted as HTML; the addendum IS HTML and goes in as it is.
 */
export function buildRentalPreviewDataV2(input: {
  rental: Row;
  customer: Row | null;
  vehicle: Row | null;
  tenant: Row;
  mileage: { allowance: string; excessRate: string };
}): Record<string, string> {
  const { rental, customer, vehicle, tenant, mileage } = input;
  const data = buildTemplateData(
    rental ?? {},
    customer ?? rental?.customers ?? {},
    vehicle ?? rental?.vehicles ?? {},
    tenant ?? {},
    tenant?.currency_code || "USD"
  );
  const text: Record<string, string> = {
    ...data,
    company_phone: tenant?.contact_phone || tenant?.phone || "",
    mileage_allowance: mileage.allowance,
    excess_mileage_rate: mileage.excessRate,
    vehicle_allowed_mileage: mileage.allowance,
  };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(text)) out[key] = escapeHtml(value ?? "");
  out.bonzah_insurance_addendum = tenant?.integration_bonzah === true ? BONZAH_INSURANCE_ADDENDUM_HTML : "";
  // Worked out on the server from the deposit settings; stated in the caption.
  out.deposit_terms_clause = "";
  return out;
}

/** The clauses the send path splices in, for this rental. */
export function rentalInjectionV2(input: { rental: Row; tenant: Row; hasMileage: boolean }): InjectionOptions {
  return {
    hasMileage: input.hasMileage,
    // The tenant's T&Cs are read on the server when it sends; see the caption.
    hasTerms: false,
    hasBonzahAddendum: input.tenant?.integration_bonzah === true,
    hasDepositClause: false,
    hasHandoverTimes: buildRentalTimeFacts(input.rental as never, input.tenant as never, []).hasAnyTimes,
  };
}

/**
 * The step both Preview and Edit's preview pane run on the template BEFORE its
 * variables are filled: the clauses the send path splices in, then the
 * signature block when the template has none. Handed to the editor as
 * `previewTransform`, so its preview is this dialog's document, not the bare
 * template.
 */
export function rentalPreviewTransformV2(injection: InjectionOptions): (html: string) => string {
  return (html) => ensureSignatureTag(injectAgreementClauses(html ?? "", injection));
}

/**
 * The document the preview shows: the template, with this rental's details in
 * it. Exactly what the editor renders with `previewTransform` set to
 * `rentalPreviewTransformV2(injection)`: renderAgreementHtml, preview mode.
 */
export function renderRentalAgreementPreviewV2(
  content: string,
  data: Record<string, string>,
  injection: InjectionOptions
): string {
  return renderAgreementHtml(rentalPreviewTransformV2(injection)(content ?? ""), data, { mode: "preview" });
}

/* ══════════════════════════════════════════════════════════════════════════
   The row
   ══════════════════════════════════════════════════════════════════════════ */

const CATEGORY_NOUN: Record<AgreementTemplateCategoryV2, string> = {
  standard: "rentals",
  payg: "Pay As You Go rentals",
  installment: "rentals on an installment plan",
  extension: "extensions",
};

export interface AgreementTemplateRowV2Props {
  rental: RentalRow;
  choice: RentalTemplateChoiceV2;
  /** The mileage the stage already resolved with the send path's resolver. */
  mileage: { allowance: string; excessRate: string; isUnspecified: boolean };
  /** `canEditSettings("templates")`: the grant template editing already has. */
  canEdit: boolean;
  /** A send is in flight: the selection holds still until it lands. */
  busy?: boolean;
}

export function AgreementTemplateRowV2({ rental, choice, mileage, canEdit, busy }: AgreementTemplateRowV2Props) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const { update } = useAgreementTemplateMutationsV2();

  const [picking, setPicking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [editing, setEditing] = useState(false);

  const sources = useRentalPreviewSourcesV2(rental, previewing || editing);

  const { selected, routeChoice, pickable, category, ready } = choice;
  const isRouteChoice = !!selected && selected.id === routeChoice?.id;

  const tenantRow = useMemo(
    () => ({ ...(tenant ?? {}), ...(sources.data?.company ?? {}) }) as Row,
    [tenant, sources.data?.company]
  );

  const previewData = useMemo(
    () =>
      buildRentalPreviewDataV2({
        rental,
        customer: sources.data?.customer ?? null,
        vehicle: sources.data?.vehicle ?? null,
        tenant: tenantRow,
        mileage,
      }),
    [rental, sources.data?.customer, sources.data?.vehicle, tenantRow, mileage]
  );

  const injection = useMemo(
    () => rentalInjectionV2({ rental, tenant: tenantRow, hasMileage: !mileage.isUnspecified }),
    [rental, tenantRow, mileage.isUnspecified]
  );
  const previewTransform = useMemo(() => rentalPreviewTransformV2(injection), [injection]);

  const previewHtml = useMemo(
    () => (selected && previewing ? renderRentalAgreementPreviewV2(selected.content, previewData, injection) : ""),
    [selected, previewing, previewData, injection]
  );

  const saveToTemplate = useCallback(
    async (content: string) => {
      if (!selected) return;
      await update(selected.id, { content });
      // The editor closes itself once this resolves, and stays open on a throw.
      toast({ title: "Template saved", description: `“${selected.name || "Untitled template"}” is updated for every agreement that uses it.` });
    },
    [selected, update, toast]
  );

  const name = selected ? selected.name || "Untitled template" : "The built-in agreement";
  const detail = !selected
    ? "You have no agreement template yet, so the built-in agreement is sent."
    : !isRouteChoice
      ? "Chosen for this rental's next send, instead of your default."
      : selected.category === category
        ? `Your default for ${CATEGORY_NOUN[category]}. This is what goes out unless you change it.`
        : `Your default for rentals. It goes out because you have no default for ${CATEGORY_NOUN[category]}.`;

  return (
    <Section
      title="Selected template"
      description="Whatever your default template is, that is what a rental sends. Change it here for this rental."
    >
      <div className={listCls}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary-light text-primary">
            <FileText className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            {choice.error ? (
              <p className="text-sm text-muted-foreground">
                Your templates could not be read, so the default is sent as usual.
              </p>
            ) : !ready ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Reading your templates…
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium" data-testid="selected-template-name">
                    {name}
                  </p>
                  {selected?.isDefault && <Pill tone="primary">Default</Pill>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {detail}
                  {selected && !isRouteChoice && routeChoice && (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={choice.reset}
                        disabled={busy}
                        className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline disabled:cursor-default disabled:opacity-50"
                      >
                        Use the default
                      </button>
                    </>
                  )}
                </p>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPicking(true)}
              disabled={!ready || busy || pickable.length === 0}
            >
              <Repeat />
              Change
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPreviewing(true)} disabled={!ready || !selected}>
              <Eye />
              Preview
            </Button>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={!ready || busy || !selected}>
                <PencilLine />
                Edit
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Change ──────────────────────────────────────────────────────── */}
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose the template</DialogTitle>
            <DialogDescription>The next agreement for this rental is sent from the template you pick.</DialogDescription>
          </DialogHeader>
          <TemplatePickerV2
            templates={pickable}
            selectedId={selected?.id ?? null}
            onSelect={(id) => {
              choice.pick(id === routeChoice?.id ? null : id);
              setPicking(false);
            }}
            className="min-h-0 flex-1"
          />
        </DialogContent>
      </Dialog>

      {/* ── Preview ─────────────────────────────────────────────────────── */}
      <Dialog open={previewing} onOpenChange={setPreviewing}>
        <DialogContent className="flex h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="shrink-0 gap-1 border-b px-6 py-4 pr-14">
            <DialogTitle className="truncate text-lg">{name}</DialogTitle>
            <DialogDescription>
              Filled in with this rental&rsquo;s details. When it is sent, your terms and conditions and any
              security-deposit clause are added as well.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto bg-muted p-6">
            {sources.isLoading ? (
              <div className="flex h-full items-center justify-center" role="status">
                <Loader2 className="size-7 animate-spin text-primary" />
              </div>
            ) : (
              <AgreementPreviewV2 html={previewHtml} banner={choice.banner} className="mx-auto" />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit ────────────────────────────────────────────────────────── */}
      {editing && selected && (
        <AgreementEditorV2
          open
          onClose={() => setEditing(false)}
          mode="rental-template"
          saveLabel="Save to template"
          initialName={selected.name}
          initialContent={selected.content}
          previewData={previewData}
          previewTransform={previewTransform}
          previewBanner={choice.banner}
          onSave={(content: string) => saveToTemplate(content)}
          nameEditable={false}
        />
      )}
    </Section>
  );
}

export default AgreementTemplateRowV2;
