"use client";

/**
 * v2 (northwind): the Payment Requests tab's table, built from the rentals
 * list's kit (`components/shared/list-table-v2`). No pager: rows arrive 25 at a
 * time as the table scrolls.
 *
 * Rows do not open anything, because the v1 row opens nothing: it has no
 * handler, link or button. Status is coloured text rather than StatusBadge.
 *
 * The 500 cap. `useTenantPaymentRequests` loads the latest 500 links
 * (`.limit(500)`) and returns no count, so without a count a tenant over the
 * cap would end on "All 500 payment requests shown". This table takes its own
 * head-only count, under its own query key so v1's query and cache entry stay
 * as they are, and hands it to the footer as `serverTotal`. The count is the
 * size of the WHOLE set, and the page's search runs over the loaded rows only,
 * so it is passed only when there is no search. A search over a capped set
 * says what it searched instead: "matches in the latest 500 payment requests".
 *
 * Only `useVoidPaymentLink` invalidates the list's key, and that code is
 * shared with v1, so the count is not invalidated with it. Voiding does not
 * change which rows the count matches, so nothing there goes stale. A link sent
 * elsewhere is picked up when the count goes stale (15s, the list's own
 * staleTime) and the table mounts again, which is also when the list refetches.
 */

import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import {
  LIST_CLASSES,
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
import { formatCurrency } from "@/lib/format-utils";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { describeLink } from "@/components/payments/payment-links-panel";
import type { PaymentLinkStatus, TenantPaymentRequest } from "@/hooks/use-payment-links";

/**
 * StatusBadge's labels (payment-links-panel.tsx STATUS_META, which is not
 * exported), with a tone per meaning. Typed against the status union, so a new
 * status fails to compile here until it is given a label and a tone.
 */
const REQUEST_STATUS_V2: Record<PaymentLinkStatus, { label: string; tone: ListTone }> = {
  paid: { label: "Paid", tone: "success" },
  approved: { label: "Approved", tone: "success" },
  deposit_hold: { label: "Deposit hold", tone: "info" },
  awaiting: { label: "Awaiting payment", tone: "warning" },
  rejected: { label: "Rejected", tone: "danger" },
  voided: { label: "Voided", tone: "danger" },
  expired: { label: "Expired", tone: "muted" },
  superseded: { label: "Superseded", tone: "muted" },
};

function RequestStatusText({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  // Matched case-insensitively: a stray capitalised value still gets its tone.
  const meta = REQUEST_STATUS_V2[status.toLowerCase() as PaymentLinkStatus];
  if (!meta) return <ListStatusText tone="muted">{status}</ListStatusText>;
  return <ListStatusText tone={meta.tone}>{meta.label}</ListStatusText>;
}

/**
 * How many links the Payment Requests list would hold with no cap. The same
 * table and filters as `fetchTenantPaymentRequests` in `use-payment-links.ts`
 * (its customer embed is a left join, so it drops no rows), and head-only, so no
 * rows come back. Keep the two in step.
 */
function useTenantPaymentRequestsCount() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["tenant-payment-requests-count", tenant?.id],
    queryFn: async (): Promise<number | null> => {
      const { count, error } = await supabaseUntyped
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant!.id)
        .or("stripe_checkout_session_id.not.is.null,square_payment_link_id.not.is.null");
      if (error) throw error;
      return count ?? null;
    },
    enabled: !!tenant?.id,
    staleTime: 15_000,
  });
}

export function PaymentRequestsTableV2({
  requests,
  loadedCount,
  resetKey,
  currencyCode,
}: {
  /** Every filtered request, already in memory: growing the list is a bigger slice. */
  requests: TenantPaymentRequest[];
  /** How many requests the hook loaded, before the search. */
  loadedCount: number;
  /** Changes with the search and never on a refetch. */
  resetKey: string;
  currencyCode: string;
}) {
  const requestRows = useProgressiveRows(requests, resetKey);

  // A failed or pending count leaves `serverTotal` unset, so the footer says
  // what it said before the count existed. It never blocks the table.
  const { data: serverCount } = useTenantPaymentRequestsCount();
  const capped = typeof serverCount === "number" && serverCount > loadedCount;
  // A search that keeps every loaded row reads the same as no search.
  const searching = requests.length < loadedCount;

  return (
    <>
      <ListTable rows={requestRows}>
        <ListTableHeader>
          <ListHead className="w-[15%]">Sent</ListHead>
          <ListHead className="w-[28%]">Customer</ListHead>
          <ListHead className="w-[25%]">For</ListHead>
          <ListHead className="w-[14%]">Amount</ListHead>
          <ListHead className="w-[18%]">Status</ListHead>
        </ListTableHeader>
        <ListBody>
          {requestRows.visible.map((r) => (
            <ListRow key={r.id}>
              <ListCell className="tabular-nums">
                <span className={`whitespace-nowrap ${LIST_CLASSES.text}`}>
                  {format(new Date(r.createdAt), "MMM d, yyyy")}
                </span>
              </ListCell>
              <ListCell>
                {r.customerName ? (
                  <span className={`block truncate ${LIST_CLASSES.identifier}`} title={r.customerName}>
                    {r.customerName}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </ListCell>
              <ListCell>
                <span className={`block truncate ${LIST_CLASSES.text}`} title={describeLink(r)}>
                  {describeLink(r)}
                </span>
              </ListCell>
              <ListCell className="tabular-nums">
                <span className={LIST_CLASSES.text}>{formatCurrency(r.amount, currencyCode)}</span>
              </ListCell>
              <ListCell>
                <RequestStatusText status={r.status} />
              </ListCell>
            </ListRow>
          ))}
        </ListBody>
      </ListTable>
      <ListFooter
        rows={requestRows}
        one={capped && searching ? `match in the latest ${loadedCount} payment requests` : "payment request"}
        many={capped && searching ? `matches in the latest ${loadedCount} payment requests` : "payment requests"}
        serverTotal={capped && !searching ? serverCount : undefined}
      />
    </>
  );
}
