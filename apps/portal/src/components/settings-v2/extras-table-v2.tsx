"use client";

/**
 * v2 (northwind): the Rental Extras table on Settings → Extras, built from the
 * rentals list's kit (`components/shared/list-table-v2`) on its flat settings
 * surface (`surface="settings"`). No pager: rows arrive 25 at a time as the
 * table scrolls, with one line under the table saying how much is shown while
 * more are to come (none once every extra is on screen).
 *
 * Rows open nothing. There is no extra record route and the v1 row opens nothing
 * either: its only control is the ⋯ menu, kept here with the same items, in the
 * same order, under the same conditions, calling ExtrasSettings' own handlers,
 * so its dialogs and mutations run exactly as in v1.
 *
 * v1 tints each row: yellow for an inactive extra, red for low stock, emerald
 * otherwise. The kit has no row tints, so that meaning moves into the cells:
 * Status is Active (success), Inactive (warning) or Sold out (danger), Stock
 * reads in the danger tone when it is out or low (v1's red stock text), and the
 * low-stock triangle stays beside the name.
 *
 * EXTREME DATA. A thumbnail whose image fails to load becomes the image tile
 * (no broken-image glyph). A price too wide for its column wraps inside it
 * rather than running into Pricing, and a per-day extra says "/ day" so it does
 * not read as a flat fee. When the bookings or vehicle-price read failed, stock
 * and the vehicle count print a dash instead of a confident wrong number. Below
 * `sm` the 880px table would hide Price, Stock, Status and the ⋯ menu off the
 * right edge with no cue, so phones get one stacked row per extra instead.
 *
 * The progressive-rows hook lives HERE, not in ExtrasSettings, so it mounts with
 * its table and its sentinel. The rows come from `useRentalExtras`, which holds
 * every extra in memory in `sort_order`. The table lists the NEWEST first, like
 * every other v2 list (`newestExtrasFirst`), and offers no sorting. Nothing in
 * the portal reorders extras: `sort_order` is the count at creation, so the
 * booking site's order is simply oldest first.
 */

import { AlertTriangle, ImageIcon, Loader2, MoreHorizontal, PackagePlus, Pencil, Power, Trash2 } from "lucide-react";
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
} from "@/components/shared/list-table-v2";
import {
  formatSettingsMoney,
  formatSettingsNumber,
  SETTINGS_PHONE_FACTS,
  SettingsImage,
  TruncatedText,
} from "@/components/settings-v2/section-states";
import { useMemo } from "react";
import type { RentalExtra } from "@/hooks/use-rental-extras";
import { cn } from "@/lib/utils";

/**
 * Newest first: by `created_at`, latest first; an extra without a readable
 * date goes last; ties fall back to the higher `sort_order` (the later one).
 * Returns a new array; `extras` is not touched.
 */
export function newestExtrasFirst<T extends Pick<RentalExtra, "created_at" | "sort_order">>(extras: readonly T[]): T[] {
  const time = (extra: T) => {
    const ms = Date.parse(extra.created_at ?? "");
    return Number.isNaN(ms) ? -Infinity : ms;
  };
  return [...extras].sort((a, b) => time(b) - time(a) || (b.sort_order ?? 0) - (a.sort_order ?? 0));
}

const Blank = ({ title }: { title?: string }) => (
  <span className="text-muted-foreground" title={title}>
    —
  </span>
);

const STOCK_UNKNOWN = "Bookings couldn't be loaded, so stock left is unknown";
const PRICES_UNKNOWN = "Vehicle prices couldn't be loaded";

/** "AED 12.50", "AED 12.50 / day", or "Varies". Never truncated. */
export function extraPriceLabel(
  extra: Pick<RentalExtra, "pricing_type" | "price" | "billing_type">,
  currencyCode: string,
): string {
  const base = extra.pricing_type === "per_vehicle" ? "Varies" : formatSettingsMoney(extra.price, currencyCode);
  return extra.billing_type === "per_day" ? `${base} / day` : base;
}

export type ExtraStatus = "active" | "inactive" | "sold_out";

export function extraStatus(
  extra: Pick<RentalExtra, "is_active" | "max_quantity" | "remaining_stock" | "stock_unknown">,
): ExtraStatus {
  if (!extra.is_active) return "inactive";
  if (extra.max_quantity !== null && !extra.stock_unknown && extra.remaining_stock === 0) return "sold_out";
  return "active";
}

function StatusText({ extra }: { extra: RentalExtra }) {
  const status = extraStatus(extra);
  if (status === "inactive") return <ListStatusText tone="warning">Inactive</ListStatusText>;
  if (status === "sold_out") return <ListStatusText tone="danger">Sold out</ListStatusText>;
  return <ListStatusText tone="success">Active</ListStatusText>;
}

