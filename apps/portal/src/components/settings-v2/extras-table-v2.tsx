"use client";

/**
 * v2 (northwind): the Rental Extras table on Settings → Extras, built from the
 * rentals list's kit (`components/shared/list-table-v2`). No pager: rows arrive
 * 25 at a time as the table scrolls, with one line under the card saying how
 * much is shown.
 *
 * Rows open nothing. There is no extra record route and the v1 row opens nothing
 * either: its only control is the ⋯ menu, kept here with the same items, in the
 * same order, under the same conditions, calling ExtrasSettings' own handlers,
 * so its dialogs and mutations run exactly as in v1.
 *
 * v1 tints each row: yellow for an inactive extra, red for low stock, emerald
 * otherwise. The kit has no row tints, so that meaning moves into the cells:
 * Status is Active (success) or Inactive (warning), Stock reads in the danger
 * tone when it is out or low (v1's red stock text), and the low-stock triangle
 * stays beside the name.
 *
 * The progressive-rows hook lives HERE, not in ExtrasSettings, so it mounts with
 * its table and its sentinel. The rows come from `useRentalExtras`, which holds
 * every extra in memory in `sort_order`, the order the booking site shows them
 * in, so the table keeps that order and offers no sorting.
 */

import { AlertTriangle, ImageIcon, MoreHorizontal, PackagePlus, Pencil, Power, Trash2 } from "lucide-react";
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
} from "@/components/shared/list-table-v2";
import { formatCurrency } from "@/lib/format-utils";
import type { RentalExtra } from "@/hooks/use-rental-extras";

const Blank = () => <span className="text-muted-foreground">—</span>;

