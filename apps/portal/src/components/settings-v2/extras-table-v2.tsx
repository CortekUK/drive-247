"use client";

/**
 * v2 (northwind): the Rental Extras table on Settings → Extras, built from the
 * rentals list's kit (`components/shared/list-table-v2`) on its flat settings
 * surface (`surface="settings"`). No pager: rows arrive 25 at a time as the
 * table scrolls, with one line under the table saying how much is shown while
 * more are to come (none once every extra is on screen).
 *
 * Rows open nothing: there is no extra record route, and the v1 row opens
 * nothing either.
 *
 * TEAM LEAD REVIEW, Sep 20 2026 — what this table stopped doing, and why.
 *
 *  - NO IMAGE IN THE TABLE. The 24px thumbnail and its image-count pip are
 *    gone, and with them the indent they left before every name ("this gap —
 *    remove it, it should start from here"). The picture is not lost: hovering
 *    ANYWHERE on the row shows it full size beside the name, the way the
 *    vehicles list shows a car's cover photo. Phones keep their thumbnail —
 *    there is no hover on a touch screen, and the stacked rows are not the
 *    table he was looking at.
 *  - NO DESCRIPTION COLUMN. Truncated prose in a 150px column said nothing;
 *    the full description is in the row's own Edit dialog, unchanged.
 *  - NO TYPE COLUMN. It read "Quantity" or "Add-on", which Stock already says:
 *    a quantity extra counts down there, an add-on prints a dash. Removing it
 *    is what makes room for the actions. Stock stays (his words).
 *  - EDIT, UPDATE STOCK, ACTIVATE/DEACTIVATE AND DELETE ARE IN THE ROW, as
 *    labelled icon buttons, instead of hiding behind a "⋯" menu. Same handlers,
 *    same order, same conditions as the menu had, so the dialogs and mutations
 *    below them are still ExtrasSettings' own and still shared with v1. The
 *    menu itself stays for the phone rows, where four buttons do not fit.
 *  - The header reads "Name", not "Extra": the page is already called Extras
 *    and the column holds a name.
 *
 * v1 tints each row: yellow for an inactive extra, red for low stock, emerald
 * otherwise. The kit has no row tints, so that meaning moves into the cells:
 * Status is Active (success), Inactive (warning) or Sold out (danger), Stock
 * reads in the danger tone when it is out or low (v1's red stock text), and the
 * low-stock triangle stays beside the name.
 *
 * EXTREME DATA. An image that fails to load becomes the image tile, in the
 * hover card and in the phone thumbnail alike (no broken-image glyph). A price
 * too wide for its column wraps inside it rather than running into Pricing, and
 * a per-day extra says "/ day" so it does not read as a flat fee. When the
 * bookings or vehicle-price read failed, stock and the vehicle count print a
 * dash instead of a confident wrong number. Below `sm` the wide table would
 * hide Price, Stock, Status and the row's controls off the right edge with no
 * cue, so phones get one stacked row per extra instead.
 *
 * The progressive-rows hook lives HERE, not in ExtrasSettings, so it mounts with
 * its table and its sentinel. The rows come from `useRentalExtras`, which holds
 * every extra in memory in `sort_order`. The table lists the NEWEST first, like
 * every other v2 list (`newestExtrasFirst`), and offers no sorting. Nothing in
 * the portal reorders extras: `sort_order` is the count at creation, so the
 * booking site's order is simply oldest first.
 */

import {
  AlertTriangle,
  ImageIcon,
  Loader2,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Power,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui-v2/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui-v2/hover-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui-v2/tooltip";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface RowActionProps<T> {
  extra: T;
  busy: boolean;
  onEdit: (extra: T) => void;
  onUpdateStock: (extra: T) => void;
  onToggleActive: (extra: T) => void | Promise<void>;
  onDelete: (extra: T) => void;
}

/**
 * The phone stacked row's controls. The table's live in the row itself
 * (`ExtraRowActions`); on a 360px row four buttons do not fit, so the menu is
 * kept here, with the same items, in the same order, under the same conditions.
 */
