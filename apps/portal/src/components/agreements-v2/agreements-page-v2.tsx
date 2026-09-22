"use client";

/**
 * Agreements v2: the whole `/agreements` tab for `useV2("agreements")`
 * tenants. The v1 page hands off to this in one branch and is otherwise
 * untouched (V2_PLAN §3), so retiring this is deleting that branch and the
 * Agreements v2 files (the older `AgreementsTableV2` stays: the v1 page's
 * chrome branch mounts it).
 *
 * Top to bottom (D1, D2, D15–D18):
 *   - the header, with the one labelled button: Send agreement (an individual
 *     agreement, D12);
 *   - the hero row, which turns over to the filter panel;
 *   - the templates, on this tab rather than in Settings (`?view=templates`
 *     scrolls to them, and the "Create your template" card opens their create);
 *   - every agreement sent, rental and individual, newest first.
 *
 * WHO MAY DO WHAT (D19). Sending and resending are writes: `canEdit("agreements")`,
 * the portal's write gate, which is false for a manager (the tab is `viewOnly`
 * in permissions.ts, so a manager can only ever hold viewer access to it) and
 * for the read-only `viewer` role. Resend also needs a name and an email on the
 * row, exactly as the rental's Agreement stage requires before it sends.
 * Creating a template keeps its own grant, `canEditSettings("templates")`.
 *
 * The page's network calls live here and in the view dialog, never in the v1
 * page (the spine tests count that file's fetches).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileSignature, Send } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
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
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useForcedEmptyState } from "@/hooks/use-forced-empty-state";
import { useIsLean } from "@/lib/lean-context";
import { useIntegrationBilling } from "@/lib/integration-billing/hooks";
import { usePageSearch } from "@/components/shared/layout/page-search-slot";
import { OverviewFlip } from "@/components/shared/layout/overview-flip";
import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2 } from "@/components/shared/header-icon-button-v2";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { SettingsLoadError, SettingsNoMatch } from "@/components/settings-v2/section-states";
import { useAgreementsListV2 } from "@/hooks/use-agreements-list-v2";
import { resendAgreementV2, syncAgreementsV2 } from "@/lib/agreements-v2/api-client";
import { toStatusV2 } from "@/lib/agreements-v2/status";
import type { AgreementRowV2 } from "@/lib/agreements-v2/types";
import {
  EMPTY_AGREEMENT_FILTERS_V2,
  agreementsNewestFirstV2,
  agreementsResultKeyV2,
  countActiveAgreementFilters,
  filterAgreementsV2,
  type AgreementListFiltersV2,
} from "@/lib/agreements-v2/list-filters";
import { AgreementsOverviewV2 } from "@/components/agreements-v2/agreements-overview-v2";
import { AgreementsFilterPanelV2 } from "@/components/agreements-v2/agreements-filter-panel-v2";
import { AgreementsListTableV2 } from "@/components/agreements-v2/agreements-table-v2";
import {
  AgreementViewDialogV2,
  downloadSignedAgreementV2,
} from "@/components/agreements-v2/agreement-view-dialog-v2";
import { SendAgreementDialogV2 } from "@/components/agreements-v2/send-agreement-dialog-v2";
import { AgreementTemplatesSectionV2 } from "@/components/agreements-v2/templates-section-v2";

/** The page's white surfaces carry the ui-v2 Card's hairline ring (not `border-border/*`, invalid in v2 dark). */
const SURFACE = "rounded-2xl bg-card ring-1 ring-foreground/5 dark:ring-foreground/10";

/** The rental Agreement stage's own message for BoldSign's hourly cap, which arrives as prose. */
const RATE_LIMITED = /quota exceeded|rate limit/i;

