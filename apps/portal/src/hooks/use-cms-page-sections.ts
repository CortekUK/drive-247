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
    // Give the tenant its own page instead (deliberately empty — see below).
    if (tenant?.id && result.data && result.data.tenant_id === null) {
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

      // The new page is left EMPTY on purpose — its sections are NOT copied
      // from the global row.
      //
      // Seeding from the global page looks helpful and is actively harmful: the
      // global site-settings sections hold Drive 247's OWN contact details
      // (+19725156635, info@drive247.com, facebook.com/drive247, "© Drive 247").
      // Today those are inert, because booking's site-settings reader is
      // tenant-scoped and never falls back to the global row. Copying them makes
      // them tenant-OWNED, and useSiteSettings applies `contact.phone ||
      // tenantSettings.phone` — so a copied value would WIN over the operator's
      // real phone number and publish another company's details on their site.
      //
      // Empty is strictly safer: the editor already supplies per-section
      // defaults, and booking already falls back to the tenants row for phone,
      // email, address and copyright.
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
