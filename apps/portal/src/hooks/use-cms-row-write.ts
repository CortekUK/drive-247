import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";

/**
 * The second write path behind the visual editor: TABLE ROWS, not CMS sections.
 *
 * Most of what a visitor reads on the home page is a field in
 * `cms_page_sections.content`, and `use-cms-draft-write.ts` stages those into
 * `draft_content` so the operator can look before they publish. Two things on
 * that page are not: the FAQ questions (`faqs`) and the customer quotes
 * (`testimonials`) are rows in their own tables, with their own portal screens
 * and NO draft column to stage into.
 *
 * Rather than leave those uneditable in the preview — they are some of the most
 * visible text on the page — they carry a `table:` address
 * (`table:faqs.<id>.question`) and land here. The trade is honest and worth
 * stating: **this write is live immediately.** There is nothing to publish,
 * because that is already true of the FAQ and Reviews screens the operator uses
 * today; a draft column on those tables would be a schema change to solve a
 * problem the operator does not currently have.
 *
 * ── why the allow-list ────────────────────────────────────────────────────
 *
 * The path arrives over `postMessage` from the site. The origin check in the
 * editor is the real boundary, but a table name and a column name taken from a
 * message and interpolated into a query is exactly the shape of thing that
 * should not be open-ended. Two tables, four columns, nothing else — and every
 * update is scoped by `tenant_id`, which on this database is the ONLY thing
 * standing between one operator's data and another's (see V2_PLAN §5).
 */

const sb = supabase as any;

/** table -> the columns the preview is allowed to write. */
const WRITABLE: Record<string, readonly string[]> = {
  faqs: ["question", "answer"],
  testimonials: ["review", "author"],
};

/** Which client query key to refresh once the row has changed. */
const QUERY_KEY: Record<string, string> = {
  faqs: "faqs",
  testimonials: "testimonials",
};

export type RowPath = { table: string; id: string; column: string };

/**
 * `table:faqs.<uuid>.question` -> its parts, or null if it is not one of ours.
 *
 * Returns null rather than throwing for anything unrecognised: an unknown path
 * is a bug or a hostile message, and in both cases the right answer is to
 * ignore it, not to abort the editor.
 */
export function parseRowPath(path: string): RowPath | null {
  if (!path.startsWith("table:")) return null;
  const [table, id, column, ...rest] = path.slice("table:".length).split(".");
  if (!table || !id || !column || rest.length > 0) return null;
  if (!WRITABLE[table]?.includes(column)) return null;
  return { table, id, column };
}

export function useCmsRowWrite() {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  const write = useMutation({
    mutationFn: async ({ path, value }: { path: string; value: string }) => {
      const parsed = parseRowPath(path);
      if (!parsed) throw new Error(`Not an editable row: ${path}`);
      if (!tenant?.id) throw new Error("No tenant");

      const { data, error } = await sb
        .from(parsed.table)
        .update({ [parsed.column]: value })
        .eq("id", parsed.id)
        // The isolation boundary. Without it this updates any tenant's row.
        .eq("tenant_id", tenant.id)
        .select("id");
      if (error) throw error;
      // An update that matched nothing is not a success: the row belongs to
      // someone else, or has been deleted since the page was rendered.
      if (!data?.length) throw new Error("That item could not be found any more.");
      return parsed;
    },
    onSuccess: (parsed) => {
      const key = QUERY_KEY[parsed.table];
      if (key) queryClient.invalidateQueries({ queryKey: [key] });
      logAction({
        action: "cms_row_updated",
        entityType: parsed.table,
        entityId: parsed.id,
        details: { column: parsed.column, via: "visual-editor" },
      });
    },
    onError: (err: any) =>
      toast({
        title: "Not saved",
        description: err?.message ?? "That edit could not be saved.",
        variant: "destructive",
      }),
  });

  return { writeRow: write.mutateAsync, isWritingRow: write.isPending };
}
