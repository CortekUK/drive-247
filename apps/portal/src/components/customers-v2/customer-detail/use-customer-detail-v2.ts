"use client";

/**
 * What the customer record screen — and its rail — read.
 *
 * Two hooks, because the two callers need very different amounts of it.
 *
 * `useCustomerDetailV2` is the screen's: the whole assembled record, the write
 * path, the permission and the two staleness computations. It mounts a dozen
 * queries, which is right for the thing that draws every section.
 *
 * `useCustomerRailHeader` is the SIDEBAR's, and it deliberately reads one row.
 * The rail shows a name and a line of contact under it, so pulling documents,
 * fines, reviews, payment links, verifications and the ledger to render two
 * strings would be twelve subscriptions for two strings. It shares
 * `useCustomerRow`'s query key with the screen, so on a customer page the two
 * are one request and the rail costs nothing; off a customer page it is passed
 * a null id and fetches nothing at all.
 */

import { useMemo } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { summaryDrift, verificationDrift } from "./derive";
import { useCustomerRecord, useCustomerRow } from "./use-customer-record";
import { useCustomerDraft } from "./use-customer-draft";

export function useCustomerDetailV2(id: string) {
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const { record, isLoading, notFound, error } = useCustomerRecord(id);
  const { set, saving } = useCustomerDraft(id);

  /**
   * The two things on this screen that can be out of date, computed once here
   * because the section showing the banner and the right rail's checklist both
   * need the same answer. Two computations of one fact is how they drift.
   */
  const verifyDrift = useMemo(() => (record ? verificationDrift(record) : []), [record]);
  const reviewDrift = useMemo(() => (record ? summaryDrift(record) : []), [record]);

  return {
    record,
    isLoading,
    notFound,
    error,
    set,
    saving,
    verifyDrift,
    reviewDrift,
    canEdit: canEdit("customers"),
    currency: tenant?.currency_code || "USD",
  };
}

/**
 * Just enough of a customer to title a rail: who they are, and how to reach
 * them. `null` id means "not on a customer page" — the query never runs.
 */
export function useCustomerRailHeader(id: string | null) {
  // `""` disables the query — `useCustomerRow` is `enabled` on a truthy id — so
  // this is safe to call unconditionally from a sidebar that renders on every
  // page. Hooks may not be conditional; the fetch may.
  const { data: row } = useCustomerRow(id ?? "");
  return {
    /** `customers.name` holds the whole name; there is no surname column.
     *  Falls back to the generic word rather than flashing "Untitled customer"
     *  before the row lands — a rail that corrects itself reads as a bug. */
    title: (row?.name as string) || "Customer",
    subtitle: row ? (row.email as string) || (row.phone as string) || "No contact on file" : "",
    blocked: !!row?.is_blocked,
    found: !!row,
  };
}
