"use client";

/**
 * v2 (northwind): the /plates table, built from the rentals list's kit
 * (`components/shared/list-table-v2`). No pager and no page-size control. The
 * page's query already returns every matching plate in one request, so rows
 * arrive 25 at a time as the table scrolls, with one line under the card
 * saying how much is shown. Nothing here reads `?page` or `?size`.
 *
 * Rows do not open anything, because v1's rows do not. A `/plates/:id` route
 * exists, but the list never linked to it, and that page embeds
 * `assigned_vehicle_id` while every writer sets `vehicle_id`.
 *
 * Every control is the page's own. The page passes in the same handlers its v1
 * cells and menu call, and the menu keeps v1's conditions: Assign or Unassign
 * by `vehicle_id`, Mark Expired unless already expired, Delete disabled on an
 * assigned plate. Each control's cell stops its click, so a row click added
 * later can never fire alongside one (menu items are portalled, but their
 * clicks still bubble through React to the row).
 */

import { format } from "date-fns";
import { Car, Clock, Copy, Edit, FileText, History, MoreHorizontal, Trash2, UserX } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
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
import { formatCurrency } from "@/lib/format-utils";
import { parseLocalDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

const Blank = () => <span className="text-muted-foreground">—</span>;

/** The fields the table reads. The page's own `Plate` satisfies it. */
export interface PlateRowV2 {
  id: string;
  plate_number: string;
  vehicle_id?: string;
  supplier?: string;
  order_date?: string;
  cost?: number;
  status: string;
  notes?: string;
  document_url?: string;
  document_name?: string;
  vehicles?: {
    id: string;
    reg: string;
    make: string;
    model: string;
  };
}

/**
 * `PlateStatusBadge`'s labels, as coloured text, matched case-insensitively as
 * the badge matches them. Ordered is still waiting on the supplier; Received
 * and Assigned (which the badge also shows for legacy "fitted") are the healthy
 * states; Expired is closed and recedes. An unrecognised status shows its raw
 * value, as the badge does.
 */
export function plateStatusV2(status: string | null | undefined): { label: string; tone: ListTone } {
  switch (status?.toLowerCase()) {
    case "ordered":
      return { label: "Ordered", tone: "warning" };
    case "received":
      return { label: "Received", tone: "success" };
    case "fitted":
    case "assigned":
      return { label: "Assigned", tone: "success" };
    case "expired":
      return { label: "Expired", tone: "muted" };
    default:
      return { label: status || "Unknown", tone: "muted" };
  }
}

/** Placeholder bar widths per column while the first load is out. */
const SKELETON_BARS = ["w-20", "w-24", "w-20", "w-16", "w-14", "w-16", "w-24", "w-14", "w-6"];

export function PlatesTableV2<T extends PlateRowV2>({
  plates,
  resetKey,
  isLoading,
  hasActiveFilters,
  currencyCode,
  documentTitle,
  onCopyPlateNumber,
  onOpenVehicle,
  onOpenDocument,
  onEdit,
  onViewHistory,
  onAssign,
  onUnassign,
  onMarkExpired,
  onDelete,
  onClearFilters,
  onAddPlate,
}: {
  /** Every plate the query returned, in its order. Not a page slice. */
  plates: T[];
  /** Changes with the result set only: see `useProgressiveRows`. */
  resetKey: string;
  isLoading: boolean;
  hasActiveFilters: boolean;
  currencyCode: string;
  /** The page's `getDocumentFilename`, for the document button's title. */
  documentTitle: (plate: T) => string;
  onCopyPlateNumber: (plateNumber: string) => void;
  onOpenVehicle: (plate: T) => void;
  onOpenDocument: (plate: T) => void;
  onEdit: (plate: T) => void;
  onViewHistory: (plate: T) => void;
  onAssign: (plate: T) => void;
  onUnassign: (plate: T) => void;
  onMarkExpired: (plate: T) => void;
  onDelete: (plate: T) => void;
  onClearFilters: () => void;
  onAddPlate: () => void;
}) {
  const plateRows = useProgressiveRows(plates, resetKey);

  // Nothing to list: v1's empty-row message and link on their own, with no
  // table header around them, as the other v2 lists show theirs.
  if (!isLoading && plates.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        {hasActiveFilters ? (
          <>
            No plates match your filters.{" "}
            <Button variant="link" onClick={onClearFilters} className="h-auto p-0 align-baseline">
              Clear filters
            </Button>
          </>
        ) : (
          <>
            No plates found.{" "}
            <Button variant="link" onClick={onAddPlate} className="h-auto p-0 align-baseline">
              Add your first plate
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <ListTable rows={plateRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          {/* Widths, measured in Manrope on a 944px card (and still whole at
              the 880px minimum). Plate number, the registration, Order date,
              Cost and Status hold their longest values whole. Make and model, Supplier, Notes and the document
              name are the parts that truncate, each with its full value in a
              title. */}
          <ListHead className="w-[15.5%]">Plate number</ListHead>
          <ListHead className="w-[15%]">Vehicle</ListHead>
          <ListHead className="w-[10%]">Supplier</ListHead>
          <ListHead className="w-[12%]">Order date</ListHead>
          <ListHead className="w-[12%]">Cost</ListHead>
          <ListHead className="w-[10%]">Status</ListHead>
          <ListHead className="w-[9.5%]">Notes</ListHead>
          <ListHead className="w-[11%]">Document</ListHead>
          <ListHead className="w-[5%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {isLoading
            ? Array.from({ length: 8 }, (_, row) => (
                <ListRow key={row}>
                  {SKELETON_BARS.map((bar, cell) => (
                    <ListCell key={cell}>
                      {/* Centred like the cells they stand in for; the last is the actions column, which stays right. */}
                      <div
                        className={cn(
                          "h-3 animate-pulse rounded-full bg-muted",
                          cell === SKELETON_BARS.length - 1 ? "ml-auto" : "mx-auto",
                          bar,
                        )}
                      />
                    </ListCell>
                  ))}
                </ListRow>
              ))
            : plateRows.visible.map((plate) => {
                const status = plateStatusV2(plate.status);
                const makeModel = [plate.vehicles?.make, plate.vehicles?.model].filter(Boolean).join(" ");
                // v1's rules: a cost of 0 also shows a blank.
                const cost = plate.cost ? formatCurrency(Number(plate.cost), currencyCode) : null;
                const orderDate = plate.order_date ? format(parseLocalDate(plate.order_date), "MM/dd/yyyy") : null;

                return (
                  <ListRow key={plate.id}>
                    {/* Click to copy, as in v1, now a real button. */}
                    <ListCell onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onCopyPlateNumber(plate.plate_number)}
                        title="Click to copy"
                        className="group mx-auto flex max-w-full items-center justify-center gap-1.5 text-center"
                      >
                        <span className={LIST_CLASSES.identifier}>{plate.plate_number}</span>
                        <Copy className="size-3 shrink-0 text-muted-foreground group-hover:text-foreground" />
                      </button>
                    </ListCell>
                    {/* The registration stays whole; make and model follow it,
                        quieter, and give way first. */}
                    <ListCell onClick={(e) => e.stopPropagation()}>
                      {plate.vehicles ? (
                        <button
                          type="button"
                          onClick={() => onOpenVehicle(plate)}
                          className="mx-auto flex max-w-full items-center justify-center gap-1.5 text-center hover:underline"
                          title={makeModel ? `${plate.vehicles.reg} • ${makeModel}` : plate.vehicles.reg}
                        >
                          <span className={cn(LIST_CLASSES.text, "shrink-0 tabular-nums")}>{plate.vehicles.reg}</span>
                          {makeModel && <span className="min-w-0 truncate text-muted-foreground">{makeModel}</span>}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">Not Assigned</span>
                      )}
                    </ListCell>
                    <ListCell>
                      {plate.supplier ? (
                        <span className={`block truncate ${LIST_CLASSES.text}`} title={plate.supplier}>
                          {plate.supplier}
                        </span>
                      ) : (
                        <Blank />
                      )}
                    </ListCell>
                    <ListCell className="tabular-nums">
                      {orderDate ? <span className={LIST_CLASSES.text}>{orderDate}</span> : <Blank />}
                    </ListCell>
                    <ListCell className="tabular-nums">
                      {cost ? <span className={LIST_CLASSES.text}>{cost}</span> : <Blank />}
                    </ListCell>
                    <ListCell>
                      <ListStatusText tone={status.tone}>{status.label}</ListStatusText>
                    </ListCell>
                    <ListCell>
                      {plate.notes ? (
                        <span className={`block truncate ${LIST_CLASSES.text}`} title={plate.notes}>
                          {plate.notes}
                        </span>
                      ) : (
                        <Blank />
                      )}
                    </ListCell>
                    <ListCell onClick={(e) => e.stopPropagation()}>
                      {plate.document_url ? (
                        <button
                          type="button"
                          onClick={() => onOpenDocument(plate)}
                          title={documentTitle(plate)}
                          className={`${LIST_CLASSES.text} mx-auto flex max-w-full items-center justify-center gap-1.5 text-center hover:underline`}
                        >
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 truncate">{plate.document_name || "View"}</span>
                        </button>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </ListCell>
                    {/* v1's menu: same items, same conditions, same handlers. */}
                    <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            // `flex ml-auto`: as a block it adds no height to the row, right-aligned.
                            className={cn(LIST_ROW_ACTION, "ml-auto flex")}
                            aria-label={`Actions for plate ${plate.plate_number}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-auto">
                          <DropdownMenuItem onClick={() => onEdit(plate)}>
                            <Edit className="h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onViewHistory(plate)}>
                            <History className="h-4 w-4" />
                            View History
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {!plate.vehicle_id ? (
                            <DropdownMenuItem onClick={() => onAssign(plate)}>
                              <Car className="h-4 w-4" />
                              Assign
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => onUnassign(plate)}>
                              <UserX className="h-4 w-4" />
                              Unassign
                            </DropdownMenuItem>
                          )}
                          {plate.status !== "expired" && (
                            <DropdownMenuItem onClick={() => onMarkExpired(plate)}>
                              <Clock className="h-4 w-4" />
                              Mark Expired
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => onDelete(plate)}
                            className="text-destructive"
                            disabled={!!plate.vehicle_id}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ListCell>
                  </ListRow>
                );
              })}
        </ListBody>
      </ListTable>
      {!isLoading && <ListFooter rows={plateRows} one="plate" many="plates" />}
    </>
  );
}
