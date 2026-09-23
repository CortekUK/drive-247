"use client";

/**
 * v2 (northwind): the /audit-logs table, built from the rentals list's kit
 * (`components/shared/list-table-v2`). No pager: rows arrive 25 at a time as
 * the table scrolls, with one line under the card saying how much is shown.
 *
 * Rows open nothing. A v1 row has no click, no link and no View button, and an
 * audit row's `entity_id` has never been linked anywhere, so a destination
 * would be invented. The one control is the Details tooltip, kept as it was.
 *
 * The progressive-rows hook lives HERE, not on the page: the page returns its
 * skeleton early (on every filter change, too), so mounting the hook with its
 * table mounts it with its sentinel.
 */

import { format } from "date-fns";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  LIST_CLASSES,
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListMetaChip,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
  type ListTone,
} from "@/components/shared/list-table-v2";
import {
  AUDIT_LOGS_V2_LIMIT,
  formatActionName,
  getActionColor,
  type AuditLog,
} from "@/hooks/use-audit-logs";
import { cn } from "@/lib/utils";

const Blank = () => <span className="text-muted-foreground">—</span>;

/**
 * v1's Action badge colour as a v2 tone. It reads `getActionColor` itself, so
 * there is one rule table and its quirks carry over unchanged: "*_unblocked"
 * is danger because "blocked" is checked first, "plate_unassigned" is success
 * because of "assigned".
 */
export function auditActionToneV2(action: string): ListTone {
  const color = getActionColor(action);
  if (color.startsWith("text-red-")) return "danger";
  if (color.startsWith("text-green-")) return "success";
  if (color.startsWith("text-blue-")) return "info";
  // Orange: a warning or dialog was shown. Amber: refunded or charged.
  if (color.startsWith("text-orange-") || color.startsWith("text-amber-")) return "warning";
  return "muted";
}

export function AuditLogsTableV2({
  logs,
  resetKey,
  serverCount,
}: {
  /** Every row the query returned, newest first. Not a page slice. */
  logs: AuditLog[];
  /** Changes with the result set (tenant, any filter) and never on a refetch. */
  resetKey: string;
  /**
   * The exact number of matching rows on the server. The page asks for it only
   * when the fetch came back full (`AUDIT_LOGS_V2_LIMIT` rows); otherwise, and
   * until it lands, it is undefined.
   */
  serverCount: number | null | undefined;
}) {
  const logRows = useProgressiveRows(logs, resetKey);

  // The fetch stops at AUDIT_LOGS_V2_LIMIT rows, so a full fetch may have older
  // entries behind it and the footer must never end on "All 1000 log entries
  // shown". With the count it reads "Showing the first 1000 of N log entries".
  // Until the count lands, or if it fails, it says what the rows are: the most
  // recent entries, without claiming a total it does not have.
  const capped = logs.length >= AUDIT_LOGS_V2_LIMIT;
  const countKnown = capped && typeof serverCount === "number";
  const serverTotal = countKnown && serverCount > logs.length ? serverCount : undefined;

  return (
    <>
      {/* Widths, measured in the portal's Manrope: the date with its time
          (148px), the longest action label ("Update Manager Permissions",
          192.1px) and the longest entity type ("TENANT_SUBSCRIPTION_INVOICE",
          179.2px, written by the platform's invoice and link functions) all
          read whole at a 944px card and at the 880px minimum, inside the kit's
          24px of cell padding. The customer name, details and actor truncate
          with a title (the details keep their tooltip). */}
      <ListTable rows={logRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          <ListHead className="w-[20%]">Date &amp; time</ListHead>
          <ListHead className="w-[25%]">Action</ListHead>
          <ListHead className="w-[24%]">Entity</ListHead>
          <ListHead className="w-[17%]">Details</ListHead>
          <ListHead className="w-[14%]">Performed by</ListHead>
        </ListTableHeader>
        <ListBody>
          {logRows.visible.map((log) => {
            const actionLabel = formatActionName(log.action);
            const actor = log.actor?.name || log.actor?.email || "System";
            return (
              <ListRow key={log.id}>
                <ListCell className="whitespace-nowrap tabular-nums">
                  <span className={LIST_CLASSES.identifier}>
                    {format(new Date(log.created_at), "MMM dd, yyyy")}
                  </span>{" "}
                  <span className="text-muted-foreground">{format(new Date(log.created_at), "HH:mm:ss")}</span>
                </ListCell>
                <ListCell className="whitespace-nowrap">
                  <span title={actionLabel}>
                    <ListStatusText tone={auditActionToneV2(log.action)}>{actionLabel}</ListStatusText>
                  </span>
                </ListCell>
                <ListCell>
                  {log.entity_type ? (
                    // A 20px line whether or not there is a chip: the 10px chip in a
                    // 14px line box otherwise makes these rows 1px taller than the rest.
                    <div className="flex h-5 min-w-0 items-center gap-2">
                      <span className="shrink-0 whitespace-nowrap leading-none">
                        <ListMetaChip>{log.entity_type}</ListMetaChip>
                      </span>
                      {log.details?.customer_name && (
                        <span
                          className={cn("min-w-0 truncate", LIST_CLASSES.text)}
                          title={String(log.details.customer_name)}
                        >
                          {log.details.customer_name}
                        </span>
                      )}
                    </div>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  {/* v1's three lines of logic, unchanged: a reason and a status
                      change can both show, and a row with neither shows the first
                      50 characters of its details (null details read "null..."). */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="truncate text-sm text-muted-foreground cursor-help">
                          {log.details?.reason && (
                            <span>Reason: {log.details.reason}</span>
                          )}
                          {log.details?.previous_status &&
                            log.details?.new_status && (
                              <span>
                                Status: {log.details.previous_status} →{" "}
                                {log.details.new_status}
                              </span>
                            )}
                          {!log.details?.reason &&
                            !log.details?.previous_status && (
                              <span>
                                {JSON.stringify(log.details).substring(
                                  0,
                                  50
                                )}
                                ...
                              </span>
                            )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        className="max-w-[400px]"
                      >
                        <pre className="text-xs whitespace-pre-wrap">
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </ListCell>
                <ListCell>
                  <span className={cn("block truncate", LIST_CLASSES.text)} title={actor}>
                    {actor}
                  </span>
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      <ListFooter
        rows={logRows}
        one="log entry"
        many={capped && !countKnown ? "most recent log entries" : "log entries"}
        serverTotal={serverTotal}
      />
    </>
  );
}
