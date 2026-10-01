"use client";

/**
 * v2 (northwind): the "All promo codes" section under the create form, with
 * every state it can be in.
 *
 *   loading, nothing yet -> a table-shaped skeleton (no jump when rows land);
 *                           stacked rows below `sm`, where the list is rows
 *   read failed, no rows -> "Couldn't load promo codes" + Try again. Never the
 *                           empty copy: "no codes yet" over a failed read tells
 *                           an operator their codes are gone.
 *   read failed, rows    -> the rows, with a one-line "couldn't refresh" above
 *   no codes             -> what a promo code is for, and (for editors) a
 *                           button that jumps to the create form
 *   codes                -> the kit table
 *
 * Copy is a real result: a blocked clipboard says so instead of "Copied!".
 *
 * `action` is the page's "Add promo code" button, beside the heading, as the
 * Extras list carries its "Add Extra" (team lead, Sep 20 2026: the create form
 * moved into a dialog behind it). It is rendered only where the page passes
 * one, so a read-only manager sees the heading alone.
 */

import { TicketPercent } from "lucide-react";
import {
  SettingsEmptyState,
  SettingsLoadError,
} from "@/components/settings-v2/section-states";
import { PromoCodesTableV2, type PromoCodeRowV2 } from "@/components/settings-v2/promo-codes-table-v2";
import { toast } from "@/hooks/use-toast";
import { SETTINGS_SECTION_TITLE } from "@/components/settings-v2/settings-kit";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";

/** Placeholder codes for the list's skeleton: only their shapes are seen. */
const SKELETON_PROMOS: PromoCodeRowV2[] = skeletonRows(4, (f) => ({
  id: f.id,
  name: f.text(2, 3),
  code: f.word(6, 10).toUpperCase(),
  type: f.pick(["percentage", "value"]),
  value: f.int(5, 50),
  created_at: f.date().slice(0, 10),
  expires_at: f.date(-30).slice(0, 10),
  max_users: f.int(10, 200),
  min_duration_days: null,
}));

/** Copies to the clipboard and reports what actually happened. */
export async function copyPromoCode(code: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(code);
    toast({ title: "Copied!", description: "Promo code copied to clipboard" });
    return true;
  } catch {
    toast({
      title: "Couldn't copy",
      description: `Select the code ${code} and copy it manually.`,
      variant: "destructive",
    });
    return false;
  }
}

/** Moves the operator to the create form's first field. */
export function focusPromoCreateForm(fieldId = "v2_promo_name") {
  if (typeof document === "undefined") return;
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.scrollIntoView({ behavior: "smooth", block: "center" });
  field.focus({ preventScroll: true });
}

export function PromoCodesSectionV2<T extends PromoCodeRowV2>({
  promos,
  isLoading,
  error,
  isFetching,
  onRetry,
  canEdit,
  currencyCode,
  resetKey,
  onEdit,
  onDelete,
  onCreateFirst = () => focusPromoCreateForm(),
  action,
}: {
  promos: T[] | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching?: boolean;
  onRetry: () => unknown;
  canEdit: boolean;
  currencyCode: string;
  resetKey: string;
  onEdit: (promo: T) => void;
  onDelete: (promo: T) => void;
  /** Opens the create dialog: the empty state's button, and `action`'s. */
  onCreateFirst?: () => void;
  /** The page's "Add promo code" button, shown beside the heading. */
  action?: React.ReactNode;
}) {
  // Until the first rows arrive, placeholder codes render through the real
  // table (the flat settings panel, an editor's action column included) and
  // <AutoSkeleton> turns them into the skeleton.
  const skeleton = useSkeletonLoading(!Array.isArray(promos) && (isLoading || !error));
  const hasRows = Array.isArray(promos);

  let body: React.ReactNode;
  if (skeleton) {
    body = (
      <AutoSkeleton loading>
        <PromoCodesTableV2
          promos={SKELETON_PROMOS as T[]}
          resetKey="skeleton"
          currencyCode={currencyCode}
          canEdit={canEdit}
          onCopy={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </AutoSkeleton>
    );
  } else if (!hasRows) {
    body = <SettingsLoadError thing="promo codes" error={error} onRetry={onRetry} retrying={isFetching} />;
  } else if (promos.length === 0) {
    body = (
      <SettingsEmptyState
        icon={TicketPercent}
        headline={canEdit ? "No promo codes yet" : "No promo codes have been set up"}
        body={
          canEdit
            ? "Create a code customers type at checkout, or a discount that applies by itself on longer rentals."
            : "Codes customers type at checkout, and discounts for longer rentals, will be listed here once an admin creates them."
        }
        primaryAction={canEdit ? { label: "Create your first code", onClick: onCreateFirst } : undefined}
      />
    );
  } else {
    body = (
      <PromoCodesTableV2
        promos={promos}
        resetKey={resetKey}
        currencyCode={currencyCode}
        canEdit={canEdit}
        onCopy={(code) => void copyPromoCode(code)}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="v2-promo-list-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="v2-promo-list-heading" className={SETTINGS_SECTION_TITLE}>
          All promo codes
        </h2>
        {/* Not over the empty state: there the teaching card's own button is
            the one to press, and two Adds side by side read as two things. */}
        {action && !skeleton && hasRows && promos.length > 0 ? action : null}
      </div>
      {!skeleton && hasRows && Boolean(error) && (
        <SettingsLoadError variant="inline" thing="promo codes" error={error} onRetry={onRetry} retrying={isFetching} />
      )}
      {body}
    </section>
  );
}
