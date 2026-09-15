"use client";

/**
 * v2 (northwind): the /insurance policies table, built from the rentals list's
 * kit (`components/shared/list-table-v2`). Rows arrive 25 at a time as the
 * table scrolls, with one line under the card saying how much is shown.
 *
 * The progressive-rows hook lives HERE, not on the page, because the page sorts
 * its rows below the insurance-exempt `return null`, where no hook may be added.
 * Mounting the hook with its table mounts it with its sentinel.
 *
 * The whole row opens the policy drawer, as the v1 row does, and the customer
 * name is still a link to the customer. The ⋯ menu is v1's: the same four items
 * and separator, Deactivate disabled on an inactive policy, and the page's own
 * handlers. Sorting is the page's own; the header now shows which column and
 * direction are active.
 */

import Link from "next/link";
import { format } from "date-fns";
import { Ban, Edit, Eye, MoreHorizontal, Upload } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LIST_CLASSES,
  LIST_ROW_ACTION,
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
  type ListTone,
} from "@/components/shared/list-table-v2";
import { parseLocalDate } from "@/lib/date-utils";
import {
  getInsuranceStatusInfo,
  type InsurancePolicyStatus,
  type InsuranceStatusLevel,
} from "@/lib/insurance-utils";
import { cn } from "@/lib/utils";

/** The page's sort fields. */
export type InsurancePolicySortFieldV2 =
  | "customer"
  | "vehicle"
  | "policy_number"
  | "provider"
  | "start_date"
  | "expiry_date"
  | "status"
  | "docs_count";

/** The fields this table reads. `InsurancePolicy` from use-insurance-data satisfies it. */
export interface InsurancePolicyListRowV2 {
  id: string;
  customer_id: string;
  policy_number: string;
  provider: string | null;
  start_date: string;
  expiry_date: string;
  status: string;
  docs_count: number;
  customers: { name: string };
  vehicles: { reg: string; make: string; model: string } | null;
}

/**
 * InsurancePolicyStatusChip's badge variants, by meaning: a policy in date is
 * success, one expiring within 30 days is warning, expired, suspended and
 * cancelled are danger (v1's destructive), and inactive recedes (v1's outline).
 */
const STATUS_TONE_V2: Record<InsuranceStatusLevel, ListTone> = {
  ok: "success",
  due_soon: "warning",
  expired: "danger",
  suspended: "danger",
  cancelled: "danger",
  inactive: "muted",
};

const Blank = () => <span className="text-muted-foreground">—</span>;

