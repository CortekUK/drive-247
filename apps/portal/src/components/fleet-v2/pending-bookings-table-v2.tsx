"use client";

/**
 * v2 (northwind): the /pending-bookings table, built from the rentals list's kit
 * (`components/shared/list-table-v2`). No pager and no page-size control: the
 * queue's query returns every pre-authorised website booking in one request, so
 * rows arrive 25 at a time as the table scrolls, with one line under the card
 * saying how much is shown.
 *
 * The progressive-rows hook lives here, not on the page, because the page
 * returns early (spinner, error card) before the table, and a hook must sit
 * above every early return. Mounting the hook with its table mounts it with its
 * sentinel.
 *
 * MONEY PATHS. Approve captures the pre-authorised payment
 * (capture-booking-payment) and Reject releases the hold and cancels the booking
 * (cancel-booking-preauth). This table runs neither. Its two buttons are v1's
 * two buttons: the page hands in the same bodies they run (select the booking,
 * open the confirmation), so the page's own AlertDialog and Dialog, and their
 * `handleApprove` / `handleReject`, are the only way either request is sent.
 * Same permission (`canEdit('pending_bookings')`), same disabled rule (either
 * mutation in flight). Rows open nothing, as in v1: there is no booking record
 * to open, and a row click on a money queue must never select a record.
 */

import { format, parseISO } from "date-fns";
import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { useTenant } from "@/contexts/TenantContext";
import type { PendingBooking } from "@/hooks/use-pending-bookings";

const Blank = () => <span className="text-muted-foreground">—</span>;

const NO_BOOKINGS: PendingBooking[] = [];

/**
 * The page's `getVerificationBadge` labels, as coloured text. Verified and
 * Manually Verified are the healthy states, Pending waits on the customer,
 * Rejected failed, and anything else (no check at all) reads "Not Verified" and
 * recedes.
 */
export function verificationStatusV2(status: string | null | undefined): { label: string; tone: ListTone } {
  switch (status?.toLowerCase()) {
    case "verified":
      return { label: "Verified", tone: "success" };
    case "manually_verified":
      return { label: "Manually Verified", tone: "success" };
    case "pending":
      return { label: "Pending", tone: "warning" };
    case "rejected":
      return { label: "Rejected", tone: "danger" };
    default:
      return { label: "Not Verified", tone: "muted" };
  }
}

/**
 * The page's `getExpiryBadge` wording and thresholds, as coloured text: a day
 * or less (including a hold that has already lapsed) is danger, three days or
 * less is warning, anything further out is a plain countdown. No expiry, no
 * text, as in v1.
 */
export function expiryStatusV2(days: number | null): { label: string; tone: ListTone } | null {
  if (days === null) return null;
  if (days <= 1) return { label: `Expires in ${days} day${days !== 1 ? "s" : ""}`, tone: "danger" };
  if (days <= 3) return { label: `Expires in ${days} days`, tone: "warning" };
  return { label: `${days} days left`, tone: "muted" };
}

const formatBookingDate = (date: string | null | undefined) => (date ? format(parseISO(date), "MMM dd, yyyy") : null);