function ExtraRowMenu<T extends RentalExtra>({ extra, busy, onEdit, onUpdateStock, onToggleActive, onDelete }: RowActionProps<T>) {
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

/**
 * One row control: an icon button that says what it does on hover and to a
 * screen reader. The same shape Custom pricing's holiday rows use, so the two
 * Pricing tables read alike.
 */
function IconAction({
  icon: Icon,
  label,
  tooltip,
  onClick,
  destructive,
  busy,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  tooltip: string;
  onClick: () => void;
  destructive?: boolean;
  /** Its own write is in flight: a spinner in place of the icon. */
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(LIST_ROW_ACTION, destructive && "hover:text-destructive")}
          onClick={onClick}
          disabled={disabled || busy}
          aria-label={label}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Edit, Update stock, Activate/Deactivate and Delete, in the row (team lead,
 * Sep 20 2026). Update stock only where there is stock to update, exactly as
 * the "⋯" menu did; Activate/Deactivate is disabled while its own write is in
 * flight, so a double click cannot send two opposite writes.
 */
function ExtraRowActions<T extends RentalExtra>({ extra, busy, onEdit, onUpdateStock, onToggleActive, onDelete }: RowActionProps<T>) {
  return (
    <div className="flex justify-end gap-0.5">
      <IconAction icon={Pencil} tooltip="Edit" label={`Edit ${extra.name}`} onClick={() => onEdit(extra)} />
      {extra.max_quantity !== null && (
        <IconAction
          icon={PackagePlus}
          tooltip="Update stock"
          label={`Update stock for ${extra.name}`}
          onClick={() => onUpdateStock(extra)}
        />
      )}
      <IconAction
        icon={Power}
        tooltip={extra.is_active ? "Deactivate" : "Activate"}
        label={`${extra.is_active ? "Deactivate" : "Activate"} ${extra.name}`}
        onClick={() => void onToggleActive(extra)}
        busy={busy}
      />
      <IconAction
        icon={Trash2}
        tooltip="Delete"
        label={`Delete ${extra.name}`}
        onClick={() => onDelete(extra)}
        destructive
      />
    </div>
  );
}

function Thumbnail({ extra, className }: { extra: RentalExtra; className: string }) {
  return (
    <SettingsImage src={extra.image_urls[0]} alt="" fallbackIcon={ImageIcon} className={cn("block", className)} />
  );
}

/** How long the pointer must rest on a row before its picture appears. */
const HOVER_OPEN_DELAY = 150;

/**
 * Open while the pointer rests on the row, closed the moment it leaves.
 *
 * The delay is ours rather than Radix's `openDelay` because the thing being
 * hovered is the whole ROW and the card is anchored to the name inside it:
 * Radix would only ever see the name. The timer is cleared on unmount, so a
 * row that scrolls out of the progressive slice cannot open a card afterwards.
 */
function useRowHover(delay = HOVER_OPEN_DELAY) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => clear, [clear]);
  const onMouseEnter = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [clear, delay]);
  const onMouseLeave = useCallback(() => {
    clear();
    setOpen(false);
  }, [clear]);
  return { open, onMouseEnter, onMouseLeave };
}

/**
 * The extra's name, and — while the row is hovered — its picture beside it.
 *
 * The card is CONTROLLED by the row (`open`), so the whole row is the hover
 * target while the card still opens next to the name rather than off the right
 * edge of a full-width row. It is `pointer-events-none` on purpose: a portalled
 * card sits above the row, so a pointer entering it would fire the row's
 * `mouseleave`, close the card, land back on the row and open it again —
 * a flicker loop. Nothing in the card is clickable, so letting the pointer
 * through costs nothing.
 *
 * With no image there is no card at all: an empty popover is worse than none.
 */