export function AgreementsPageV2() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const { canEdit, canEditSettings } = useManagerPermissions();
  const canSend = canEdit("agreements");
  // Integration billing (northwind): e-signing is on the plan — no credits to mention.
  const creditsSentence = useIntegrationBilling() ? "" : " Sending uses e-sign credits.";
  const canCreateTemplate = canEditSettings("templates");

  const list = useAgreementsListV2();
  const { rows: allRows, error, refetch } = list;
  // The list's query waits for the tenant, and a waiting query is not
  // "loading" to React Query. Without the tenant there is no answer yet, so
  // the page must not say "no agreements" in the meantime.
  const isLoading = list.isLoading || !tenant?.id;

  // The /dev preview switch for the teaching state (lib/dev-overrides.ts),
  // inert outside development and kept inside the lean gate like every page.
  const devForceEmpty = useForcedEmptyState("agreements");
  const devForceEmptyAgreements = useIsLean() && devForceEmpty;

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<AgreementListFiltersV2>(EMPTY_AGREEMENT_FILTERS_V2);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [viewRow, setViewRow] = useState<AgreementRowV2 | null>(null);
  const [confirmRow, setConfirmRow] = useState<AgreementRowV2 | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  /**
   * Once per visit, ask the signing service where every individual agreement
   * still out for signature has got to, then read the list again. Individual
   * agreements have no webhook of their own (D4), so this is how a signature
   * reaches the list. A failure changes nothing on screen.
   *
   * It waits for the tenant: `refetch` runs the list's read even while that
   * query is disabled, and without a tenant it has nothing to filter on.
   */
  const synced = useRef(false);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const tenantId = tenant?.id;
  useEffect(() => {
    if (!tenantId || synced.current) return;
    synced.current = true;
    syncAgreementsV2()
      .catch(() => undefined)
      .then(() => refetchRef.current());
  }, [tenantId]);

  const activeCount = countActiveAgreementFilters(filters);
  const filtered = activeCount > 0 || search.trim() !== "";
  const visibleRows = useMemo(
    () => agreementsNewestFirstV2(filterAgreementsV2(allRows ?? [], filters, search)),
    [allRows, filters, search],
  );
  const resetKey = agreementsResultKeyV2(tenant?.id, filters, search);

  usePageSearch({
    placeholder: "Search agreements",
    value: search,
    onChange: setSearch,
    filters: { open: filtersOpen, onOpenChange: setFiltersOpen, activeCount },
  });

  const clearFilters = () => {
    setFilters(EMPTY_AGREEMENT_FILTERS_V2);
    setSearch("");
  };

  /* ── the templates section ─────────────────────────────────────────── */

  // `?view=templates` (the v2 redirect from Settings, and the card below) is
  // handled by AgreementTemplatesSectionV2 itself: it scrolls once its cards
  // are in, and not again when `new` comes off the URL. The page used to
  // scroll too, and re-scrolled on that change, so the two fought.
  const paramsKey = searchParams.toString();

  /** "Create your template": the templates section opens its create on `new=1`. */
  const openTemplateCreate = () => {
    const params = new URLSearchParams(paramsKey);
    params.set("view", "templates");
    params.set("new", "1");
    router.replace(`/agreements?${params.toString()}`, { scroll: false });
  };

  /* ── row actions ───────────────────────────────────────────────────── */

  const download = useCallback(async (row: AgreementRowV2) => {
    setDownloadingId(row.id);
    try {
      await downloadSignedAgreementV2(row);
      toast({ title: "Signed agreement downloaded" });
    } catch (e: any) {
      toast({ title: "Could not download it", description: e?.message, variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  }, []);

  /**
   * Resend (D17). A RENTAL row re-posts `/api/esign` with exactly the payload
   * the rental's Agreement stage sends, which mints a new document and voids
   * the one before: today's rule, unchanged. An extension agreement is never
   * re-sent from here, because the list does not hold its period and the route
   * would issue it as the original. An INDIVIDUAL row gets a new row of its own
   * and the old one is left alone.
   */
  const resend = async (row: AgreementRowV2) => {
    if (!tenant?.id || !row.customerEmail || !row.customerName) return;
    setResendingId(row.id);
    try {
      if (row.kind === "individual") {
        const result = await resendAgreementV2(row.id, tenant.id);
        if (toStatusV2(result.status) === "failed") {
          toast({
            title: "Not sent",
            description:
              result.status === "credit_failed"
                ? "No e-sign credits left. Top up, then resend it."
                : "The signing service turned it down. It is in the list as Failed.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Agreement resent", description: `${row.customerName} has been emailed a new copy to sign.` });
        }
        return;
      }

      const { data: agreement, error: lookupError } = await supabase
        .from("rental_agreements")
        .select("agreement_type")
        .eq("id", row.id)
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!agreement || !row.rentalId) throw new Error("This agreement could not be found.");
      if (agreement.agreement_type === "extension") {
        toast({
          title: "Resend it from the rental",
          description: "An extension agreement carries the extension's dates, so it is re-issued from the rental itself.",
        });
        return;
      }

      const response = await fetch("/api/esign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rentalId: row.rentalId,
          customerEmail: row.customerEmail,
          customerName: row.customerName,
          tenantId: tenant.id,
          agreementType: "original",
        }),
      });
      const data = await response.json().catch(() => ({}) as Record<string, any>);
      if (data?.ok) {
        toast({ title: "Agreement resent", description: `${row.customerName} has been emailed a new copy to sign.` });
      } else if (data?.error === "insufficient_credits") {
        toast({ title: "No e-sign credits left", description: "Top up before resending this agreement.", variant: "destructive" });
      } else {
        const detail = String(data?.detail || data?.error || "The agreement could not be sent.");
        toast({
          title: RATE_LIMITED.test(detail) ? "Rate limit reached" : "Not sent",
          description: RATE_LIMITED.test(detail) ? "Up to 50 agreements can be sent an hour. Try again in a few minutes." : detail,
          variant: "destructive",
        });
      }
    } catch (e: any) {
      toast({ title: "Not sent", description: e?.message ?? "The agreement could not be sent.", variant: "destructive" });
    } finally {
      setResendingId(null);
      await refetch();
    }
  };

  const requestResend = (row: AgreementRowV2) => {
    setViewRow(null);
    setConfirmRow(row);
  };

  /* ── the page ──────────────────────────────────────────────────────── */

  const noAgreements = !isLoading && !error && ((allRows?.length ?? 0) === 0 || devForceEmptyAgreements);

  return (
    <div className="container mx-auto space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">Agreements</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Send agreements for signature, and follow every one to its signed copy.
          </p>
        </div>
        <div className={`flex items-center gap-2 ${HEADER_ACTIONS_V2}`}>
          {canSend && (
            <Button
              onClick={() => setSendOpen(true)}
              className={`flex-1 bg-gradient-primary text-white transition-all duration-200 hover:opacity-90 sm:flex-none ${HEADER_PRIMARY_V2}`}
            >
              <Send className="size-4" />
              Send agreement
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="h-[220px] animate-pulse rounded-2xl bg-muted" aria-hidden />
      ) : (
        <OverviewFlip
          flipped={filtersOpen}
          onFlipBack={() => setFiltersOpen(false)}
          front={
            <AgreementsOverviewV2
              rows={visibleRows}
              filtered={filtered}
              onCreateTemplate={openTemplateCreate}
              canCreateTemplate={canCreateTemplate}
            />
          }
          back={
            <AgreementsFilterPanelV2
              filters={filters}
              onChange={setFilters}
              onClear={() => setFilters(EMPTY_AGREEMENT_FILTERS_V2)}
              onClose={() => setFiltersOpen(false)}
            />
          }
        />
      )}

      <section id="agreement-templates" className="scroll-mt-24">
        <AgreementTemplatesSectionV2 />
      </section>

      <section className="space-y-3" aria-labelledby="agreements-sent-heading">
        <div>
          <h2 id="agreements-sent-heading" className="font-heading text-lg font-semibold tracking-tight text-foreground">
            Sent agreements
          </h2>
          <p className="text-sm text-muted-foreground">
            Rental agreements from the rental flow, and the ones you send from here.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-3" role="status" aria-label="Loading agreements">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : error && !(allRows?.length) ? (
          <SettingsLoadError thing="your agreements" error={error} onRetry={refetch} />
        ) : noAgreements ? (
          <TeachingEmptyState
            icon={FileSignature}
            headline="Every agreement you send, in one place"
            body="Send an agreement to anyone for e-signature, with or without a rental. Agreements sent from a rental arrive here too, so you can see at a glance who has signed and who has not."
            points={[
              "One recipient, with CC and a message of your own",
              "Start from your default template, or edit a copy just for this one",
              "Download the signed PDF the moment it is signed",
            ]}
            primaryAction={canSend ? { label: "Send agreement", onClick: () => setSendOpen(true), icon: Send } : undefined}
            explainerId="agreements.first-agreement"
          />
        ) : visibleRows.length === 0 ? (
          <div className={SURFACE}>
            <SettingsNoMatch query={search} noun="agreements" filtersActive={activeCount > 0} onClear={clearFilters} />
          </div>
        ) : (
          <>
          {/* A refetch that failed over rows already on screen: say so, keep the rows. */}
          {error ? <SettingsLoadError variant="inline" thing="your agreements" error={error} onRetry={refetch} /> : null}
          <AgreementsListTableV2
            rows={visibleRows}
            resetKey={resetKey}
            canResend={canSend}
            viewingId={null}
            downloadingId={downloadingId}
            resendingId={resendingId}
            onView={setViewRow}
            onDownload={download}
            onResend={requestResend}
          />
          </>
        )}
      </section>

      <AgreementViewDialogV2
        row={viewRow}
        open={!!viewRow}
        onOpenChange={(open) => {
          if (!open) setViewRow(null);
        }}
        onDownload={download}
        downloading={!!viewRow && downloadingId === viewRow.id}
        onResend={canSend ? requestResend : undefined}
      />

      {/* A resend is a new, legally binding document and spends e-sign credits, so it asks first. */}
      <AlertDialog open={!!confirmRow} onOpenChange={(open) => !open && setConfirmRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resend this agreement?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRow?.kind === "rental"
                ? `A new copy goes to ${confirmRow?.customerName} (${confirmRow?.customerEmail}) to sign, and any earlier copy still waiting for a signature is cancelled, so only the new one can be signed. It is built from your current default template and the rental as it stands now.${creditsSentence}`
                : `A new copy goes to ${confirmRow?.customerName} (${confirmRow?.customerEmail}) to sign, as a new row in this list. The one sent before is left as it is, word for word.${creditsSentence}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const row = confirmRow;
                setConfirmRow(null);
                if (row) void resend(row);
              }}
            >
              Resend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SendAgreementDialogV2 open={sendOpen} onOpenChange={setSendOpen} onSent={() => void refetch()} />
    </div>
  );
}