export function ExtrasTableV2<T extends RentalExtra>({
  extras,
  resetKey,
  currencyCode,
  canEdit,
  isLowStock,
  onEdit,
  onUpdateStock,
  onToggleActive,
  onDelete,
}: {
  /** Every extra from `useRentalExtras`, in its `sort_order`. */
  extras: T[];
  /** Changes with the result set only (the tenant): see `useProgressiveRows`. */
  resetKey: string;
  currencyCode: string;
  /** `canEditSettings('extras')`: without it the row shows no menu. */
  canEdit: boolean;
  /** ExtrasSettings' own `isLowStock`, so the rule lives in one place. */
  isLowStock: (extra: T) => boolean;
  /** The v1 menu's handlers. */
  onEdit: (extra: T) => void;
  onUpdateStock: (extra: T) => void;
  onToggleActive: (extra: T) => void | Promise<void>;
  onDelete: (extra: T) => void;
}) {
  const extraRows = useProgressiveRows(extras, resetKey);

  return (
    <>
      <ListTable rows={extraRows} minWidth="min-w-[880px]">
        <ListHeaderRow />
        <ListBody>
          {extraRows.visible.map((extra) => {
            const lowStock = isLowStock(extra);
            const imageCount = extra.image_urls.length;
            return (
              <ListRow key={extra.id}>
                {/* v1's Image and Name columns as one: a small thumbnail (its
                    negative margin keeps the row the height of a text row),
                    the image count on it as in v1, the name, and the low-stock
                    triangle, which never gives way to a long name. */}
                <ListCell>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="relative -my-0.5 shrink-0">
                      {imageCount > 0 ? (
                        <img src={extra.image_urls[0]} alt="" className="block size-6 rounded object-cover" />
                      ) : (
                        <span className="flex size-6 items-center justify-center rounded bg-muted">
                          <ImageIcon className="size-3.5 text-muted-foreground" />
                        </span>
                      )}
                      {imageCount > 1 && (
                        <span
                          className="absolute -bottom-1 -right-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full border bg-muted px-0.5 text-[9px] font-medium leading-none tabular-nums text-foreground"
                          title={`${imageCount} images`}
                        >
                          {imageCount}
                        </span>
                      )}
                    </span>
                    <span className={`min-w-0 truncate ${LIST_CLASSES.identifier}`} title={extra.name}>
                      {extra.name}
                    </span>
                    {lowStock && extra.is_active && (
                      <span className="shrink-0" title="Below 20% stock">
                        <AlertTriangle className="size-3.5 text-red-500 dark:text-red-400" aria-hidden="true" />
                        <span className="sr-only">Low stock</span>
                      </span>
                    )}
                  </div>
                </ListCell>
                <ListCell>
                  {extra.description ? (
                    <span className={`block truncate ${LIST_CLASSES.text}`} title={extra.description}>
                      {extra.description}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                {/* Never truncated: an ellipsis here hides money. */}
                <ListCell className="tabular-nums">
                  {extra.pricing_type === 'per_vehicle' ? (
                    <span className="text-muted-foreground">Varies</span>
                  ) : (
                    <span className={LIST_CLASSES.text}>{formatCurrency(Number(extra.price), currencyCode)}</span>
                  )}
                </ListCell>
                <ListCell>
                  <span className={`tabular-nums ${LIST_CLASSES.text}`}>
                    {extra.pricing_type === 'per_vehicle'
                      ? `Per Vehicle (${extra.vehicle_pricing?.length || 0})`
                      : 'Global'}
                  </span>
                </ListCell>
                <ListCell>
                  <span className={LIST_CLASSES.text}>{extra.max_quantity !== null ? 'Quantity' : 'Add-on'}</span>
                </ListCell>
                {/* v1 prints out-of-stock and low stock in red: the danger tone. */}
                <ListCell className="tabular-nums">
                  {extra.max_quantity !== null ? (
                    extra.remaining_stock === 0 || lowStock ? (
                      <ListStatusText tone="danger">{extra.remaining_stock} left</ListStatusText>
                    ) : (
                      <span className={LIST_CLASSES.text}>{extra.remaining_stock} left</span>
                    )
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  {extra.is_active ? (
                    <ListStatusText tone="success">Active</ListStatusText>
                  ) : (
                    <ListStatusText tone="warning">Inactive</ListStatusText>
                  )}
                </ListCell>
                {/* The same menu as v1. Clicks on the trigger and on its items
                    (portalled, but still React children of this cell) stop here. */}
                <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={LIST_ROW_ACTION}
                          aria-label={`Actions for ${extra.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(extra)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        {extra.max_quantity !== null && (
                          <DropdownMenuItem onClick={() => onUpdateStock(extra)}>
                            <PackagePlus className="h-3.5 w-3.5 mr-2" />
                            Update Stock
                          </DropdownMenuItem>
                        )}
                        {/* v1 reads "Deactive", a typo; v2 says what it does. */}
                        <DropdownMenuItem onClick={() => onToggleActive(extra)}>
                          <Power className="h-3.5 w-3.5 mr-2" />
                          {extra.is_active ? 'Deactivate' : 'Activate'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => onDelete(extra)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          Delete
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
      <ListFooter rows={extraRows} one="extra" many="extras" />
    </>
  );
}

/**
 * Widths measured at the 944px card with Manrope, each with a few pixels to
 * spare: Price holds "AED 12,345.67", Pricing "Per Vehicle (128)", Type
 * "Quantity", Stock "1000 left" and Status "Inactive". Extra and Description
 * take the rest and truncate with their full text in a tooltip.
 */
function ListHeaderRow() {
  return (
    <ListTableHeader>
      <ListHead className="w-[22%]">Extra</ListHead>
      <ListHead className="w-[16.5%]">Description</ListHead>
      <ListHead className="w-[13.5%]">Price</ListHead>
      <ListHead className="w-[15%]">Pricing</ListHead>
      <ListHead className="w-[9%]">Type</ListHead>
      <ListHead className="w-[9.5%]">Stock</ListHead>
      <ListHead className="w-[8.5%]">Status</ListHead>
      <ListHead className="w-[6%] text-right">
        <span className="sr-only">Actions</span>
      </ListHead>
    </ListTableHeader>
  );
}
