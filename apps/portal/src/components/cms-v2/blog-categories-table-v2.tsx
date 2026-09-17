"use client";

/**
 * v2 (northwind): the /cms/blog/categories table, built from the rentals list's
 * kit (`components/shared/list-table-v2`). No pager: rows arrive 25 at a time
 * as the table scrolls, with one line under the card saying how much is shown.
 *
 * `useBlogCategories` returns every category in memory (no range, no count), so
 * a growing slice is the whole mechanism and there is no `serverTotal`.
 *
 * Rows open nothing: a category has no page, and Edit opens the page's dialog,
 * which is an action, not a destination. Edit and Delete are the page's own
 * handlers (`openEdit`, `setDeleteTarget`) behind the same `hasEditAccess` gate,
 * so the dialog, the post-count warning and `handleDelete` run exactly as in v1.
 */

import { Edit, MoreHorizontal, Trash2 } from "lucide-react";
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
  ListRow,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
} from "@/components/shared/list-table-v2";
import type { BlogCategoryWithCount } from "@/types/blog";

export function BlogCategoriesTableV2({
  categories,
  resetKey,
  canEdit,
  onEdit,
  onDelete,
}: {
  /** Every category, in the query's order (display order, then name). */
  categories: BlogCategoryWithCount[];
  /** Changes with the result set only: see `useProgressiveRows`. */
  resetKey: string;
  /** The page's `hasEditAccess`, which gates v1's Edit and Delete buttons. */
  canEdit: boolean;
  /** The v1 Edit button's handler. */
  onEdit: (category: BlogCategoryWithCount) => void;
  /** The v1 Delete button's handler. */
  onDelete: (category: BlogCategoryWithCount) => void;
}) {
  const categoryRows = useProgressiveRows(categories, resetKey);

  return (
    <>
      <ListTable rows={categoryRows} minWidth="min-w-[720px]">
        <ListTableHeader>
          {/* Widths, measured in Manrope on a 944px card and at the 720px
              minimum. Posts and Order hold their numbers in full, and Actions
              holds the 32px menu button at 720px. Name and Slug truncate, each
              with its full value in a title. */}
          <ListHead className="w-[39%]">Name</ListHead>
          <ListHead className="w-[29%]">Slug</ListHead>
          <ListHead className="w-[12%]">Posts</ListHead>
          <ListHead className="w-[12%]">Order</ListHead>
          <ListHead className="w-[8%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {categoryRows.visible.map((cat) => (
            <ListRow key={cat.id}>
              <ListCell>
                {/* v1's description line under the name, which a one-line row
                    has no room for, is kept readable in the name's tooltip. */}
                <span
                  className={`block truncate ${LIST_CLASSES.identifier}`}
                  title={cat.description ? `${cat.name}\n${cat.description}` : cat.name}
                >
                  {cat.name}
                </span>
              </ListCell>
              <ListCell>
                <span className="block truncate text-muted-foreground" title={cat.slug}>
                  {cat.slug}
                </span>
              </ListCell>
              <ListCell className="tabular-nums">
                <span className={LIST_CLASSES.text}>{cat.post_count}</span>
              </ListCell>
              <ListCell className="tabular-nums">
                <span className={LIST_CLASSES.text}>{cat.display_order}</span>
              </ListCell>
              {/* Rows open nothing, but the menu stops its clicks anyway, as on
                  every v2 table, so a row click added later cannot fire from it. */}
              <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={LIST_ROW_ACTION}
                        aria-label={`Actions for ${cat.name}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto">
                      <DropdownMenuItem onClick={() => onEdit(cat)}>
                        <Edit className="h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onDelete(cat)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
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
      <ListFooter rows={categoryRows} one="category" many="categories" />
    </>
  );
}