export function InsurancePolicyListV2<T extends InsurancePolicyListRowV2>({
  policies,
  resetKey,
  sortField,
  sortDirection,
  onSort,
  isUrgent,
  onView,
  onEdit,
  onUpload,
  onDeactivate,
}: {
  /** Every filtered policy in the page's sort order, already in memory. */
  policies: T[];
  /** Changes with the result set (tenant, filters, sort) and never on a refetch. */
  resetKey: string;
  sortField: InsurancePolicySortFieldV2;
  sortDirection: "asc" | "desc";
  onSort: (field: InsurancePolicySortFieldV2) => void;
  /** The page's own 0-7 day check, which drives v1's rail and Urgent badge. */
  isUrgent: (expiryDate: string) => boolean;
  onView: (policy: T) => void;
  onEdit: (policy: T) => void;
  onUpload: (policy: T) => void;
  onDeactivate: (policyId: string) => void;
}) {
  const policyRows = useProgressiveRows(policies, resetKey);
  const sortBy = (field: InsurancePolicySortFieldV2) => ({
    direction: sortField === field ? sortDirection : null,
    onSort: () => onSort(field),
  });

  return (
    <>
      <ListTable rows={policyRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          {/* Widths, measured in Manrope on a 944px card. Policy number, Start,
              Expiry and Status hold their longest values in full:
              "POL-2026-00012345" (17 characters), "May 28, 2026", "Expires in
              30 days". Every sortable header stays inside its own cell's padding
              (Docs leans into the empty Actions header). Customer, Vehicle and
              Provider truncate, each with its full value in a title. */}
          <ListHead className="w-[11%]" sort={sortBy("customer")}>Customer</ListHead>
          <ListHead className="w-[11.5%]" sort={sortBy("vehicle")}>Vehicle</ListHead>
          <ListHead className="w-[17%]" sort={sortBy("policy_number")}>Policy number</ListHead>
          <ListHead className="w-[10%]" sort={sortBy("provider")}>Provider</ListHead>
          <ListHead className="w-[12%]" sort={sortBy("start_date")}>Start</ListHead>
          <ListHead className="w-[12%]" sort={sortBy("expiry_date")}>Expiry</ListHead>
          <ListHead className="w-[15%]" sort={sortBy("status")}>Status</ListHead>
          <ListHead className="w-[7.5%]" sort={sortBy("docs_count")}>Docs</ListHead>
          <ListHead className="w-[4%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {policyRows.visible.map((policy) => {
            const urgent = isUrgent(policy.expiry_date);
            const status = getInsuranceStatusInfo(policy.status as InsurancePolicyStatus, policy.expiry_date);
            const reg = policy.vehicles?.reg;
            // v1 prints make and model as a second line under the plate. Here
            // they follow the plate on the same line, quieter, as Invoices does.
            const makeModel = [policy.vehicles?.make, policy.vehicles?.model].filter(Boolean).join(" ");

            return (
              <ListRow
                key={policy.id}
                // The rentals list's flag treatment: a faint tint and a 2px rail,
                // in place of v1's 4px amber border on a policy expiring this week.
                className={cn(urgent && "bg-amber-500/5 border-l-2 border-l-amber-500")}
                onOpen={() => onView(policy)}
              >
                {/* The link must not also open the drawer. */}
                <ListCell onClick={(e) => e.stopPropagation()}>
                  <Link
                    href={`/customers/${policy.customer_id}`}
                    className={`block truncate ${LIST_CLASSES.text} hover:underline`}
                    title={policy.customers.name}
                  >
                    {policy.customers.name}
                  </Link>
                </ListCell>
                <ListCell>
                  {policy.vehicles ? (
                    <span className="block truncate" title={[reg, makeModel].filter(Boolean).join(" · ")}>
                      {reg ? <span className={`tabular-nums ${LIST_CLASSES.text}`}>{reg}</span> : <Blank />}
                      {makeModel && <span className="ml-1.5 text-muted-foreground">{makeModel}</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No vehicle</span>
                  )}
                </ListCell>
                <ListCell>
                  <span className={`block truncate ${LIST_CLASSES.identifier}`} title={policy.policy_number}>
                    {policy.policy_number}
                  </span>
                </ListCell>
                <ListCell>
                  {policy.provider ? (
                    <span className={`block truncate ${LIST_CLASSES.text}`} title={policy.provider}>
                      {policy.provider}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={LIST_CLASSES.text}>{format(parseLocalDate(policy.start_date), "MMM d, yyyy")}</span>
                </ListCell>
                {/* Urgent: the date stays whole on the first line and v1's
                    "Urgent" badge becomes the rentals list's flag line under it,
                    as Fines does with "N days overdue". A chip beside the date
                    needed a column wide enough to squeeze everything else. */}
                <ListCell className="tabular-nums">
                  <div className="flex flex-col gap-0.5">
                    <span className={LIST_CLASSES.text}>
                      {format(parseLocalDate(policy.expiry_date), "MMM d, yyyy")}
                    </span>
                    {urgent && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        Urgent
                      </span>
                    )}
                  </div>
                </ListCell>
                <ListCell>
                  <ListStatusText tone={STATUS_TONE_V2[status.level] ?? "muted"}>{status.label}</ListStatusText>
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={LIST_CLASSES.text}>{policy.docs_count}</span>
                </ListCell>
                {/* The menu must not open the drawer: clicks on the trigger and on
                    its items (portalled, but still React children of this cell)
                    stop here, as v1's per-item stopPropagation did. */}
                <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className={cn(LIST_ROW_ACTION, "flex ml-auto")}
                        aria-label={`Actions for policy ${policy.policy_number}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onView(policy)}>
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEdit(policy)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit Policy
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onUpload(policy)}>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Document
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onDeactivate(policy.id)}
                        disabled={policy.status === "Inactive"}
                      >
                        <Ban className="h-4 w-4 mr-2" />
                        Deactivate
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      {/* No `serverTotal`: the policies query does not count. */}
      <ListFooter rows={policyRows} one="policy" many="policies" />
    </>
  );
}
