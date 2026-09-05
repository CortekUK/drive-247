import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";

/**
 * The visual editor's write path: pending edits, then a real Publish.
 *
 * Unlike `use-cms-section-write.ts` (which writes the LIVE `content` and is
 * what the field editor uses), this writes `cms_page_sections.draft_content` —
 * the column added for exactly this. The public site never reads it. So an
 * operator can rewrite a headline on the live preview, look at it, and only
 * then put it on the site, which is the "edit in the preview, then publish"
 * model this editor promises.
 *
 * Paths come from the site itself — every editable node carries its own
 * address, `home.home_hero.headline` or `about.why_choose_us.items.2.title`
 * (see v2/apps/web/src/lib/cms/editable.tsx). The first segment is the CMS
 * page, the second the section key, the rest the field path inside the
 * section's JSON, exactly as stored. One rendered page draws from several CMS
 * pages (the home page reads `about` and `promotions` keys too), so this hook
 * is NOT scoped to a page: it resolves the page row per write.
 */

const sb = supabase as any;

type Row = { id: string; page_id: string; content: any; draft_content: any };

function setPath(obj: any, keys: string[], value: any): any {
  const [head, ...rest] = keys;
  const isIndex = /^\d+$/.test(head);
  const base = Array.isArray(obj) ? [...obj] : obj && typeof obj === "object" ? { ...obj } : isIndex ? [] : {};
  const k: any = isIndex ? Number(head) : head;
  base[k] = rest.length === 0 ? value : setPath(base[k], rest, value);
  return base;
}

export function useCmsDraftWrite(previewSlug: string) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  /** Tenant-scoped page lookup. Never the shared global row (tenant_id NULL). */
  const pageId = useCallback(
    async (slug: string): Promise<string> => {
      if (!tenant?.id) throw new Error("No tenant");
      const { data, error } = await sb
        .from("cms_pages")
        .select("id")
        .eq("slug", slug)
        .eq("tenant_id", tenant.id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data?.id) return data.id;
      // The tenant has no row of its own for this page yet — give it one
      // rather than writing to the global fallback every tenant shares.
      const { data: created, error: createError } = await sb
        .from("cms_pages")
        .insert({ slug, name: slug, status: "draft", tenant_id: tenant.id })
        .select("id")
        .single();
      if (createError || !created) throw createError ?? new Error("Could not create page");
      return created.id;
    },
    [tenant?.id]
  );

  /**
   * Pending edits across the WHOLE site for this tenant, keyed by page slug.
   * The preview of one page may carry drafts from three pages, and Publish
   * has to publish all of them or the operator sees a half-published site.
   */
  const drafts = useQuery({
    queryKey: ["cms-drafts", tenant?.id],
    queryFn: async () => {
      const { data, error } = await sb
        .from("cms_page_sections")
        .select("id, section_key, page:cms_pages!cms_page_sections_page_id_fkey(slug)")
        .eq("tenant_id", tenant!.id)
        .not("draft_content", "is", null);
      if (error) throw error;
      return (data ?? []) as { id: string; section_key: string; page: { slug: string } | null }[];
    },
    enabled: !!tenant?.id,
  });

  const writeDraft = useMutation({
    mutationFn: async ({ path, value }: { path: string; value: string }) => {
      const [slug, sectionKey, ...field] = path.split(".");
      if (!slug || !sectionKey || field.length === 0) throw new Error(`Bad CMS path: ${path}`);
      const page_id = await pageId(slug);

      const { data: row, error } = await sb
        .from("cms_page_sections")
        .select("id, page_id, content, draft_content")
        .eq("page_id", page_id)
        .eq("section_key", sectionKey)
        .eq("tenant_id", tenant!.id)
        .maybeSingle();
      if (error) throw error;

      const current = (row as Row | null)?.draft_content ?? (row as Row | null)?.content ?? {};
      const next = setPath(current, field, value);

      const { error: writeError } = await sb.from("cms_page_sections").upsert(
        { page_id, section_key: sectionKey, tenant_id: tenant!.id, draft_content: next },
        { onConflict: "page_id,section_key" }
      );
      if (writeError) throw writeError;
      return { slug, sectionKey };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cms-drafts", tenant?.id] }),
    onError: (err: any) =>
      toast({ title: "Not saved", description: err?.message ?? "That edit could not be saved.", variant: "destructive" }),
  });

  /** Move every pending edit into the live content and put the pages on the site. */
  const publish = useMutation({
    mutationFn: async () => {
      const { data: rows, error } = await sb
        .from("cms_page_sections")
        .select("id, page_id, draft_content")
        .eq("tenant_id", tenant!.id)
        .not("draft_content", "is", null);
      if (error) throw error;

      const pages = new Set<string>();
      for (const r of (rows ?? []) as Row[]) {
        const { error: e } = await sb
          .from("cms_page_sections")
          .update({ content: r.draft_content, draft_content: null, updated_at: new Date().toISOString() })
          .eq("id", r.id)
          .eq("tenant_id", tenant!.id);
        if (e) throw e;
        pages.add(r.page_id);
      }

      // The previewed page goes live even if it had no pending edit — that is
      // what the operator pressed the button for.
      pages.add(await pageId(previewSlug));

      const { data: { user } } = await supabase.auth.getUser();
      const { data: appUser } = await sb.from("app_users").select("id").eq("auth_user_id", user?.id).maybeSingle();

      for (const id of pages) {
        // Snapshot for history, then flip the page on. Same two writes
        // `useCMSPages().publishPage` does, without its per-page toasts.
        const { data: sections } = await sb.from("cms_page_sections").select("*").eq("page_id", id).eq("tenant_id", tenant!.id);
        const { data: last } = await sb.from("cms_page_versions").select("version_number").eq("page_id", id).eq("tenant_id", tenant!.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
        await sb.from("cms_page_versions").insert({
          page_id: id, version_number: (last?.version_number ?? 0) + 1, content: sections,
          created_by: appUser?.id ?? null, notes: "Published from the visual editor", tenant_id: tenant!.id,
        });
        const { data: published, error: pe } = await sb
          .from("cms_pages")
          .update({ status: "published", published_at: new Date().toISOString(), published_by: appUser?.id ?? null })
          .eq("id", id).eq("tenant_id", tenant!.id).select("id");
        if (pe) throw pe;
        if (!published?.length) throw new Error("This page could not be published for your account.");
      }
      return pages.size;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ["cms-drafts", tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      queryClient.invalidateQueries({ queryKey: ["cms-page"] });
      toast({ title: "Published", description: `Your changes are on the website.` });
      logAction({ action: "cms_page_published", entityType: "cms_page", entityId: previewSlug, details: { pages: n, via: "visual-editor" } });
    },
    onError: (err: any) => toast({ title: "Not published", description: err?.message, variant: "destructive" }),
  });

  const discard = useMutation({
    mutationFn: async () => {
      const { error } = await sb
        .from("cms_page_sections")
        .update({ draft_content: null })
        .eq("tenant_id", tenant!.id)
        .not("draft_content", "is", null);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cms-drafts", tenant?.id] }),
  });

  return {
    pendingSections: drafts.data ?? [],
    writeDraft: writeDraft.mutateAsync,
    isWriting: writeDraft.isPending,
    publish: publish.mutateAsync,
    isPublishing: publish.isPending,
    discard: discard.mutateAsync,
    isDiscarding: discard.isPending,
  };
}