function StockText({ extra, lowStock }: { extra: RentalExtra; lowStock: boolean }) {
  if (extra.max_quantity === null) return <Blank />;
  if (extra.stock_unknown) return <Blank title={STOCK_UNKNOWN} />;
  const label = `${formatSettingsNumber(extra.remaining_stock)} left`;
  return extra.remaining_stock === 0 || lowStock ? (
    <ListStatusText tone="danger">{label}</ListStatusText>
  ) : (
    <span className={LIST_CLASSES.text}>{label}</span>
  );
}

function pricingLabel(extra: RentalExtra): { text: string; title?: string } {
  if (extra.pricing_type !== "per_vehicle") return { text: "Global" };
  if (extra.vehicle_pricing_unknown) return { text: "Per Vehicle (—)", title: PRICES_UNKNOWN };
  return { text: `Per Vehicle (${formatSettingsNumber(extra.vehicle_pricing?.length || 0)})` };
}

interface MenuProps<T> {
  extra: T;
  busy: boolean;
  onEdit: (extra: T) => void;
  onUpdateStock: (extra: T) => void;
  onToggleActive: (extra: T) => void | Promise<void>;
  onDelete: (extra: T) => void;
}

function ExtraRowMenu<T extends RentalExtra>({ extra, busy, onEdit, onUpdateStock, onToggleActive, onDelete }: MenuProps<T>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={LIST_ROW_ACTION} aria-label={`Actions for ${extra.name}`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      {/* Surface tone: this row menu sits on a light Settings table, where the
          default translucent near-black panel reads as an OS menu. */}
      <DropdownMenuContent tone="surface" align="end" className="w-auto">
        <DropdownMenuItem onClick={() => onEdit(extra)}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </DropdownMenuItem>
        {extra.max_quantity !== null && (
          <DropdownMenuItem onClick={() => onUpdateStock(extra)}>
            <PackagePlus className="h-3.5 w-3.5" />
            Update Stock
          </DropdownMenuItem>
        )}
        {/* v1 reads "Deactive", a typo; v2 says what it does. Disabled while
            its own write is in flight, so a double click cannot send two
            opposite writes. */}
        <DropdownMenuItem disabled={busy} onClick={() => void onToggleActive(extra)}>
          <Power className="h-3.5 w-3.5" />
          {busy ? "Updating…" : extra.is_active ? "Deactivate" : "Activate"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(extra)}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Thumbnail({ extra, className }: { extra: RentalExtra; className: string }) {
  return (
    <SettingsImage src={extra.image_urls[0]} alt="" fallbackIcon={ImageIcon} className={cn("block", className)} />
  );
}

export function ExtrasTableV2<T extends RentalExtra>({
  extras,
  resetKey,
  currencyCode,
  canEdit,
  isLowStock,
  busyId = null,
  onEdit,
  onUpdateStock,
  onToggleActive,
  onDelete,
}: {
  /** Every extra from `useRentalExtras`, in its `sort_order` (shown newest first). */
  extras: T[];
  /** Changes with the result set only (the tenant): see `useProgressiveRows`. */
  resetKey: string;
  currencyCode: string;
  /** `canEditSettings('extras')`: without it the row shows no menu. */
  canEdit: boolean;
  /** ExtrasSettings' own `isLowStock`, so the rule lives in one place. */
  isLowStock: (extra: T) => boolean;
  /** The extra whose Activate/Deactivate is in flight. */
  busyId?: string | null;
  /** The v1 menu's handlers. */
  onEdit: (extra: T) => void;
  onUpdateStock: (extra: T) => void;
  onToggleActive: (extra: T) => void | Promise<void>;
  onDelete: (extra: T) => void;
}) {
  const ordered = useMemo(() => newestExtrasFirst(extras), [extras]);
  const extraRows = useProgressiveRows(ordered, resetKey);
  const menu = (extra: T) =>
    canEdit ? (
      <ExtraRowMenu
        extra={extra}
        busy={busyId === extra.id}
        onEdit={onEdit}
        onUpdateStock={onUpdateStock}
        onToggleActive={onToggleActive}
        onDelete={onDelete}
      />
    ) : null;

  return (
    <>
      {/* Phones: one stacked row per extra. The table below is hidden here. */}
      <ul className="space-y-2 sm:hidden" aria-label="Rental extras">
        {extraRows.visible.map((extra) => {
          const lowStock = isLowStock(extra);
          return (
            <li key={extra.id} className="flex items-start gap-3 rounded-2xl bg-muted/40 px-4 py-3">
              <Thumbnail extra={extra} className="size-10 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <TruncatedText text={extra.name} className={LIST_CLASSES.identifier} />
                  {lowStock && extra.is_active && (
                    <AlertTriangle className="size-3.5 shrink-0 text-red-500 dark:text-red-400" aria-label="Low stock" />
                  )}
                </div>
                <p className={cn(SETTINGS_PHONE_FACTS.line, "text-sm")}>
                  <span
                    className={cn(
                      "tabular-nums [overflow-wrap:anywhere]",
                      LIST_CLASSES.text,
                      extra.pricing_type !== "per_vehicle" && Number(extra.price) < 0 && "text-red-500 dark:text-red-400",
                    )}
                  >
                    {extraPriceLabel(extra, currencyCode)}
                  </span>
                  <span className={SETTINGS_PHONE_FACTS.afterDot}>
                    <StatusText extra={extra} />
                  </span>
                  {extra.max_quantity !== null && (
                    <span className={cn("tabular-nums", SETTINGS_PHONE_FACTS.afterDot)}>
                      <StockText extra={extra} lowStock={lowStock} />
                    </span>
                  )}
                </p>
                <p className={cn(SETTINGS_PHONE_FACTS.line, "text-xs text-muted-foreground")} title={pricingLabel(extra).title}>
                  <span className="[overflow-wrap:anywhere]">{pricingLabel(extra).text}</span>
                  <span className={SETTINGS_PHONE_FACTS.afterDot}>{extra.max_quantity !== null ? "Quantity" : "Add-on"}</span>
                </p>
              </div>
              {menu(extra)}
            </li>
          );
        })}
      </ul>

      <div className="hidden sm:block">
        <ListTable rows={extraRows} minWidth="min-w-[880px]" surface="settings">
          <ListHeaderRow withActions={canEdit} />
          <ListBody>
            {extraRows.visible.map((extra) => {
              const lowStock = isLowStock(extra);
              const imageCount = extra.image_urls.length;
              const pricing = pricingLabel(extra);
              return (
                <ListRow key={extra.id}>
                  {/* v1's Image and Name columns as one: a small thumbnail (its
                      negative margin keeps the row the height of a text row),
                      the image count on it as in v1, the name, and the low-stock
                      triangle, which never gives way to a long name. */}
                  <ListCell className="text-left">
                    <div className="flex min-w-0 items-center justify-start gap-2.5">
                      <span className="relative -my-0.5 shrink-0">
                        <Thumbnail extra={extra} className="size-6 rounded" />
                        {imageCount > 1 && (
                          <span
                            className="absolute -bottom-1 -right-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full border bg-muted px-0.5 text-[9px] font-medium leading-none tabular-nums text-foreground"
                            title={`${imageCount} images`}
                          >
                            {imageCount > 99 ? "99+" : imageCount}
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
                  {/* Never truncated: an ellipsis here hides money. Too wide for
                      the column, it wraps inside the cell instead. */}
                  <ListCell className="tabular-nums">
                    <span
                      className={cn(
                        "block [overflow-wrap:anywhere]",
                        extra.pricing_type === "per_vehicle" ? "text-muted-foreground" : LIST_CLASSES.text,
                        extra.pricing_type !== "per_vehicle" && Number(extra.price) < 0 && "text-red-500 dark:text-red-400",
                      )}
                    >
                      {extraPriceLabel(extra, currencyCode)}
                    </span>
                  </ListCell>
                  <ListCell>
                    <span className={`tabular-nums ${LIST_CLASSES.text}`} title={pricing.title}>
                      {pricing.text}
                    </span>
                  </ListCell>
                  <ListCell>
                    <span className={LIST_CLASSES.text}>{extra.max_quantity !== null ? "Quantity" : "Add-on"}</span>
                  </ListCell>
                  {/* v1 prints out-of-stock and low stock in red: the danger tone. */}
                  <ListCell className="tabular-nums">
                    <span className="block [overflow-wrap:anywhere]">
                      <StockText extra={extra} lowStock={lowStock} />
                    </span>
                  </ListCell>
                  <ListCell>
                    <StatusText extra={extra} />
                  </ListCell>
                  {/* The same menu as v1. Clicks on the trigger and on its items
                      (portalled, but still React children of this cell) stop here. */}
                  {canEdit && (
                    <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {menu(extra)}
                    </ListCell>
                  )}
                </ListRow>
              );
            })}
          </ListBody>
        </ListTable>
      </div>
      <ListFooter rows={extraRows} one="extra" many="extras" hideWhenAllShown />
    </>
  );
}

/**
 * Widths measured at the 944px card with Manrope, each with a few pixels to
 * spare: Price holds "AED 12,345.67", Pricing "Per Vehicle (128)", Type
 * "Quantity", Stock "1000 left" and Status "Inactive". Extra and Description
 * take the rest and truncate with their full text in a tooltip.
 */
function ListHeaderRow({ withActions }: { withActions: boolean }) {
  return (
    <ListTableHeader>
      <ListHead className="w-[22%] text-left">Extra</ListHead>
      <ListHead className="w-[16.5%]">Description</ListHead>
      <ListHead className="w-[13.5%]">Price</ListHead>
      <ListHead className="w-[15%]">Pricing</ListHead>
      <ListHead className="w-[9%]">Type</ListHead>
      <ListHead className="w-[9.5%]">Stock</ListHead>
      <ListHead className="w-[8.5%]">Status</ListHead>
      {/* Only for someone who can use the menu: for a viewer it was a blank
          column with nothing under its blank heading. */}
      {withActions && (
        <ListHead className="w-[6%] text-right">
          <span className="sr-only">Actions</span>
        </ListHead>
      )}
    </ListTableHeader>
  );
}
