"use client";

/**
 * v2 (northwind): the /cms/blog posts table, built from the rentals list's kit
 * (`components/shared/list-table-v2`). No pager: rows arrive 25 at a time as the
 * table scrolls, with one line under the card saying how much is shown. No card
 * twin on phones: the table scrolls sideways instead.
 *
 * The page fetches page 1 of up to 1,000 posts through the same `useBlogPosts`
 * hook (with the server's status, category and title filters, as v1), asking
 * only for `BLOG_POST_LIST_COLUMNS_V2`, so a thousand rows never carry every
 * article's HTML body. `serverTotal` is the exact count of that same filtered
 * set, so a capped list says so instead of claiming every post is shown.
 *
 * The row opens the post editor at /cms/blog/:id, where v1's row and its
 * Edit/View button both went, so that button has no column here. Delete is the
 * page's own: the same `hasEditAccess` gate and the same `setDeleteTarget`, so
 * the page's confirmation dialog and `handleDelete` run exactly as in v1.
 */

import { formatDistanceToNow, format } from "date-fns";
import { MoreHorizontal, Trash2 } from "lucide-react";
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
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
  type ListTone,
} from "@/components/shared/list-table-v2";
import type { BlogPost } from "@/types/blog";

/**
 * Every column this table (and the page's delete dialog, which reads `id` and
 * `title`) uses. Rows fetched with it carry only these fields. Add a column here
 * before reading a new field from a v2 row.
 */
export const BLOG_POST_LIST_COLUMNS_V2 =
  "id, title, excerpt, status, is_featured, author_name, published_at, created_at, category_id, category:blog_categories(id, name)";

const Blank = () => <span className="text-muted-foreground">—</span>;

/** v1's two labels, keyed on the lower-cased status. Anything else reads "Draft", as v1's else-branch does. */
const POST_STATUS_V2: Record<string, { label: string; tone: ListTone }> = {
  published: { label: "Published", tone: "success" },
  draft: { label: "Draft", tone: "muted" },
};

function postStatusV2(status: string | null | undefined) {
  return POST_STATUS_V2[String(status ?? "").toLowerCase()] ?? POST_STATUS_V2.draft;
}

export function BlogPostsTableV2({
  posts,
  resetKey,
  serverTotal,
  canDelete,
  onOpen,
  onDelete,
}: {
  /** Every post the query returned, in its order (newest first). Not a page slice. */
  posts: BlogPost[];
  /** Changes with the result set only: see `useProgressiveRows`. */
  resetKey: string;
  /** The query's exact count for the same filters. */
  serverTotal: number;
  /** The page's `hasEditAccess`, which gates v1's Delete button. */
  canDelete: boolean;
  /** The v1 row's destination. */
  onOpen: (post: BlogPost) => void;
  /** The v1 Delete button's handler. */
  onDelete: (post: BlogPost) => void;
}) {
  const postRows = useProgressiveRows(posts, resetKey);

  return (
    <>
      <ListTable rows={postRows} minWidth="min-w-[880px]">
        <ListTableHeader>
          {/* Widths, measured in Manrope on a 944px card and at the 880px
              minimum. Status and Date hold their longest values in full
              ("Published"; "less than a minute ago", "about 11 months ago",
              "Sep 30, 2026"). Title, Category and Author truncate, each with
              its full value in a title. */}
          <ListHead className="w-[32%]">Title</ListHead>
          <ListHead className="w-[15%]">Category</ListHead>
          <ListHead className="w-[11%]">Status</ListHead>
          <ListHead className="w-[15%]">Author</ListHead>
          <ListHead className="w-[20%]">Date</ListHead>
          {/* 7%: at the 880px minimum, 6% leaves the 32px menu button 3px
              short of its cell. */}
          <ListHead className="w-[7%] text-right">
            <span className="sr-only">Actions</span>
          </ListHead>
        </ListTableHeader>
        <ListBody>
          {postRows.visible.map((post) => {
            const status = postStatusV2(post.status);
            const categoryName = post.category?.name;
            // v1's second line under the title, which a one-line row has no room
            // for, is kept readable in the title's tooltip.
            const titleTooltip = post.excerpt ? `${post.title}\n${post.excerpt}` : post.title;

            return (
              <ListRow key={post.id} onOpen={() => onOpen(post)}>
                <ListCell>
                  <div className="flex min-w-0 items-center gap-1.5">
                    {/* A real button, so the post stays reachable by keyboard. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(post);
                      }}
                      title={titleTooltip}
                      className={`${LIST_CLASSES.identifier} truncate text-left hover:underline`}
                    >
                      {post.title}
                    </button>
                    {post.is_featured && (
                      <span className="shrink-0">
                        <ListMetaChip>Featured</ListMetaChip>
                      </span>
                    )}
                  </div>
                </ListCell>
                <ListCell>
                  {categoryName ? (
                    <span className={`block truncate ${LIST_CLASSES.text}`} title={categoryName}>
                      {categoryName}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell>
                  <ListStatusText tone={status.tone}>{status.label}</ListStatusText>
                </ListCell>
                <ListCell>
                  {post.author_name ? (
                    <span className={`block truncate ${LIST_CLASSES.text}`} title={post.author_name}>
                      {post.author_name}
                    </span>
                  ) : (
                    <Blank />
                  )}
                </ListCell>
                <ListCell className="tabular-nums">
                  {/* v1's expression: the publish date, else how long ago the draft was created. */}
                  <span className={LIST_CLASSES.text}>
                    {post.published_at
                      ? format(new Date(post.published_at), "MMM d, yyyy")
                      : formatDistanceToNow(new Date(post.created_at), {
                          addSuffix: true,
                        })}
                  </span>
                </ListCell>
                {/* The menu must not open the post: clicks on the trigger and on
                    its item (portalled, but still React children of this cell)
                    stop here, or one click would open the confirmation and
                    navigate to the editor underneath it. */}
                <ListCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {canDelete && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={LIST_ROW_ACTION}
                          aria-label={`Actions for ${post.title}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-auto">
                        <DropdownMenuItem
                          onClick={() => onDelete(post)}
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
            );
          })}
        </ListBody>
      </ListTable>
      <ListFooter rows={postRows} one="post" many="posts" serverTotal={serverTotal} />
    </>
  );
}
