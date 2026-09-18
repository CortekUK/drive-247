"use client";

/**
 * v2 (northwind): the Blacklisted Customers table on /settings/blacklist, built
 * from the rentals list's kit (`components/shared/list-table-v2`). No pager:
 * rows arrive 25 at a time as the table scrolls, with one line under the card
 * saying how much is shown. No card twin on phones: the table scrolls sideways.
 *
 * The query neither pages nor caps its rows, so the page hands over its
 * searched array and a growing slice is the whole mechanism.
 *
 * A row does what the v1 row does and nothing more: it shows or hides the list
 * of companies that blocked the email. There is no blacklist record to open.
 * v1 made the row a `CollapsibleTrigger` around a Fragment; here the detail row
 * is simply rendered while the page's `expandedRows` holds the id, and both the
 * row and the Show/Hide button call the page's own `toggleRow`.
 */

import { Fragment } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
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
} from "@/components/shared/list-table-v2";
import { formatCompanyCount, isPositiveCount } from "@/components/settings-v2/settings-shell-state";

const Blank = () => <span className="text-muted-foreground">—</span>;

/** v1's date format for this page, with the year. */
const formatBlockedDateV2 = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : format(d, "MMM d, yyyy");
};

/** The fields the table reads. The page's own `GlobalBlacklistEntry` satisfies it. */
export interface GlobalBlacklistEntryRowV2 {
  id: string;
  email: string;
  blocked_tenant_count: number;
  first_blocked_at: string | null;
  last_blocked_at: string | null;
  blocking_tenants: {
    tenant_name: string | null;
    reason: string | null;
    blocked_at: string | null;
  }[] | null;
}

export function GlobalBlacklistTableV2<T extends GlobalBlacklistEntryRowV2>({
  entries,
  resetKey,
  expandedIds,
  onToggle,
}: {
  /** Every row the search returns, in the query's order. Not a page slice. */
  entries: T[];
  /** Changes with the result set only: see `useProgressiveRows`. */
  resetKey: string;
  /** The page's `expandedRows`. */
  expandedIds: Set<string>;
  /** The page's `toggleRow`. */
  onToggle: (id: string) => void;
}) {
  const entryRows = useProgressiveRows(entries, resetKey);

  return (
    <>
      <ListTable rows={entryRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          <ListHead className="w-[42%]">Email</ListHead>
          <ListHead className="w-[15%]">Status</ListHead>
          <ListHead className="w-[14%]">First blocked</ListHead>
          <ListHead className="w-[14%]">Last blocked</ListHead>
          <ListHead className="w-[15%]">Details</ListHead>
        </ListTableHeader>
        <ListBody>
          {entryRows.visible.map((entry) => {
            const expanded = expandedIds.has(entry.id);
            const detailsId = `global-blacklist-details-${entry.id}`;
            const firstBlocked = formatBlockedDateV2(entry.first_blocked_at);
            const lastBlocked = formatBlockedDateV2(entry.last_blocked_at);
            const companies = formatCompanyCount(entry.blocked_tenant_count);
            return (
              <Fragment key={entry.id}>
                <ListRow onOpen={() => onToggle(entry.id)}>
                  <ListCell>
                    {/* The email column is NOT NULL, but a row without one must
                        still say what it is rather than leave the cell blank. */}
                    {entry.email ? (
                      <span className={`block truncate ${LIST_CLASSES.identifier}`} title={entry.email}>
                        {entry.email}
                      </span>
                    ) : (
                      <span className="block truncate text-sm text-muted-foreground">No email on record</span>
                    )}
                  </ListCell>
                  <ListCell>
                    {/* v1's destructive "{n} companies" badge, as coloured text,
                        cut with its full text as a title so a long count never
                        runs into First blocked on a narrow screen. Red only
                        while a company still blocks the customer: "0 companies"
                        (every block lifted) and a broken count ("—") are muted. */}
                    <span className="block truncate tabular-nums" title={companies}>
                      <ListStatusText tone={isPositiveCount(entry.blocked_tenant_count) ? "danger" : "muted"}>
                        {companies}
                      </ListStatusText>
                    </span>
                  </ListCell>
                  <ListCell className="tabular-nums">
                    {firstBlocked ? <span className={LIST_CLASSES.text}>{firstBlocked}</span> : <Blank />}
                  </ListCell>
                  <ListCell className="tabular-nums">
                    {lastBlocked ? <span className={LIST_CLASSES.text}>{lastBlocked}</span> : <Blank />}
                  </ListCell>
                  {/* The button toggles on its own and the cell stops the click,
                      so one click never reaches the row's toggle as well (which
                      would open and close the details in the same click). It is
                      also the keyboard's way in: a table row takes no focus. */}
                  {/* The flex wrapper keeps the labelled button off the text
                      baseline. Inline, its label's descender space made the row
                      3px taller than a rentals row even with `-my-1.5`. */}
                  <ListCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-my-1.5 gap-1 text-muted-foreground hover:text-foreground"
                        aria-expanded={expanded}
                        aria-controls={expanded ? detailsId : undefined}
                        onClick={() => onToggle(entry.id)}
                      >
                        {expanded ? (
                          <>
                            <ChevronUp className="h-4 w-4" />
                            Hide
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-4 w-4" />
                            Show
                          </>
                        )}
                      </Button>
                    </div>
                  </ListCell>
                </ListRow>
                {expanded && (
                  // Not a toggle: as in v1, clicking inside the details leaves them open.
                  <ListRow id={detailsId} className="bg-muted/30 hover:bg-muted/30">
                    <ListCell colSpan={5} className="text-left">
                      <div className="space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Blocking Companies
                        </div>
                        {entry.blocking_tenants && entry.blocking_tenants.length > 0 ? (
                          <ul className="space-y-1.5">
                            {entry.blocking_tenants.map((tenant, idx) => {
                              const name = tenant.tenant_name || "Unknown Company";
                              const reason = tenant.reason || "No reason provided";
                              const blocked = formatBlockedDateV2(tenant.blocked_at);
                              return (
                                // One line per company. The name and the reason may
                                // cut, each with its full text as a title; the date
                                // never does.
                                <li key={idx} className="flex items-center gap-4 text-sm">
                                  <span className={`w-[28%] shrink-0 truncate ${LIST_CLASSES.text}`} title={name}>
                                    {name}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={reason}>
                                    <span className="font-medium text-foreground">Reason:</span> {reason}
                                  </span>
                                  <span className="shrink-0 tabular-nums text-muted-foreground">
                                    Blocked: {blocked ?? "Date unknown"}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">No details available</p>
                        )}
                      </div>
                    </ListCell>
                  </ListRow>
                )}
              </Fragment>
            );
          })}
        </ListBody>
      </ListTable>
      <ListFooter rows={entryRows} one="blacklisted customer" many="blacklisted customers" />
    </>
  );
}