function ExtraName({ extra, open }: { extra: RentalExtra; open: boolean }) {
  const image = extra.image_urls[0];
  const name = (
    <span className={`min-w-0 truncate ${LIST_CLASSES.identifier}`} title={extra.name}>
      {extra.name}
    </span>
  );
  if (!image) return name;
  const count = extra.image_urls.length;
  return (
    <HoverCard open={open}>
      <HoverCardTrigger asChild>{name}</HoverCardTrigger>
      <HoverCardContent side="right" align="center" className="pointer-events-none w-72 space-y-1.5 p-1.5">
        <SettingsImage
          src={image}
          alt={`Picture of ${extra.name}`}
          fallbackIcon={ImageIcon}
          className="aspect-[16/10] w-full rounded-[18px]"
        />
        {count > 1 && (
          <p className="px-1.5 pb-0.5 text-xs text-muted-foreground">
            1 of {formatSettingsNumber(count)} images
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * One table row. A component rather than markup inside the map because the
 * hover state belongs to the row: a single id held by the table would re-render
 * every visible row on every pointer move between them.
 */
function ExtraRow<T extends RentalExtra>({
  extra,
  lowStock,
  currencyCode,
  canEdit,
  busy,
  onEdit,
  onUpdateStock,
  onToggleActive,
  onDelete,
}: RowActionProps<T> & { lowStock: boolean; currencyCode: string; canEdit: boolean }) {
  const hover = useRowHover();
  const pricing = pricingLabel(extra);
  return (
    <ListRow onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave}>
      {/* The name, and the extra's picture while the row is hovered. No
          thumbnail: the indent it left before every name is what the review
          called "this gap". */}
      <ListCell>
        <div className="flex min-w-0 items-center gap-2.5">
          <ExtraName extra={extra} open={hover.open} />
          {lowStock && extra.is_active && (
            <span className="shrink-0" title="Below 20% stock">
              <AlertTriangle className="size-3.5 text-red-500 dark:text-red-400" aria-hidden="true" />
              <span className="sr-only">Low stock</span>
            </span>
          )}
        </div>
      </ListCell>
      {/* Never truncated: an ellipsis here hides money. Too wide for
          the column, it wraps inside the cell instead. */}
      <ListCell className="text-right tabular-nums">
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
      {/* v1 prints out-of-stock and low stock in red: the danger tone. */}
      <ListCell className="tabular-nums">
        <span className="block [overflow-wrap:anywhere]">
          <StockText extra={extra} lowStock={lowStock} />
        </span>
      </ListCell>
      <ListCell>
        <StatusText extra={extra} />
      </ListCell>
      {/* v1's menu items, as controls in the row. Clicks stop here.
          The whole CELL is gated, not just its contents: the header drops the
          actions column for a read-only user, so a cell left behind here would
          leave the body one column wider than the head and shift every row. */}
      {canEdit && (
        <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <ExtraRowActions
            extra={extra}
            busy={busy}
            onEdit={onEdit}
            onUpdateStock={onUpdateStock}
            onToggleActive={onToggleActive}
            onDelete={onDelete}
          />
        </ListCell>
      )}
    </ListRow>
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
  /** `canEditSettings('extras')`: without it the row shows no controls. */
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

  return (
    <>
      {/* Phones: one stacked row per extra. The table below is hidden here, and
          so is the hover card — there is no hover on a touch screen, which is
          why these rows keep their thumbnail. */}
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
              {canEdit && (
                <ExtraRowMenu
                  extra={extra}
                  busy={busyId === extra.id}
                  onEdit={onEdit}
                  onUpdateStock={onUpdateStock}
                  onToggleActive={onToggleActive}
                  onDelete={onDelete}
                />
              )}
            </li>
          );
        })}
      </ul>

      <div className="hidden sm:block">
        {/* One provider for the whole table: a tooltip per row would mount a
            provider per row. `delayDuration` matches Custom pricing's. */}
        <TooltipProvider delayDuration={300}>
          <ListTable rows={extraRows} minWidth="min-w-[820px]" surface="settings">
            <ListHeaderRow withActions={canEdit} />
            <ListBody>
              {extraRows.visible.map((extra) => (
                <ExtraRow
                  key={extra.id}
                  extra={extra}
                  lowStock={isLowStock(extra)}
                  currencyCode={currencyCode}
                  canEdit={canEdit}
                  busy={busyId === extra.id}
                  onEdit={onEdit}
                  onUpdateStock={onUpdateStock}
                  onToggleActive={onToggleActive}
                  onDelete={onDelete}
                />
              ))}
            </ListBody>
          </ListTable>
        </TooltipProvider>
      </div>
      <ListFooter rows={extraRows} one="extra" many="extras" hideWhenAllShown />
    </>
  );
}

/**
 * Widths measured at the 944px card with Manrope, each with a few pixels to
 * spare: Price holds "AED 12,345.67 / day", Pricing "Per Vehicle (128)", Stock
 * "1000 left" and Status "Inactive". Actions holds four 32px buttons. Name
 * takes the rest and truncates with its full text in a tooltip.
 */
function ListHeaderRow({ withActions }: { withActions: boolean }) {
  return (
    <ListTableHeader>
      <ListHead className="w-[28%]">Name</ListHead>
      {/* The one money column: right, so the figures stack. */}
      <ListHead className="w-[17%] text-right">Price</ListHead>
      <ListHead className="w-[16%]">Pricing</ListHead>
      <ListHead className="w-[11%]">Stock</ListHead>
      <ListHead className="w-[10%]">Status</ListHead>
      {/* Only for someone who can use the controls: for a viewer it was a
          blank column with nothing under its blank heading. */}
      {withActions && (
        <ListHead className="w-[18%] text-right">
          <span className="sr-only">Actions</span>
        </ListHead>
      )}
    </ListTableHeader>
  );
}
