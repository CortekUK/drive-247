"use client";

/**
 * v2 (northwind): the two tables on /blocked-customers, built from the rentals
 * list's kit (`components/shared/list-table-v2`). No pager: rows arrive 25 at a
 * time as the table scrolls, with one line under the card saying how much is
 * shown. No card twin on phones: the table scrolls sideways instead.
 *
 * The progressive-rows hook lives in each table, not on the page, because both
 * tables sit inside Radix `TabsContent`s that unmount when the other tab is
 * open. Mounting the hook with its table mounts it with its sentinel.
 *
 * Neither query pages or caps its rows, so the page hands over its filtered
 * arrays and a growing slice is the whole mechanism.
 *
 * The actions are the page's own. Each table is handed the same state setters
 * the v1 buttons call, the same `canEdit('blocked_customers')` result and the
 * shared `isLoading` flag from `useCustomerBlockingActions`, so the confirmation
 * dialogs, their audit rows and the post-unblock refetch run exactly as in v1.
 */

import { format } from "date-fns";
import { CheckCircle, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import {
  LIST_ROW_ACTION,
  LIST_CLASSES,
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListMetaChip,
  ListRow,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from "@/components/shared/list-table-v2";
import type { BlockedIdentity } from "@/hooks/use-customer-blocking";

const Blank = () => <span className="text-muted-foreground">—</span>;

/** The fields the customers table reads. The page's own `BlockedCustomer` satisfies it. */
export interface BlockedCustomerRowV2 {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  license_number: string | null;
  id_number: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
}

/**
 * The page's `getIdentityTypeBadge` labels, as a quiet chip. As in v1, 'email'
 * and anything unrecognised read "Other".
 */
const IDENTITY_TYPE_LABELS: Record<string, string> = {
  license: "License",
  id_card: "ID Card",
  passport: "Passport",
};

export function BlockedCustomersTableV2<T extends BlockedCustomerRowV2>({
  customers,
  resetKey,
  canUnblock,
  isLoading,
  onOpen,
  onUnblock,
}: {
  /** Every row the search returns, in the query's order. Not a page slice. */
  customers: T[];
  /** Changes with the result set only: see `useProgressiveRows`. */
  resetKey: string;
  canUnblock: boolean;
  isLoading: boolean;
  /** The v1 View button's destination. */
  onOpen: (customer: T) => void;
  /** The v1 Unblock button's handler. */
  onUnblock: (customer: T) => void;
}) {
  const customerRows = useProgressiveRows(customers, resetKey);

  return (
    <>
      {/* No View column: the row opens the customer, where v1's View button went.
          License and ID are two one-line columns rather than one two-line cell,
          so rows stay the height of a rentals row. */}
      <ListTable rows={customerRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          <ListHead className="w-[18%]">Customer</ListHead>
          <ListHead className="w-[20%]">Contact</ListHead>
          <ListHead className="w-[12%]">License</ListHead>
          <ListHead className="w-[12%]">ID number</ListHead>
          <ListHead className="w-[12%]">Blocked on</ListHead>
          <ListHead className="w-[20%]">Reason</ListHead>
          <ListHead className="w-[6%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {customerRows.visible.map((customer) => {
            const contact = customer.email || customer.phone;
            return (
              <ListRow key={customer.id} onOpen={() => onOpen(customer)}>
                <ListCell>
                  {/* A real button, so the record stays reachable by keyboard. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(customer);
                    }}
                    className={`${LIST_CLASSES.identifier} block max-w-full truncate text-left hover:underline`}
                  >
                    {customer.name}
                  </button>
                </ListCell>
                <ListCell>
                  {contact ? (
                    <span
                      className={`block truncate ${customer.email ? "" : "tabular-nums "}${LIST_CLASSES.text}`}
                      title={contact}
                    >
                      {contact}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  {customer.license_number ? (
                    <span className={`block truncate tabular-nums ${LIST_CLASSES.text}`} title={customer.license_number}>
                      {customer.license_number}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  {customer.id_number ? (
                    <span className={`block truncate tabular-nums ${LIST_CLASSES.text}`} title={customer.id_number}>
                      {customer.id_number}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className="tabular-nums">
                  {customer.blocked_at ? (
                    <span className={LIST_CLASSES.text}>{format(new Date(customer.blocked_at), "MMM dd, yyyy")}</span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  {customer.blocked_reason ? (
                    // The title gives back the full reason, which v1 truncates with no way to read it.
                    <span className={`block truncate ${LIST_CLASSES.text}`} title={customer.blocked_reason}>
                      {customer.blocked_reason}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                {/* The menu must not open the record: clicks on the trigger and on
                    its item (portalled, but still React children of this cell)
                    stop here. Otherwise one click would open the confirmation and
                    navigate away, and the dialog's audit row would still be written. */}
                <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {canUnblock && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={LIST_ROW_ACTION}
                          aria-label={`Actions for ${customer.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-auto">
                        <DropdownMenuItem
                          onClick={() => onUnblock(customer)}
                          disabled={isLoading}
                          className="text-green-600 focus:text-green-600"
                        >
                          <CheckCircle className="h-4 w-4" />
                          Unblock
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      <ListFooter rows={customerRows} one="blocked customer" many="blocked customers" />
    </>
  );
}

export function BlockedIdentitiesTableV2<T extends BlockedIdentity>({
  identities,
  resetKey,
  canRemove,
  isLoading,
  onRemove,
}: {
  /** Every row the search returns, in the query's order. Not a page slice. */
  identities: T[];
  /** Changes with the result set only: see `useProgressiveRows`. */
  resetKey: string;
  canRemove: boolean;
  isLoading: boolean;
  /** The v1 Remove button's handler. */
  onRemove: (identity: T) => void;
}) {
  const identityRows = useProgressiveRows(identities, resetKey);

  return (
    <>
      {/* Rows do not open anything: there is no identity record route, and a
          blocked identity carries no customer id to link back to. */}
      <ListTable rows={identityRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          <ListHead className="w-[10%]">Type</ListHead>
          <ListHead className="w-[16%]">Customer</ListHead>
          <ListHead className="w-[17%]">Identity number</ListHead>
          <ListHead className="w-[23%]">Reason</ListHead>
          <ListHead className="w-[16%]">Notes</ListHead>
          <ListHead className="w-[12%]">Added on</ListHead>
          <ListHead className="w-[6%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {identityRows.visible.map((identity) => (
            <ListRow key={identity.id}>
              <ListCell>
                <ListMetaChip>{IDENTITY_TYPE_LABELS[identity.identity_type] ?? "Other"}</ListMetaChip>
              </ListCell>
              <ListCell>
                {identity.customer_name ? (
                  <span className={`block truncate ${LIST_CLASSES.text}`} title={identity.customer_name}>
                    {identity.customer_name}
                  </span>
                ) : (
                  <Blank />
                )}
              </ListCell>
              <ListCell>
                <span className={`block truncate ${LIST_CLASSES.identifier}`} title={identity.identity_number}>
                  {identity.identity_number}
                </span>
              </ListCell>
              <ListCell>
                {identity.reason ? (
                  <span className={`block truncate ${LIST_CLASSES.text}`} title={identity.reason}>
                    {identity.reason}
                  </span>
                ) : (
                  <Blank />
                )}
              </ListCell>
              <ListCell>
                {identity.notes ? (
                  <span className={`block truncate ${LIST_CLASSES.text}`} title={identity.notes}>
                    {identity.notes}
                  </span>
                ) : (
                  <Blank />
                )}
              </ListCell>
              <ListCell className="tabular-nums">
                {/* `created_at` is nullable in the database: a blank, not v1's 1970. */}
                {identity.created_at ? (
                  <span className={LIST_CLASSES.text}>{format(new Date(identity.created_at), "MMM dd, yyyy")}</span>
                ) : (
                  <Blank />
                )}
              </ListCell>
              <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
                {canRemove && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={LIST_ROW_ACTION}
                        aria-label={`Actions for ${identity.identity_number}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto">
                      <DropdownMenuItem
                        onClick={() => onRemove(identity)}
                        disabled={isLoading}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove from Blocklist
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </ListCell>
            </ListRow>
          ))}
        </ListBody>
      </ListTable>
      <ListFooter rows={identityRows} one="blocked identity" many="blocked identities" />
    </>
  );
}
