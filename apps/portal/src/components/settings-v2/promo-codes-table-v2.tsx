"use client";

/**
 * v2 (northwind): the "All Promo Codes" table on Settings → Promo Codes, built
 * from the rentals list's kit (`components/shared/list-table-v2`). No pager:
 * rows arrive 25 at a time as the table scrolls, with one line under the card
 * saying how much is shown.
 *
 * Rows open nothing. There is no promo code record route, and the v1 row opens
 * nothing either. Its three controls are kept with the Settings page's own
 * handlers: Copy becomes the code itself, as a button, and Edit and Delete move
 * into the ⋯ menu, where they still open the page's Edit dialog and its delete
 * confirmation, both shared with v1.
 *
 * The progressive-rows hook lives HERE, not on the Settings page: the table sits
 * inside a Radix `TabsContent` that unmounts while another settings tab is open,
 * below the page's early returns. Mounting the hook with its table mounts it with
 * its sentinel.
 *
 * The page's query neither pages nor counts, so every code is already in memory
 * and a growing slice is the whole mechanism. There is no `serverTotal`.
 *
 * v1's Type column is folded into Value. `type` is only ever 'percentage' or
 * 'value' (the create and edit selects offer nothing else), and Value already
 * prints the one as "12.5%" and the other as money, so the column repeated what
 * its neighbour says. Measured at the 944px card with Manrope, keeping it left
 * Name about 75px once the columns that must never be cut (a 17-character code
 * with its copy mark, "AED 12,500.00", "May 28, 2026", the MAX USERS and
 * AUTO-APPLY headings) had the room they need.
 */

import { format } from "date-fns";
import { Copy, FilePenLine, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { parseLocalDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";

/** The fields this table reads. A `promocodes` row satisfies it. */
export interface PromoCodeRowV2 {
  id: string;
  name: string;
  code: string;
  type: string;
  value: number;
  created_at: string;
  expires_at: string;
  max_users: number;
  min_duration_days: number | null;
}

const Blank = () => <span className="text-muted-foreground">—</span>;

/**
 * `created_at` and `expires_at` are written as `yyyy-MM-dd`. `new Date()` reads
 * that as UTC midnight and prints the previous day west of Greenwich, so the
 * value is parsed as the local calendar day it names. A value that does not
 * parse prints raw, which is how v1 prints every value.
 */
function PromoDate({ value }: { value: string | null | undefined }) {
  if (!value) return <Blank />;
  const date = parseLocalDate(value);
  return (
    <span className={LIST_CLASSES.text}>{Number.isNaN(date.getTime()) ? value : format(date, "PP")}</span>
  );
}

export function PromoCodesTableV2<T extends PromoCodeRowV2>({
  promos,
  resetKey,
  currencyCode,
  canEdit,
  onCopy,
  onEdit,
  onDelete,
}: {
  /** Every promo code the page's query returned, in its order. */
  promos: T[];
  /** Changes with the result set only (the tenant): see `useProgressiveRows`. */
  resetKey: string;
  currencyCode: string;
  /** `canEditSettings('promos')`: without it the row shows no Edit or Delete. */
  canEdit: boolean;
  /** The v1 Copy button's handler. */
  onCopy: (code: string) => void;
  /** The v1 Edit button's handler. */
  onEdit: (promo: T) => void;
  /** The v1 Delete button's handler. */
  onDelete: (promo: T) => void;
}) {
  const promoRows = useProgressiveRows(promos, resetKey);

  return (
    <>
      <ListTable rows={promoRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          {/* Widths measured at the 944px card with Manrope. Code holds a
              17-character code and its copy mark; Value "AED 12,500.00"; each
              date "May 28, 2026"; Max users and Auto-apply their own headings,
              which are wider than any value under them. Name takes the rest and
              truncates with its full text in a tooltip. */}
          <ListHead className="w-[16%]">Name</ListHead>
          <ListHead className="w-[19%]">Code</ListHead>
          <ListHead className="w-[13.5%]">Value</ListHead>
          <ListHead className="w-[12.5%]">Created</ListHead>
          <ListHead className="w-[12.5%]">Expires</ListHead>
          <ListHead className="w-[10%]">Max users</ListHead>
          <ListHead className="w-[10.5%]">Auto-apply</ListHead>
          <ListHead className="w-[6%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {promoRows.visible.map((promo) => (
            <ListRow key={promo.id}>
              <ListCell>
                <span className={`block truncate ${LIST_CLASSES.identifier}`} title={promo.name}>
                  {promo.name}
                </span>
              </ListCell>
              {/* v1's Copy button, now the code itself: one click copies it. */}
              <ListCell onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => onCopy(promo.code)}
                  title="Copy promo code"
                  aria-label={`Copy promo code ${promo.code}`}
                  className="group flex max-w-full items-center gap-1.5 text-left"
                >
                  <span className={`font-mono text-[13px] ${LIST_CLASSES.text}`}>{promo.code}</span>
                  <Copy className="size-3 shrink-0 text-muted-foreground group-hover:text-foreground" />
                </button>
              </ListCell>
              {/* Never truncated: an ellipsis here hides money. The % sign or the
                  currency is the type (see the note at the top of this file). */}
              <ListCell className="tabular-nums">
                <span className={LIST_CLASSES.text}>
                  {promo.type === 'percentage' ? `${promo.value}%` : formatCurrency(Number(promo.value), currencyCode)}
                </span>
              </ListCell>
              <ListCell className="tabular-nums">
                <PromoDate value={promo.created_at} />
              </ListCell>
              <ListCell className="tabular-nums">
                <PromoDate value={promo.expires_at} />
              </ListCell>
              <ListCell className="tabular-nums">
                <span className={LIST_CLASSES.text}>{promo.max_users}</span>
              </ListCell>
              {/* v1's amber badge for an auto-applied code, as coloured text. */}
              <ListCell>
                {(promo.min_duration_days ?? 0) > 0 ? (
                  <ListStatusText tone="info">{promo.min_duration_days}+ days</ListStatusText>
                ) : (
                  <ListStatusText tone="muted">Manual</ListStatusText>
                )}
              </ListCell>
              {/* Edit and Delete, v1's two buttons, in the ⋯ menu. Clicks on the
                  trigger and on its items (portalled, but still React children
                  of this cell) stop here. */}
              <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={LIST_ROW_ACTION}
                        aria-label={`Actions for promo code ${promo.code}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(promo)}>
                        <FilePenLine className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDelete(promo)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </ListCell>
            </ListRow>
          ))}
        </ListBody>
      </ListTable>
      <ListFooter rows={promoRows} one="promo code" many="promo codes" />
    </>
  );
}
