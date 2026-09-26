"use client";

/**
 * Fines — "Fines stay" (spec §7). The fines list, inside Finances.
 *
 * Built from the fines tab's OWN parts, not a copy of its money code:
 *   - `useFinesData` reads the rows (the same query key the fines tab uses, so
 *     every invalidation the fines dialogs already fire refreshes this list);
 *   - `BulkActionBar` charges, waives and emails a toll statement for the
 *     selected fines — the fines tab's own bulk actions, unchanged;
 *   - `AddFineDialog` adds one.
 *   - the row menu's Record payment and Waive fine are the fines tab's own
 *     row actions (`components/fines/use-fine-row-actions.tsx`, lifted out of
 *     `fines/page.tsx` so both screens run one copy). The page hosts the hook
 *     and hands the two calls in, so the side panel offers the same ones.
 * A fine opens in the side panel; its record (`/fines/[id]`, untouched) is one
 * click from there.
 *
 * With a `scope` (a rental's or a customer's own Finances, `ScopedFinances`)
 * the rows are that rental's or customer's fines, read in full by
 * `useScopedFinanceFines` — the same rows, rules and actions, narrowed.
 * Without one it is the page's list, read exactly as before (the page does not
 * read fines at all until this view is opened).
 */

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Ban, DollarSign, FileText, PanelRightOpen, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { Button } from "@/components/ui-v2/button";
import { Checkbox } from "@/components/ui-v2/checkbox";
import {
  LIST_CLASSES,
  LIST_TONES,
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from "@/components/shared/list-table-v2";
import { BulkActionBar } from "@/components/fines/bulk-action-bar";
import { useFinesData, type EnhancedFine } from "@/hooks/use-fines-data";
import { useScopedFinanceFines } from "@/hooks/use-finances-fines";
import type { FinanceScope } from "@/lib/finances/types";
import type { FineFilterState } from "@/components/fines/fine-filters";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/payment-plans-ui/format";
import { toCents } from "@/lib/finances/balance";
import {
  SettingsEmptyState,
  SettingsLoadError,
  SettingsNoMatch,
  SettingsSectionSkeleton,
} from "@/components/settings-v2/section-states";
import { fineCanCharge, fineCanWaive } from "@/components/fines/use-fine-row-actions";
import { fineStatusWords, formatListDay } from "./finance-words";
import { MobileFact, MobileRows, RowMenuTrigger } from "./finance-list-bits";

const EMPTY: EnhancedFine[] = [];

/** The fines list's filters for the shared bar's search and status. */
export function fineFiltersOf(q: string, status: string | null): FineFilterState {
  const quick = status === "overdue" ? "overdue" : status === "due_next_7" ? "due-next-7" : undefined;
  return {
    status: status && !quick ? [status] : [],
    vehicleSearch: "",
    customerSearch: "",
    search: q.trim(),
    quickFilter: quick,
  };
}

/**
 * The fines list, newest added first, up to 1,000 rows — exactly the fines
 * tab's v2 arguments, so the same query key and the same invalidations.
 */
export function useFinanceFines(q: string, status: string | null) {
  return useFinesData({
    filters: fineFiltersOf(q, status),
    sortBy: "created_at",
    sortOrder: "desc",
    page: 1,
    pageSize: 1000,
  });
}

export function fineReference(fine: Pick<EnhancedFine, "reference_no" | "id">): string {
  return fine.reference_no || fine.id.slice(0, 8);
}

/** Where the list's rows came from, and whether they can be trusted yet — for the overview's fine metrics. */
export interface FinesListStatus {
  loading: boolean;
  failed: boolean;
  /** The read hit the fines tab's 1,000-row cap: the rows are the newest 1,000, not all. */
  capped: boolean;
}

type FinesQuery = {
  data?: { fines: EnhancedFine[]; serverCount?: number } | undefined;
  isLoading: boolean;
  error: unknown;
  refetch: () => unknown;
  isRefetching?: boolean;
};

export type FinesViewProps = FinesListProps & {
  /** A rental's or a customer's own fines; omitted on the Finances page. */
  scope?: FinanceScope;
};

export function FinesView(props: FinesViewProps) {
  return props.scope && (props.scope.rentalId || props.scope.customerId) ? (
    <ScopedFinesSource {...props} scope={props.scope} />
  ) : (
    <TenantFinesSource {...props} />
  );
}

function TenantFinesSource(props: FinesListProps) {
  return <FinesList {...props} query={useFinanceFines(props.q, props.status)} />;
}

function ScopedFinesSource(props: FinesListProps & { scope: FinanceScope }) {
  return <FinesList {...props} query={useScopedFinanceFines(props.scope, props.q, props.status)} scoped />;
}

interface FinesListProps {
  q: string;
  status: string | null;
  tenantId: string | undefined;
  currency: string;
  /** `canEdit('fines')`: selection, the bulk bar and Add fine. */
  mayEdit: boolean;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onOpen: (fine: EnhancedFine) => void;
  onAddFine: () => void;
  /** The rows on screen, handed up so the side panel can find a fine by id. */
  onRows: (fines: EnhancedFine[]) => void;
  onClearFilters: () => void;
  /** The fines tab's Record Payment (`useFineRowActions().openPaymentDialog`). Offered on an Open fine when `mayEdit`. */
  onRecordPayment?: (fine: EnhancedFine) => void;
  /** The fines tab's Waive Fine (`useFineRowActions().waiveFineAction.mutate(fine.id)`). Offered on an Open fine when `mayEdit`. */
  onWaive?: (fine: EnhancedFine) => void;
  /** A waive is on its way: the item waits, as on the fines tab. */
  waiving?: boolean;
  /** Told whenever the list's read changes state (the overview's fine metrics wait on it). */
  onStatus?: (status: FinesListStatus) => void;
  /** The quieter empty state, for a rental's or a customer's own Finances. */
  compact?: boolean;
}

function FinesList({
  q,
  status,
  tenantId,
  currency,
  mayEdit,
  selected,
  onSelect,
  onOpen,
  onAddFine,
  onRows,
  onClearFilters,
  onRecordPayment,
  onWaive,
  waiving = false,
  onStatus,
  compact = false,
  query,
  scoped = false,
}: FinesListProps & { query: FinesQuery; scoped?: boolean }) {
  const { data, isLoading, error, refetch, isRefetching } = query;
  const fines = data?.fines ?? EMPTY;
  const serverCount = data?.serverCount ?? 0;
  useEffect(() => {
    onRows(fines);
  }, [fines, onRows]);
  const failed = !!error && !data;
  useEffect(() => {
    onStatus?.({ loading: isLoading, failed, capped: serverCount > 1000 });
  }, [onStatus, isLoading, failed, serverCount]);
  const rows = useProgressiveRows(fines, `${tenantId ?? ""}|${q}|${status ?? ""}`);
  const filtered = !!q.trim() || !!status;

  if (isLoading) return <SettingsSectionSkeleton variant="table" rows={compact ? 3 : 6} columns={6} label="Loading fines" />;
  if (error && !data) {
    return <SettingsLoadError thing="your fines" error={error as Error} onRetry={() => refetch()} retrying={isRefetching} />;
  }
  if (fines.length === 0) {
    if (filtered) {
      return (
        <div className="rounded-2xl bg-card ring-1 ring-foreground/5 dark:ring-foreground/10">
          <SettingsNoMatch query={q} noun="fines" filtersActive={!!status} onClear={onClearFilters} />
        </div>
      );
    }
    if (scoped) {
      return (
        <SettingsEmptyState
          variant="compact"
          icon={AlertTriangle}
          headline="No fines"
          body="Tolls, tickets and other fines charged here appear in this list, and join what is owed."
          primaryAction={mayEdit ? { label: "Add fine", onClick: onAddFine, icon: Plus } : undefined}
        />
      );
    }
    return (
      <SettingsEmptyState
        icon={AlertTriangle}
        headline="Tolls, tickets and other fines"
        body="When a customer runs up a toll or a ticket in one of your cars, add it here and charge it to them — it joins what they owe."
        primaryAction={mayEdit ? { label: "Add fine", onClick: onAddFine, icon: Plus } : undefined}
      />
    );
  }

  const selectedRows = rows.visible.filter((f) => selected.includes(f.id));
  const allShown = rows.visible.length > 0 && rows.visible.every((f) => selected.includes(f.id));
  const toggle = (id: string, on: boolean) => onSelect(on ? [...selected, id] : selected.filter((x) => x !== id));

  return (
    <div className="space-y-3">
      {mayEdit && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onAddFine}>
            <Plus data-icon="inline-start" />
            Add fine
          </Button>
        </div>
      )}

      {mayEdit && selectedRows.length > 0 && <BulkActionBar selectedFines={selectedRows} onClearSelection={() => onSelect([])} />}

      <div className="hidden sm:block">
        <ListTable rows={rows} minWidth="min-w-[880px]">
          <ListTableHeader>
            <ListHead className="w-[4%]">
              {mayEdit && (
                <Checkbox
                  checked={allShown}
                  onCheckedChange={(v) => onSelect(v === true ? rows.visible.map((f) => f.id) : [])}
                  aria-label="Select all shown fines"
                />
              )}
            </ListHead>
            <ListHead className="w-[12%]">Reference</ListHead>
            <ListHead className="w-[10%]">Rental</ListHead>
            <ListHead className="w-[10%]">Vehicle</ListHead>
            <ListHead className="w-[13%]">Customer</ListHead>
            <ListHead className="w-[11%]">Issued</ListHead>
            <ListHead className="w-[13%]">Due</ListHead>
            <ListHead className="w-[12%]">Status</ListHead>
            <ListHead className="w-[11%] text-right">Amount</ListHead>
            <ListHead className="w-[4%] text-right">
              <span className="sr-only">Actions</span>
            </ListHead>
          </ListTableHeader>
          <ListBody>
            {rows.visible.map((fine, i) => {
              const ref = fineReference(fine);
              const status = fineStatusWords(fine.status, fine.isOverdue);
              const days = Math.abs(fine.daysUntilDue);
              return (
                <ListRow
                  key={fine.id}
                  data-fine-id={fine.id}
                  data-tour={i === 0 ? "finances-row" : undefined}
                  data-state={selected.includes(fine.id) ? "selected" : undefined}
                  className={cn(fine.isOverdue && "border-l-2 border-l-red-500 bg-red-500/5")}
                  onOpen={() => onOpen(fine)}
                >
                  <ListCell onClick={(e) => e.stopPropagation()}>
                    {mayEdit && (
                      <Checkbox
                        checked={selected.includes(fine.id)}
                        onCheckedChange={(v) => toggle(fine.id, v === true)}
                        aria-label={`Select fine ${ref}`}
                      />
                    )}
                  </ListCell>
                  <ListCell>
                    <span className={cn("block truncate", LIST_CLASSES.identifier)} title={ref}>
                      {ref}
                    </span>
                    {fine.type && <span className="block truncate text-[11px] text-muted-foreground">{fine.type}</span>}
                  </ListCell>
                  <ListCell className="tabular-nums">
                    {fine.rentals?.rental_number ? (
                      <span className={cn("block truncate", LIST_CLASSES.text)}>{fine.rentals.rental_number}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </ListCell>
                  <ListCell>
                    <span className={cn("block truncate tabular-nums", LIST_CLASSES.text)} title={fine.vehicles?.reg}>
                      {fine.vehicles?.reg || "—"}
                    </span>
                  </ListCell>
                  <ListCell>
                    <span className={cn("block truncate", LIST_CLASSES.text)} title={fine.customers?.name ?? undefined}>
                      {fine.customers?.name || "—"}
                    </span>
                  </ListCell>
                  <ListCell className="tabular-nums">
                    <span className={LIST_CLASSES.text}>{formatListDay(fine.issue_date) ?? "—"}</span>
                  </ListCell>
                  <ListCell className="tabular-nums">
                    <span className={cn("block", fine.isOverdue ? cn("font-medium", LIST_TONES.danger) : LIST_CLASSES.text)}>
                      {formatListDay(fine.due_date) ?? "—"}
                    </span>
                    {fine.isOverdue && (
                      <span className={cn("block text-[11px] font-medium", LIST_TONES.danger)}>
                        {days} {days === 1 ? "day" : "days"} overdue
                      </span>
                    )}
                  </ListCell>
                  <ListCell>
                    <ListStatusText tone={status.tone}>{status.label}</ListStatusText>
                  </ListCell>
                  <ListCell className="text-right tabular-nums">
                    <span className={LIST_CLASSES.text}>{formatMoney(toCents(fine.amount), currency)}</span>
                  </ListCell>
                  <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                    <FineMenu
                      fine={fine}
                      mayEdit={mayEdit}
                      waiving={waiving}
                      onOpen={onOpen}
                      onRecordPayment={onRecordPayment}
                      onWaive={onWaive}
                    />
                  </ListCell>
                </ListRow>
              );
            })}
          </ListBody>
        </ListTable>
      </div>

      <MobileRows rows={rows.visible} keyOf={(f) => f.id} onOpen={onOpen} label={(f) => `Open fine ${fineReference(f)}`}>
        {(fine) => {
          const status = fineStatusWords(fine.status, fine.isOverdue);
          return (
            <>
              <MobileFact primary={fineReference(fine)} secondary={fine.customers?.name || fine.vehicles?.reg || undefined} />
              <MobileFact
                align="right"
                primary={formatMoney(toCents(fine.amount), currency)}
                secondary={<span className={LIST_TONES[status.tone]}>{status.label}</span>}
              />
            </>
          );
        }}
      </MobileRows>

      {/* `serverTotal` only when the 1,000-row read was actually capped, as on the fines tab. */}
      <ListFooter rows={rows} one="fine" many="fines" serverTotal={serverCount > 1000 ? serverCount : undefined} />
    </div>
  );
}

/**
 * A fine's row menu. The fines tab's two items — Record Payment and Waive
 * Fine, on an Open fine, for someone who may edit fines — plus the ways in
 * that every Finances row menu offers.
 */
export function FineMenu({
  fine,
  mayEdit,
  waiving,
  onOpen,
  onRecordPayment,
  onWaive,
}: {
  fine: EnhancedFine;
  mayEdit: boolean;
  waiving: boolean;
  onOpen: (fine: EnhancedFine) => void;
  onRecordPayment?: (fine: EnhancedFine) => void;
  onWaive?: (fine: EnhancedFine) => void;
}) {
  const charge = mayEdit && !!onRecordPayment && fineCanCharge(fine);
  const waive = mayEdit && !!onWaive && fineCanWaive(fine);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <RowMenuTrigger label={`Actions for fine ${fineReference(fine)}`} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem onClick={() => onOpen(fine)}>
          <PanelRightOpen className="h-4 w-4" />
          See the fine
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/fines/${fine.id}`}>
            <FileText className="h-4 w-4" />
            Open the fine
          </Link>
        </DropdownMenuItem>
        {(charge || waive) && <DropdownMenuSeparator />}
        {charge && (
          <DropdownMenuItem data-fine-action="record_payment" onClick={() => onRecordPayment!(fine)}>
            <DollarSign className="h-4 w-4" />
            Record payment
          </DropdownMenuItem>
        )}
        {waive && (
          <DropdownMenuItem data-fine-action="waive" disabled={waiving} onClick={() => onWaive!(fine)}>
            <Ban className="h-4 w-4" />
            Waive fine
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