export function PendingBookingsTableV2({
  bookings,
  canEdit,
  actionsDisabled,
  vehicleName,
  daysUntilExpiry,
  onReject,
  onApprove,
}: {
  /** Every booking the queue's query returned, in its order. */
  bookings: PendingBooking[] | undefined;
  /** The page's `canEdit('pending_bookings')`. */
  canEdit: boolean;
  /** The page's `approveBooking.isPending || rejectBooking.isPending`. */
  actionsDisabled: boolean;
  /** The page's `getVehicleName`. */
  vehicleName: (booking: PendingBooking) => string;
  /** The page's `getDaysUntilExpiry`. */
  daysUntilExpiry: (expiresAt: string | null) => number | null;
  /** v1's Reject button body: select the booking and open the reject dialog. */
  onReject: (booking: PendingBooking) => void;
  /** v1's Approve button body: select the booking and open the approve dialog. */
  onApprove: (booking: PendingBooking) => void;
}) {
  const { tenant } = useTenant();
  // The set changes only with the tenant: the queue has no search, filter or
  // sort. The hook refetches every minute with a new array, which must NOT
  // reset an operator scrolled deep into the queue.
  const bookingRows = useProgressiveRows(bookings ?? NO_BOOKINGS, tenant?.id ?? "");

  // No rows yet because the query has not run (it waits for the tenant): the
  // page's own loading spinner, never an empty table.
  if (!bookings) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <ListTable rows={bookingRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          {/* Widths, measured in Manrope on a 944px card. Pickup, Return,
              Amount, Verification and Expiry hold their longest values whole,
              and the actions cell holds both buttons. The customer's name and
              contact, and the make and model, are what truncate, each with
              its full value in a title. */}
          <ListHead className="w-[14.3%]">Customer</ListHead>
          <ListHead className="w-[13.1%]">Vehicle</ListHead>
          <ListHead className="w-[11.9%] px-2">Pickup</ListHead>
          <ListHead className="w-[11.9%] px-2">Return</ListHead>
          <ListHead className="w-[10.5%] px-2">Amount</ListHead>
          <ListHead className="w-[14.6%] px-2">Verification</ListHead>
          <ListHead className="w-[15.6%] px-2">Expiry</ListHead>
          <ListHead className="w-[8.1%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {bookingRows.visible.map((booking) => {
            const customer = booking.customer;
            const contact = customer?.email || customer?.phone;
            const reg = booking.vehicle?.reg;
            const name = vehicleName(booking);
            // `getVehicleName` falls back to the registration (or "Unknown
            // Vehicle") when make or model is missing: show that once, not twice.
            const makeModel = booking.vehicle?.make && booking.vehicle?.model ? name : null;
            const pickup = formatBookingDate(booking.rental?.start_date);
            const dropoff = formatBookingDate(booking.rental?.end_date);
            const verification = verificationStatusV2(customer?.identity_verification_status);
            const expiry = expiryStatusV2(daysUntilExpiry(booking.preauth_expires_at));

            return (
              <ListRow key={booking.id}>
                {/* One line: the name carries the row, the contact follows it,
                    quieter. v1's third line (phone beside an email) is in the
                    title with the rest, so nothing is lost. */}
                <ListCell>
                  {customer?.name || contact ? (
                    <span
                      className="block truncate"
                      title={[customer?.name, customer?.email, customer?.phone].filter(Boolean).join(" · ")}
                    >
                      {customer?.name && <span className={LIST_CLASSES.identifier}>{customer.name}</span>}
                      {customer?.name && contact && <span className="text-muted-foreground"> · </span>}
                      {contact && <span className="text-muted-foreground">{contact}</span>}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                {/* The registration stays whole; make and model follow it and
                    give way first. */}
                <ListCell>
                  {reg && makeModel ? (
                    <span className="flex max-w-full items-center gap-1.5" title={`${reg} • ${makeModel}`}>
                      <span className={`${LIST_CLASSES.text} shrink-0 tabular-nums`}>{reg}</span>
                      <span className="min-w-0 truncate text-muted-foreground">{makeModel}</span>
                    </span>
                  ) : booking.vehicle?.make && booking.vehicle?.model ? (
                    <span className={`block truncate ${LIST_CLASSES.text}`} title={name}>
                      {name}
                    </span>
                  ) : reg ? (
                    <span className={`${LIST_CLASSES.text} tabular-nums`}>{reg}</span>
                  ) : (
                    <span className="block truncate text-muted-foreground" title={name}>
                      {name}
                    </span>
                  )}
                </ListCell>
                <ListCell className="px-2 tabular-nums">
                  {pickup ? <span className={LIST_CLASSES.text}>{pickup}</span> : <Blank />}
                </ListCell>
                <ListCell className="px-2 tabular-nums">
                  {dropoff ? <span className={LIST_CLASSES.text}>{dropoff}</span> : <Blank />}
                </ListCell>
                {/* v1's "$" and `toLocaleString()`, so the figure reads exactly
                    as the confirmation dialogs print it. */}
                <ListCell className="px-2 tabular-nums">
                  {booking.amount != null ? (
                    <span className={LIST_CLASSES.text}>${booking.amount.toLocaleString()}</span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className="px-2">
                  <ListStatusText tone={verification.tone}>{verification.label}</ListStatusText>
                </ListCell>
                <ListCell className="px-2">
                  {expiry && <ListStatusText tone={expiry.tone}>{expiry.label}</ListStatusText>}
                </ListCell>
                {/* Both buttons only open the page's confirmations. Their clicks
                    stop here, so a row click added later could never fire with
                    one. */}
                <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                  {canEdit && (
                    <div className="flex items-center justify-end">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="-my-1.5 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10"
                              onClick={() => onReject(booking)}
                              disabled={actionsDisabled}
                              aria-label={`Reject booking${customer?.name ? ` for ${customer.name}` : ""}`}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Reject</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="-my-1.5 text-green-600 hover:bg-green-50 hover:text-green-700 dark:text-green-400 dark:hover:bg-green-500/10"
                              onClick={() => onApprove(booking)}
                              disabled={actionsDisabled}
                              aria-label={`Approve booking${customer?.name ? ` for ${customer.name}` : ""}`}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Approve</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </ListCell>
              </ListRow>
            );
          })}
        </ListBody>
      </ListTable>
      <ListFooter rows={bookingRows} one="pending booking" many="pending bookings" />
    </>
  );
}
