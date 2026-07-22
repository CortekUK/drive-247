import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";
import type { CMSPageSection } from "@/types/cms";

export const useCMSPageSections = (pageSlug: string) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();

  // Helper to get page by slug with tenant filtering.
  // A slug can resolve to both a tenant-specific row AND a shared global row
  // (tenant_id null) — e.g. "site-settings". `.single()` threw on that (2 rows)
  // and also on 0 rows, which broke CMS logo saves. Prefer the tenant row, fall
  // back to the global one: order tenant-first (non-null tenant_id sorts ahead
  // of null via nullsFirst:false), take one, and use `.maybeSingle()` so 0/2
  // rows no longer throw. Behaviour is identical when exactly one row exists.
  const getPageBySlug = async () => {
    let query = supabase
      .from("cms_pages")
      .select("id, tenant_id, name, description")
      .eq("slug", pageSlug);

    // Filter by tenant if available
    if (tenant?.id) {
      query = query
        .or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)
        .order("tenant_id", { ascending: false, nullsFirst: false });
    }

    const result = await query.limit(1).maybeSingle();

    // CROSS-TENANT GUARD. If the only row for this slug is the SHARED global one
    // (tenant_id IS NULL), we must not write to it: that row is the fallback for
    // every tenant that lacks its own, so one operator's edits would surface on
    // other operators' sites. It is also unpublishable from here — publishPage
    // filters `.eq("tenant_id", tenant.id)`, so publishing a global row matches
    // zero rows, reports success, and the change never goes live. That silent
    // dead end is exactly what a logo upload ran into.
    //
    // Give the tenant its own page instead, seeded with whatever the global row
    // was showing them so nothing they were looking at disappears.
    if (tenant?.id && result.data && result.data.tenant_id === null) {
      const globalPageId = result.data.id;

      const { data: created, error: createError } = await supabase
        .from("cms_pages")
        .insert({
          slug: pageSlug,
          name: result.data.name ?? pageSlug,
          description: result.data.description ?? null,
          status: "draft",
          tenant_id: tenant.id,
        })
        .select("id, tenant_id, name, description")
        .single();

      // If we cannot create one (RLS, race with another tab), fall through to
      // the original result rather than blocking the save outright — the
      // pre-existing behaviour — but never silently prefer the global row when
      // a tenant row now exists.
      if (createError || !created) {
        const { data: retry } = await supabase
          .from("cms_pages")
          .select("id, tenant_id, name, description")
          .eq("slug", pageSlug)
          .eq("tenant_id", tenant.id)
          .limit(1)
          .maybeSingle();
        if (retry) return { data: retry, error: null };
        return result;
      }

      // Copy the global page's sections across so the tenant starts from what
      // they saw, not from an empty page.
      const { data: globalSections } = await supabase
        .from("cms_page_sections")
        .select("section_key, content, is_visible, display_order")
        .eq("page_id", globalPageId);

      if (globalSections && globalSections.length > 0) {
        await supabase.from("cms_page_sections").insert(
          globalSections.map((s) => ({
            page_id: created.id,
            // cms_page_sections carries its own tenant_id; leaving it null on a
            // tenant-owned page would recreate the very ambiguity being fixed.
            tenant_id: tenant.id,
            section_key: s.section_key,
            content: s.content,
            is_visible: s.is_visible ?? true,
            display_order: s.display_order ?? 0,
          }))
        );
      }

      return { data: created, error: null };
    }

    return result;
  };

  // Update a single section
  const updateSectionMutation = useMutation({
    mutationFn: async ({
      sectionKey,
      content,
    }: {
      sectionKey: string;
      content: Record<string, any>;
    }) => {
      // First get the page id from slug (with tenant filtering)
      const { data: page, error: pageError } = await getPageBySlug();

      if (pageError) throw pageError;
      if (!page) throw new Error(`CMS page "${pageSlug}" not found`);

      // Upsert the section
      const { error } = await supabase
        .from("cms_page_sections")
        .upsert(
          {
            page_id: page.id,
            section_key: sectionKey,
            content,
            updated_at: new Date().toISOString(),
            tenant_id: tenant?.id || null,
          },
          {
            onConflict: "page_id,section_key",
          }
        );

      if (error) throw error;

      // Also update the page's updated_at timestamp
      await supabase
        .from("cms_pages")
        .update({ updated_at: new Date().toISOString(), status: "draft" })
        .eq("id", page.id);

      return page.id;
    },
    onSuccess: (pageId, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cms-page", pageSlug] });
      toast({
        title: "Section Saved",
        description: "Your changes have been saved as a draft.",
      });
      logAction({
        action: "cms_section_updated",
        entityType: "cms_section",
        entityId: pageId,
        details: { pageSlug, sectionKey: variables.sectionKey },
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save section.",
        variant: "destructive",
      });
    },
  });

  // Update multiple sections at once
  const updateMultipleSectionsMutation = useMutation({
    mutationFn: async (
      sections: { sectionKey: string; content: Record<string, any> }[]
    ) => {
      // Get the page id (with tenant filtering)
      const { data: page, error: pageError } = await getPageBySlug();

      if (pageError) throw pageError;
      if (!page) throw new Error(`CMS page "${pageSlug}" not found`);

      // Prepare upsert data
      const upsertData = sections.map((s) => ({
        page_id: page.id,
        section_key: s.sectionKey,
        content: s.content,
        updated_at: new Date().toISOString(),
        tenant_id: tenant?.id || null,
      }));

      // Upsert all sections
      const { error } = await supabase
        .from("cms_page_sections")
        .upsert(upsertData, {
          onConflict: "page_id,section_key",
        });

      if (error) throw error;

      // Update page timestamp
      await supabase
        .from("cms_pages")
        .update({ updated_at: new Date().toISOString(), status: "draft" })
        .eq("id", page.id);

      return page.id;
    },
    onSuccess: (pageId, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cms-page", pageSlug] });
      toast({
        title: "All Sections Saved",
        description: "Your changes have been saved as a draft.",
      });
      logAction({
        action: "cms_section_updated",
        entityType: "cms_section",
        entityId: pageId,
        details: { pageSlug, sectionKeys: variables.map(s => s.sectionKey), count: variables.length },
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save sections.",
        variant: "destructive",
      });
    },
  });

  // Toggle section visibility
  const toggleVisibilityMutation = useMutation({
    mutationFn: async ({
      sectionId,
      isVisible,
    }: {
      sectionId: string;
      isVisible: boolean;
    }) => {
      let query = supabase
        .from("cms_page_sections")
        .update({ is_visible: isVisible })
        .eq("id", sectionId);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["cms-page", pageSlug] });
      logAction({
        action: "cms_section_visibility_toggled",
        entityType: "cms_section",
        entityId: variables.sectionId,
        details: { isVisible: variables.isVisible },
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update visibility.",
        variant: "destructive",
      });
    },
  });

  return {
    updateSection: updateSectionMutation.mutate,
    updateSectionAsync: updateSectionMutation.mutateAsync,
    updateMultipleSections: updateMultipleSectionsMutation.mutate,
    toggleVisibility: toggleVisibilityMutation.mutate,
    isUpdating: updateSectionMutation.isPending || updateMultipleSectionsMutation.isPending,
  };
};
