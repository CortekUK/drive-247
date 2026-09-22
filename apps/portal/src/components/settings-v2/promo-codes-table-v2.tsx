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
 * its neighbour says.
 *
 * EXTREME DATA. A long code truncates with the full code in its title (the copy
 * button still copies all of it). Money and percentages are never cut: a
 * too-wide amount wraps inside its cell instead of running into the next one.
 * An expired code says so. Below `sm` the 880px table would hide Value, Expires
 * and the ⋯ menu off the right edge with no scroll cue, so phones get one
 * stacked row per code instead, with the same menu and the same footer.
 */

import { format } from "date-fns";
import { Copy, FilePenLine, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  TruncatedText,
} from "@/components/settings-v2/section-states";
import { parseLocalDate } from "@/lib/date-utils";
import { isPromoExpired } from "@/lib/settings-money-states";
import { cn } from "@/lib/utils";

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
 * parse prints as a dash with the raw text in its title.
 */
function promoDateLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = parseLocalDate(value);
  return Number.isNaN(date.getTime()) ? null : format(date, "PP");
}

function PromoDate({ value, expiry }: { value: string | null | undefined; expiry?: boolean }) {
  const label = promoDateLabel(value);
  if (!label) {
    return value ? (
      <span className="text-muted-foreground" title={value}>
        —
      </span>
    ) : (
      <Blank />
    );
  }
  if (expiry && isPromoExpired(value)) {
    // Each part keeps to one line; the pair wraps between them when the column
    // is too narrow (the cell allows it), instead of running into Max users.
    return (
      <span className="block">
        <span className="whitespace-nowrap text-muted-foreground">{label}</span>{" "}
        <span className="whitespace-nowrap">
          <ListStatusText tone="danger">Expired</ListStatusText>
        </span>
      </span>
    );
  }
  return <span className={LIST_CLASSES.text}>{label}</span>;
}

/** "12.5%" or the tenant's money, never truncated. */
export function promoValueLabel(promo: Pick<PromoCodeRowV2, "type" | "value">, currencyCode: string): string {
  return promo.type === "percentage"
    ? formatSettingsNumber(promo.value, { suffix: "%" })
    : formatSettingsMoney(promo.value, currencyCode);
}

interface PromoMenuProps<T> {
  promo: T;
  onEdit: (promo: T) => void;
  onDelete: (promo: T) => void;
}

function PromoRowMenu<T extends PromoCodeRowV2>({ promo, onEdit, onDelete }: PromoMenuProps<T>) {
  return (
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
      {/* Surface tone: this row menu sits on a light Settings table, where the
          default translucent near-black panel reads as an OS menu. */}
      <DropdownMenuContent tone="surface" align="end" className="w-auto">
        <DropdownMenuItem onClick={() => onEdit(promo)}>
          <FilePenLine className="h-4 w-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(promo)}>
          <Trash2 className="h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CopyCode({ code, onCopy, className }: { code: string; onCopy: (code: string) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onCopy(code)}
      title={code}
      aria-label={`Copy promo code ${code}`}
      className={cn("group flex min-w-0 max-w-full items-center gap-1.5 text-left", className)}
    >
      <span className={`min-w-0 truncate font-mono text-[13px] ${LIST_CLASSES.text}`}>{code}</span>
      <Copy className="size-3 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
    </button>
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
      {/* Phones: one stacked row per code. The table below is hidden here. */}
      <ul className="space-y-2 sm:hidden" aria-label="Promo codes">
        {promoRows.visible.map((promo) => (
          <li key={promo.id} className="flex items-start gap-3 rounded-2xl bg-muted/40 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1">
              <TruncatedText text={promo.name} className={LIST_CLASSES.identifier} />
              <CopyCode code={promo.code} onCopy={onCopy} />
              <p className={cn(SETTINGS_PHONE_FACTS.line, "text-sm")}>
                <span
                  className={cn(
                    "tabular-nums [overflow-wrap:anywhere]",
                    LIST_CLASSES.text,
                    Number(promo.value) < 0 && "text-red-500 dark:text-red-400",
                  )}
                >
                  {promoValueLabel(promo, currencyCode)}
                </span>
                <span className={cn("tabular-nums", SETTINGS_PHONE_FACTS.afterDot)}>
                  <PromoDate value={promo.expires_at} expiry />
                </span>
              </p>
              <p className={cn(SETTINGS_PHONE_FACTS.line, "text-xs text-muted-foreground tabular-nums")}>
                <span>{formatSettingsNumber(promo.max_users)} max uses</span>
                <span className={SETTINGS_PHONE_FACTS.afterDot}>
                  {(promo.min_duration_days ?? 0) > 0
                    ? `Applies by itself on ${formatSettingsNumber(promo.min_duration_days)}+ days`
                    : "Typed at checkout"}
                </span>
              </p>
            </div>
            {canEdit && <PromoRowMenu promo={promo} onEdit={onEdit} onDelete={onDelete} />}
          </li>
        ))}
      </ul>

      <div className="hidden sm:block">
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
                  {/* A block <button> is only as wide as its content, so it is centred as a box (mx-auto), as the column is. */}
                  <CopyCode code={promo.code} onCopy={onCopy} className="mx-auto justify-center text-center" />
                </ListCell>
                {/* Never truncated: an ellipsis here hides money. A value too wide
                    for the column wraps inside it instead of overlapping. */}
                <ListCell className="tabular-nums">
                  <span
                    className={cn(
                      "block [overflow-wrap:anywhere]",
                      LIST_CLASSES.text,
                      Number(promo.value) < 0 && "text-red-500 dark:text-red-400",
                    )}
                  >
                    {promoValueLabel(promo, currencyCode)}
                  </span>
                </ListCell>
                <ListCell className="tabular-nums">
                  <PromoDate value={promo.created_at} />
                </ListCell>
                <ListCell className="tabular-nums whitespace-normal">
                  <PromoDate value={promo.expires_at} expiry />
                </ListCell>
                <ListCell className="tabular-nums">
                  <span className={`block [overflow-wrap:anywhere] ${LIST_CLASSES.text}`}>
                    {formatSettingsNumber(promo.max_users)}
                  </span>
                </ListCell>
                {/* v1's amber badge for an auto-applied code, as coloured text. */}
                <ListCell>
                  {(promo.min_duration_days ?? 0) > 0 ? (
                    <ListStatusText tone="info">{formatSettingsNumber(promo.min_duration_days)}+ days</ListStatusText>
                  ) : (
                    <ListStatusText tone="muted">Manual</ListStatusText>
                  )}
                </ListCell>
                {/* Edit and Delete, v1's two buttons, in the ⋯ menu. Clicks on the
                    trigger and on its items (portalled, but still React children
                    of this cell) stop here. */}
                <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {canEdit && <PromoRowMenu promo={promo} onEdit={onEdit} onDelete={onDelete} />}
                </ListCell>
              </ListRow>
            ))}
          </ListBody>
        </ListTable>
      </div>
      <ListFooter rows={promoRows} one="promo code" many="promo codes" />
    </>
  );
}
