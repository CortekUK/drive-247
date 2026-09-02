import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/contexts/TenantContext";
import type { CMSPageVersion } from "@/types/cms";

export const useCMSVersions = (pageSlug: string) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();

  // Helper to get page by slug with tenant filtering
  const getPageBySlug = async () => {
    let query = supabase
      .from("cms_pages")
      .select("id")
      .eq("slug", pageSlug);

    // Filter by tenant if available
    if (tenant?.id) {
      query = query.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`);
    }

    return query.single();
  };

  // Fetch all versions for a page (filtered by tenant)
  const { data: versions = [], isLoading, error } = useQuery({
    queryKey: ["cms-versions", pageSlug, tenant?.id],
    queryFn: async () => {
      // First get the page id (with tenant filtering)
      const { data: page, error: pageError } = await getPageBySlug();

      if (pageError) {
        if (pageError.code === "PGRST116") return [];
        throw pageError;
      }

      // Get versions
      let versionsQuery = supabase
        .from("cms_page_versions")
        .select("*")
        .eq("page_id", page.id)
        .order("version_number", { ascending: false });

      if (tenant?.id) {
        versionsQuery = versionsQuery.eq("tenant_id", tenant.id);
      }

      const { data, error } = await versionsQuery;

      if (error) throw error;
      return data as CMSPageVersion[];
    },
    enabled: !!pageSlug && !!tenant,
  });

  // Rollback to a specific version
  const rollbackMutation = useMutation({
    mutationFn: async (versionId: string) => {
      // Get the version content - validate tenant ownership through page
      let versionQuery = supabase
        .from("cms_page_versions")
        .select("*, page:cms_pages!cms_page_versions_page_id_fkey(id, slug, tenant_id)")
        .eq("id", versionId);

      const { data: version, error: versionError } = await versionQuery.single();

      if (versionError) throw versionError;

      // Validate tenant ownership
      if (tenant?.id && version.page.tenant_id && version.page.tenant_id !== tenant.id) {
        throw new Error("Access denied: Version belongs to a different tenant");
      }

      const pageId = version.page.id;
      const sections = version.content as any[];

      // Delete current sections
      let deleteQuery = supabase
        .from("cms_page_sections")
        .delete()
        .eq("page_id", pageId);

      if (tenant?.id) {
        deleteQuery = deleteQuery.eq("tenant_id", tenant.id);
      }

      await deleteQuery;

      // Insert version sections (with new IDs)
      if (sections && sections.length > 0) {
        const newSections = sections.map((s: any) => ({
          page_id: pageId,
          section_key: s.section_key,
          content: s.content,
          display_order: s.display_order,
          is_visible: s.is_visible,
          tenant_id: tenant?.id || null,
        }));

        const { error: insertError } = await supabase
          .from("cms_page_sections")
          .insert(newSections);

        if (insertError) throw insertError;
      }

      // Set page status back to draft (requires re-publish)
      let updateQuery = supabase
        .from("cms_pages")
        .update({
          status: "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("id", pageId);

      if (tenant?.id) {
        updateQuery = updateQuery.eq("tenant_id", tenant.id);
      }

      await updateQuery;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-page", pageSlug] });
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast({
        title: "Version Restored",
        description: "Page content has been restored to the selected version. Publish to make it live.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to restore version.",
        variant: "destructive",
      });
    },
  });

  // Delete old versions (keep last N)
  const cleanupVersionsMutation = useMutation({
    mutationFn: async (keepCount: number = 10) => {
      // Get page with tenant filtering
      const { data: page, error: pageError } = await getPageBySlug();

      if (pageError || !page) throw new Error("Page not found");

      // Get versions to keep
      let versionsToKeepQuery = supabase
        .from("cms_page_versions")
        .select("id")
        .eq("page_id", page.id)
        .order("version_number", { ascending: false })
        .limit(keepCount);

      if (tenant?.id) {
        versionsToKeepQuery = versionsToKeepQuery.eq("tenant_id", tenant.id);
      }

      const { data: versionsToKeep } = await versionsToKeepQuery;

      const keepIds = versionsToKeep?.map((v) => v.id) || [];

      if (keepIds.length === 0) return;

      // Delete older versions
      let deleteQuery = supabase
        .from("cms_page_versions")
        .delete()
        .eq("page_id", page.id)
        .not("id", "in", `(${keepIds.join(",")})`);

      if (tenant?.id) {
        deleteQuery = deleteQuery.eq("tenant_id", tenant.id);
      }

      const { error } = await deleteQuery;

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-versions", pageSlug] });
      toast({
        title: "Versions Cleaned Up",
        description: "Old versions have been removed.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cleanup versions.",
        variant: "destructive",
      });
    },
  });

  return {
    versions,
    isLoading,
    error,
    rollback: rollbackMutation.mutate,
    rollbackAsync: rollbackMutation.mutateAsync,
    cleanupVersions: cleanupVersionsMutation.mutate,
    isRollingBack: rollbackMutation.isPending,
  };
};
